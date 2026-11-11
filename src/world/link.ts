/**
 * The page's line to the scene.
 *
 * The scene runs in a worker wherever the browser can hand a canvas to one
 * (`transferControlToOffscreen`), and on the page's own thread everywhere
 * else. Both answer to the same small interface, so nothing above this file
 * knows which it got.
 *
 * WHY A WORKER. The renderer is half a megabyte of script, the models have to
 * be decoded and their shaders compiled, and then sixty frames a second have
 * to be drawn. On the page's thread every one of those is time in which the
 * page cannot answer a tap or a keystroke. Measured with Lighthouse on a
 * simulated phone (2026-11-11), the scene on the page's thread blocked it for
 * about a second in total; in a worker the page's thread only reads the scroll
 * position and posts one small message per frame. See docs/performance.md.
 */
import { TOKEN_NAMES, type Tier, type Tokens } from "./kit";
import type { RingData } from "./parts/rings";
import type { Extras, FrameInput, FrameOutput, WorldOptions } from "./World";

export interface WorldLink {
  /** The monitor's screen in the world, for the dock (src/world/timeline.ts). */
  screen: { center: [number, number, number]; height: number };
  /** True when the scene draws on a thread of its own. */
  threaded: boolean;
  start(getFrame: () => FrameInput | null, onFrame: (out: FrameOutput) => void, onCut: () => void): void;
  /** The canvas's size on the page, CSS px. */
  resize(width: number, height: number): void;
  setPointer(point: { x: number; y: number } | null): void;
  /** The visitor pressed the scene; resolves with what was under the pointer. */
  press(): Promise<FrameOutput["hot"]>;
  setListening(on: boolean): void;
  setPaused(on: boolean): void;
  extend(extras: Partial<Extras>): Promise<void>;
  /** Called once if the graphics context is lost for good. */
  onLost(callback: () => void): void;
}

export interface OpenOptions {
  tier: Tier;
  stargazers: number;
}

/** The values of the scene's colour tokens, read from the page's stylesheet. */
function readTokens(): Tokens {
  const style = getComputedStyle(document.documentElement);
  const tokens: Tokens = {};
  for (const name of TOKEN_NAMES) tokens[name] = style.getPropertyValue(name).trim();
  return tokens;
}

/**
 * The marks' sprite sheet as a decoded picture. An SVG can only be decoded by
 * an image element, which only the page has; the scene gets the pixels.
 */
export async function loadMarkSheet(url: string): Promise<ImageBitmap> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
  return createImageBitmap(image);
}

type Shared = Omit<WorldOptions, "canvas">;

async function openLocal(canvas: HTMLCanvasElement, shared: Shared): Promise<WorldLink> {
  const { World } = await import("./World");
  const world = await World.create({ ...shared, canvas });
  let lost: (() => void) | null = null;
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    world.stop();
    lost?.();
  });
  return {
    screen: world.screen,
    threaded: false,
    start: (getFrame, onFrame, onCut) => world.start(getFrame, onFrame, onCut),
    resize: (width, height) => world.resize(width, height),
    setPointer: (point) => world.setPointer(point),
    press: () => Promise.resolve(world.press()),
    setListening: (on) => world.setListening(on),
    setPaused: (on) => world.setPaused(on),
    extend: (extras) => world.extend(extras),
    onLost: (callback) => {
      lost = callback;
    },
  };
}

function openThreaded(canvas: HTMLCanvasElement, shared: Shared): Promise<WorldLink> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    const waiting = new Map<number, (value: unknown) => void>();
    let nextId = 1;
    let onFrame: ((out: FrameOutput) => void) | null = null;
    let onCut: (() => void) | null = null;
    let lost: (() => void) | null = null;
    let paused = false;
    let settled = false;

    const ask = <T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> =>
      new Promise((done) => {
        const id = nextId++;
        waiting.set(id, done as (value: unknown) => void);
        worker.postMessage({ ...message, id }, transfer);
      });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    worker.onerror = (event) => fail(new Error(event.message || "the scene's worker failed to load"));

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; [key: string]: unknown };
      if (message.type === "ready") {
        settled = true;
        resolve({
          screen: message.screen as WorldLink["screen"],
          threaded: true,
          start(getFrame, frame, cut) {
            onFrame = frame;
            onCut = cut;
            // The page keeps the clock: one small message per frame, nothing else.
            const tick = () => {
              requestAnimationFrame(tick);
              if (paused) return;
              const input = getFrame();
              if (input) worker.postMessage({ type: "frame", input });
            };
            requestAnimationFrame(tick);
          },
          resize: (width, height) => worker.postMessage({ type: "resize", width, height }),
          setPointer: (point) => worker.postMessage({ type: "pointer", point }),
          press: () => ask<{ hot: FrameOutput["hot"] }>({ type: "press" }).then((answer) => answer.hot),
          setListening: (on) => worker.postMessage({ type: "listening", on }),
          setPaused(on) {
            paused = on;
            worker.postMessage({ type: "paused", on });
          },
          extend(extras) {
            const sheet = (extras.rings as RingData | null | undefined)?.sheet;
            return ask<void>({ type: "extend", extras }, sheet ? [sheet] : []);
          },
          onLost(callback) {
            lost = callback;
          },
        });
      } else if (message.type === "failed") fail(new Error(String(message.message)));
      else if (message.type === "frame") onFrame?.(message.out as FrameOutput);
      else if (message.type === "cut") onCut?.();
      else if (message.type === "lost") lost?.();
      else if (message.type === "extended" || message.type === "pressed") {
        const done = waiting.get(message.id as number);
        waiting.delete(message.id as number);
        done?.(message);
      }
    };

    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: "init", options: { ...shared, canvas: offscreen } }, [offscreen]);
  });
}

/**
 * Start the scene on `canvas`. Resolves with the line to it and the canvas it
 * ended up on: if the worker cannot draw, the canvas it was given is spent, and
 * a fresh one takes its place for the attempt on the page's own thread.
 */
export async function openWorld(
  canvas: HTMLCanvasElement,
  options: OpenOptions,
): Promise<{ link: WorldLink; canvas: HTMLCanvasElement }> {
  const shared: Shared = {
    tier: options.tier,
    stargazers: options.stargazers,
    tokens: readTokens(),
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
    pixelRatio: window.devicePixelRatio || 1,
  };
  // `?world=page` keeps the scene on the page's thread, to check that path.
  const onPage = /[?&]world=page/.test(window.location.search);
  if (!onPage && typeof Worker !== "undefined" && "transferControlToOffscreen" in canvas) {
    try {
      return { link: await openThreaded(canvas, shared), canvas };
    } catch (error) {
      console.warn("[world] no scene on a thread of its own; trying the page's", error);
      const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return { link: await openLocal(canvas, shared), canvas };
}
