/**
 * The world's timeline: where the camera is and what the scene is doing at
 * every scroll position. Pure arithmetic, no DOM and no renderer, so it can be
 * tested on its own and run before the 3D code has loaded.
 *
 * See docs/world.md, "The timeline".
 */

export type Vec3 = readonly [number, number, number];

/** A rectangle of the window, in fractions of it, origin top left. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A camera shot, described by what it has to show rather than by where the
 * camera stands: "fit a sphere of radius `fit` around `target` into this box
 * of the window, seen from this direction". The distance and the lens shift
 * follow from the window's shape, so one shot holds on a phone and on an
 * ultrawide monitor.
 */
export interface Shot {
  target: Vec3;
  /** Degrees around the vertical axis. 0 looks down -Z; positive stands toward +X. */
  az: number;
  /** Degrees above the horizon. */
  el: number;
  /** Radius, in metres, of the sphere around `target` that must stay in the box. */
  fit: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Where the subject sits in a landscape window. */
  wide: Box;
  /** Where it sits in a portrait window. */
  tall: Box;
}

/** A shot resolved for one window: everything the camera needs, as numbers. */
export interface Pose {
  tx: number;
  ty: number;
  tz: number;
  az: number;
  el: number;
  dist: number;
  fov: number;
  /** Lens shift in clip space: where the target lands, -1..1 from the centre. */
  sx: number;
  sy: number;
}

/** What the scene is doing, apart from the camera. Every value is 0..1 unless noted. */
export interface Channels {
  /** 0 night, 1 morning. */
  dawn: number;
  /** How many agent pods are lit, 0..POD_COUNT. */
  pods: number;
  /** The orbit rings are present. */
  rings: number;
  /** Which ring is lit: 1 plugins, 2 skills, 3 command-line tools. 0 none. */
  ring: number;
  /** The set shows its wireframe. */
  wire: number;
  /** The stargazer lights are up. */
  stars: number;
  /** The mascot listens. */
  voice: number;
  /** The camera is docked onto the monitor. */
  dock: number;
}

export const CHANNELS_AT_REST: Channels = {
  dawn: 0,
  pods: 0,
  rings: 0,
  ring: 0,
  wire: 0,
  stars: 0,
  voice: 0,
  dock: 0,
};

/** The one shot that is not written down: it is read off the page. */
export const DOCK = "dock" as const;

export interface Beat {
  /** Position inside the chapter's pinned stretch, 0..1. */
  at: number;
  shot: Shot | typeof DOCK;
  ch?: Partial<Channels>;
}

export interface Key {
  /** Scroll position in px. */
  y: number;
  shot: Shot | typeof DOCK;
  ch: Channels;
  chapter: string;
}

export interface ChapterSpan {
  id: string;
  /** Document offset of the chapter's top edge. */
  top: number;
  height: number;
  beats: readonly Beat[];
}

export interface Viewport {
  width: number;
  height: number;
  /**
   * The page's content column, as fractions of the window's width. On a very
   * wide window the copy keeps to that column (docs/layout.md), so a subject
   * placed against the window's own edges would sit under the copy or far
   * away from it. Absent: the column is the window.
   */
  column?: { x0: number; x1: number };
}

/** The monitor's screen in the world, and the element it has to land on. */
export interface DockTarget {
  /** Centre of the screen quad, world space. */
  center: Vec3;
  /** Height of the screen quad in metres. */
  height: number;
  /** The element's rectangle in the window, px. */
  rect: { left: number; top: number; width: number; height: number };
}

export const DOCK_FOV = 30;

const DEG = Math.PI / 180;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * Lay the chapters' beats out along the scroll axis.
 *
 * A chapter is pinned from its top edge until its bottom edge reaches the
 * bottom of the window; its beats are spread over that stretch. Between two
 * chapters the page travels one window height, and the camera crosses from the
 * last beat of one to the first beat of the next in that time.
 */
export function buildKeys(chapters: readonly ChapterSpan[], viewport: Viewport): Key[] {
  const keys: Key[] = [];
  let ch: Channels = { ...CHANNELS_AT_REST };
  for (const chapter of chapters) {
    const start = chapter.top;
    const end = Math.max(start, chapter.top + chapter.height - viewport.height);
    for (const beat of chapter.beats) {
      ch = { ...ch, ...beat.ch };
      keys.push({ y: lerp(start, end, clamp01(beat.at)), shot: beat.shot, ch, chapter: chapter.id });
    }
  }
  return keys;
}

/**
 * Blend the two boxes by the window's shape: portrait gets `tall`, landscape
 * `wide`. The switch is centred on 21:20, where the page's own layout moves the
 * copy from above the scene to beside it (src/styles/world.css).
 */
function boxFor(shot: Shot, aspect: number, column: { x0: number; x1: number }): Box {
  const w = smooth((aspect - 0.95) / 0.2);
  // A landscape box is written against the content column. An edge at 0 or 1
  // is "as far out as it goes": half way from the column's edge to the window's.
  const place = (x: number) =>
    x <= 0 ? column.x0 / 2 : x >= 1 ? (column.x1 + 1) / 2 : lerp(column.x0, column.x1, x);
  return {
    x0: lerp(shot.tall.x0, place(shot.wide.x0), w),
    y0: lerp(shot.tall.y0, shot.wide.y0, w),
    x1: lerp(shot.tall.x1, place(shot.wide.x1), w),
    y1: lerp(shot.tall.y1, shot.wide.y1, w),
  };
}

