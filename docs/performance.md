# Loading speed

What keeps the site fast although it stands in a real-time 3D scene, and how to
measure it. Read this before adding an island, an image, a model or a part of
the scene. The scene itself is described in [`world.md`](world.md).

## The numbers (2026-11-11)

Lighthouse CLI 13.5, front page, a build served with gzip on this machine, in a
visible Chrome so the scene is drawn by the real graphics card.

| | Phone profile (slow 4G, 4x slower processor) | Desktop profile |
| --- | --- | --- |
| Performance score | 100 (three runs) | 100 (two runs) |
| First paint | 1.2 to 1.3 s | 0.4 s |
| Largest paint | 1.3 to 1.4 s | 0.5 s |
| Blocking time | 25 to 40 ms | 0 ms |
| Layout shift | 0 | 0 |
| Downloaded with the whole room | about 2.4 MB in 51 requests | about 3.5 MB in 51 requests |

Accessibility, best practices and SEO: 100 each. `/plugins`: 99 on the phone
profile.

These are the figures of the room (the second version of the scene, the same
day). Its first version, a desk with a few objects around it, weighed 0.8 MB;
the room is a whole interior in six pieces, each with its light in two states,
and it arrives after the first paint, one piece at a time.

For comparison, the first working version of the scene ran on the page's own
thread and scored 62 to 78 on the phone profile, with about a second of
blocking time. The difference is the first rule below.

The ranges are the spread over several runs. A busy machine moves every figure,
so compare runs taken back to back.

## What holds them there

- **The scene runs in a worker** (`src/world/link.ts`). Parsing the renderer,
  decoding the models, compiling shaders and drawing every frame happen off the
  page's thread. The page's thread reads the scroll position and posts one
  small message per frame. Do not move scene work back onto the page's thread,
  and keep `window` and `document` out of `src/world/World.ts`, `kit.ts` and
  `parts/`.
- **Nothing of the scene is requested before the page has painted.**
  `boot.ts` waits for the load event, then for the largest paint to be
  recorded, then for an idle moment. The headline is text in the page and is
  the largest paint; the canvas is not a candidate. Lighthouse's model counts
  every request that starts before the largest paint against it, which is why
  this order matters more than the bytes.
- **The scene's downloads ask for low priority** and arrive in pieces: first
  the room's shell, the desk, the mascot and their night textures; then, one
  piece per idle moment and in the order the tour visits them, the agents wall,
  the lounge with the hologram, the window, the whiteboard corner, the morning
  textures and the wireframe.
- **The baked light comes in two sizes.** A phone, and every route that only
  shows a still view, gets the half-size textures.
- **The canvas draws fewer pixels when frames run long** (`watchSpeed` in
  `World.ts`), and stops drawing when the tab is hidden or, on a page of text,
  once the reader has scrolled into the text.
- **The stylesheet is inside the page** (`build.inlineStylesheets` in
  `astro.config.mjs`). No request stands between the HTML and the first paint.
- **The app window is on the first screen and still costs the first paint
  nothing.** `DemoStage` is `client:idle`: its script starts when the page's
  thread is free. No island is `client:load`.
- **The room's text is drawn off the page's thread.** The signs, the
  whiteboard and the terminals are canvases the worker draws; a terminal
  redraws at most one pane per frame.
- **The chapters' layout is decided in the `<head>`** (`world-on`), so nothing
  moves after the first paint: layout shift is 0.
- **Nothing large is painted when the room arrives.** A chapter shows its copy
  and its row until then; at that instant they leave the picture without a
  fade (`world-settled` in `docs/world.md`). A fade there once made an unseen
  row of small print the page's largest paint, 2.4 s late.

## Measuring

Build, serve the build from a scratch copy on its own port with compression
(never the dev server: it serves unminified modules), and stop the server
afterwards:

```
npm run build
npx lighthouse http://127.0.0.1:<port>/ --only-categories=performance \
  --output=json --output-path=report.json
```

Run it at least three times and read the median. Add `--preset=desktop` for the
desktop profile. Leave Chrome visible: a headless Chrome draws WebGL on the
processor, which is slow and is not what a visitor's machine does.

To see which part of a change costs what, compare against the plain page
(`/?world=off`) and against the scene on the page's thread (`/?world=page`).

## What is left

- GitHub Pages sets the cache lifetime of every file; Lighthouse lists that
  under "cache" and nothing in this repository can change it.
- The app clone's font is declared `font-display: block` inside its own frame,
  so the clone's text waits for the font. It does not delay the page's own
  text, which uses the system font.
- The speed index varies between 1.2 and 3.8 s on the phone profile, because
  the scene fades in after the text. It weighs a tenth of the score.
