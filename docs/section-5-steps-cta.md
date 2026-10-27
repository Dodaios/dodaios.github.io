# Section 5 — the steps, and the closing CTA

> Assumes [`layout.md`](layout.md).
> Position: **the last two blocks of the page, inside ONE section that is one
> screen tall.** Two blocks in one file because together they are the end of
> the page — and in one `<section>` because together they are one screen.

---

## Reference

Layout model: the design reference the maintainer supplied — its steps
section and the band beneath it.

The reference governs layout, proportion and the focus behaviour. Not copy, not
colour, not content.

Its rastered artwork is a **dead-on orthographic elevation** — no tilt, no
perspective. That is the viewpoint the mark uses (maintainer, 2026-08-29).

Three things were read off the reference rather than guessed at, so nobody has
to squint at it again:

| What | The reference | Here |
|---|---|---|
| Block A's boundary | a rule above **and** below, between the two rails | the same |
| Space between the blocks | one gap, not a join | **none** — the band hangs off the rule (maintainer, 2026-08-29) |
| Seconds per revolution | about 15 | 14 |

---

# Block A — "How to install Dodaios"

## What it says

Four steps from installing to the first spoken command. The reader should see
that getting in is small and reversible.

**Source of the content:** `README.md`, sections "Install" and "Run it".
Steps are never invented. Every one carries a comment in `Install.astro`
naming what proves it.

| # | Step | Source |
|---|------|--------|
| 1 | One command | README "Install" |
| 2 | Pick a wake word | README "Install", `dodaios.toml.example` |
| 3 | Add a key, or skip it | README "Install", "Runs on your own hardware" |
| 4 | Say it | README "Run it" |

---

## Measurements

| Element | Value |
|---|---|
| Section height | `min-height: 100svh` — **both blocks together**, not Block A alone |
| Block A's height | whatever the band and the gaps leave over (`flex: 1`) |
| Block A's padding | `clamp(1.5rem, 2.6svh, 3rem)`, a floor rather than a fixed amount |
| Width | step `content` |
| Columns | **7/12 steps left, 5/12 artwork right** — the extra column takes two wrapped lines out of the four bodies and 46px out of the screen; the mark was never as wide as its half of the row |
| Step spacing | `--pin-air` — 32px on a tall window, less on a short one |
| Number badge | `1.5rem` square, radius 4px, `--font-mono`, held `0.75rem` clear of the left rule |
| Install box | step `content`'s left column, ~105px tall — header 33px, two command lines |
| Connecting line | 1px, `--hairline`, one segment per gap, down the badge's centre |
| Boundary | the pinned frame's own two rules, plus `.section-rule` opening the section and one under the track for the band to hang from |

Widths come from `<Container>` alone. The step names a `max-width` of its own
nowhere — `check-style.mjs` enforces that.

### The section is one screen, and the band is what makes it one

Block A alone used to be the `100svh` section, with its content centred in it
and the band a sibling underneath. On a tall monitor that put ~800px of steps
in the middle of a 1250px screen and dropped the whole surplus — roughly 220px
— as dead space between the last step and the band. It read as a hole, and it
was the first thing the maintainer pointed at (2026-08-29).

The band moving *inside* the section is the fix. The surplus is then spent
rather than wasted: `flex: 1` on Block A absorbs it, the band lands at the foot
of the screen, and the reader gets the steps and the close in one view.

The padding is a floor and the height is a `min-height`, so the failure
direction is safe. On a short laptop where the steps plus the band cannot fit,
the section simply grows past one screen and the page scrolls. Nothing is
clipped and nothing is squeezed.

**One screen is the target, not a constraint to enforce against the content**
— and that is the settled reading, because the first attempt enforced it and
was rejected for it (maintainer, 2026-08-29: *"the viewport doesn't do it for
me; go by the section instead"*). Measured: 1305×2560 lands at exactly one
screen, 1249 at 23px over, a 1440×900 laptop at 89px over. The section is
proportioned first and lands near a screen second.

### The connecting line stops at the last badge

One segment per **gap**, on each step but the last: from that step's badge
bottom edge down through the step gap to the next badge's top (`bottom` is the
negative of the same `--pin-air` the gap is, so it follows the gap as the gap
gives way on a short window).

