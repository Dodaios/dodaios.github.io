# The 3D world

The site stands in one real-time 3D scene: a desk at night, the mascot on it,
the agents around it, and everything the app reaches in orbit. On the front
page the scroll position moves a camera through that scene; every other route
shows one still view of it behind its text.

Read this before changing anything under `src/world/`, `src/sections/world/`,
`src/styles/world.css` or `art/`.

Related: [`hero.md`](hero.md) for the first screen and the app window,
[`performance.md`](performance.md) for the loading rules,
[`design.md`](design.md) for colour and type.

---

## The idea

The page tells one story, and the scene is that story:

| Chapter | `data-chapter` | What the scene does |
|---|---|---|
| The desk at night | `hero` | One lamp, one monitor, an empty chair, the mascot beside the screen. |
| Sit down | `try` | The camera takes the chair. The monitor becomes the working app. |
| Voice | `talk` | Face to face with the mascot. It leans in when it listens. |
| Agents | `agents` | The camera pulls back: eight agent pods light up around the desk. |
| Plugins, Skills, CLIs | `plugins`, `skills`, `clis` | Three rings of tiles orbit the desk, one lit at a time. |
| Stars | `stars` | One light for each person who starred the repository. |
| Open source | `open` | The set dims and shows the lines it is built from. |
| Install | `install` | Night turns to morning. |

The visitor can use the product inside the scene: in "Sit down" the monitor's
screen is the working clone of the app (`hero.md`).

## How it is put together

```
src/world/
  timeline.ts       pure arithmetic: shots, poses, keys, sampling
  script.ts         what the camera shows and the scene does in each chapter
  boot.ts           the page's side: measures chapters, samples the timeline,
                    starts the scene after the first paint
  link.ts           the line to the scene: a worker where possible, the page's
                    own thread otherwise
  world.worker.ts   the worker's end of that line
  World.ts          renderer, camera, frame loop
  kit.ts            loaders, tokens, smoothing
  parts/            desk, mascot, pods, rings, sky
src/sections/world/ the chapters' markup
src/styles/world.css  the canvas's box and the chapters' layout
src/components/world/WorldCanvas.astro  the canvas, the data, the boot script
art/                the Blender sources of the three models
```

### The page works without the scene

There are two states and the first needs no script.

- **Plain.** No `world-on` class on `<html>`. Every chapter is an ordinary
  block in the flow and everything in it is visible, the app window included.
  This is what a browser without WebGL 2 or without JavaScript gets.
- **`world-on`.** Stamped in the `<head>` (`Base.astro`) when the browser can
  draw the scene. A chapter becomes a tall track with one screen pinned inside
  it. The class is set before the first paint because it decides the layout.

`world-live` is added when the scene has drawn its first frame. If the scene
cannot start, `boot.ts` removes `world-on` again and the page is the plain one.

Two switches for checking, both in the address:

- `?world=off` asks for the plain page.
- `?world=page` keeps the scene on the page's own thread.
- `?world=debug` adds `window.__world()`, which reports what the page believes
  about the scene (sizes, the dock's rectangle and its error in px).

### The scene runs on its own thread

`link.ts` hands the canvas to a worker (`transferControlToOffscreen`). The
worker parses the renderer, decodes the models, compiles the shaders and draws
every frame. The page's thread reads the scroll position and posts one small
message per frame.

Because of that, **nothing in `World.ts`, `kit.ts` or `parts/` may touch
`window` or `document`.** What the scene needs from the page is handed to it:
the values of the colour tokens (`TOKEN_NAMES` in `kit.ts`), the canvas's size,
and the marks' sprite sheet as a decoded picture (an SVG can only be decoded on
the page).

Where a worker cannot take a canvas, the same code runs on the page's thread.
Both paths answer to `WorldLink`; nothing above `link.ts` knows which it got.

### The timeline

A camera shot is written as what it must show, not where the camera stands:
"fit a sphere of this radius around this point into this box of the window,
from this direction" (`Shot` in `timeline.ts`). The distance and the lens shift
follow from the window's shape, so one shot holds on a phone and on a wide
monitor. Each shot names two boxes, one for a landscape window and one for a
portrait one; the switch is at 21:20, the same ratio at which `world.css` moves
the copy from above the scene to beside it.

