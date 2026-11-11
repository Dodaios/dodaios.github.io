/**
 * The script: what the camera shows and what the scene does in each chapter of
 * the front page. A chapter is one `<section data-chapter="...">`; its beats
 * are spread over the stretch for which that section is pinned.
 *
 * Distances are metres. The set stands at the origin: the floor is Y = 0, the
 * desk top Y = 0.74, the monitor's screen faces +Z. See docs/world.md.
 */
import { DOCK, type Beat, type Box, type Shot, type Vec3 } from "./timeline";

/** Where things are. The loaded models correct the first two at run time. */
export const SCREEN_CENTER: Vec3 = [0, 1.06, -0.6];
export const MASCOT_SEAT: Vec3 = [0.5, 0.74, -0.42];

export const POD_COUNT = 8;

/** The three orbits: centre height and radius of each ring of tiles. */
export const RINGS = [
  { id: "plugins", y: 2.05, radius: 6.4, speed: 0.022 },
  { id: "skills", y: 1.25, radius: 6.8, speed: -0.017 },
  { id: "clis", y: 0.45, radius: 7.2, speed: 0.013 },
] as const;
export const RING_CENTER_Z = -0.5;

/** The subject on the right, the copy on the left. */
const RIGHT: Box = { x0: 0.42, y0: 0.1, x1: 1, y1: 0.94 };
/** The subject on the left, the copy on the right. */
const LEFT: Box = { x0: 0, y0: 0.1, x1: 0.58, y1: 0.94 };
/** A phone: copy on top, the subject below it. */
const BELOW: Box = { x0: 0, y0: 0.47, x1: 1, y1: 0.98 };
/** A phone, under a chapter whose copy is long: the subject keeps to the foot. */
const LOW: Box = { x0: 0, y0: 0.6, x1: 1, y1: 0.97 };
const WHOLE: Box = { x0: 0.04, y0: 0.08, x1: 0.96, y1: 0.94 };
/** Behind a page of text: the lower half, under the page's opening lines. */
const UNDER: Box = { x0: 0, y0: 0.5, x1: 1, y1: 0.98 };
/** Behind a column of prose: out at the right edge, clear of the column. */
const ASIDE: Box = { x0: 0.74, y0: 0.12, x1: 1, y1: 0.9 };
/** The stargazers: up and to the right, above the quotes. */
const SKY: Box = { x0: 0.42, y0: 0.07, x1: 1, y1: 0.7 };
const SKY_TALL: Box = { x0: 0, y0: 0.34, x1: 1, y1: 0.7 };

const shot = (partial: Partial<Shot> & Pick<Shot, "target" | "az" | "el" | "fit">): Shot => ({
  fov: 32,
  wide: RIGHT,
  tall: BELOW,
  ...partial,
});

const ringFront = (index: number): Vec3 => [0, RINGS[index].y, RING_CENTER_Z + RINGS[index].radius];

