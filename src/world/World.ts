/**
 * The world: the real-time scene behind the page.
 *
 * This file owns the renderer, the camera and the frame loop, and puts the
 * parts together. It knows nothing about the page: each frame it asks its host
 * for a camera pose and a set of channels (src/world/timeline.ts) and reports
 * back what the page needs to know, such as where the monitor's screen landed.
 *
 * It is loaded on demand, after the page has painted (src/world/boot.ts), and
 * runs in a worker where the browser allows it (src/world/link.ts). So nothing
 * in here, or in any part, may touch `window` or `document`. See docs/world.md.
 */
import {
  Color,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type Texture,
} from "three";

import { breathe, damp, loadFonts, tokenLookup, type Context, type Tier, type Tokens } from "./kit";
import { createGlobe, type Globe, type GlobeData } from "./parts/globe";
import { createSecond, type Second } from "./parts/second";
import { createLabels, type Labels, type LabelTexts } from "./parts/labels";
import { createMascot, type Mascot } from "./parts/mascot";
import { createRings, type RingData, type RingPick, type Rings } from "./parts/rings";
import { createRoom, glowTexture, type Room, type ZoneName } from "./parts/room";
import { createSky, type Sky } from "./parts/sky";
import { createTerminals, type Terminals } from "./parts/terminals";
import { GLOBE_RADIUS, HOLO_CENTER } from "./script";
import { CHANNELS_AT_REST, cameraPosition, poseLooking, type Channels, type Pose, type ScreenQuad } from "./timeline";

export interface WorldOptions {
  /** The page's canvas, or the worker's end of it. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tier: Tier;
  /** Values of the page's colour tokens (kit.ts, TOKEN_NAMES). */
  tokens: Tokens;
  stargazers: number;
  /** The canvas's size on the page, CSS px, and the screen's pixel ratio. */
  width: number;
  height: number;
  pixelRatio: number;
  /** The words of every label in the room, as the page has them. */
  labels: LabelTexts;
  /** The typefaces the labels and terminals are drawn in. */
  fonts: readonly { family: string; url: string; weight: string }[];
  /** The places pinned on the globe by the window. */
  globe: GlobeData;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the host says each frame. */
export interface FrameInput {
  pose: Pose;
  ch: Channels;
  /** Where a screen of the room has to land while docked, in canvas px, and which screen. */
  dockRect: Rect | null;
  dockQuad: ScreenQuad | null;
  /** The pointer may reach the scene (it is not over a control of the page). */
  pointerFree: boolean;
}

/** Something in the scene that answers a press. */
export type Hot =
  | { kind: "mascot" }
  | { kind: "tile"; label: string; ring: number }
  /** An object of the room: the whiteboard, a card, the counter. */
  | { kind: "spot"; id: string }
  /** A place on the globe. */
  | { kind: "pin"; label: string };

/** What the world answers. */
export interface FrameOutput {
  /**
   * How far the monitor's screen is from `dockRect`, in px, at its worst
   * corner. Infinity when there is no rectangle to compare with.
   */
  dockError: number;
  /** What is under the pointer, if it can be pressed. */
  hot: Hot | null;
}

/** What a page asks for beyond the first screen. */
export interface Extras {
  zones: readonly ZoneName[];
  rings: RingData | null;
  dawn: boolean;
  /** The frames of the thread that plays on the desk's second monitor. */
  frames: boolean;
}

const CHANNEL_KEYS = ["dawn", "agents", "rings", "ring", "stars", "voice", "dock", "repo", "globe"] as const;
/** Seconds the scene takes to come alive once its first frame is ready. */
const REVEAL_SECONDS = 1.9;
/** The quads of the room that answer a press, by name. */
const SPOTS = ["Text_install", "Text_quote1", "Text_quote2", "Text_quote3", "Text_stars"] as const;

export class World {
  /** The monitor's screen in the world, for the dock (src/world/timeline.ts). */
  readonly screen: { center: [number, number, number]; height: number };
  /** Frames drawn so far; a host can watch it to see that the scene is alive. */
  frames = 0;

  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.05, 220);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly pointerSmooth = new Vector2();
  private readonly corner = new Vector3();
  private readonly target = new Vector3();

