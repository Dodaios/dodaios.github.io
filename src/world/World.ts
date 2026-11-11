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
  type Texture,
} from "three";

import { breathe, damp, tokenLookup, type Context, type Tier, type Tokens } from "./kit";
import { createDesk, glowTexture, type Desk } from "./parts/desk";
import { createMascot, type Mascot } from "./parts/mascot";
import { createPods, type Pods } from "./parts/pods";
import { createRings, type RingData, type RingPick, type Rings } from "./parts/rings";
import { createSky, type Sky } from "./parts/sky";
import { CHANNELS_AT_REST, cameraPosition, type Channels, type Pose } from "./timeline";

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
  /** Where the monitor's screen has to land while docked, in canvas px. */
  dockRect: Rect | null;
  /** The pointer may reach the scene (it is not over a control of the page). */
  pointerFree: boolean;
}

/** What the world answers. */
export interface FrameOutput {
  /**
   * How far the monitor's screen is from `dockRect`, in px, at its worst
   * corner. Infinity when there is no rectangle to compare with.
   */
  dockError: number;
  /** Something under the pointer that can be pressed. */
  hot: { kind: "mascot" } | { kind: "tile"; label: string; ring: number } | null;
}

/** Which parts a page asks for beyond the desk and the mascot. */
export interface Extras {
  pods: boolean;
  rings: RingData | null;
  dawn: boolean;
  edges: boolean;
}

const POSE_KEYS = ["tx", "ty", "tz", "az", "el", "dist", "fov", "sx", "sy"] as const;
const CHANNEL_KEYS = ["dawn", "pods", "rings", "ring", "wire", "stars", "voice", "dock"] as const;
/** Seconds the scene takes to come alive once its first frame is ready. */
const REVEAL_SECONDS = 1.9;

