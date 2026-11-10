# Hero — layout and the working demo

> Builds on [`layout.md`](layout.md). The width steps (`prose`, `content`,
> `full`) and the `Container` component apply here unchanged. Colour, type and
> rhythm come from [`design.md`](design.md).

The hero does three things, top to bottom: it says **what the product is**, it
offers **one action**, and it lets the reader **use the app** before they
install it.

---

## Shape

```
nav (fixed, out of the flow)
copy        prose      headline, one line under it, the download button, two links
tiles       content    six floating marks beside the copy (from lg up)
window      content    the app, cloned, as wide as the column
starters               three buttons that start an errand in the window
```

**The hero is taller than the screen, on purpose.** The first screen holds the
whole argument and the top of the window; the window goes on below the fold.

Until 2026-11-10 the hero was held to one viewport and the window was shrunk
to whatever height the copy left over. That rule was right for a window that
only played: a small complete picture beats a large cropped one. It is wrong
for a window that is meant to be pressed — one small enough to fit was too
small to hit a sidebar row in. So the window now takes the full `content`
width and the height its own ratio gives it, and nothing above shrinks it.

What did not change:

- **`svh`, never `vh`**, wherever a viewport share is used (the air above the
  headline, the air above the window).
- **The hero has no edges of its own.** No rule across the top, no rails down
  the sides, no marker on them: the page chrome is held at nothing while the
  hero owns the screen and arrives as the reader scrolls out of it
  (`--chrome-reveal`, see `layout.md` § "The chrome arrives; it is not always
  drawn"). A framed field is a form; the first screen is open ground.
- **It pays for the nav in padding** — `padding-top: var(--nav-height)` on its
  own box — because the nav is fixed over the whole document.
- **It draws no closing rule.** The line that closes the hero is the logo
  strip's opening rule (`layout.md` § "A bounded section").

### The ground

A faint grid, `full` width, that fades out from behind the headline through a
radial mask. It is drawn in `--hairline-soft`, a few percent off the floor, so
nothing has to be read against it. There is no painting behind the window any
more: the window stands directly on the page.

---

## Headline

- Centred, `text-balance`, `prose` step, weight 400 (`design.md`)
- **A definition, not a slogan.** "The open-source agent OS for your desktop" —
  a reader should be able to repeat what the product is after this one line.
  One thing, no feature list, no third-party product names
- `line-height: 1.04`, size via `clamp()`, capped at **4.5rem**. The cap no
  longer protects the window's height (nothing does, see above); it keeps the
  headline at three lines on a wide screen instead of two very long ones

## The line under it

One sentence that completes the definition — what it runs, how you talk to it,
where it runs — and one that answers the first objection ("bring your own
subscription"). It is `--body`, not ink: it supports the headline and must not
compete with it.

The old rule was "exactly one headline, no subline". It went with the old
headline, which was a slogan and needed nothing after it. A definition does:
"agent OS" names the category, the line under it says what that means.

## The action

- **One button.** Paper on ink, pill, at least 48px tall. It names the reader's
  own machine ("Download for macOS / Windows / Linux"), chosen by CSS from
  `data-os` on `<html>` — see `DownloadCta.astro` and `OsProbe.astro`. Below
  640px it takes the full width
- **Two quiet links under it**: the repository, with its star count from
  `src/data/social-counts.json`, and the docs. The docs used to be a second
  button; two buttons of equal weight made the reader choose before they had
  seen anything

The pill is the one place that overrides `design.md`'s 8px button radius — a
hero CTA is read from across the room (maintainer, 2026-08-28).

## The floating marks

Six tiles, three a side, in the two bands the `prose` column leaves free
inside the `content` column. Each carries the mark of a service the app
drives, in ink on `--surface-card`, tilted a few degrees and drifting half a
rem up and down on its own offset.

- From `lg` up only. Below it there are no free bands, and the tiles are not
  drawn at all
- `aria-hidden`: they are decoration here. The same marks are **identified**
  in the strip directly under the hero, which carries the caption that they
  imply no partnership or endorsement (`LOGOS.md`). Do not add a mark here
  that is not in that strip
- `prefers-reduced-motion`: no drift

---

## The window is a clone of the app

**One window, and it is the app's own markup under the app's own stylesheet.**
Drawn versions of the app drifted every time the app changed, and the
maintainer judges the demo against the running app. So nothing in the window
is drawn:

- **Markup** — `src/components/demo/app/` copies the elements and the class
  names of the running app: the shell and its caption strip (`AppShell.tsx`),
  the conversation on the front page (`Conversation.tsx`), the Agentic IDE in
  its thread layout (`Threads.tsx`) and in its grid (`IdeScene.tsx`), the
  Agents section (`AgentsView.tsx`) and the plugin catalogue
  (`PluginsView.tsx`). Each file names the app components it copies. Only the
  data is the demo's (`demoData.ts`) — an invented person, project and agents
- **Style** — `app.css` is the app's compiled stylesheet, cut down to the
  classes the clone uses by `scripts/sync-app-ui.mjs`. Never edit it by hand
- **Isolation** — `AppFrame` renders the clone into an empty iframe through a
  React portal. The app's sheet styles `html`, `body`, `:root` and carries
  Tailwind's reset; in a document of its own it applies exactly as in the app
  and cannot touch this site. No src, no network request
- **Icons, marks and fonts** — `scripts/gen-app-icons.mjs` writes the lucide
  icons at the app's pinned version (ISC) and copies the app's own section
  icons. Inter and JetBrains Mono (both SIL OFL 1.1) are the app's two font
  files. The pets are four of the app's built-in ones (`src/assets/app/pets`):
  Gigi, the default, plays the assistant — never the maintainer's own pet
- **The window edge** is the only thing the app does not draw (the operating
  system does): `.demo-window` in `demo-stage.css`, on this site's tokens

The style gate exempts `src/components/demo/app/` (`scripts/check-style.mjs`,
`CLONE_DIRS`): the app's design system governs a copy of the app, not this
site's.

**When the app's UI changes**, update the copied markup from the app, then run
both scripts against a fresh app build:

```
node scripts/gen-app-icons.mjs <app>/dodaios/ui/web/frontend
node scripts/sync-app-ui.mjs   <app>/dodaios/ui/web/dist/assets
```

The quickest way to see what the app renders today is its own DOM: open the
view in the app, read the markup of the part to copy, and keep its class
strings verbatim. Whatever a real session shows stays out of this repository —
copy the structure, never the content.

### Size

A real app window, 1360 x 758 CSS px, laid out at that size and scaled as one
piece — so the app's type keeps its proportion to the window, the way a
screenshot would.

The scale is `column width / 1360`. **Below 0.46 it stops**: a phone is
narrower than that, and type at a quarter of its size is a texture, not an
interface. There the window keeps 0.46, slides its sidebar out of the left
edge and lets its right side run out of the frame, so the phone shows the
middle of the app — the conversation — at a size that can be read. The frame's
`min-height` is that held window's height, so the stage does not jump when it
hydrates.

---

## The window works

**Left alone it plays one errand, once around and again.** The person asks for
a failing test to be fixed; the assistant checks the failed run and hands the
job to an agent; the Agentic IDE opens on that agent's thread, where three
sub-agents reproduce the failure, find the cause and run the suite; the thread
ends with the changed files and an open pull request; the front page shows the
job under "Done".

**The first press inside the window ends the tour for good.** From then on the
reader drives:

| Where | What answers |
|---|---|
| Sidebar | Conversation, Agents, Agentic IDE and Plugins open their section; an agent's row opens its chat |
| Caption strip | Home and Back; in the Agentic IDE, the switch between threads and grid |
| Front page | The composer takes what is typed and the assistant answers; the round button starts a call |
| Agentic IDE | Threads open; "New thread" opens the empty one; both composers start a turn; the sub-agent dock unfolds |
| Agents | Each agent's chat opens; its composer is answered |
| Plugins | A row's plus connects it |

Everything else is real markup that does nothing, the way a screenshot does
nothing.

**The demo never pretends to have done work.** Three questions have scripted
answers (a failing test, the calendar, the inbox). Anything else is answered
with the truth: this is the demo on the website, nothing runs here, and this is
what the app would do with it.

### The starters

Three buttons under the window — "Fix the failing test", "What's on my
calendar?", "Open the Agentic IDE". They belong to the page, not to the window:
the app has no such row and a clone may not grow one. They exist because a
reader who would never think to type into a picture of an app still finds out,
with one press, that it answers.

### No audio, no canvas, no network

- No `getUserMedia`, no sound, no WebGL. A call shows the app's call card; its
  level meter is a canvas in the app and plain elements here
- No request leaves the window

## Accessibility

- The stage is `aria-hidden="true"`, and every control inside it has
  `tabIndex={-1}`: a keyboard or screen-reader user gets the description
  instead of a hundred unlabelled buttons
- Beside it, a `<p class="sr-only">` says what the demo shows and what the
  three starters do. The starters themselves are ordinary buttons in the tab
  order
- `prefers-reduced-motion`: no tour and no typing. The window opens on the
  finished errand and still answers every press, without animation

---

## Forbidden

- `100vh` instead of `100svh`
- Shrinking the window to fit a height, or scaling it on anything but width
- Hand-drawn imitations of the app's UI inside the window — copy the app's
  markup and sync its stylesheet instead
- Content from a real session in the clone's data
- An answer in the demo that claims work was done
- Screenshots, video, canvas, or image sequences for the mockup
- Text in the mockup that is not real text in the DOM
- Responsive styling inside the window
- A second floating window, or a window that is not the app as it ships
- Network requests from the demo
- `getUserMedia` or any permission prompt in the hero
- A mark among the floating tiles that the connection strip does not identify
- A bespoke `max-width` on the section instead of a step from `layout.md`
