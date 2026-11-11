# The first screen and the app window

> Builds on [`world.md`](world.md), which describes the room the front page
> stands in. Colour and type come from [`design.md`](design.md).

The top of the front page does three things: it says **what the product is**,
it offers **one action**, and it lets the reader **use the app** before they
install it. Since 2026-11-11 all three are one picture: the reader sits at the
desk, and the monitor in front of them is the app.

---

## The first screen

`src/sections/room/HeroChapter.astro`

- **The monitor is the app, from the first frame.** The working clone of the
  app lies exactly where the monitor's screen is (`world.md`, "The dock"). It
  is in the page's markup, so it is there before the room has loaded, and the
  room appears around it. Nothing has to be scrolled, opened or started first.
- **The headline is the LED bar above the monitor.** It is the page's `<h1>`,
  it is text in the page, and the room draws the same words on the bar's quad
  (`Text_hero`). The headline is a definition, not a slogan: a reader should be
  able to repeat what the product is after this one line.
- **One button**, in the HUD row at the foot of the window. It names the
  reader's own machine, chosen by CSS from `data-os` on `<html>`
  (`DownloadCta.astro`, `OsProbe.astro`). Corners are 8 px, as in the app; no
  pills.
- **Two quiet links** beside it: the repository with its star count from
  `src/data/social-counts.json`, and the docs.

Scrolling rolls the chair back: the live window gives way to the monitor in the
room, and the desk comes into view with the mascot beside the screen, the
second monitor, the lamp and the wordmark on the wall.

Without the scene the same window stands in the page under the headline.

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

A section the app has dropped is dropped from the clone in the same change.

### Size

A real app window, 1360 x 758 CSS px, laid out at that size and scaled as one
piece. The stage is as wide as the column, or as wide as the window's ratio
allows the screen's height to hold it together with the headline bar above it
and the HUD row below it, whichever is less.

The scale is `stage width / 1360`. **Below 0.46 it stops**: on a phone the
window keeps 0.46, slides its sidebar out of the left edge and lets its right
side run out of the frame. The monitor in the room matches the whole window,
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

## Accessibility

- The window is `aria-hidden="true"` and every control inside it has
  `tabIndex={-1}`. Beside it, a `<p class="sr-only">` says what it shows.
- While the scene runs and the window is not docked, the stage is
  `visibility: hidden`, so nothing in it can be reached by the Tab key while it
  cannot be seen.
- The words drawn in the room are not the accessible ones: the chapter's copy
  in the page is, and it becomes visible when it takes the keyboard focus.
- `prefers-reduced-motion`: no tour, no typing, no camera flight
  (`world.md`, "Reduced motion").

## Forbidden

- Hand-drawn imitations of the app's UI inside the window.
- Content from a real session in the clone's data.
- An answer in the demo that claims work was done.
- Words that float in the scene. Text in the room is on an object, and the same
  words are in the page (`world.md`, "Text in the room, and text in the page").
- Network requests from the demo, `getUserMedia`, or any permission prompt.
- A mark in the scene without the caption that it implies no partnership.