export class World {
  /** The monitor's screen in the world, for the dock (src/world/timeline.ts). */
  readonly screen: { center: [number, number, number]; height: number };

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.05, 220);
  private last = 0;
  private time = 0;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly pointerSmooth = new Vector2();
  private readonly corner = new Vector3();
  private readonly target = new Vector3();

  private glow: Texture | null = null;
  private readonly loading = { pods: false, rings: false };
  private pods: Pods | null = null;
  private rings: Rings | null = null;
  private pose: Pose | null = null;
  private ch: Channels = { ...CHANNELS_AT_REST };
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
    renderer: WebGLRenderer,
    private readonly desk: Desk,
    private readonly mascot: Mascot,
    private readonly sky: Sky,
  ) {
    this.renderer = renderer;
    this.pixelRatio = renderer.getPixelRatio();
    this.screen = {
      center: [desk.screenCenter.x, desk.screenCenter.y, desk.screenCenter.z],
      height: desk.screenSize.height,
    };
    this.scene.add(desk.group, mascot.group, sky.group);
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
    // Reading back shader logs stalls the main thread; a broken shader would
    // show as a missing object, which the browser pass catches.
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
    const glow = glowTexture();
    const desk = await createDesk(ctx, glow);
    await breathe();
    const mascot = await createMascot(ctx, desk.mascotAnchor, desk.lampBulb, desk.screenCenter);
    await breathe();
    const sky = createSky(ctx, desk.lampBulb, options.stargazers);

    const world = new World(ctx, renderer, desk, mascot, sky);
    world.glow = glow;
    world.resize(options.width, options.height);
    return world;
  }

  /** Bring in the parts that are not on the first screen. Safe to call twice. */
  async extend(extras: Partial<Extras>): Promise<void> {
    if (extras.pods && !this.pods && !this.loading.pods) {
      this.loading.pods = true;
      try {
        const hub = this.desk.screenCenter.clone().add(new Vector3(0, this.desk.screenSize.height * 0.62, 0));
        const pods = await createPods(this.ctx, this.glow ?? glowTexture(), hub);
        this.scene.add(pods.group);
        this.pods = pods;
      } catch (error) {
        console.warn("[world] the agent pods did not load", error);
      }
      await breathe();
    }
    if (extras.rings && !this.rings && !this.loading.rings) {
      this.loading.rings = true;
      try {
        const rings = await createRings(this.ctx, extras.rings);
        this.scene.add(rings.mesh);
        this.rings = rings;
      } catch (error) {
        console.warn("[world] the orbit rings did not load", error);
      }
      await breathe();
    }
    if (extras.dawn) await this.desk.loadDawn().catch((error) => console.warn("[world] no morning textures", error));
    if (extras.edges) await this.desk.loadEdges().catch((error) => console.warn("[world] no wireframe", error));
  }

  start(
    getFrame: () => FrameInput | null,
    onFrame: (out: FrameOutput) => void,
    onCut: () => void,
  ): void {
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
  press(): FrameOutput["hot"] {
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

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
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
      const rate = input.ch.dock > 0.98 ? 11 : 6.5;
      for (const key of POSE_KEYS) this.pose[key] = damp(this.pose[key], input.pose[key], rate, follow);
    }
    for (const key of CHANNEL_KEYS) this.ch[key] = calm ? input.ch[key] : damp(this.ch[key], input.ch[key], 7, follow);

    const before = this.reveal;
    this.reveal = calm ? 1 : Math.min(1, this.reveal + dt / REVEAL_SECONDS);
    // The lamp is on, the eyes are open: a small jump to say hello.
    if (before < 1 && this.reveal >= 1 && !calm) this.mascot.poke();

    // The pointer moves the camera a few degrees, except where a fit is exact.
    const free = this.hasPointer && input.pointerFree && !calm;
    this.pointerSmooth.x = damp(this.pointerSmooth.x, free ? this.pointer.x : 0, 3.5, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, free ? this.pointer.y : 0, 3.5, dt);
    const sway = 1 - Math.min(1, this.ch.dock * 1.2);
    const pose = this.pose;
    const az = ((pose.az + this.pointerSmooth.x * 2.4 * sway) * Math.PI) / 180;
    const el = ((pose.el - this.pointerSmooth.y * 1.4 * sway) * Math.PI) / 180;
    const flat = Math.cos(el) * pose.dist;
    this.camera.position.set(
      pose.tx + Math.sin(az) * flat,
      pose.ty + Math.sin(el) * pose.dist,
      pose.tz + Math.cos(az) * flat,
    );
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
    this.desk.update(this.ch, this.reveal, time);
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
    this.pods?.update(this.ch, this.reveal, time, this.camera, pose.sx);
    this.rings?.update(this.ch, time, { x: pose.sx, y: pose.sy });

    this.renderer.render(this.scene, this.camera);

    this.out.dockError = input.dockRect ? this.dockError(input.dockRect) : Infinity;
    this.out.hot = free ? this.probe() : null;
    this.onFrame?.(this.out);

    this.watchSpeed(dt);
  };

  /** The worst distance between a screen corner and the matching corner of `rect`. */
  private dockError(rect: Rect): number {
    const { screenCenter, screenSize } = this.desk;
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const sy = i < 2 ? 1 : -1;
      this.corner
        .set(screenCenter.x + (sx * screenSize.width) / 2, screenCenter.y + (sy * screenSize.height) / 2, screenCenter.z)
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
  private probe(): FrameOutput["hot"] {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.rings) {
      const pick = this.rings.pick(this.raycaster.ray);
      if (pick !== this.hover) {
        this.hover = pick;
        this.rings.setHover(pick);
      }
      if (pick) return { kind: "tile", label: pick.label, ring: pick.ring };
    }
    if (this.ch.dock < 0.5 && this.raycaster.intersectObject(this.mascot.hit, false).length > 0) {
      return { kind: "mascot" };
    }
    return null;
  }

  /**
   * Hold the frame rate: when frames run long, draw fewer pixels. The canvas
   * never goes back up, so the picture does not pump.
   */
  private watchSpeed(dt: number): void {
    if (this.reveal < 1) return;
    if (dt > 0.026) this.slowFrames++;
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