Not one line spanned against the `<ol>`. The list's box ends at the bottom of
the last step's *body*, several lines below the last badge, so a single line
overshot the final number and ran on into empty space — visible in the
maintainer's screenshot of 2026-08-29. A line that has to stop at an element it
is not anchored to cannot be given the right length in CSS; a segment that
knows both of its own ends can.

### The badge column is three numbers, kept together

`--badge-size`, `--badge-inset` and `--badge-gap` on `[data-steps]`. Every
position that has to agree with the numbers is computed from them: the badge's
own box, the text indent (`inset + size + gap`), and where the connecting line
runs (`inset + size / 2`, starting at `size`). Written separately as utilities
they drifted the moment one of them moved — a line beside the badge instead of
down it, or a title closing up on the number.

**`--badge-inset` is the one to touch**, and it exists because the badges sat
*on* the frame's left rule rather than near it (maintainer, 2026-08-29): the
section marker draws that rule at exactly the content's left edge, and a
bordered box touching a border reads as stuck to it. Only the badges step in,
and the text steps in with them so the gap between a number and its title never
changes.

**The heading and the eyebrow are centred on the frame** (maintainer,
2026-08-29). They span the full content width, so centring puts them over the
middle of the whole section — steps and artwork together — instead of over the
steps column they sit above. The rule is written against `[data-frame] >` with
a child combinator: `text-align` inherits, and set on the frame it would centre
the step list and the closing band too, both of which stay left.

**In `rem`, not in the `--space-*` tokens.** The root font size grows with the
viewport, so the utilities these replaced grew too; stated in the fixed-pixel
tokens the badge came out 24px on a 2560px screen where it had been 28px —
shrinking on exactly the screens the page is scaled up for.

---

## The focus behaviour (the signature)

**Exactly one step is active.** The active step stands at full opacity, the
other three at `opacity: .35`.

- The active badge is filled (`--surface-strong` ground, `--ink` digit), the
  inactive ones outlined only
- 300ms transition on `opacity`
- Step 1 carries the install box, and it dims with step 1 like any other
  content. It is **not** added and removed as the focus moves — see below

### The section holds the page still while it happens

**The steps are pinned, and each one owns a quarter of the scrolling.** The
frame stops under the reader, step 1 lights, then 2, then 3, then 4, and only
once the fourth has had its share does the section let go (maintainer,
2026-08-29).

This file forbade exactly that until then, in as many words — *"no scroll
hijacking, no sticky pinning; sticky variants break on mobile and feel
sluggish"*. The reason was sound and is why the pin is **conditional**, not
why it is absent: it is off below 1280px, below 1136px of window height, and
under `prefers-reduced-motion`. Where it is off, the section is an ordinary
block and the old rule decides — whichever step's centre sits closest to the
middle of the window.

The construction is [`layout.md`](layout.md) § "A section that is one viewport
and still scrolls", the same one `VoiceSwitch.astro` uses: a tall track, a
sticky child, and `track - viewport` of scrolling as the running length.

| Element | Value |
|---|---|
| Track | `400svh` — three screens of pinned scrolling, 75svh per step |
| Sticky child | `top: var(--nav-height)`, `height: calc(100svh - var(--nav-height))`, `--section-inset` of padding above and `--space-lg` below, `overflow: hidden`. It carries the frame AND the band |
| Frame | `border-block: 1px solid var(--rule)`, `var(--space-base)` padding, content centred |
| Pin drops out at | narrow, calm, or **measured not to fit** — see below |

### The band is part of the pinned screen

**Block B rides inside the sticky child, under the frame.** It used to come
after the track, so the screen the reader was held on never showed the end of
the page — the maintainer's words: *"the box belongs in that viewport too"*
(2026-08-29). The pinned screen is now frame plus band: the steps, the rule
that closes them, and the close hanging straight off it.

It needs no `Container` of its own. It already sits on the content column,
inside the one the sticky child carries; a second `content` Container there
applies the gutter and the max-width a second time and pulls the band 32px
inside the rails.

### The height is measured, not tuned

**There is no window-height threshold in this file any more, and that is the
point.** How tall the screen has to be is a fact about the content — four
steps, an install box, a band, at a root scale that grows with the viewport —
and a hand-measured number is a stale copy of it the moment anyone touches a
step, a padding or the band. It was wrong twice in one afternoon: once when the
band moved into this screen, and once when the sticky child's top inset went
from `--space-lg` to `--section-inset`.

