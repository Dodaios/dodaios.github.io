# Hero — layout and interactive demo

> Builds on [`layout.md`](layout.md). The width steps (`prose`, `content`,
> `full`) and the `Container` component apply here unchanged. Colour, type and
> rhythm come from [`design.md`](design.md).

---

## Vertical budget

The hero is one viewport minus a tail: `min-height: calc(100svh - var(--space-xxl))`.
**Not `100vh`** — on iOS the address bar slides in on scroll and the section
changes height mid-animation. The section has `overflow: hidden`.

**Why the 48px tail, and not a flat `100svh`.** A boundary on this page is one
line and it belongs to the section BELOW, so the line that closes the hero is
`LogoStrip`'s opening `.section-rule`. At exactly `100svh` that line lands on
the fold's own pixel row and the window edge eats it: the page simply ran out
from under the reader, with no line anywhere on the first screen. (The defect
was first written up as "opened with a rule under the nav and had nothing
answering it at the bottom" — that top line went with the nav band on
2026-08-29, and the bottom half of the complaint is the half that still bites.)
Ending the section one `--space-xxl` short pulls the same line up to ~96% of the
viewport, with air beneath it.

The hero does **not** draw a closing rule of its own. It would sit a few dozen
pixels above `LogoStrip`'s, and two lines at one boundary is what the
single-rule convention exists to prevent (`layout.md` § "A bounded section").

The section is a **two-row grid**, `grid-rows-[auto_minmax(0,1fr)]`:

1. Copy — headline on `prose`, CTAs 28px under it
2. Demo stage — `content` step, takes the remaining row **and fits inside it**

**There used to be a third row above them, for the nav.** The nav left the hero
on 2026-08-29 and is fixed over the whole document (`layout.md` § "The nav"), so
it is out of the flow entirely and no longer a row of anything. **The hero pays
for it in padding instead** — `padding-top: var(--nav-height)` on its own box,
the same figure the row used to be. That is what keeps every number in the table
below exactly where it was: the headline still begins one nav-height plus 5svh
down the screen, and nothing underneath it moved a pixel. Without the padding
the headline would simply start behind the lettering, which is the one thing an
out-of-flow nav cannot arrange for itself.

**Not a flex column with `justify-end`.** That pushes the whole block to the
bottom of the viewport and leaves a dead field above the headline — the copy
ends up past the middle of the screen, which is what this layout is for.

`minmax(0, 1fr)` and not `1fr`, and `min-h-0` on the stage's container: a grid
track's automatic minimum is its content's intrinsic size, so without both the
track grows to whatever the stage wants and the hero spills past the fold
again — the exact failure this layout exists to prevent.

Spacing above the copy is in `svh`, so the proportions hold on a short laptop
and a tall monitor alike.

### The hero has no edges, and that is the point of this screen

**No rule across the top, no rails down the sides, no marker on them.** The page
draws all three everywhere else; across the hero they are held at nothing and
arrive as the reader scrolls out of it — `--chrome-reveal` runs 0 to 1 over
0.7 of a screen, and the rails, the section marker and the veil under the nav
all come in on it. The mechanism and the second number are in `layout.md`
§ "The chrome arrives; it is not always drawn".

**A framed field is a form.** The first screen has one job — make the argument —
and it makes it with a headline, two buttons and a lit demo on open ground. Put
a hairline down each side and a rule along the top and the same screen reads as
a document with a header, which is a promise about paperwork rather than about
speaking to a computer. Everywhere below the hero the rails are doing real work,
because from there on the page *is* a document and the reader wants to know
where a section starts and ends.

**Nothing here is switched on at a scroll position.** The chrome is coupled to
the gesture, so there is no frame at which two full-height lines appear down the
window — see the same section of `layout.md` for why that distinction is the
whole effect.

### Target proportions

Measured at 2560x1250. These are the numbers to check a change against:

| Element | Top edge |
|---|---|
| Headline | ~11% of viewport height |
| CTAs | ~29% |
| Stage top | ~34% |
| Stage bottom | ~90% |
| Closing rule | ~96% |

