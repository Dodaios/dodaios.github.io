# Loading speed

What keeps the home page fast, and how to measure it. Read this before adding
an island, an image or a video to the home page.

## The numbers (2026-11-10)

Lighthouse CLI 13, home page, simulated phone (slow 4G, 4x slower processor),
the same machine before and after:

| | Before | After |
| --- | --- | --- |
| Performance score | 80 to 89 | 93 to 100 |
| First paint | 1.4 to 1.8 s | 1.3 to 1.5 s |
| Largest paint | 2.9 to 4.4 s | 1.3 to 1.9 s |
| Blocking time | 150 to 270 ms | 10 to 65 ms |
| Downloaded on load | 1,954 kB in 82 requests | 478 kB in 31 requests |

The ranges are the spread over several runs. A busy machine moves every figure,
so compare runs taken back to back.

## What holds them there

- **The stylesheet is inside the page** (`build.inlineStylesheets` in
  `astro.config.mjs`). No request stands between the HTML and the first paint.
- **Only the hero island starts early, and it waits for idle** (`client:idle`).
  Every other island is `client:visible`. The commit chart hydrates two
  screens ahead (`rootMargin`), because pinned it must be in its pose before
  it scrolls into view. Do not add a `client:load` island below the hero.
- **A demo window builds its contents once it has a size**
  (`DemoStage` in `src/components/window-demo/Stage.tsx`). The window is hidden
  until its stage has been measured, so contents in the server's HTML would be
  downloaded and laid out without ever being seen. This is also what keeps the
  recording in "Code by talking" from loading with the page: the `<video>` is
  part of those contents.
- **Backdrops come in three widths** (768, 1024 and the master). After adding
  or replacing a painting, run `node scripts/build-backdrop-variants.mjs` and
  commit the copies it writes.

## Measuring

Build, serve the build from a scratch copy on its own port (never the dev
server: it serves unminified modules), and stop the server afterwards:

```
npm run build
npx lighthouse http://127.0.0.1:<port>/ --only-categories=performance \
  --chrome-flags="--headless=new" --output=json --output-path=report.json
```

Run it at least three times and read the median. Add `--preset=desktop` for
the desktop profile. The live site answers the same command at
`https://dodaios.ai/`.

## What is left

- The page's HTML is still about 65 kB compressed without the stylesheet. Half
  of that is the logo strip's 56 inline marks.
- GitHub Pages sets the cache lifetime of every file; Lighthouse lists that
  under "cache" and nothing in this repository can change it.
- The app clone's font is declared `font-display: block` inside its own frame,
  so the clone's text waits for the font. Lighthouse lists it; it does not
  delay the page's own text, which uses the system font.