So the script measures the failure itself: **the list of steps must end above
the line that closes the frame.** If it does not, `data-unpinned` goes on the
section and the stylesheet gives up the pin, which the section survives — it
becomes an ordinary block. What it does not survive is the alternative: the
sticky child hides overflow, so a screen 40px too short simply eats the bottom
of step 4 with nothing to show for it.

Two things that look like the obvious test and are not:

- **`scrollHeight` against `clientHeight`.** The frame centres its content, so
  half of any overflow goes off the TOP, and `scrollHeight` does not count
  that. A screen 40px short reads as 20px short.
- **The frame's own natural height.** The mark's canvas carries an explicit
  pixel height derived from the frame, so asking the frame how tall it wants to
  be is circular. The list is neither centred nor circular: it is text, and its
  height depends only on the column it wraps in.

The query that remains — `(max-width: 1279px), (max-height: 1135px),
(prefers-reduced-motion: reduce)` — covers the structural cases and acts as a
floor for a reader with no JavaScript. Above it the measurement decides.

**And the decision never changes while the reader is in the section.** Switching
modes takes the track from four screens to one, which removes about 3,700px
from the document in a single frame: the browser clamps the scroll position and
the reader is thrown to the bottom of the page from wherever they were. That is
not a theory — it is the bug the guard shipped with, reported the same hour:
*frozen from step 2, then suddenly at step 4 with nothing below*. The trigger
is ordinary, which is what makes it nasty: `load` fires late on this page (a
WebGL island, video thumbnails), by which time a reader is somewhere around
step 2.

So a pending change waits until the section is more than 200px clear of the
viewport, and the scroll handler applies it when it gets there. A mode one
resize out of date costs nobody anything; a page that jumps under a reader's
hands costs them their place.

For reference rather than as a contract: measured at 2560×1305 the pinned
screen holds its content with **52px to spare** between the last step and the
line that closes the frame. That is the figure to re-read after touching a
step's copy, a padding or the band — it is what the measurement above is
spending, and a step body that grows by three lines takes all of it.

### One nav off the height, not two, and air that knows the window

Two things had to give the screen room before it could pin at all, and both
were found the same way: at 2560×1305 the screen wanted 1269px and was being
offered 1153, so the measurement dropped the pin and the section scrolled
straight past — which is what the maintainer reported hours after the pin was
built.

- **`height: calc(100svh - var(--nav-height))`.** Every other one-screen
  section is `--section-height`, the window less *twice* the nav, because it
  has a closing rule at its bottom edge that needs air above the next section's
  opening one. This screen has no closing rule: the CTA band is at its bottom
  and the footer is under that, so there is no joint to keep clear and the
  second subtraction bought nothing. It is the same asymmetry the child's
  padding already states — `--section-inset` at the top because that end *is* a
  section edge, `--space-lg` at the bottom because that end is not. Worth 76px.
- **`--pin-air`**, one variable for the three step gaps, the row above them and
  the band's block padding. Air everywhere else on the site is a `--space-*`
  token in rem, which grows with the root scale — and the root scale grows with
  the viewport's **width**. Right for a page that scrolls; wrong for the one
  screen that must hold four steps, an install box and a band at once, because
  a 2560px-wide window is 19% taller in content than a 1280px one and no taller
  in pixels. `clamp(1rem, 1.7svh, 2rem)` keeps the old `mb-8` on a tall window
  and gives way on a short one. Worth 94px at 1305.

Spend the screen's air through that variable, never as a `space-*` utility, or
the next window height that does not fit is back to being a hand-measured
threshold.

**The progress comes from `spanProgress`** in `src/lib/scrollSpan.ts` — the
same function the section marker and the voice wipe measure with. Three things
draw this page's scroll position and exactly one decides it, or the last step
lights up before the marker reaches the corner.

**The media query is spelled identically in the CSS and in the script.** The
stylesheet decides the geometry, the script decides where the value comes
from, and a mismatch leaves a scrub driving a section that no longer has a
track.

Hovering an inactive step also brings it to full opacity, without taking over
the active state.

---

## The install box

Step 1 ends in the install one-liner, **printed**. Component:
`src/components/InstallCommand.astro`; the commands themselves come from
`src/lib/install.ts`, which is also what the copy button reads, so the line on
screen and the line in the clipboard cannot drift apart.