### Fit, and the air below it

**The whole hero is visible in one viewport. Nothing is cut off.**

The hero used to crop the stage against the section's bottom edge and call the
cut-off border a scroll cue. The maintainer retired that on 2026-08-29: the
demo is the argument the page is making, and an argument that runs off the
screen is one the visitor has to work for.

Two rules hold it:

- The stage row gets whatever height is left, and the stage **contains** itself
  inside it — `min(width / STAGE_W, height / STAGE_H)`, never width alone. A
  short viewport shrinks the window rather than pushing its lower half out of
  the frame.
- The row carries `pb-[6svh]`, so the frame ends with a clear band of page
  under it instead of touching the fold. In `svh`, so a tall monitor gets
  proportionally more air rather than the same 100px. It was `10svh` before the
  section grew its tail — the band under the frame is now that padding plus the
  48px below the closing rule, which comes to the same distance. The frame keeps
  the height it had; the band it sits in gained a line partway down.

The cost is real and worth naming: on a short laptop the frame gets shallow and
the window inside it small. That is the honest trade — a small readable whole
beats a large cropped fragment.

---

## Headline

- Centred, `text-balance`, `prose` step
- **Three lines on a wide screen, two on a laptop.** The `prose` column is a
  constant 672px from 1440px up to 2585px, so the line count is decided by the
  font size alone: three lines above roughly 1900px, two below. Four lines is
  too big and one means `prose` is too wide — neither happens at this clamp
- **Exactly one headline, no subline.** If a subline feels necessary, the
  headline is too weak — fix the headline
- `line-height: 1.08`, size via `clamp()`, capped at **3.25rem**

The cap is the load-bearing part. The headline is the one element that decides
whether the stage still has room, so it is sized against the vertical budget
and not against how large it could be: at the old 6rem cap the hero could not
hold the stage on any screen, which is what the crop was hiding.

## CTAs

- Two buttons side by side, centred, 12px gap
- First filled (ink on cream, per `design.md`), second outline or ghost
- Below 640px they stack, each at full `prose` width

**The first one names the reader's machine.** "Download for macOS", "Download
for Windows" or "Download for Linux", decided in the browser and pointing at
`#install`, where the box opens on that same machine's command. Until
2026-09-01 it said "Download for Windows" to everyone, which was wrong for most
visitors and sent a Mac reader to a PowerShell line.

It is chosen by CSS from `data-os` on `<html>`, written by an inline head
script (`OsProbe.astro`) before the body is parsed — never by rewriting the
text after load, which shows the wrong machine for a frame. All three labels
ship in the markup and two are `display: none`, so a screen reader announces
one button. With scripting off the `DEFAULT_OS` label stands: a real button
pointing at a real command. See `src/components/DownloadCta.astro`.

The nav's button keeps the bare word "Download". That row is width-constrained
to the character (`src/lib/nav.ts`), the short word is already true on every
machine, and clicking it still opens the install box on the reader's own.

**Shape:** pill (`rounded-full`), at least 44px tall, at least 24px of
horizontal padding, at least 15px type. The hero is the one place that overrides
`design.md`'s 8px button radius — a hero CTA is read from across the room, and
the maintainer chose the pill here deliberately (2026-08-28). Everywhere else
on the site the 8px radius still applies.

---

## Demo stage

`content` step. No video, no canvas, no image sequence. **Everything is DOM.**
Every word in the mockup is real text in the markup — it is selectable,
searchable, and legible to a screen reader that ignores our `aria-hidden`.

The **frame** is the bordered box. It has no ratio of its own: it fills the
content column and the height the hero row has left.

```
position: relative
height: 100%
min-height: 300px
border-radius: var(--radius-xl)
overflow: hidden
border: 1px solid var(--hairline)
```

### Backdrop

The frame is filled by a painting, not by a flat colour. Before that, the stage
painted `--app-bg` across its whole area, and because the window only reaches
part of the way down, the rest read as a hole punched in the page.

- One `<Image />` from `astro:assets`, `absolute inset-0`, `object-cover`,
  `loading="eager"` — it is above the fold. `object-cover` because the frame's
  ratio moves with the viewport height