  private rings: Rings | null = null;
  private ringsAsked = false;
  private globe: Globe | null = null;
  private globeHover = -1;
  private spots: Mesh[] = [];
  private pose: Pose | null = null;
  private ch: Channels = { ...CHANNELS_AT_REST };
  private last = 0;
  private time = 0;
  private reveal = 0;
  private paused = false;
  private running = false;
  private frame = 0;
  private pixelRatio: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private width = 1;
  private height = 1;
  private hasPointer = false;
  private hover: RingPick | null = null;
  private listening = false;
  private listenLevel = 0;
  private getFrame: (() => FrameInput | null) | null = null;
  private onFrame: ((out: FrameOutput) => void) | null = null;
  private onCut: (() => void) | null = null;
  private readonly out: FrameOutput = { dockError: Infinity, hot: null };

  private constructor(
    private readonly ctx: Context,
    private readonly renderer: WebGLRenderer,
    private readonly room: Room,
    private readonly labels: Labels,
    private readonly terminals: Terminals,
    private readonly second: Second,
    private readonly mascot: Mascot,
    private readonly sky: Sky,
    private readonly globeData: GlobeData,
  ) {
    this.pixelRatio = renderer.getPixelRatio();
    const { center, height } = room.screen;
    this.screen = { center: [center.x, center.y, center.z], height };
    this.scene.add(room.group, mascot.group, sky.group);
    this.collect();
  }

  /** Build the scene up to its first frame. Rejects if WebGL is not there. */
  static async create(options: WorldOptions): Promise<World> {
    const { canvas, tier } = options;
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    // Reading back shader logs stalls the thread; a broken shader would show
    // as a missing object, which the browser pass catches.
    renderer.debug.checkShaderErrors = false;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(options.pixelRatio || 1, tier.maxPixelRatio));

    const token = tokenLookup(options.tokens);
    renderer.setClearColor(new Color(token("--canvas")), 1);
    const ctx: Context = {
      tier,
      token,
      anisotropy: Math.min(tier.small ? 4 : 8, renderer.capabilities.getMaxAnisotropy()),
    };

    await breathe();
    const glow: Texture = glowTexture();
    const room = createRoom(ctx, glow);
    // The first screen is the desk in its room; everything else comes later.
    await Promise.all([room.loadZone("shell"), room.loadZone("desk"), loadFonts(options.fonts)]);
    await breathe();

    const labels = createLabels(ctx, options.labels);
    const terminals = createTerminals(ctx);
    const second = createSecond(ctx);
    labels.attach(room.quads);
    terminals.attach(room.quads);
    second.attach(room.quads);
    await breathe();

    const seat = room.anchors.get("MascotAnchor") ?? { position: new Vector3(-0.62, 0.74, -2.12), yaw: 0.24 };
    const lamp = room.anchors.get("LampBulb")?.position ?? new Vector3(-1, 1.25, -2.45);
    const mascot = await createMascot(ctx, seat, lamp, room.screen.center);
    await breathe();
    const sky = createSky(ctx, lamp, options.stargazers);

