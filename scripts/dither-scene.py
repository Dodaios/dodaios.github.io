#!/usr/bin/env python3
"""Print the section-3 photographs as a one-bit dither — one on paper, one in ink.

Run from the repo root with the two source photographs beside it:

    python scripts/dither-scene.py <manual-src.png> <voice-src.png>

It writes src/assets/scene/manual.png and voice.png at the dither grid's own
resolution. They are NOT scaled up here: the page draws them onto a canvas with
smoothing off, so one source dot lands on a whole number of device pixels
instead of being resampled into mush.

THE TWO FRAMES ARE INVERSES OF EACH OTHER, and that is the whole design.

  manual  daylight  -> dark dots on paper   (ground --ink,    dots --canvas)
  voice   night     -> light dots on ink    (ground --canvas, dots --ink)

The page floor is the second ground. So the wipe between them does not merely
swap two pictures: it settles the section onto the colour the rest of the site
already stands on, and the state the product is selling is the one that stops
fighting the page. Two tokens do all of it — there is no third colour anywhere
in the treatment.

WHY THE GAMMA IS SOLVED AND NOT SET. A photograph's tone curve decides how many
cells carry a dot, and the two sources here sit two and a half stops apart: the
daylight frame is nearly blown out, the night frame is nearly black. One
hand-tuned exponent cannot serve both, and a pair whose ink coverage differs is
a pair where the wipe reads as the picture getting heavier rather than as the
room changing. So the exponent is bisected per frame until the coverage lands on
COVERAGE, and both frames print at the same weight by construction. That also
means a re-generated photograph does not need the constant re-tuned by hand.

WHY THERE IS NO AUTOCONTRAST. Stretching each frame to the full range is the
obvious move and it destroys the pair: it lifts the night frame into a bright
picture of a dark room, and the section's entire claim is that one of these is
light and the other is not. The exposures are the difference. They are left
alone, and the solved gamma is what keeps the DOT WEIGHT matched without
touching the brightness.

WHY LOCAL CONTRAST. A global curve has nothing left to separate at the ends of
the range, which is exactly where the subject is: the lit monitor is the
brightest thing in both frames, so on the daylight frame it flattens to bare
paper and the windows piled across it — the picture's whole point — disappear.
Subtracting a blurred copy puts the edges back at every brightness, so the
screen keeps its clutter in one frame and its calm in the other. This replaces
an earlier version that carried hand-measured pixel boxes around the monitor
glass; those had to be re-measured every time a photograph was regenerated.

AND WHY IT RUNS AFTER THE GAMMA. Before it, the pass measures differences in the
raw exposure, and the night frame's whole subject lives inside five per cent of
that range — see TONE_RADIUS. After it, the pass sees the tone that actually
decides the dots, and the gamma is simply solved a second time so the coverage
target still lands exactly.

THE NIGHT FRAME CARRIES ONE HAND-PLACED TOUCH, measured against that one
photograph rather than derived from anything: MIC_LIGHT dodges the microphone
out of the wall it is the same brightness as. Regenerate that photograph and it
needs measuring again.

THE SPEECH BUBBLE IS NOT IN HERE ANY MORE. This script drew it into the dot grid
until 2026-08-29, empty, with three dots in it; the maintainer's complaint that
day was that it looked bad and said nothing. A bubble that carries words has to
be typeset, has to arrive one word at a time as the reader scrolls, and has to
be able to move without a photograph being regenerated — none of which a shape
burnt into a one-bit raster can do. The page prints it onto the canvas at run
time now, in src/sections/VoiceSwitch.astro, with the same Bayer matrix and the
same dot this script prints the frames with, so it is still one-bit and still on
this lattice without being baked into it. That file owns the crop maths it needs
to sit in the right place. The one number this file still owes it is the mouth,
at (0.818, 0.512) of the frame — see MIC_LIGHT, whose falloff reaches the same
lips.

The palette is baked into the PNGs rather than left to CSS. A mask would let the
page recolour the dots, but a mask is resampled by the compositor and the crisp
pixel grid is the entire point. **If the tokens change, re-run this script** —
that is why it is committed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

CANVAS = (0x06, 0x06, 0x05)  # --canvas
INK = (0xF7, 0xF7, 0xF4)     # --ink

GRID_W = 720   # dither resolution; the page scales it up with smoothing off

#: Share of cells carrying a dot. Both frames are solved to this, so neither
#: reads as the heavier half of the pair.
#:
#: It is deliberately WELL under half. The mark is the minority on both grounds,
#: so the daylight frame stays a light picture and the night frame a dark one —
#: which is the difference the section is about. Push it toward 0.5 and both
#: frames converge on the same mid-grey mush.
COVERAGE = 0.22

#: The scale at which the frame's own colour cast is measured, as a fraction of
#: the grid width. Wide enough to be a lighting gradient rather than an outline:
#: `local_chroma` subtracts a blur this wide to throw away the warm wood, the
#: warm skin and the warm lamp, and keep only the colour that changes from one
#: dot to the next.
CHROMA_RADIUS = 0.025

#: Local contrast on TONE: the radius an object is separated from its
#: background at, and the gain on the difference.
#:
#: THE PASS RUNS AFTER THE GAMMA SOLVE, NOT BEFORE, and that ordering is the
#: whole of why the night frame has a microphone in it. Before the gamma the
#: high-pass measures differences in the raw exposure, and the night frame's
#: entire subject lives inside about five per cent of that range — the
#: microphone reads 0.087 mean against a wall at 0.091, measured. A gain under
#: one adds a few thousandths there and the object stays invisible, while the
#: same gain is plenty on the daylight frame. Run after the gamma, the pass sees
#: the tone that actually decides the dots, so a shadow difference the exponent
#: has just expanded is amplified like any other. The gamma is then solved a
#: second time on the result, so COVERAGE still lands exactly.
#:
#: THE RADIUS IS AN OBJECT'S SIZE, NOT A DOT'S. At 0.055 of the grid it is about
#: 40px against a 50px microphone, so the pass separates the thing from the wall
#: behind it rather than sharpening the texture on it — which is what a dark
#: object on a dark ground actually needs. The daylight frame gains the same
#: way: at the old radius the dozen overlapping panels dithered into one mush,
#: and at this one each panel keeps its own edge.
#:
#: The maintainer asked for a legible microphone on 2026-08-29.
TONE_RADIUS = 0.055
TONE_GAIN = 1.0

#: The five hues a coloured dot may take: the app's own agent-timeline tokens,
#: which are the colours the editor in the photograph is actually showing. This
#: is not a third colour smuggled into a two-token treatment — it is the SCREEN,
#: and the screen is the one thing in the room that has a colour of its own.
#:
#: Order is irrelevant; a dot takes whichever of these its own hue is nearest.
STAGE = (
    (0xDF, 0xA8, 0x8F),  # --stage-thinking  peach
    (0x9F, 0xC9, 0xA2),  # --stage-grep      mint
    (0x9F, 0xBB, 0xE0),  # --stage-read      blue
    (0xC0, 0xA8, 0xDD),  # --stage-edit      lavender
    (0xC0, 0x85, 0x32),  # --stage-done      gold
)

#: The scale a line of code lives at, as a fraction of the grid width, and the
#: size of the neighbourhood a screen fills.
#:
#: THESE TWO ARE THE WHOLE DETECTOR, and the pair is what makes it work.
#: `COLOUR_MICRO` is a second high-pass, on the colour STRENGTH this time: it
#: keeps colour that changes from one dot to the next and throws away colour
#: that holds over any distance. That is the difference between syntax colouring
#: and a person — skin, wood and a blue t-shirt are all saturated, but they are
#: saturated smoothly, and a smooth field high-passes to nothing. `COLOUR_REGION`
#: then asks where that micro-colour is DENSE. A compressed photograph rings
#: along every hard edge, so the bezel and the keys each carry a fringe of it;
#: a screen full of code carries an area.
#:
#: Measured against this pair of photographs: 98% of the dots this colours land
#: inside the monitor glass. Every simpler rule tried first put the majority of
#: them on the desk — a saturation threshold puts them on the man's forearm,
#: because skin and a code comment sit at the same saturation.
COLOUR_MICRO = 0.004
COLOUR_REGION = 0.05

#: Ceiling on the share of PRINTED DOTS that may carry a hue.
#:
#: A ceiling rather than a target, and it is usually not the binding constraint:
#: the micro-colour test above runs out of screen first, at about 3% of the dots
#: on the daylight frame and 5% on the night one. It is here so that a
#: photograph with no screen in it at all cannot end up with a coloured room —
#: the quantile would otherwise happily promote the noisiest 15% of anything.
COLOURED = 0.15

#: How far a coloured dot travels from the frame's own mark toward its hue.
#:
#: Not all the way. The mark colour is what makes the daylight frame dark ink on
#: paper and the night frame the exact inverse, and a dot painted in the raw
#: token abandons that: the tokens are all light, so on the paper ground they
#: turn to pastel mush and the screen reads as a hole rather than as a screen.
#: Mixing toward the mark keeps every dot on the right side of its ground and
#: lets the hue be unmistakable anyway.
TINT = 0.80

#: The microphone, dodged. Centre and radii in fractions of the frame, then the
#: rotation of its long axis in degrees, the softness of the falloff as a share
#: of the radius, and the gain in the middle of it.
#:
#: WHY THIS EXISTS. The night photograph exposes the microphone at 0.087 mean
#: against a wall behind it at 0.091 — measured on the grid. Those are the same
#: brightness, so the object has no boundary at all, and a halftone can only
#: print what the photograph contains: no gamma, no local contrast and no
#: coverage target invents a separation that is not in the file. On the page it
#: read as a black smudge, and the maintainer asked for a legible microphone on
#: 2026-08-29. A gain of 2.2 lifts the mic's own range (0.035..0.169) to
#: 0.08..0.37 and leaves the wall where it is, so the thing gets an edge.
#:
#: IT IS A CORRECTION TO ONE PHOTOGRAPH, NOT A RULE. That is why it may be a
#: measured box when the colour detector may not: the colour rule has to hold
#: for any frame, and a box there was a bug waiting for the next photograph;
#: this is a light that the photographer did not set, aimed at one object in one
#: file. REGENERATING THE NIGHT FRAME MEANS RE-MEASURING IT, or better, lighting
#: the microphone in the photograph and deleting this.
#:
#: Multiplicative, not additive: the mic's own dark bands stay dark relative to
#: its body, so the shock mount and the cylinder keep their modelling instead of
#: flooding into one grey shape. The falloff is generous on purpose — it reaches
#: the lips, which is where the page's speech bubble points.
MIC_LIGHT = (0.746, 0.532, 0.074, 0.076, -8.0, 0.35, 2.2)


def bayer(n: int = 8) -> np.ndarray:
    """Ordered threshold matrix. Ordered, not Floyd-Steinberg: error diffusion
    gives an organic grain, and this treatment wants a regular grid — which is
    also what lets the page's wipe dissolve along the same matrix."""
    m = np.array([[0, 2], [3, 1]], dtype=float)
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return (m + 0.5) / m.size