Until 2026-08-29 this was a button reading "Copy the install command". The
maintainer's instruction that day: render the real command, make it look like
something, and let the visitor pick their machine. The reasoning holds on its
own — the command pipes a remote script into a shell, and a button that copies
something the reader never sees asks for trust it has not earned.

| Element | Value |
|---|---|
| Frame | `--surface-card`, 1px `--hairline`, `--radius-lg` — the code block of [`design.md`](design.md) |
| Header | shell name left, machine picker right, 1px `--hairline-soft` under it |
| Command | `--font-mono`, prompt (`$`, `PS>`) in `--muted-soft`, command in `--ink` |
| Copy | icon button right of the command, ticks green on success |

### Three machines, two commands

macOS, Windows, Linux — in that order. The README has two lines, not three,
because macOS and Linux run the same `curl`. The site still offers three
choices: "which of these is mine" is a question the visitor should never have
to answer. Two of the three agreeing is a property of the installer, not
something to hide.

**The visitor's own machine is preselected** from the user agent
(`detectOs()`). iOS lands on macOS and Android on Linux — neither can run the
installer, and guessing further away would not help them.

### It is a radio group, and that is load-bearing

Three options, one chosen. Using the real control means the switch works with
**JavaScript turned off**, answers to the arrow keys, and announces itself
without a line of ARIA. The panels follow the checked radio through `:has()`,
which is what lets the tabs sit in the header while the command sits in the
body.

JavaScript adds exactly two things: it preselects the machine, and it copies.
The copy button therefore starts `hidden` and is revealed by the script — a
copy button without a clipboard is a lie, and the command is on screen to
select by hand either way.

### The box never leaves

The button it replaced was pulled out of the DOM whenever another step took
focus. That was affordable at 44px. The box is 105px, and adding and removing
it on every scroll shunted the three steps below it up and down the screen. It
stays, and dims with step 1; hovering step 1 brings it back to full strength,
which is also what makes it clickable without scrolling it into focus first.

The section still fits one screen: 1305px of content on the maintainer's
1305px viewport, measured 2026-08-29.

### The command's type size is the one exception to rem

Everything on this site scales with the root font size. This line cannot. The
steps column stops widening at `content`'s 1280px floor while the root size
keeps climbing, so on a 2560px monitor the same command was set 18% larger in a
column that had not grown — it wrapped onto a third line and pushed the section
119px past one screen.

`clamp(0.75rem, 2.9cqi, var(--text-code))`, against a container on the command
column. `cqi` is a share of the box, not of the viewport, so the characters per
line stay put however wide the monitor is. Two lines on every machine and every
screen; `word-break: break-all` fills each line rather than leaving `irm` alone
on the first one.

---

## The artwork

The Dodaios mark as a **dither relief**. Recipe, pipeline and acceptance live in
[`dither-relief.md`](dither-relief.md); this file does not repeat them.

- Sized from its GRID CELL: its column's width, its row's height, centred in
  both. Never from the viewport
- The flat logo PNG is **not** enough
- It **turns** — a full revolution, so the recipe's real-time exception applies
  (maintainer, 2026-08-29)
- **Fourteen seconds per revolution.** Six was tried and rejected: at a
  one-pixel cell the raster crawls rather than turns, and the mark reads as
  restless (maintainer, 2026-08-29). Fourteen is also within a second of the
  reference's own rate
- **The camera is fitted to the form, not to a hand-picked number.** The frame
  clears the mark's RADIUS about the turn axis — `max sqrt(x² + z²)` over every
  vertex, measured at build time — and the frustum is then the canvas expressed
  in those units. A square canvas with a square frustum, which is what stood
  here before, wastes the taller half of a non-square cell and draws the mark
  smaller than its box allows at every angle
- **It fills its cell.** A grid item with a fixed `aspect-ratio` cannot stretch,
  so the old square sat at the TOP of a row the steps ran on past, and the mark
  read as floating in the upper corner over a hole. Drawn size went up about
  45% between the two
- **The reader can turn it by hand.** Hold the left button and drag; letting go
  throws it, and the throw glides back into the idle turn. Nothing on the page
  depends on which way the mark is facing — it is a toy, and asked for as one
  (maintainer, 2026-08-29)
- Purely decorative: `aria-hidden="true"`, and **no `tabindex`**. There is no
  content behind the turn or the drag, so there is nothing for assistive
  technology to miss; a focusable element inside an `aria-hidden` subtree, on
  the other hand, is a stop on the tab order that a screen reader cannot
  describe
