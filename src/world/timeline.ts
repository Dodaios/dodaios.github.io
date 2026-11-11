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
  /**
   * The farthest the camera may stand from `target`, in metres. The scene is a
   * room: a subject that needs more distance than the room has (a narrow
   * phone, a wide subject) gets a wider lens instead of a camera in the wall.
   */
  reach?: number;
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
  /** How many screens of the agents wall are awake, 0..AGENT_COUNT. */
  agents: number;
  /** The orbit rings are present. */
  rings: number;
  /** Which ring is lit: 1 plugins, 2 skills, 3 command-line tools. 0 none. */
  ring: number;
  /** The stargazer lights are up. */
  stars: number;
  /** The mascot listens. */
  voice: number;
  /** The camera is docked onto the desk's monitor. */
  dock: number;
  /** The camera is docked onto the repository display on the wall. */
  repo: number;
  /** The globe by the window is the subject. */
  globe: number;
}

export const CHANNELS_AT_REST: Channels = {
  dawn: 0,
  agents: 0,
  rings: 0,
  ring: 0,
  stars: 0,
  voice: 0,
  dock: 0,
  repo: 0,
  globe: 0,
};

/**
 * A shot that is not written down but read off the page: the camera stands
 * straight in front of one of the room's screens, at the one distance where
 * that screen covers its element in the page exactly.
 */
export interface DockShot {
  dock: "desk" | "repo";
}
/** Seated at the desk: the monitor is the app. */
export const DOCK: DockShot = { dock: "desk" };
/** In front of the display on the wall: it is the repository. */
export const DOCK_REPO: DockShot = { dock: "repo" };

export const isDock = (shot: Shot | DockShot): shot is DockShot => "dock" in shot;

export interface Beat {
  /** Position inside the chapter's pinned stretch, 0..1. */
  at: number;
  shot: Shot | DockShot;
  ch?: Partial<Channels>;
}

export interface Key {
  /** Scroll position in px. */
  y: number;
  shot: Shot | DockShot;
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

/** A screen of the room, as a rectangle in the world. */
export interface ScreenQuad {
  /** Centre of the screen quad, world space. */
  center: Vec3;
  /** Size of the screen quad in metres. */
  width: number;
  height: number;
  /** The way it faces, degrees about the vertical axis: 0 faces +Z, 90 faces +X. */
  yaw: number;
}

/** A screen in the world, and the element it has to land on. */
export interface DockTarget extends ScreenQuad {
  /** The element's rectangle in the window, px. */
  rect: { left: number; top: number; width: number; height: number };
}

export const DOCK_FOV = 30;
const MAX_FOV = 72;

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
  const tight = Math.max(0.05, Math.min(halfH, halfW * aspect));
  let dist = shot.fit / (tan * tight);
  let fov = shot.fov;
  if (shot.reach !== undefined && dist > shot.reach) {
    // No room to step back: open the lens until the subject fits, up to a limit
    // past which the room would start to bend.
    dist = shot.reach;
    fov = Math.min(MAX_FOV, (2 * Math.atan(shot.fit / (dist * tight))) / DEG);
  }
  return {
    tx: shot.target[0],
    ty: shot.target[1],
    tz: shot.target[2],
    az: shot.az,
    el: shot.el,
    dist,
    fov,
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
    az: dock.yaw,
    el: 0,
    dist: (dock.height * viewport.height) / (2 * height * tan),
    fov: DOCK_FOV,
    sx: ((rect.left + rect.width / 2) / Math.max(1, viewport.width)) * 2 - 1,
    sy: 1 - ((rect.top + rect.height / 2) / Math.max(1, viewport.height)) * 2,
  };
}

/** The pose of a camera that stands at `eye` and looks at `target`. */
export function poseLooking(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  lens: Pick<Pose, "fov" | "sx" | "sy">,
): Pose {
  const dx = eye[0] - target[0];
  const dy = eye[1] - target[1];
  const dz = eye[2] - target[2];
  const dist = Math.max(1e-4, Math.hypot(dx, dy, dz));
  return {
    tx: target[0],
    ty: target[1],
    tz: target[2],
    az: Math.atan2(dx, dz) / DEG,
    el: Math.asin(Math.max(-1, Math.min(1, dy / dist))) / DEG,
    dist,
    fov: lens.fov,
    sx: lens.sx,
    sy: lens.sy,
  };
}

/**
 * Between two poses the camera goes straight from where it stands to where it
 * will stand, and what it looks at goes straight from one subject to the next.
 * The room is convex, so a straight line between two places inside it stays
 * inside; turning the angle and the distance instead would swing the camera
 * around a moving target, and across the room that arc passes through a wall.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const from = cameraPosition(a);
  const to = cameraPosition(b);
  return poseLooking(
    [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)],
    [lerp(a.tx, b.tx, t), lerp(a.ty, b.ty, t), lerp(a.tz, b.tz, t)],
    { fov: lerp(a.fov, b.fov, t), sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t) },
  );
}

export function lerpChannels(a: Channels, b: Channels, t: number): Channels {
  return {
    dawn: lerp(a.dawn, b.dawn, t),
    agents: lerp(a.agents, b.agents, t),
    rings: lerp(a.rings, b.rings, t),
    ring: lerp(a.ring, b.ring, t),
    stars: lerp(a.stars, b.stars, t),
    voice: lerp(a.voice, b.voice, t),
    dock: lerp(a.dock, b.dock, t),
    repo: lerp(a.repo, b.repo, t),
    globe: lerp(a.globe, b.globe, t),
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
  docks: Partial<Record<DockShot["dock"], DockTarget>>,
  calm = false,
): Sample | null {
  if (keys.length === 0) return null;
  const resolve = (key: Key): Pose => {
    if (!isDock(key.shot)) return resolveShot(key.shot, viewport);
    const dock = docks[key.shot.dock];
    return dock ? resolveDock(dock, viewport) : resolveShot(FALLBACK_SHOTS[key.shot.dock], viewport);
  };

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
const FALLBACK_BOXES = {
  wide: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
  tall: { x0: 0, y0: 0.25, x1: 1, y1: 0.75 },
};
const FALLBACK_SHOTS: Record<DockShot["dock"], Shot> = {
  desk: { target: [0, 1.16, -2.38], az: 0, el: 0, fit: 0.45, fov: DOCK_FOV, ...FALLBACK_BOXES },
  repo: { target: [-3.555, 1.6, -1.85], az: 90, el: 0, fit: 0.62, fov: DOCK_FOV, reach: 2.6, ...FALLBACK_BOXES },
};

/** Where the camera stands for a pose, as a point in the world. */
export function cameraPosition(pose: Pose): [number, number, number] {
  const az = pose.az * DEG;
  const el = pose.el * DEG;
  const flat = Math.cos(el) * pose.dist;
  return [pose.tx + Math.sin(az) * flat, pose.ty + Math.sin(el) * pose.dist, pose.tz + Math.cos(az) * flat];
}
