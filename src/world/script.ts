/**
 * The script: where the camera stands and what the room does in each chapter of
 * the front page. A chapter is one `<section data-chapter="...">`; its beats
 * are spread over the stretch for which that section is pinned.
 *
 * The scene is one room (art/room/spec.py holds its numbers; the same
 * coordinates are used here). Distances are metres. The floor is Y = 0, the
 * back wall with the desk is at Z = -2.7, the window is in the left wall at
 * X = -3.6, the agents wall is the right wall at X = 3.6. See docs/world.md.
 *
 * The tour goes once around the room: the desk, the mascot, the agents wall,
 * the holo table, the window with the globe and the corkboard, the display
 * with the repository, the whiteboard, and at the end the whole room in the
 * morning.
 */
import { DOCK, DOCK_REPO, type Beat, type Box, type ScreenQuad, type Shot, type Vec3 } from "./timeline";

export const AGENT_COUNT = 6;

/** Where the hologram turns: the models correct it at run time (anchor `HoloCenter`). */
export const HOLO_CENTER: Vec3 = [-1.45, 1.2, 1.25];

/** Where the globe stands by the window (anchor `GlobeCenter`), and how big it is. */
export const GLOBE_CENTER: Vec3 = [-2.98, 1.0, -0.45];
export const GLOBE_RADIUS = 0.24;

/** The display on the left wall that carries the repository (quad `Screen_repo`). */
export const REPO_SCREEN: ScreenQuad = { center: [-3.555, 1.6, -1.85], width: 1.04, height: 0.65, yaw: 90 };

/**
 * The hologram shows one thing at a time: the apps it connects to, then the
 * command-line tools it drives, then the skills it was taught. All three turn
 * at the same height and radius; the one that is not shown is folded into the
 * table. Speed is radians a second (the sign is the direction).
 */
export const RINGS = [
  { id: "plugins", y: 0.1, radius: 1.0, speed: 0.05 },
  { id: "skills", y: 0.1, radius: 1.0, speed: -0.04 },
  { id: "clis", y: 0.1, radius: 1.0, speed: 0.045 },
] as const;

/** The whole window, less a margin: the picture fills the screen now. */
const FULL: Box = { x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.86 };
const FULL_TALL: Box = { x0: 0, y0: 0.12, x1: 1, y1: 0.84 };

const shot = (partial: Partial<Shot> & Pick<Shot, "target" | "az" | "el" | "fit">): Shot => ({
  fov: 36,
  wide: FULL,
  tall: FULL_TALL,
  ...partial,
});

const holo = (dy: number): Vec3 => [HOLO_CENTER[0], HOLO_CENTER[1] + dy, HOLO_CENTER[2]];