export const SCRIPT: Record<string, readonly Beat[]> = {
  /* The desk at night. A slow push in while the first screen is read. */
  hero: [
    { at: 0, shot: shot({ target: [0, 0.95, -0.05], az: 33, el: 15, fit: 2.1 }) },
    { at: 1, shot: shot({ target: [0.02, 1.0, -0.3], az: 25, el: 12, fit: 1.6 }) },
  ],

  /* Sit down: the camera takes the chair and the monitor becomes the app. */
  try: [
    {
      at: 0,
      shot: shot({ target: [0, 1.04, -0.55], az: 9, el: 7, fit: 0.78, fov: 30, wide: WHOLE, tall: WHOLE }),
    },
    { at: 0.26, shot: DOCK, ch: { dock: 1 } },
    { at: 0.8, shot: DOCK, ch: { dock: 1 } },
    {
      at: 1,
      shot: shot({ target: [0.3, 1.0, -0.5], az: -2, el: 6, fit: 0.7, fov: 30, wide: WHOLE, tall: WHOLE }),
      ch: { dock: 0 },
    },
  ],

  /* Face to face with the mascot. */
  talk: [
    {
      at: 0,
      shot: shot({ target: [0.5, 0.93, -0.42], az: -16, el: 9, fit: 0.36, fov: 30, wide: LEFT, tall: LOW }),
      ch: { voice: 1 },
    },
    {
      at: 1,
      shot: shot({ target: [0.5, 0.93, -0.42], az: -26, el: 6, fit: 0.33, fov: 30, wide: LEFT, tall: LOW }),
      ch: { voice: 1 },
    },
  ],

  /* Pull back: the room was never empty. The pods light up one by one. */
  agents: [
    { at: 0, shot: shot({ target: [0, 1.9, -0.9], az: -28, el: 10, fit: 3.6, fov: 36 }), ch: { voice: 0, pods: 1 } },
    { at: 0.6, shot: shot({ target: [0, 2.4, -1.1], az: -6, el: 9, fit: 4.3, fov: 36 }), ch: { pods: POD_COUNT } },
    { at: 1, shot: shot({ target: [0, 2.4, -1.1], az: 8, el: 10, fit: 4.4, fov: 36 }), ch: { pods: POD_COUNT } },
  ],

  /* The three orbits pass in front of the lens, one lit at a time. */
  plugins: [
    { at: 0, shot: shot({ target: ringFront(0), az: 10, el: 5, fit: 2.3, fov: 34, wide: LEFT }), ch: { rings: 1, ring: 1 } },
    { at: 1, shot: shot({ target: ringFront(0), az: 4, el: 4, fit: 2.2, fov: 34, wide: LEFT }), ch: { rings: 1, ring: 1 } },
  ],
  skills: [
    { at: 0, shot: shot({ target: ringFront(1), az: -6, el: 3, fit: 2.3, fov: 34 }), ch: { rings: 1, ring: 2 } },
    { at: 1, shot: shot({ target: ringFront(1), az: -11, el: 2, fit: 2.2, fov: 34 }), ch: { rings: 1, ring: 2 } },
  ],
  clis: [
    { at: 0, shot: shot({ target: ringFront(2), az: 8, el: 6, fit: 2.3, fov: 34, wide: LEFT }), ch: { rings: 1, ring: 3 } },
    { at: 1, shot: shot({ target: ringFront(2), az: 14, el: 8, fit: 2.2, fov: 34, wide: LEFT }), ch: { rings: 1, ring: 3 } },
  ],

  /* Look up: every light is someone who starred the project. */
  stars: [
    {
      at: 0,
      shot: shot({ target: [0, 3.3, -1.2], az: 30, el: 7, fit: 4.9, fov: 38, wide: SKY, tall: SKY_TALL }),
      ch: { rings: 0, ring: 0, stars: 1 },
    },
    {
      at: 1,
      shot: shot({ target: [0, 3.5, -1.2], az: 46, el: 4, fit: 4.9, fov: 38, wide: SKY, tall: SKY_TALL }),
      ch: { stars: 1 },
    },
  ],

  /* Nothing hidden: the set shows how it is built. */
  open: [
    { at: 0, shot: shot({ target: [0, 0.95, -0.35], az: -34, el: 20, fit: 2.5, wide: LEFT }), ch: { stars: 0.25, wire: 1 } },
    { at: 1, shot: shot({ target: [0, 0.95, -0.35], az: -22, el: 17, fit: 2.4, wide: LEFT }), ch: { wire: 1 } },
  ],

  /* Morning. */
  install: [
    { at: 0, shot: shot({ target: [0.05, 1.0, -0.35], az: 12, el: 13, fit: 2.5 }), ch: { wire: 0, dawn: 0.35, stars: 0 } },
    { at: 1, shot: shot({ target: [0.05, 1.0, -0.35], az: 24, el: 15, fit: 2.3 }), ch: { dawn: 1 } },
  ],
};

/** One fixed shot for a page that is not the front page. */
export const STILLS: Record<string, Beat> = {
  plugins: { at: 0, shot: shot({ target: ringFront(0), az: 14, el: 6, fit: 2.6, fov: 34, wide: UNDER, tall: UNDER }), ch: { rings: 1, ring: 1, pods: POD_COUNT } },
  skills: { at: 0, shot: shot({ target: ringFront(1), az: -12, el: 4, fit: 2.6, fov: 34, wide: UNDER, tall: UNDER }), ch: { rings: 1, ring: 2, pods: POD_COUNT } },
  clis: { at: 0, shot: shot({ target: ringFront(2), az: 10, el: 8, fit: 2.6, fov: 34, wide: UNDER, tall: UNDER }), ch: { rings: 1, ring: 3, pods: POD_COUNT } },
  quiet: { at: 0, shot: shot({ target: [0, 2.6, -1], az: 30, el: 6, fit: 4.6, fov: 36, wide: ASIDE, tall: UNDER }), ch: { stars: 0.3, pods: POD_COUNT } },
};