- The stage itself paints **nothing**. The window is the only opaque thing in
  the frame, so the painting shows as an even margin around it
- **Licence:** the backdrop is generated for this site (xAI
  `grok-imagine-image-2.0`, prompt in the commit that added it), so nothing
  third-party is attached to it. If it is ever swapped for someone else's work,
  the replacement must be public domain or explicitly licensed, and the source
  recorded here

### Scaling

An inner `div` at a **fixed design size**, `origin-top-left`, scaled by a
`ResizeObserver`.

The factor is `min(width / STAGE_W, height / STAGE_H)` — **contain, not
fill-the-width.** The frame's height is whatever the hero has left over, so
scaling on width alone would push the lower half of the window out through the
bottom.

Every child measurement inside is in px. **No responsive styling inside the
stage.** Otherwise the mockup looks different at every viewport instead of
scaling like a real screenshot does.

```tsx
<div ref={wrap} style={{ position: "relative", width: "100%", height: "100%" }}>
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      width: STAGE_W,
      height: STAGE_H,
      transform: `translate(-50%, -50%) scale(${scale})`,
    }}
  >
    {/* the window lives here, everything in px */}
  </div>
</div>
```

The design size is the window **plus the air around it**, not a screen shape.
A baked-in 16:10 leaves a dead band under the window as soon as the frame's own
ratio moves, which is exactly what the backdrop makes visible.

---

## The window is a clone of the app

**One window, and it is the app's own markup under the app's own stylesheet.**
Drawn versions of the app drifted every time the app changed, and the
maintainer judges the demo against the running app (2026-10-03: "noch kein
1 zu 1 digitaler Klon"). So the window is no longer drawn:

- **Markup** — `src/components/demo/app/` copies the JSX and the class names of
  the app's components at HEAD: the shell (App.tsx), the sidebar (Sidebar.tsx,
  SidebarSearchBar, SidebarAgents, RecentChats, ChatKindMark), the caption strip
  (TopBar, SectionNavButtons, ThemeToggle), the front page in voice mode
  (VoiceStage, Greeting, VoiceComposer, VoiceGlow's CSS light, the rail look of
  WorkTrace and TraceTimeline) and the Agentic IDE (IdeScene.tsx). Each file
  names the app components it copies. Only the data is the demo's.
- **Style** — `app.css` is the app's compiled stylesheet, cut down to the
  classes the clone uses by `scripts/sync-app-ui.mjs`. Never edit it by hand.
- **Isolation** — `AppFrame` renders the clone into an empty iframe through a
  React portal. The app's sheet styles `html`, `body`, `:root` and carries
  Tailwind's reset; in a document of its own it applies exactly as in the app
  and cannot touch this site. No src, no network request.
- **Icons and fonts** — `scripts/gen-app-icons.mjs` writes the lucide icons at
  the app's pinned version (ISC) and copies the app's own section icons. Inter
  and JetBrains Mono (both SIL OFL 1.1) are the app's two font files, declared
  inside the frame. The pet is Gigi, the app's built-in default, from its own
  sprite sheet — never the maintainer's chosen pet.
- **The window edge** is the only thing the app does not draw (the operating
  system does): `.demo-window` in `demo-stage.css`, on this site's tokens.

The style gate exempts `src/components/demo/app/` (scripts/check-style.mjs,
`CLONE_DIRS`): the app's design system governs a copy of the app, not this
site's.

**When the app's UI changes**, update the copied markup from the app's
components, then run both scripts against a fresh app build:

```
node scripts/gen-app-icons.mjs <app>/dodaios/ui/web/frontend
node scripts/sync-app-ui.mjs   <app>/dodaios/ui/web/dist/assets
```

### Size

The window is a real app window, 1360 x 758 CSS px, laid out at that size and
scaled down with the stage — so the app's 14 to 16 px type keeps its
proportion to the window. Type enlarged for the hero read as a zoomed-in crop
of the app (maintainer, 2026-10-02).

---

## Interaction