export const SCRIPT: Record<string, readonly Beat[]> = {
  /*
   * Seated at the desk. The monitor IS the app from the first frame: the
   * visitor can use it before they have scrolled at all. Then the chair rolls
   * back and the desk comes into view.
   */
  hero: [
    { at: 0, shot: DOCK, ch: { dock: 1 } },
    { at: 0.58, shot: DOCK, ch: { dock: 1 } },
    { at: 1, shot: shot({ target: [0, 1.5, -2.5], az: -5, el: 3, fit: 1.3, fov: 36, reach: 3.7 }), ch: { dock: 0 } },
  ],

  /* The mascot and its microphone, then the second monitor where a thread runs what was said. */
  talk: [
    { at: 0, shot: shot({ target: [-0.6, 0.97, -2.1], az: 17, el: 7, fit: 0.42, fov: 30, reach: 1.9 }), ch: { voice: 1 } },
    { at: 1, shot: shot({ target: [0.74, 1.1, -2.28], az: -22, el: 3, fit: 0.42, fov: 30, reach: 1.9 }), ch: { voice: 1 } },
  ],

  /* Turn to the right wall: six screens wake one after another. */
  agents: [
    { at: 0, shot: shot({ target: [3.5, 1.72, 0], az: -74, el: 3, fit: 1.6, fov: 38, reach: 4.8 }), ch: { voice: 0, agents: 1 } },
    { at: 0.6, shot: shot({ target: [3.5, 1.72, 0], az: -90, el: 2, fit: 1.6, fov: 38, reach: 4.9 }), ch: { agents: AGENT_COUNT } },
    { at: 1, shot: shot({ target: [3.5, 1.72, 0], az: -102, el: 2, fit: 1.6, fov: 38, reach: 4.8 }), ch: { agents: AGENT_COUNT } },
  ],

  /*
   * Across the room to the holo table. Each of the three chapters shows one
   * thing in the hologram, and the camera walks a third of the way round the
   * table for each, so the change of subject is a change of place too.
   */
  plugins: [
    { at: 0, shot: shot({ target: holo(0.3), az: 150, el: -2, fit: 1.2, fov: 40, reach: 3.0 }), ch: { rings: 1, ring: 1 } },
    { at: 1, shot: shot({ target: holo(0.3), az: 160, el: -1, fit: 1.15, fov: 40, reach: 3.0 }), ch: { rings: 1, ring: 1 } },
  ],
  skills: [
    { at: 0, shot: shot({ target: holo(0.28), az: 176, el: 0, fit: 1.2, fov: 40, reach: 3.0 }), ch: { rings: 1, ring: 2 } },
    { at: 1, shot: shot({ target: holo(0.28), az: 184, el: 1, fit: 1.15, fov: 40, reach: 3.0 }), ch: { rings: 1, ring: 2 } },
  ],
  clis: [
    { at: 0, shot: shot({ target: holo(0.26), az: 198, el: 1, fit: 1.2, fov: 40, reach: 2.9 }), ch: { rings: 1, ring: 3 } },
    { at: 1, shot: shot({ target: holo(0.26), az: 206, el: 2, fit: 1.15, fov: 40, reach: 2.9 }), ch: { rings: 1, ring: 3 } },
  ],

  /*
   * The window: the globe turns with a pin for every place a stargazer lives,
   * and outside there is one light for each of them. Then the corkboard.
   */
  stars: [
    { at: 0, shot: shot({ target: [-3.6, 1.5, 0.15], az: 92, el: 0, fit: 1.4, fov: 40, reach: 4.2 }), ch: { rings: 0, ring: 0, stars: 1, globe: 0.4 } },
    { at: 0.36, shot: shot({ target: GLOBE_CENTER, az: 64, el: 8, fit: 0.4, fov: 30, reach: 1.9 }), ch: { stars: 1, globe: 1 } },
    { at: 0.64, shot: shot({ target: GLOBE_CENTER, az: 80, el: 6, fit: 0.38, fov: 30, reach: 1.8 }), ch: { stars: 1, globe: 1 } },
    { at: 1, shot: shot({ target: [-3.56, 1.66, 2.05], az: 105, el: 0, fit: 0.6, fov: 32, reach: 2.2 }), ch: { stars: 1, globe: 0.3 } },
  ],

  /*
   * The display on the wall is the repository, live: the camera steps in front
   * of it and the page's own view of GitHub lies on the screen, to be used.
   */
  open: [
    { at: 0, shot: shot({ target: REPO_SCREEN.center, az: 68, el: 1, fit: 0.9, fov: 34, reach: 2.9 }), ch: { stars: 0.3, globe: 0.3, repo: 0 } },
    { at: 0.3, shot: DOCK_REPO, ch: { stars: 0, repo: 1 } },
    { at: 0.82, shot: DOCK_REPO, ch: { repo: 1 } },
    { at: 1, shot: shot({ target: REPO_SCREEN.center, az: 104, el: 2, fit: 0.9, fov: 34, reach: 2.7 }), ch: { repo: 0, globe: 0 } },
  ],

  /* The whiteboard at first light, then the whole room in the morning. */
  install: [
    { at: 0, shot: shot({ target: [-2.5, 1.48, -2.66], az: 7, el: 1, fit: 0.98, fov: 34, reach: 2.9 }), ch: { stars: 0, dawn: 0.45 } },
    { at: 0.5, shot: shot({ target: [-2.5, 1.48, -2.66], az: -4, el: 1, fit: 0.9, fov: 34, reach: 2.8 }), ch: { dawn: 1 } },
    { at: 1, shot: shot({ target: [-0.55, 1.28, -0.95], az: 47, el: 9, fit: 3.2, fov: 50, reach: 4.5 }), ch: { dawn: 1, agents: AGENT_COUNT, globe: 0.4 } },
  ],
};

/**
 * One fixed shot for a page that is not the front page. A still stands behind a
 * page of text, so it looks where the room has no words of its own: the
 * hologram is seen from the side, with the window behind it and the lightbox out
 * of the picture, and a page of plain text gets the window at night.
 */
export const STILLS: Record<string, Beat> = {
  plugins: { at: 0, shot: shot({ target: holo(0.12), az: 84, el: 3, fit: 1.35, fov: 40, reach: 3.3 }), ch: { rings: 1, ring: 1, stars: 0.6, globe: 0.4 } },
  skills: { at: 0, shot: shot({ target: holo(0.06), az: 92, el: 3, fit: 1.35, fov: 40, reach: 3.3 }), ch: { rings: 1, ring: 2, stars: 0.6, globe: 0.4 } },
  clis: { at: 0, shot: shot({ target: holo(0), az: 100, el: 3, fit: 1.35, fov: 40, reach: 3.3 }), ch: { rings: 1, ring: 3, stars: 0.6, globe: 0.4 } },
  quiet: { at: 0, shot: shot({ target: [-3.6, 1.5, 0.1], az: 86, el: 2, fit: 1.45, fov: 40, reach: 3.6 }), ch: { stars: 1, globe: 0.6 } },
};