- Below 1024px it is dropped, not shrunk. `client:media` means the bundle is
  never fetched there

The mark is the hooded figure, the project's logo since the rename to Dodaios
in October 2026. Its geometry is not typed out: `src/components/mark/figure.ts`
parses the one path in `src/assets/dodaios-logo.svg`, a copy of the app
repository's `assets/brand/dodaios-logo.svg`, and extrudes it as a single
shape with the eyes cut through. Replace the file and the relief follows. Until
then the mark was the app's ghost mascot, built by hand from its coordinates.

Decisions about the mark, not defaults:

- **The eyes are holes**, which in this raster means *no dots*: the page floor
  shows through them. The logo is one flat shape with openings and is extruded
  as exactly that, so there is no second material and the back of the turn
  shows the same figure mirrored
- **The bevel is taken inside the outline.** The hood, the body and the foot
  are separated by gaps a few units wide; a bevel that grows outwards, which is
  the default, closes them into one blob

---

# Block B — the closing CTA

## Measurements

| Element | Value |
|---|---|
| Width | step `content` — rail to rail, exactly like Block A |
| Height | 200px desktop, `auto` under 768px |
| Corners | **sharp**, `border-radius: 0` |
| Ground | the accent, full bleed |
| Padding | 32px |
| Space above | **0** — the band hangs off the frame's bottom rule |
| Space below | the sticky child's own `var(--space-lg)` — the tail off the screen edge |

## Build

- Headline left, two lines, in the colour that contrasts the band
- Under it one sentence, smaller, same colour at reduced opacity
- Button right, vertically centred, inverted: light ground, accent as type
- Under 768px: button under the text, full width

**The contrast is deliberate.** The band breaks with everything above it
because it marks the end of the page. No rounding, no transparency, no
gradient.

**And it touches the rule above it.** The reference leaves a gap there; ours
was given one and the maintainer struck it out on sight (2026-08-29). The
difference is what the two bands ARE: theirs is a coloured card floating on the
page, which needs air around it, and ours is a filled block that closes the
section. Air above a closing block reads as a hole between the last step and
the end of the page, not as breathing room.

The band is not the last element on the page — the legal foot follows it, below
the fold. See [`footer.md`](footer.md).

### The accent on this palette

There is no `BRAND.md` in this repository and no borrowed accent hue —
[`design.md`](design.md) keeps exactly one action colour, "paper on ink". So
the band is `--ink` and its type is `--on-ink`: 18.5:1, well past AA. Inverted,
the button is therefore dark on the pale band.

---

## Accessibility

- Block A is an `<ol>`. The order is part of the content
- The focus behaviour is purely visual. All four steps stay equally readable to
  a screen reader, dimmed ones included
- The install box is a radio group and a button, both real controls, both
  reachable by keyboard whether or not step 1 is the active one
- Only the checked machine's command line is in the DOM tree that a screen
  reader walks; the other two are `display: none`, not merely off screen
- `prefers-reduced-motion`: no opacity transitions. Every step at full opacity,
  every button visible. The same state is what a visitor without JavaScript
  gets, because the dimming is opted into by script

---

## Forbidden

- A pin that cannot drop out. It is off on a narrow screen, on a short window
  and under `prefers-reduced-motion`, and those three conditions are spelled
  the same in the CSS and in the script
- More than four steps
- A second install box, or one on any step but the first
- Hiding the command behind a button again, or printing a line the copy button
  does not hand over verbatim
- Invented steps that README or the repo cannot prove
- Sizing the artwork from the VIEWPORT — an `svh` cap, a fixed aspect ratio.
  It is framed against the section it sits in, and nothing else
- A shadow map in the turning scene. See [`dither-relief.md`](dither-relief.md)
  § "Two rules a moving relief adds"
- A gap between the rule that closes Block A and the band
- Rounding, gradients or transparency on the CTA band
- Block B outside the section, or any other arrangement that lets Block A's
  leftover height fall as dead space between the last step and the band
- A band narrower or wider than Block A. Both stand on the rails, or the end of
  the page has two different edges
- Rastering a flat, unshaded logo. See [`dither-relief.md`](dither-relief.md)
- A `max-width` of its own instead of step `content` from [`layout.md`](layout.md)