**Two sidebar rows are live: "New chat" and "Agentic IDE".** They move between
the two scenes the way the real rows move between sections. Everything else is
real markup that does nothing, the way a screenshot does nothing.

- Left alone, the stage plays the front page, follows the hand-off into the
  Agentic IDE, and comes back
- The first press of a live row stops the **hand-over** for good; the chosen
  scene keeps looping. Freezing it would answer "show me the agents" with a
  still frame, which looks broken

---

## The two scenes

One errand, followed across the app. The scripts are `app/frontPageScript.ts`
and the IDE's own data in `app/IdeScene.tsx`.

- **The front page, in voice mode.** It opens empty — Gigi, the greeting, the
  hint and the voice composer with its Start pill and the soft light rising
  from the bottom. The person speaks (their words arrive in the italic bubble),
  the turn's work runs on the rail — a streaming thought, then one quiet line
  per call with the service's real logo, Gigi working on the state line — and
  the answer is said out loud: words not yet spoken stay grey and light up as
  the voice reaches them, Gigi talking under it. Dodaios hands the coding part
  to Scout
- **The Agentic IDE.** Scout (Claude Code), Atlas (Codex) and Quill (Gemini
  CLI) work side by side in one workspace; Scout ends with a pull request,
  one agent is still working when the loop ends
- No `getUserMedia`, no audio, no WebGL: the voice light is the app's own CSS
  fallback, driven by a synthetic level instead of a microphone

## Accessibility

- The stage gets `aria-hidden="true"`
- Beside it, a `<p class="sr-only">` describing what is shown — both scenes,
  since the rows that switch between them are unreachable by keyboard
- Every interactive element inside the stage: `tabIndex={-1}`
- `prefers-reduced-motion`: no autoplay, no typewriter, no tilt — render the
  final frame directly

---

## Forbidden

- `100vh` instead of `100svh`
- Cropping the stage against the fold, or any other part of the hero. The whole
  hero fits in one viewport
- Scaling the stage on width alone
- A backdrop whose licence is not recorded in this file
- Screenshots, video, canvas, or image sequences for the mockup
- Hand-drawn imitations of the app's UI inside the window — copy the app's
  markup and sync its stylesheet instead
- Text in the mockup that is not real text in the DOM
- Responsive styling inside the stage
- A second floating window, or a window that is not the app as it ships
- Network requests from the demo
- `getUserMedia` or any permission prompt in the hero
- A bespoke `max-width` on the section instead of a step from `layout.md`

---

## Skeleton

```astro
<section id="top" class="grid min-h-svh grid-rows-[minmax(0,1fr)] overflow-hidden">
  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] pt-[var(--nav-height)]">
    <div class="pt-[5svh]">
      <Container width="prose">
        <h1 class="text-center text-balance leading-[1.08]">…</h1>
        <div class="mt-7 flex flex-col justify-center gap-3 sm:flex-row">…</div>
      </Container>
    </div>

    <Container width="content" class="min-h-0 pt-6 pb-[10svh]">
      <div class="relative h-full min-h-[300px] overflow-hidden rounded-2xl border border-hairline">
        <Image src={backdrop} alt="" loading="eager"
               class="pointer-events-none absolute inset-0 h-full w-full object-cover" />
        <DemoStage client:load className="relative h-full" />
      </div>
    </Container>
  </div>
</section>
```

**There is no `<header>` in here any more.** It was the first row of this grid,
`sticky top-0 z-30` on a `bg-canvas` band with a hairline along its bottom, and
it is now `SiteNav.astro` rendered from `Base.astro` — fixed over the whole
document, with neither the ground nor the line. What is left of it here is the
`pt-[var(--nav-height)]` on the box and the `id="top"` on the section, which is
where the wordmark sends the reader.

The stage row is `minmax(0, 1fr)`, so it takes whatever height is left and the
frame fills it exactly — `pb-[10svh]` is the air that keeps the frame off the
fold. The stage is the one React island on the page — `client:load`, because it
sits above the fold and its first frame is the point; everything around it
ships as plain HTML.
