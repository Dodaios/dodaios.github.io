# The 3D world

The site is one room: a developer's room at night, modelled in full, with the
app running on the monitor. On the front page the scroll position moves a
camera through that room, from the chair at the desk once around and back. Every
other route shows one still view of the room behind its text.

Read this before changing anything under `src/world/`, `src/sections/room/`,
`src/styles/world.css` or `art/`.

Related: [`hero.md`](hero.md) for the first screen and the app window,
[`performance.md`](performance.md) for the loading rules,
[`design.md`](design.md) for colour and type.

---

## The idea

The visitor is in the room from the first frame, seated at the desk, and the
monitor in front of them is the working app. Scrolling rolls the chair back and
takes them round the room. Each station of the tour is one thing the product
does, and what the page says about it is written on an object that stands
there:

| Station | `data-chapter` | What stands there | Where its words are |
|---|---|---|---|
| The desk | `hero` | The monitor is the app, and it can be used at once. | An LED bar above the monitor (`Text_hero`). |
| Voice | `talk` | The mascot at its microphone; the second monitor plays the thread that the order starts. | A small lightbox on the desk (`Text_voice`). |
| Agents | `agents` | Six screens on the right wall, each a coding agent at work in a terminal. | Lettering on the wall above them (`Text_agents`). |
| Plugins, Skills, CLIs | `plugins`, `skills`, `clis` | A hologram over the table in the lounge. It shows one thing per chapter: the apps, then the skills, then the command-line tools. | A cinema lightbox on the wall behind (`Text_reach`). |
| Stars | `stars` | A globe that turns, with a pin for every place a stargazer lives; one light outside the window for each of them; the corkboard beside it with what people wrote. | A counter on the sill (`Text_stars`), a title strip and cards on the board (`Text_board`, `Text_quote1..3`). |
| Open source | `open` | A display on the wall that IS the repository, live: the camera docks onto it as it does onto the monitor. | The display itself (`Screen_repo`). |
| Install | `install` | The whiteboard, at first light; then the whole room in the morning. | The whiteboard (`Text_install`). |

### Text in the room, and text in the page

Every word of the page is in the page's markup (`src/sections/room/`), where it
can be searched, translated and read aloud. With the scene running, that copy is
moved out of sight (it stays in the accessibility tree and appears when it takes
the keyboard focus), and the same words are drawn on the room's objects. Both
read them from data: `src/data/room.ts` for the signs and boards,
`src/data/sessions.ts` for what the terminals show. One source feeds both, so
they cannot drift apart.

What stays on the glass is the HUD: one row at the foot of the window with the
chapter's controls (a button, a link, the command to copy). A press on the
object in the room does the same as its control in the HUD: the whiteboard
copies the command, a card opens the place where it was said.

Every chapter's row is in the tab order wherever the camera is. A row that is
not on screen is transparent, not hidden; when a control in it takes the focus,
`boot.ts` (`followFocus`) scrolls its chapter up and the camera goes there. So
the Tab key walks the room in the order the tour does.

## How it is put together

```
src/world/
  timeline.ts       pure arithmetic: shots, poses, keys, sampling
  script.ts         where the camera stands and what the room does in each chapter
  boot.ts           the page's side: measures chapters, samples the timeline,
                    starts the scene after the first paint, wires the HUD
  link.ts           the line to the scene: a worker where possible, the page's
                    own thread otherwise
  world.worker.ts   the worker's end of that line
  World.ts          renderer, camera, frame loop, what the pointer hits
  kit.ts            loaders, tokens, fonts, canvas drawing, smoothing
  parts/
    room.ts         the room's zones, their baked light, the quads and anchors
    labels.ts       the words on the room's objects
    terminals.ts    the agents' terminals on the wall
    second.ts       the desk's second monitor: the app's thread view, playing
    rings.ts        the hologram
    globe.ts        the globe by the window and its pins
    mascot.ts       the mascot
    sky.ts          the lights outside the window, the dust in the lamp's cone
src/data/room.ts    the copy of every station, for the page and for the room
src/data/sessions.ts  what the wall's terminals show
src/components/repo/  the repository browser that lies on the wall display
src/sections/room/  the chapters' markup
src/styles/world.css  the canvas's box, the chapters, the HUD
src/components/world/WorldCanvas.astro  the canvas, the data, the boot script
art/room/           the Blender sources of the room
art/mascot/         the Blender source of the mascot
```

### The page works without the scene

There are two states and the first needs no script.

- **Plain.** No `world-on` class on `<html>`. Every chapter is an ordinary
  block in the flow and everything in it is visible, the app window included.
  This is what a browser without WebGL 2 or without JavaScript gets.