def solve_gamma(tone: np.ndarray, target: float) -> float:
    """The exponent that brings `tone` to `target` mean coverage.

    `tone ** g` falls monotonically with g, so a plain bisection is exact
    enough in forty steps and needs no derivative.
    """
    lo, hi = 0.05, 24.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if (tone**mid).mean() > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def blur_grid(values: np.ndarray, radius: float) -> np.ndarray:
    """Gaussian blur of a plain float grid.

    Through 8 bits, because Pillow's Gaussian refuses an "F" image. Everything
    blurred here is compared only against a threshold solved from itself, so a
    256-step ladder loses nothing and the scale factor cancels out of the
    comparison entirely.
    """
    scale = max(float(values.max()), 1e-6)
    small = Image.fromarray(np.round(values / scale * 255).astype(np.uint8))
    return np.asarray(small.filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255.0 * scale


def local_chroma(path: Path, size: tuple[int, int]) -> np.ndarray:
    """The colour in the photograph that is LOCAL, as an RGB offset per pixel.

    Every photograph of a room has a cast — warm wood, warm skin, a warm lamp —
    and that cast is a smooth field across the whole frame. Subtracting a blurred
    copy of the colour leaves only the colour that changes from one dot to the
    next, which in this scene is the syntax colouring on the screen and nothing
    else. It is the same move `render` makes on tone, and for the same reason: a
    global saturation threshold has to choose between colouring the desk and
    colouring nothing, because the wood and the code sit at the same saturation.
    """
    im = Image.open(path).convert("RGB").resize(size, Image.LANCZOS)
    blur = im.filter(ImageFilter.GaussianBlur(CHROMA_RADIUS * size[0]))
    rgb = np.asarray(im, dtype=float) / 255.0
    low = np.asarray(blur, dtype=float) / 255.0
    return (rgb - rgb.mean(2, keepdims=True)) - (low - low.mean(2, keepdims=True))


def stage_hue(offset: np.ndarray) -> np.ndarray:
    """Index into STAGE for each pixel, by nearest hue.

    Matched as a DIRECTION rather than as an angle: the pixel's colour offset
    and each token's are unit-normalised and compared by dot product, so there
    is no wrap-around to handle at red and no conversion out of RGB. Brightness
    drops out of it, which is what makes a dim blue and a bright one land on the
    same token.
    """
    tokens = np.array(STAGE, dtype=float) / 255.0
    tokens = tokens - tokens.mean(1, keepdims=True)
    tokens /= np.linalg.norm(tokens, axis=1, keepdims=True)

    unit = offset / np.maximum(np.linalg.norm(offset, axis=2, keepdims=True), 1e-6)
    return np.argmax(unit @ tokens.T, axis=2)


def dodge_mic(tone: np.ndarray) -> np.ndarray:
    """Lift the microphone out of the wall behind it. See MIC_LIGHT.

    A rotated ellipse with a smoothstep edge, applied as a gain. The ellipse is
    measured in fractions of the FRAME so it survives a change of GRID_W, and
    the vertical axis is circularised first so `soft` is one number rather than
    one per axis.
    """
    cx, cy, rx, ry, angle, soft, gain = MIC_LIGHT
    h, w = tone.shape
    ys, xs = np.mgrid[0:h, 0:w]
    dx = (xs - cx * w) / w
    dy = (ys - cy * h) / h * (h / w)
    a = np.radians(angle)
    u = (dx * np.cos(a) + dy * np.sin(a)) / rx
    v = (-dx * np.sin(a) + dy * np.cos(a)) / (ry * h / w)
    edge = np.clip((1.0 + soft - np.sqrt(u * u + v * v)) / soft, 0.0, 1.0)
    return np.clip(tone * (1.0 + edge * edge * (3 - 2 * edge) * (gain - 1.0)), 0.0, 1.0)


def render(path: Path, *, invert: bool, retouch: bool) -> tuple[np.ndarray, np.ndarray]:
    """Return two grids: where a dot is printed, and which hue each dot takes.

    The second is an index into STAGE, or -1 for a dot in the frame's own mark
    colour. Almost every dot is -1 — the screen is the exception, and that is
    the whole of the treatment's colour.

    `invert` flips which end of the tone range earns a dot. On the night frame
    dots sit on the LIGHT parts, because the ground is near black and a dot has
    to mean light. On the daylight frame the ground is paper and the same logic
    runs the other way: a dot means shadow. Getting this backwards prints a
    photographic negative — the window goes solid and the person glows.
    """
    im = Image.open(path).convert("L")
    height = round(GRID_W * im.height / im.width)
    im = im.resize((GRID_W, height), Image.LANCZOS)

    flat = np.asarray(im, dtype=float) / 255.0
    if retouch:
        flat = dodge_mic(flat)
    tone = 1.0 - flat if invert else flat

    # Gamma first, so the local-contrast pass below works on the tone that
    # decides the dots rather than on the raw exposure — see TONE_RADIUS.
    tone = tone ** solve_gamma(tone, COVERAGE)
    tone = np.clip(tone + TONE_GAIN * (tone - blur_grid(tone, TONE_RADIUS * GRID_W)), 0.0, 1.0)
    tone = tone ** solve_gamma(tone, COVERAGE)

    threshold = np.tile(bayer(), (height // 8 + 1, GRID_W // 8 + 1))[:height, :GRID_W]
    dots = tone > threshold

    # Which of those dots are on the screen. Two tests, and both are needed —
    # see COLOUR_MICRO above for why neither finds it alone.
    #
    # The floor is solved against the PRINTED DOTS rather than the whole frame:
    # only a dot can carry a colour, so a cell with nothing in it has no vote in
    # where the threshold lands.
    offset = local_chroma(path, (GRID_W, height))
    strength = np.linalg.norm(offset, axis=2)
    micro = np.clip(strength - blur_grid(strength, COLOUR_MICRO * GRID_W), 0.0, None)
    region = blur_grid(micro, COLOUR_REGION * GRID_W)

    printed = region[dots]
    floor = float(np.quantile(printed, 1.0 - COLOURED)) if printed.size else np.inf

    hue = np.full(dots.shape, -1, dtype=int)
    coloured = dots & (micro > 0) & (region > floor)
    hue[coloured] = stage_hue(offset)[coloured]
    return dots, hue


def to_png(
    dots: np.ndarray,
    hue: np.ndarray,
    *,
    ground: tuple[int, int, int],
    mark: tuple[int, int, int],
):
    """Ground, mark, and the handful of dots that carry one of the five hues.

    A coloured dot is the frame's own mark mixed TINT of the way toward its
    token, so it stays on the right side of its ground — dark on the paper
    frame, light on the ink one — while reading unmistakably as a colour.
    """
    h, w = dots.shape
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[...] = ground
    rgb[dots] = mark

    base = np.array(mark, dtype=float)
    for index, token in enumerate(STAGE):
        mixed = base + TINT * (np.array(token, dtype=float) - base)
        rgb[hue == index] = np.round(mixed).astype(np.uint8)
    return Image.fromarray(rgb)


#: name -> (source argv index, dots on the dark end, ground, dot colour, retouch)
#:
#: `retouch` is the hand-placed, hand-measured touch the NIGHT frame carries and
#: the daylight one does not: the microphone's dodge (MIC_LIGHT, before the
#: halftone). It kept the speech bubble company until 2026-08-29; the bubble is a
#: DOM layer over the canvas now and this flag is down to one correction, which
#: still carries its contract — regenerate that photograph and re-measure it.
FRAMES = (
    ("manual", 1, True, INK, CANVAS, False),
    ("voice", 2, False, CANVAS, INK, True),
)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2

    out = Path(__file__).resolve().parent.parent / "src" / "assets" / "scene"
    out.mkdir(parents=True, exist_ok=True)

    for name, index, invert, ground, mark, retouch in FRAMES:
        src = Path(argv[index])
        dots, hue = render(src, invert=invert, retouch=retouch)
        to_png(dots, hue, ground=ground, mark=mark).save(out / f"{name}.png", optimize=True)
        print(
            f"  {name:7s} {dots.shape[1]}x{dots.shape[0]}"
            f"  dots {dots.mean() * 100:.1f}%"
            f"  coloured {(hue >= 0).mean() * 100:.2f}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