A chapter is pinned from its top edge until its bottom edge reaches the bottom
of the window. Its beats (`script.ts`) are spread over that stretch. Between
two chapters the page travels one window height and the camera crosses from
the last beat of one to the first beat of the next. Every stretch is eased at
both ends, so the camera rests on each beat.

A beat can also set **channels**: numbers the scene reads besides the camera
(`dawn`, `pods`, `rings`, `ring`, `wire`, `stars`, `voice`, `dock`).

`boot.ts` writes two things on each chapter for CSS to use: `--p`, the
progress through the pinned stretch, and `data-seen`, which starts the copy's
entrance.

### The dock

In "Sit down" the monitor's screen has to land exactly on the app window in the
page. `resolveDock` computes the one camera distance and lens shift at which
the screen quad covers the window's rectangle; a plane parallel to the image
plane keeps its shape under a shifted lens, so all four corners match. The
scene reports the worst corner's distance in px each frame, and `boot.ts` fades
the live window in as that distance goes to zero. Measured after a direct jump
into the chapter: under 0.3 px.

The scene must draw at exactly the size the poses are worked out for. A
scrollbar arriving changes the canvas without a resize event, so `boot.ts`
forwards every change of the canvas's size, not only window resizes.

Until the two line up, the monitor shows `src/assets/world/screen.webp`, a
picture of the app window in its opening state. After the app's look changes,
take it again (see "The models").

### Reduced motion

With `prefers-reduced-motion` the camera does not travel. Each beat is held
until the next one is nearer, and the picture changes in a short fade
(`world-cut`). The idle motion stops: no breathing, no drifting dust, no
turning rings. Everything still answers a press.

### Other routes

Every route names a scene through `Base.astro`'s `world` prop: `plugins`,
`skills`, `clis`, or the default `quiet`. These are single shots (`STILLS` in
`script.ts`). Behind text the scene is scenery: it is clearest behind the
page's opening lines, steps back as the reader scrolls (`--world-still`), and
stops drawing once it is out of the way.

## The models

Three models, each built from scratch by one Python script in headless Blender
(`art/<name>/build.py`). Lighting is rendered ahead of time with Cycles on the
GPU and stored in textures; the site draws the set unlit.

| Model | Nodes the code relies on | Light |
|---|---|---|
| `desk` | `Near`, `Far`, `Screen`, `MascotAnchor`, `LampBulb`, `LampPool` | two baked states, night and morning, in two atlases each |
| `mascot` | `Body`, `Cape`, `Face`, `EyeL`, `EyeR` | lit at run time, so it can move |
| `pod` | `Base`, `Screen`, `Agent`, `AgentEyeL`, `AgentEyeR`, `LanternGlow` | one baked atlas |

`Screen` in `desk` is one quad with the app window's own ratio (1360 : 758),
exactly vertical and facing +Z. The dock depends on that.

To rebuild a model and ship it:

```
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python art/desk/build.py
node scripts/build-world-assets.mjs
```

`art/*/out/` is not committed. `build-world-assets.mjs` writes what the site
ships into `src/assets/world/`: geometry compressed with meshopt, textures as
WebP in a full and a half size, and the set's hard edges for the wireframe.

The monitor's picture is a screenshot of the app clone's window at 1360 x 758,
taken from the plain page (`/?world=off`) right after the window has loaded and
before its tour starts.

## The marks on the tiles

The tiles of the first and third ring carry the marks of services the app
connects to. They come from `src/components/logos/` through one sprite sheet
(`src/pages/world/marks.svg.ts`). They identify those services and imply no
partnership; the Plugins chapter carries the caption that says so
([`LOGOS.md`](LOGOS.md)). Do not show a mark anywhere in the scene without that
caption on the same screen.

## Rules

- Text is never part of the scene. Every word a visitor reads is in the page,
  so it can be selected, searched, translated and read aloud.
- Nothing draws before the page has painted. The scene starts after the load
  event and after the largest paint has been recorded, in an idle moment.
- No colour is named in `src/world/`. Colours are tokens (`tokens.css`); the
  light's own colours are the `--world-*` group.
- The scene never asks for the microphone, plays sound, or sends a request to
  another site.
- A new part goes in `parts/`, is created in `World.extend` if it is not on the
  first screen, and reads channels rather than the scroll position.