    const world = new World(ctx, renderer, room, labels, terminals, second, mascot, sky, options.globe);
    world.resize(options.width, options.height);
    return world;
  }

  /**
   * Bring in what is not on the first screen. Safe to call twice. A zone that
   * does not arrive is asked for once more and then REJECTS: a room with a
   * station missing would leave that chapter's words nowhere, so the page has
   * to know and take over.
   */
  async extend(extras: Partial<Extras>): Promise<void> {
    for (const zone of extras.zones ?? []) {
      try {
        await this.room.loadZone(zone);
      } catch (error) {
        console.warn(`[world] the ${zone} zone did not load; trying once more`, error);
        await this.room.loadZone(zone);
      }
      this.labels.attach(this.room.quads);
      this.terminals.attach(this.room.quads);
      this.collect();
      // The globe stands on the stand the window zone brings.
      const stand = this.room.anchors.get("GlobeCenter");
      if (zone === "window" && stand && !this.globe) {
        this.globe = createGlobe(this.ctx, stand.position, GLOBE_RADIUS, this.globeData);
        this.scene.add(this.globe.group);
      }
      await breathe();
    }
    if (extras.rings && !this.ringsAsked) {
      this.ringsAsked = true;
      try {
        const at = this.room.anchors.get("HoloCenter")?.position ?? new Vector3(...HOLO_CENTER);
        const rings = await createRings(this.ctx, extras.rings, at);
        this.scene.add(rings.mesh);
        this.rings = rings;
      } catch (error) {
        console.warn("[world] the hologram did not load", error);
      }
      await breathe();
    }
    if (extras.dawn) await this.room.loadDawn().catch((error) => console.warn("[world] no morning textures", error));
    if (extras.frames) await this.second.load().catch((error) => console.warn("[world] the thread does not play", error));
  }

  /** The quads that answer a press, of the zones that are in. */
  private collect(): void {
    this.spots = SPOTS.map((name) => this.room.quads.get(name)).filter((mesh): mesh is Mesh => Boolean(mesh));
  }

  start(getFrame: () => FrameInput | null, onFrame: (out: FrameOutput) => void, onCut: () => void): void {
    this.getFrame = getFrame;
    this.onFrame = onFrame;
    this.onCut = onCut;
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Pointer position in the canvas, px from its top left. `null` when it left. */
  setPointer(point: { x: number; y: number } | null): void {
    if (!point) {
      this.hasPointer = false;
      this.pointer.set(0, 0);
      return;
    }
    this.hasPointer = true;
    this.pointer.set((point.x / this.width) * 2 - 1, 1 - (point.y / this.height) * 2);
  }

  /** The visitor pressed the scene. Returns what was hit. */
  press(): Hot | null {
    // Probed now, not read from the last frame: a tap has no hover before it.
    const hot = this.hasPointer && this.pose ? this.probe() : null;
    if (hot?.kind === "mascot") this.mascot.poke();
    return hot;
  }

  /** Stop drawing without tearing anything down; the last frame stays up. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) this.last = performance.now();
  }

  setListening(on: boolean): void {
    this.listening = on;
    this.mascot.setListening(on);
  }

  /** Change the words of one label in the room. */
  setLabel(id: string, lines: readonly string[]): void {
    this.labels.set(id, lines);
  }

  /** Something happened on the page that the room acts out. */
  act(name: string): void {
    if (name === "voice-run") this.second.run();
  }

  /** The canvas's size on the page, in CSS px. */
  resize(width = this.width, height = this.height): void {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (width === this.width && height === this.height && this.renderer.getPixelRatio() === this.pixelRatio) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
  }

  /** Milliseconds since the last frame was worked out. */
  get idleFor(): number {
    return performance.now() - this.last;
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    this.step();
  };

  /**
   * Work out and draw one frame. The frame loop calls it; a host may call it
   * too when the loop has gone quiet (see world.worker.ts).
   */
  step(): void {
    if (!this.running) return;
    const now = performance.now();
    const elapsed = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    // Two clocks. The scene's own motion (breath, drift, the reveal) never
    // jumps: a long gap counts as one short step, so a tab that was away does
    // not lurch. Following the page is the opposite: it uses the real time
    // that passed, because on a slow device every frame is a long gap, and a
    // camera that only moved one short step per frame would trail the scroll
    // in slow motion and the app's window would arrive seconds late.
    const dt = Math.min(0.05, elapsed);
    const follow = Math.min(1, elapsed);
    if (this.paused) return;
    this.time += dt;
    const time = this.time;
    const input = this.getFrame?.();
    if (!input) return;
    const calm = this.ctx.tier.calm;

    // Follow the timeline with a little give, so a wheel's steps become one move.
    if (!this.pose) this.pose = { ...input.pose };
    else if (calm) {
      const from = cameraPosition(this.pose);
      const to = cameraPosition(input.pose);
      if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > 0.4) this.onCut?.();
      this.pose = { ...input.pose };
    } else {
      // Arriving at the monitor has to finish: the page waits for an exact fit.
      const rate = Math.max(input.ch.dock, input.ch.repo) > 0.98 ? 11 : 6.5;
      // The camera follows as a place and a subject, each in a straight line: a
      // jump across the room (a link in the nav) must not swing it through a wall.
      const eye = cameraPosition(this.pose);
      const want = cameraPosition(input.pose);
      const next = this.pose;
      this.pose = poseLooking(
        [damp(eye[0], want[0], rate, follow), damp(eye[1], want[1], rate, follow), damp(eye[2], want[2], rate, follow)],
        [
          damp(next.tx, input.pose.tx, rate, follow),
          damp(next.ty, input.pose.ty, rate, follow),
          damp(next.tz, input.pose.tz, rate, follow),
        ],
        {
          fov: damp(next.fov, input.pose.fov, rate, follow),
          sx: damp(next.sx, input.pose.sx, rate, follow),
          sy: damp(next.sy, input.pose.sy, rate, follow),
        },
      );
    }
    for (const key of CHANNEL_KEYS) this.ch[key] = calm ? input.ch[key] : damp(this.ch[key], input.ch[key], 7, follow);

    const before = this.reveal;
    this.reveal = calm ? 1 : Math.min(1, this.reveal + dt / REVEAL_SECONDS);
    // The lamp is on, the eyes are open: a small jump to say hello.
    if (before < 1 && this.reveal >= 1 && !calm) this.mascot.poke();

    // The pointer moves the camera a few degrees, except where a fit is exact.
    // With reduced motion it moves nothing, but it still finds what it is over.
    const pointed = this.hasPointer && input.pointerFree;
    const free = pointed && !calm;
    this.pointerSmooth.x = damp(this.pointerSmooth.x, free ? this.pointer.x : 0, 3.5, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, free ? this.pointer.y : 0, 3.5, dt);
    const sway = 1 - Math.min(1, Math.max(this.ch.dock, this.ch.repo) * 1.2);
    const pose = this.pose;
    const az = ((pose.az + this.pointerSmooth.x * 2.4 * sway) * Math.PI) / 180;
    const el = ((pose.el - this.pointerSmooth.y * 1.4 * sway) * Math.PI) / 180;
    const flat = Math.cos(el) * pose.dist;
    this.camera.position.set(pose.tx + Math.sin(az) * flat, pose.ty + Math.sin(el) * pose.dist, pose.tz + Math.cos(az) * flat);
    this.target.set(pose.tx, pose.ty, pose.tz);
    this.camera.lookAt(this.target);
    this.camera.fov = pose.fov;
    this.camera.updateProjectionMatrix();
    // The lens shift: put the target at (sx, sy) instead of the centre.
    this.camera.projectionMatrix.elements[8] = -pose.sx;
    this.camera.projectionMatrix.elements[9] = -pose.sy;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld();

    this.listenLevel = damp(this.listenLevel, this.listening ? 1 : 0, 6, dt);
    this.room.update(this.ch, this.reveal, time);
    this.labels.update(this.ch, this.reveal);
    this.terminals.update(this.ch, this.reveal, time);
    this.second.update(this.ch, this.reveal, time);
    this.mascot.update({
      dt,
      time,
      ch: this.ch,
      reveal: this.reveal,
      pointer: free ? this.pointer : ZERO,
      camera: this.camera,
    });
    this.sky.update({
      ch: this.ch,
      reveal: this.reveal,
      time,
      camera: this.camera,
      pixelRatio: this.pixelRatio,
      viewportHeight: this.height,
      listening: this.listenLevel,
      face: this.mascot.face,
    });
    this.rings?.update(this.ch, time);
    this.globe?.update({
      ch: this.ch,
      reveal: this.reveal,
      time,
      camera: this.camera,
      pixelRatio: this.pixelRatio,
      viewportHeight: this.height,
    });

    this.renderer.render(this.scene, this.camera);
    this.frames++;

    this.out.dockError = input.dockRect && input.dockQuad ? this.dockError(input.dockRect, input.dockQuad) : Infinity;
    if (!pointed && this.hover) {
      // The pointer left the scene: no tile may stay lit behind it.
      this.hover = null;
      this.rings?.setHover(null);
    }
    this.out.hot = pointed ? this.probe() : null;
    this.onFrame?.(this.out);

    this.watchSpeed(dt);
  }

  /** The worst distance between a screen corner and the matching corner of `rect`. */
  private dockError(rect: Rect, quad: ScreenQuad): number {
    const { center, width, height } = quad;
    // The screen's own "right", seen from its front.
    const yaw = (quad.yaw * Math.PI) / 180;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const sy = i < 2 ? 1 : -1;
      this.corner
        .set(center[0] + (rx * sx * width) / 2, center[1] + (sy * height) / 2, center[2] + (rz * sx * width) / 2)
        .project(this.camera);
      const x = ((this.corner.x + 1) / 2) * this.width;
      const y = ((1 - this.corner.y) / 2) * this.height;
      const wantX = sx < 0 ? rect.left : rect.left + rect.width;
      const wantY = sy > 0 ? rect.top : rect.top + rect.height;
      worst = Math.max(worst, Math.hypot(x - wantX, y - wantY));
    }
    return worst;
  }

  /** What is under the pointer. */
  private probe(): Hot | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.rings) {
      const pick = this.rings.pick(this.raycaster.ray);
      if (pick !== this.hover) {
        this.hover = pick;
        this.rings.setHover(pick);
      }
      if (pick) return { kind: "tile", label: pick.label, ring: pick.ring };
    }
    if (this.globe) {
      const place = this.ch.globe > 0.5 ? this.globe.pick(this.raycaster.ray) : null;
      const index = place?.index ?? -1;
      if (index !== this.globeHover) {
        this.globeHover = index;
        this.globe.setHover(index);
      }
      if (place) return { kind: "pin", label: place.label };
    }
    if (this.ch.dock < 0.5) {
      if (this.raycaster.intersectObject(this.mascot.hit, false).length > 0) return { kind: "mascot" };
      // Only what the camera is near enough to read answers a press.
      const hit = this.raycaster.intersectObjects(this.spots, false)[0];
      if (hit && hit.distance < 3.6) return { kind: "spot", id: hit.object.name.replace(/^Text_/, "") };
    }
    return null;
  }

  /**
   * Hold the frame rate: when frames run long, draw fewer pixels. The canvas
   * never goes back up, so the picture does not pump.
   */
  private watchSpeed(dt: number): void {
    if (this.reveal < 1) return;
    // Under 25 frames a second. Not "under 60": a screen held at 30 Hz to save
    // its battery draws every frame with ease, and must keep its sharp picture.
    if (dt > 0.04) this.slowFrames++;
    else this.fastFrames++;
    if (this.slowFrames + this.fastFrames < 90) return;
    const slow = this.slowFrames > 45;
    this.slowFrames = this.fastFrames = 0;
    const floor = this.ctx.tier.small ? 0.85 : 1;
    if (slow && this.pixelRatio > floor) {
      this.pixelRatio = Math.max(floor, this.pixelRatio - 0.25);
      this.resize();
    }
  }
}

const ZERO = new Vector2(0, 0);