const WHOLE_WINDOW = { x0: 0, x1: 1 };

export function resolveShot(shot: Shot, viewport: Viewport): Pose {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const box = boxFor(shot, aspect, viewport.column ?? WHOLE_WINDOW);
  // Half sizes of the box in clip space, where the whole window is 2 x 2.
  const halfW = box.x1 - box.x0;
  const halfH = box.y1 - box.y0;
  const tan = Math.tan((shot.fov * DEG) / 2);
  // The sphere has to fit the box both ways; the tighter side decides.
  const dist = shot.fit / (tan * Math.max(0.05, Math.min(halfH, halfW * aspect)));
  return {
    tx: shot.target[0],
    ty: shot.target[1],
    tz: shot.target[2],
    az: shot.az,
    el: shot.el,
    dist,
    fov: shot.fov,
    sx: box.x0 + box.x1 - 1,
    sy: 1 - (box.y0 + box.y1),
  };
}

/**
 * The docked pose: straight in front of the monitor, at the one distance and
 * lens shift where the screen quad covers the element's rectangle exactly. A
 * plane parallel to the image plane keeps its shape under a shifted lens, so
 * the match is exact at every corner, not only at the centre.
 */
export function resolveDock(dock: DockTarget, viewport: Viewport): Pose {
  const { rect } = dock;
  const tan = Math.tan((DOCK_FOV * DEG) / 2);
  const height = Math.max(1, rect.height);
  return {
    tx: dock.center[0],
    ty: dock.center[1],
    tz: dock.center[2],
    az: 0,
    el: 0,
    dist: (dock.height * viewport.height) / (2 * height * tan),
    fov: DOCK_FOV,
    sx: ((rect.left + rect.width / 2) / Math.max(1, viewport.width)) * 2 - 1,
    sy: 1 - ((rect.top + rect.height / 2) / Math.max(1, viewport.height)) * 2,
  };
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    tz: lerp(a.tz, b.tz, t),
    az: lerp(a.az, b.az, t),
    el: lerp(a.el, b.el, t),
    dist: lerp(a.dist, b.dist, t),
    fov: lerp(a.fov, b.fov, t),
    sx: lerp(a.sx, b.sx, t),
    sy: lerp(a.sy, b.sy, t),
  };
}

export function lerpChannels(a: Channels, b: Channels, t: number): Channels {
  return {
    dawn: lerp(a.dawn, b.dawn, t),
    pods: lerp(a.pods, b.pods, t),
    rings: lerp(a.rings, b.rings, t),
    ring: lerp(a.ring, b.ring, t),
    wire: lerp(a.wire, b.wire, t),
    stars: lerp(a.stars, b.stars, t),
    voice: lerp(a.voice, b.voice, t),
    dock: lerp(a.dock, b.dock, t),
  };
}

export interface Sample {
  pose: Pose;
  ch: Channels;
  /** The chapter the nearer key belongs to. */
  chapter: string;
}

/**
 * The state at one scroll position. Every stretch between two keys is eased at
 * both ends, so the camera comes to rest on each beat and never changes
 * direction at speed. `calm` is for reduced motion: no travel, the nearer key
 * is held.
 */
export function sample(
  keys: readonly Key[],
  y: number,
  viewport: Viewport,
  dock: DockTarget | null,
  calm = false,
): Sample | null {
  if (keys.length === 0) return null;
  const resolve = (key: Key): Pose =>
    key.shot === DOCK
      ? dock
        ? resolveDock(dock, viewport)
        : resolveShot(FALLBACK_SHOT, viewport)
      : resolveShot(key.shot, viewport);

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].y <= y) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  if (a === b || y <= a.y || b.y - a.y < 0.5) {
    return { pose: resolve(a), ch: a.ch, chapter: a.chapter };
  }
  const raw = clamp01((y - a.y) / (b.y - a.y));
  if (calm) {
    const key = raw < 0.5 ? a : b;
    return { pose: resolve(key), ch: key.ch, chapter: key.chapter };
  }
  const t = smooth(raw);
  return {
    pose: lerpPose(resolve(a), resolve(b), t),
    ch: lerpChannels(a.ch, b.ch, t),
    chapter: raw < 0.5 ? a.chapter : b.chapter,
  };
}

/** Used only if a dock beat is sampled before the page has told us where the screen goes. */
const FALLBACK_SHOT: Shot = {
  target: [0, 1.06, -0.6],
  az: 0,
  el: 0,
  fit: 0.45,
  fov: DOCK_FOV,
  wide: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
  tall: { x0: 0, y0: 0.25, x1: 1, y1: 0.75 },
};

/** Where the camera stands for a pose, as a point in the world. */
export function cameraPosition(pose: Pose): [number, number, number] {
  const az = pose.az * DEG;
  const el = pose.el * DEG;
  const flat = Math.cos(el) * pose.dist;
  return [pose.tx + Math.sin(az) * flat, pose.ty + Math.sin(el) * pose.dist, pose.tz + Math.cos(az) * flat];
}
