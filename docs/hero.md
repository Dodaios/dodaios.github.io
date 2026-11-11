# The first screen and the app window

> Builds on [`world.md`](world.md), which describes the 3D scene the front page
> stands in. Colour and type come from [`design.md`](design.md).

The top of the front page does three things: it says **what the product is**,
it offers **one action**, and it lets the reader **use the app** before they
install it. Until 2026-11-11 all three sat in one hero section with the app
window under the headline. Now they are the first two chapters of the scene.

---

## Chapter one: the desk at night

`src/sections/world/HeroChapter.astro`

- **The headline is a definition, not a slogan**: "The open-source agent OS for
  your desktop". A reader should be able to repeat what the product is after
  this one line. Weight 400, as everywhere (`design.md`).
- **One line under it** completes the definition (what it runs, how you talk to
  it, where it runs) and answers the first objection ("bring your own
  subscription").
- **One button.** Paper on ink, a pill, at least 48px tall. It names the
  reader's own machine, chosen by CSS from `data-os` on `<html>`
  (`DownloadCta.astro`, `OsProbe.astro`).
- **Two quiet links**: the repository with its star count from
  `src/data/social-counts.json`, and the docs.
- **The headline is text in the page.** It is painted before any of the scene
  has loaded, and it is the page's largest paint (`performance.md`).

Behind it the scene comes alive in about two seconds: the monitor wakes, the
lamp catches, the mascot opens its eyes and makes one small jump. The mascot's
eyes follow the pointer; pressing it makes it jump again.

In a landscape window the copy stands on the left and the desk on the right. In
a portrait window the copy is on top and the desk below it.

## Chapter two: sit down

`src/sections/world/TryChapter.astro`

The camera flies over the empty chair to the monitor. When it has arrived, the
monitor's screen **is** the app: the working clone lies exactly where the
screen came to rest (`world.md`, "The dock"). Scrolling on makes the camera
stand up again.

Without the scene the same window simply stands in the page.

### The window is a clone of the app

**One window, and it is the app's own markup under the app's own stylesheet.**
Drawn versions of the app drifted every time the app changed, and the
maintainer judges the demo against the running app. So nothing in the window is
drawn:

- **Markup**: `src/components/demo/app/` copies the elements and the class
  names of the running app: the shell (`AppShell.tsx`), the conversation
  (`Conversation.tsx`), the Agentic IDE in its thread layout (`Threads.tsx`)
  and in its grid (`IdeScene.tsx`), the Agents section (`AgentsView.tsx`) and
  the plugin catalogue (`PluginsView.tsx`). Only the data is the demo's
  (`demoData.ts`): an invented person, project and agents.
- **Style**: `app.css` is the app's compiled stylesheet, cut down to the
  classes the clone uses by `scripts/sync-app-ui.mjs`. Never edit it by hand.
- **Isolation**: `AppFrame` renders the clone into an empty iframe through a
  React portal, so the app's sheet cannot touch this site. No src, no request.
- **The window edge** is the only thing the app does not draw: `.demo-window`
  in `demo-stage.css`.

The style gate exempts `src/components/demo/app/` (`scripts/check-style.mjs`).

**When the app's UI changes**, update the copied markup from the app, run both
scripts against a fresh app build, and take the monitor's picture again
(`world.md`, "The models"):

```
node scripts/gen-app-icons.mjs <app>/dodaios/ui/web/frontend
node scripts/sync-app-ui.mjs   <app>/dodaios/ui/web/dist/assets
```

A section the app has dropped is dropped from the clone in the same change. The
Verse entries went on 2026-11-11, with the app's own removal of it.

### Size

A real app window, 1360 x 758 CSS px, laid out at that size and scaled as one
piece. The stage is as wide as the column, or as wide as the window's ratio
allows the screen's height to hold it together with its caption and the
starters, whichever is less.

The scale is `stage width / 1360`. **Below 0.46 it stops**: on a phone the
window keeps 0.46, slides its sidebar out of the left edge and lets its right
side run out of the frame. The monitor in the scene matches the whole window,
so on a phone the monitor continues on both sides of the live frame.

### The window works

**Left alone it plays one errand**: the person asks for a failing test to be
fixed; the assistant hands the job to an agent; the Agentic IDE opens on that
agent's thread; the thread ends with an open pull request.

**The first press inside the window ends the tour for good.** From then on the
reader drives: the sidebar opens the sections, threads open, both composers
take what is typed, a plugin connects, the round button starts a call.

**The demo never pretends to have done work.** Three questions have scripted
answers. Anything else is answered with the truth: this is the demo on the
website, nothing runs here, and this is what the app would do with it.

Three starters under the window ("Fix the failing test", "What's on my
calendar?", "Open the Agentic IDE") belong to the page, not to the window.

## Accessibility

- The window is `aria-hidden="true"` and every control inside it has
  `tabIndex={-1}`. Beside it, a `<p class="sr-only">` says what it shows.
- While the scene runs and the window is not docked, the stage is
  `visibility: hidden`, so its starters cannot be reached by the Tab key while
  they cannot be seen.
- `prefers-reduced-motion`: no tour, no typing, no camera flight
  (`world.md`, "Reduced motion").

## Forbidden

- Hand-drawn imitations of the app's UI inside the window.
- Content from a real session in the clone's data.
- An answer in the demo that claims work was done.
- Text in the scene. Words belong to the page.
- Network requests from the demo, `getUserMedia`, or any permission prompt.
- A mark in the scene without the caption that it implies no partnership.