- **`world-on`.** Stamped in the `<head>` (`Base.astro`) when the browser can
  draw the scene. A chapter becomes a tall track with one screen pinned inside
  it, its copy leaves the picture and its HUD row appears. The class is set
  before the first paint because it decides the layout.

`world-on` promises only that the browser can draw the scene and that the
window is at least 600 px high (a pinned screen needs that much; a phone held
sideways gets the plain page). Three more classes follow:

- `world-ready` is added by `boot.ts` the moment it runs. If it is not there
  four seconds after the page has loaded, the script never arrived, and the
  head's own script takes `world-on` off again.
- `world-live` is added when the scene draws. **Only from then on is a
  chapter's copy out of sight.** While the room loads, a chapter shows its own
  words and its row in the middle of its screen, so a reader who follows a link
  to a chapter before the room is there finds the chapter, not an empty screen.
- `world-settled` follows two frames later and lets the HUD rows fade. (At the
  instant the room arrives every row leaves the page's flow at once; a fade
  there painted all of them over the foot of the screen, and Lighthouse counted
  that as the page's largest paint.)

If the scene cannot start, if a zone of the room does not arrive after a second
try, or if the graphics context is lost later, `boot.ts` (`giveUp`) removes the
classes, stops the scene and its thread, clears what the scene wrote on the
page, and keeps the reader in the chapter they were reading: the page is the
plain page from then on. A room with a station missing is not shown, because
that chapter's words would be nowhere.

Switches for checking, all in the address:

- `?world=off` asks for the plain page.
- `?world=page` keeps the scene on the page's own thread.
- `?world=debug` adds `window.__world()`, which reports what the page believes
  about the scene (sizes, the dock's rectangle and its error in px).

### The scene runs on its own thread

`link.ts` hands the canvas to a worker (`transferControlToOffscreen`). The
worker parses the renderer, decodes the models, compiles the shaders, draws the
room's text and terminals, and draws every frame. The page's thread reads the
scroll position and posts one small message per frame.

Because of that, **nothing in `World.ts`, `kit.ts` or `parts/` may touch
`window` or `document`.** What the scene needs from the page is handed to it:
the values of the colour tokens (`TOKEN_NAMES` in `kit.ts`), the canvas's size,
the room's copy, the addresses of the two font files, and the marks' sprite
sheet as a decoded picture (an SVG can only be decoded on the page). Text is
drawn on `OffscreenCanvas` in the worker with fonts it loads itself
(`loadFonts` in `kit.ts`).

Where a worker cannot take a canvas, the same code runs on the page's thread.
Both paths answer to `WorldLink`; nothing above `link.ts` knows which it got.

Two guards keep a worker from leaving the page waiting:

- **A worker that neither starts nor fails** is given 25 seconds, then the
  page's own thread takes over on a fresh canvas.
- **A worker whose frame loop goes quiet.** In Chrome a worker's animation
  frames were seen to stop while the page's carried on. The page posts one
  message per frame of its own; when the worker has not drawn for 150 ms and
  such a message arrives, it draws on that message instead (`world.worker.ts`).

### The timeline

A camera shot is written as what it must show, not where the camera stands:
"fit a sphere of this radius around this point into this box of the window,
from this direction" (`Shot` in `timeline.ts`). The distance and the lens shift
follow from the window's shape, so one shot holds on a phone and on a wide
monitor.

The camera is inside a room, so a shot also names its `reach`: the farthest the
camera may stand from its target. Where the window's shape would ask for more
(a phone held upright), the lens widens instead, up to 72 degrees, and the
camera stays inside the walls.

Between two shots the camera goes in a straight line from where it stands to
where it will stand, and what it looks at goes in a straight line from one
subject to the next (`lerpPose`; the scene follows the page the same way). The
room is convex, so that path cannot leave it. Turning the angle and the
distance instead swings the camera around a moving target, and across the room
that arc passed through a wall.

A chapter is pinned from its top edge until its bottom edge reaches the bottom
of the window. Its beats (`script.ts`) are spread over that stretch. Between
two chapters the page travels one window height and the camera crosses from
the last beat of one to the first beat of the next. Every stretch is eased at
both ends, so the camera rests on each beat.

A beat can also set **channels**: numbers the scene reads besides the camera
(`dawn`, `agents`, `rings`, `ring`, `stars`, `voice`, `dock`, `repo`, `globe`).

`boot.ts` writes on each chapter what CSS needs: `--p`, the progress through
the pinned stretch, `data-seen`, and `data-current` on the one chapter whose HUD
row is showing.

### The dock

Two screens of the room carry a piece of the page. At the desk the monitor's
screen has to land exactly on the app window; in the corner the wall display
has to land exactly on the repository browser. `resolveDock` computes, for a
screen facing any way round the room, the one camera distance and lens shift at
which the screen quad covers its element's rectangle; a plane parallel to the
image plane keeps its shape under a shifted lens, so all four corners match.
The scene reports the worst corner's distance in px each frame, and `boot.ts`
shows the live element while that distance is near zero.

A dock is a stage in the page (`[data-dock-stage="desk"]`, `"repo"`), a window
inside it that has the screen's own shape, a `DockShot` in the script (`DOCK`,
`DOCK_REPO`) and a channel (`dock`, `repo`). The desk's screen comes from the
model; the wall display's place is `REPO_SCREEN` in `script.ts`, the same
numbers as `Screen_repo` in `spec.py`.

The page opens docked: the hero's first beat is the dock, so the app window is
on screen and usable before the scene has loaded, and the room appears around
it. The LED bar above the monitor is the page's `<h1>`; it has the same ratio
and the same place in the page as the `Text_hero` quad has above the screen.

The scene must draw at exactly the size the poses are worked out for. A
scrollbar arriving changes the canvas without a resize event, so `boot.ts`
forwards every change of the canvas's size, not only window resizes.

When the camera leaves the chair the monitor shows
`src/assets/world/screen.webp`, a picture of the app window in its opening
state. After the app's look changes, take it again (see "The models").

### The first frame

The room is not there at the first paint: it starts after the page has painted
and takes a moment more. Until then a picture of it stands behind the app's
window (`.dock__poster` in `world.css`, `src/assets/world/poster.webp`): the
room as the docked camera sees it, laid so that the picture's monitor is the
window. So the first thing a visitor sees is a place, and the live room fades
in over its own picture. On a window wide enough the monitor takes about three
quarters of the width, not all of it, for the same reason.

To take the picture again (after the desk's model or light changed), let the
scene run docked in a large window with the stage held narrow, hide the page's
own layer, and note where the stage stood: the three numbers in the poster's
rule are the stage's left, top and the picture's width, in hundredths of the
stage's width.

### The hologram, the globe, the second monitor, the wall display

- **The hologram** (`rings.ts`) shows one ring at a time. The ring of the
  chapter the reader is in rises out of the table tile by tile; the others are
  folded back into it. The lightbox behind says in plain words what the ring
  is, then how many there are.
- **The globe** (`globe.ts`) is drawn by the scene on the stand the window zone
  models (anchor `GlobeCenter`). Its land is the site's own land mask; each pin
  is a place from `src/data/stargazers.json`, never a person. A pin under the
  pointer shows the place's name.
- **The second monitor** (`second.ts`) plays the app's thread view as a short
  run of pictures, `src/assets/world/thread-NN.webp`. They are frames of the
  working clone on this site, filmed while it plays its errand, so the screen
  shows the app's own look and the clone's own words. Hold to talk restarts
  the run.
- **The wall display** is the repository browser
  (`src/components/repo/RepoBrowser.tsx`): real markup in the page, docked onto
  the display. It reads GitHub's public API from the visitor's browser when it
  comes into view and again for whatever the visitor opens, keeps the answers
  for the session, and falls back to the snapshot in `src/data/repo-map.json`
  (refreshed daily by the `social-counts` workflow). The privacy page states
  these requests; change them together.

### What the pointer does

Only on the front page, and only where no control of the page is under it: the
mascot's eyes follow it, the camera leans a few degrees, a hologram tile shows
its name, and an object that can be pressed (`SPOTS` in `World.ts`) shows the
hand. An object answers a **click that did not travel**, never a press: a
finger put down to scroll must not copy a command or open a page. Under a mouse
the page already knows what the pointer is over and acts in the click itself:
copying and opening a page need the user's gesture, and an answer that comes
back from the scene's thread is no longer that gesture. Behind a page
of text nothing in the scene takes the pointer.

### Reduced motion

With `prefers-reduced-motion` the camera does not travel. Each beat is held
until the next one is nearer, and the picture changes in a short fade
(`world-cut`). The idle motion stops: no breathing, no drifting dust, no
turning rings, and the terminals show their finished state. Everything still
answers a press.

### Other routes

Every route names a scene through `Base.astro`'s `world` prop: `plugins`,
`skills`, `clis`, or the default `quiet`. These are single shots (`STILLS` in
`script.ts`). Behind text the scene is scenery: it is clearest behind the
page's opening lines, steps back as the reader scrolls (`--world-still`), and
stops drawing once it is out of the way.

## The models

The room is built from scratch by Python scripts in headless Blender, one per
zone, against one contract:

- `art/room/spec.py` holds every number two files must agree on: the room's
  size, each zone's box, the palette, the quads the site draws on, the anchors,
  the lights, and the cameras the previews are taken from. `script.ts` uses the
  same coordinates.
- `art/room/common.py` holds what every zone shares: materials, the shell, the
  light rig, the lightmap, the bake and the export.
- `art/room/zone_<name>.py` models one zone; `bake_shell.py` bakes the walls,
  floor and ceiling with every zone standing in them.

| File the site ships | What is in it |
|---|---|
| `room-shell.glb` | walls, floor, ceiling, window opening, door |
| `room-desk.glb` | desk, chair, monitors, PC, shelves and the wordmark on the back wall |
| `room-right.glb` | the agents wall: six screens, their creatures, the shelf under them |
| `room-lounge.glb` | armchair, rug, the holo table, the lightbox, the door side |
| `room-window.glb` | window, sill, radiator, telescope, the globe's stand, corkboard |
| `room-corner.glb` | whiteboard, the wall display, sideboard, printer |
| `mascot.glb` | the mascot (`Body`, `Cape`, `Face`, `EyeL`, `EyeR`), lit at run time so it can move |

Lighting is rendered ahead of time with Cycles on the GPU and stored in
textures; the site draws the room unlit. Each zone has one 2048 px atlas in two
states, night and morning, and the scene blends between them (`dawn`). A zone's
mesh is named `Zone_<name>` and its material `Bake_<atlas>`; that material name
is how `room.ts` finds the atlas files.

Besides its mesh a zone's file holds:

- **Quads**: flat rectangles the site draws on at run time, named in
  `spec.py` (`Screen`, `Screen2`, `Screen_repo`, `Wall_1..6`, `Text_*`). The model only
  provides the object around them: the monitor's shell, the lightbox's frame,
  the whiteboard's surface.
- **Anchors**: empties that mark a place (`MascotAnchor`, `LampBulb`,
  `LampPool`, `MicTip`, `Wordmark`, `HoloCenter`, `GlobeCenter`).

`Screen` is one quad with the app window's own ratio (1360 : 758), exactly
vertical and facing +Z; `Screen_repo` is exactly vertical and faces +X. The
docks depend on that.

The first screen needs `shell` and `desk`; the other zones load one after
another once the first frame is drawn, the zone the reader is in first, then
the second monitor's frames, then the morning atlases.

To rebuild a zone and ship it:

```
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python art/room/zone_desk.py
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python art/room/bake_shell.py
node scripts/build-world-assets.mjs
```

A zone's light falls on its neighbours, so after a change that moves a lamp or
a large object, bake the shell again as well. `art/*/out/` and
`art/room/cache/` are not committed. `build-world-assets.mjs` writes what the
site ships into `src/assets/world/`: geometry compressed with meshopt, and the
atlases as WebP in a full and a half size.

The monitor's picture is a screenshot of the app clone's window at 1360 x 758,
taken from the plain page (`/?world=off`) right after the window has loaded and
before its tour starts. The second monitor's frames are taken the same way,
later in the tour: one picture of the window for each step of the thread, from
the first work line to the open pull request.

## The marks in the hologram

The tiles of the first and third ring carry the marks of services the app
connects to. They come from `src/components/logos/` through one sprite sheet
(`src/pages/world/marks.svg.ts`). They identify those services and imply no
partnership; the lightbox behind the hologram carries the caption that says so
while those rings are lit ([`LOGOS.md`](LOGOS.md)). Do not show a mark anywhere
in the scene without that caption in the same picture.

The terminals on the agents wall name the coding agents the app drives. They
are written as text, in the terminal's own type, and show no mark.

## Rules

- Every word a visitor reads in the room is also in the page's markup, and both
  come from `src/data/room.ts` or `src/data/sessions.ts`. Never write copy in
  `parts/`.
- A control is never hidden from the keyboard because the camera is elsewhere.
- Text in the room belongs to an object: a sign, a board, a screen, a sheet of
  paper. Nothing floats.
- Nothing draws before the page has painted. The scene starts after the load
  event and after the largest paint has been recorded, in an idle moment.
- No colour is named in `src/world/`. Colours are tokens (`tokens.css`); the
  light's own colours are the `--world-*` group.
- The scene never asks for the microphone, plays sound, or sends a request to
  another site.
- A new part goes in `parts/`, is created in `World.extend` if it is not on the
  first screen, and reads channels rather than the scroll position.
- A new object with words on it is a quad in `spec.py`, a frame around it in
  the zone's script, and a drawing in `labels.ts`.
