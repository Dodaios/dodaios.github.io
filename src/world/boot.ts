/**
 * The page's side of the world: it measures the chapters, turns the scroll
 * position into a camera pose, and starts the scene once the page has painted.
 * It is small and has no renderer in it; the scene itself arrives as a separate
 * download and, where the browser allows, runs on a thread of its own
 * (src/world/link.ts).
 *
 * The page works without it. `world-on` on <html> (stamped in the head, see
 * Base.astro) only promises that this script will try; if the scene cannot
 * start, the class comes off again and the chapters fall back to an ordinary
 * page. See docs/world.md.
 */
import { loadMarkSheet, openWorld, type WorldLink } from "./link";
import type { RingData } from "./parts/rings";
import { SCRIPT, STILLS } from "./script";
import {
  CHANNELS_AT_REST,
  buildKeys,
  clamp01,
  sample,
  type ChapterSpan,
  type DockTarget,
  type Key,
} from "./timeline";
import type { FrameInput, FrameOutput } from "./World";

interface WorldData {
  scene: string;
  stargazers: number;
  rings: Omit<RingData, "sheet"> & { sheet: string };
}

/** The app window's size and the scale below which it stops shrinking (DemoStage.tsx). */
const WINDOW_W = 1360;
const WINDOW_H = 758;
const MIN_SCALE = 0.46;
const SIDEBAR_W = 240;

const RING_ROUTES = ["/plugins", "/skills", "/clis"];

const root = document.documentElement;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Set while a scene is running: tells it that the mascot is being spoken to. */
let listen: ((on: boolean) => void) | null = null;

talk();

const firstCanvas = document.querySelector<HTMLCanvasElement>("[data-world]");
const dataNode = document.getElementById("world-data");
if (firstCanvas && dataNode && root.classList.contains("world-on")) {
  // From here on this script answers for the chapters' entrance: until this
  // class is there nothing is hidden, so a page whose script never arrives
  // (a stale cached page, a blocked file) still shows all of its copy.
  root.classList.add("world-ready");
  run(firstCanvas, JSON.parse(dataNode.textContent || "{}") as WorldData);
}

/**
 * Hold to talk. It plays one scripted exchange and belongs to the page, not to
 * the scene: it works on the plain page too, where there is no mascot to lean in.
 */
function talk(): void {
  const hold = document.querySelector<HTMLButtonElement>("[data-talk-hold]");
  const said = document.querySelector<HTMLElement>("[data-talk-said]");
  const reply = document.querySelector<HTMLElement>("[data-talk-reply]");
  const status = document.querySelector<HTMLElement>("[data-talk-status]");
  if (!hold || !said || !reply) return;

  const request = said.dataset.text ?? "";
  const answer = reply.dataset.text ?? "";
  let typing = 0;
  let pending = 0;
  let held = false;

  const stop = () => {
    window.clearInterval(typing);
    window.clearTimeout(pending);
  };
  const type = (node: HTMLElement, text: string, speed: number, done?: () => void) => {
    window.clearInterval(typing);
    if (calm) {
      node.textContent = text;
      done?.();
      return;
    }
    let shown = node.textContent?.length ?? 0;
    typing = window.setInterval(() => {
      shown += 1;
      node.textContent = text.slice(0, shown);
      if (shown >= text.length) {
        window.clearInterval(typing);
        done?.();
      }
    }, speed);
  };
  const begin = () => {
    if (held) return;
    held = true;
    stop();
    hold.setAttribute("aria-pressed", "true");
    listen?.(true);
    said.textContent = "";
    reply.textContent = "";
    if (status) status.textContent = "";
    type(said, request, 42);
  };
  const end = () => {
    if (!held) return;
    held = false;
    stop();
    hold.setAttribute("aria-pressed", "false");
    listen?.(false);
    // Letting go early still sends the whole sentence: this is a simulation.
    said.textContent = request;
    pending = window.setTimeout(
      () =>
        type(reply, answer, 24, () => {
          // Read out once, whole, instead of letter by letter.
          if (status) status.textContent = `You: ${request} Dodaios: ${answer}`;
        }),
      calm ? 0 : 420,
    );
  };

  hold.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    hold.setPointerCapture(event.pointerId);
    begin();
  });
  hold.addEventListener("pointerup", end);
  hold.addEventListener("pointercancel", end);
  hold.addEventListener("contextmenu", end);
  hold.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      begin();
    }
  });
  hold.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      // Otherwise the space bar's own click would start a second round.
      event.preventDefault();
      end();
    }
  });
  hold.addEventListener("blur", end);
  // A screen reader presses a button with a click and nothing else: no key
  // goes down, no pointer. Such a click (`detail` is 0) plays the whole round.
  hold.addEventListener("click", (event) => {
    if (event.detail !== 0 || held) return;
    begin();
    window.setTimeout(end, calm ? 0 : 1100);
  });
}

function run(firstCanvas: HTMLCanvasElement, data: WorldData): void {
  const home = data.scene === "home";
  const small = matchMedia("(max-width: 767px), (pointer: coarse) and (max-width: 1100px)").matches;
  const chapters = home ? Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]")) : [];
  const dockStage = document.querySelector<HTMLElement>("[data-dock-stage]");
  const podCount = document.querySelector<HTMLElement>("[data-pods-count]");
  const tip = document.querySelector<HTMLElement>("[data-world-tip]");

  let canvas = firstCanvas;
  let world: WorldLink | null = null;
  let keys: Key[] = [];
  let spans: ChapterSpan[] = [];
  let pinHeight = window.innerHeight;
  let size = { width: 1, height: 1 };
  /** The content column inside the canvas, as fractions of its width. */
  let column = { x0: 0, x1: 1 };
  const columnEdge = document.querySelector<HTMLElement>(".chapter__frame, .container-content");
  let pointerFree = true;
  let dockInView = false;
  let queued = false;
  let stillPaused = false;

  /* ---- The timeline -------------------------------------------------- */

  const measure = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (width !== size.width || height !== size.height) {
      size = { width, height };
      // The scene must draw at exactly the size the poses are worked out for:
      // a scrollbar arriving changes the canvas without any resize event.
      world?.resize(width, height);
    }
    if (columnEdge) {
      const edge = columnEdge.getBoundingClientRect();
      const origin = canvas.getBoundingClientRect();
      if (edge.width > 0) {
        column = {
          x0: clamp01((edge.left - origin.left) / width),
          x1: clamp01((edge.right - origin.left) / width),
        };
      }
    }
    if (!home) {
      const still = STILLS[data.scene] ?? STILLS.quiet;
      keys = [{ y: 0, shot: still.shot, ch: { ...CHANNELS_AT_REST, ...still.ch }, chapter: data.scene }];
      return;
    }
    const pin = chapters[0]?.querySelector<HTMLElement>(".chapter__pin");
    pinHeight = pin?.offsetHeight || window.innerHeight;
    spans = chapters.map((el) => ({
      id: el.dataset.chapter!,
      top: el.getBoundingClientRect().top + window.scrollY,
      height: el.offsetHeight,
      beats: SCRIPT[el.dataset.chapter!] ?? [],
    }));
    keys = buildKeys(spans, { width: window.innerWidth, height: pinHeight });
    applyScroll();
  };

  /** Tell each chapter how far through it the reader is; CSS does the rest. */
  const progress = new WeakMap<HTMLElement, number>();
  const applyScroll = () => {
    queued = false;
    const y = window.scrollY;
    const view = window.innerHeight;
    dockInView = false;
    chapters.forEach((el, i) => {
      const span = spans[i];
      if (!span) return;
      const top = span.top - y;
      const bottom = top + span.height;
      const near = bottom > -view * 0.5 && top < view * 1.5;
      if (near && span.id === "try") dockInView = true;
      const seen = top < view * 0.62 && bottom > view * 0.2;
      if (seen !== el.hasAttribute("data-seen")) el.toggleAttribute("data-seen", seen);
      if (!near) return;
      const stretch = Math.max(1, span.height - pinHeight);
      const p = Math.round(clamp01(-top / stretch) * 1000) / 1000;
      if (progress.get(el) !== p) {
        progress.set(el, p);
        el.style.setProperty("--p", String(p));
      }
    });
  };

  const syncPause = () => world?.setPaused(document.hidden || stillPaused);

  /**
   * A page of text: the scene is clearest behind the opening lines, steps back
   * as the reader scrolls into the text, and stops drawing once it is out of
   * the way, so a long read does not keep the graphics card busy.
   */
  let stillLevel = -1;
  const applyStill = () => {
    queued = false;
    const level = Math.round((1 - 0.78 * clamp01(window.scrollY / (window.innerHeight * 0.7))) * 50) / 50;
    if (level === stillLevel) return;
    stillLevel = level;
    canvas.style.setProperty("--world-still", String(level));
    stillPaused = level < 0.3;
    syncPause();
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(home ? applyScroll : applyStill);
  };

  measure();
  if (!home) applyStill();
  window.addEventListener("scroll", onScroll, { passive: true });
  // Fonts, images and hydrating islands all move the chapters' edges.
  if (home) new ResizeObserver(() => measure()).observe(document.body);
  window.addEventListener("resize", measure);
  document.addEventListener("visibilitychange", syncPause);

  /* ---- The frame, as the scene asks for it ---------------------------- */

  const canvasRect = () => canvas.getBoundingClientRect();

  /**
   * Where the app's window is on the page, whole: on a phone the stage holds
   * the window at MIN_SCALE and lets it run out of the frame on both sides, and
   * the monitor has to match the window, not the frame.
   */
  const dockRect = (): FrameInput["dockRect"] => {
    const frame = dockStage?.querySelector<HTMLElement>(".demo-window");
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    if (box.width <= 0) return null;
    const origin = canvasRect();
    const natural = box.width / WINDOW_W;
    const scale = Math.max(natural, MIN_SCALE);
    const shift = natural >= MIN_SCALE ? 0 : SIDEBAR_W * MIN_SCALE;
    return {
      left: box.left - origin.left - shift,
      top: box.top - origin.top,
      width: WINDOW_W * scale,
      height: WINDOW_H * scale,
    };
  };

  const getFrame = (): FrameInput | null => {
    if (!world) return null;
    const rect = dockInView ? dockRect() : null;
    const dock: DockTarget | null = rect ? { center: world.screen.center, height: world.screen.height, rect } : null;
    const state = sample(keys, window.scrollY, { ...size, column }, dock, calm);
    if (!state) return null;
    if (podCount) {
      const lit = String(Math.round(state.ch.pods));
      if (podCount.textContent !== lit) podCount.textContent = lit;
    }
    // Behind a page of text the scene is scenery: nothing in it takes the pointer.
    return {
      pose: state.pose,
      ch: state.ch,
      dockRect: state.ch.dock > 0.02 ? rect : null,
      pointerFree: home && pointerFree,
    };
  };

  let dockOpacity = -1;
  let hotKind = "";
  let tipText = "";
  let lastError = Infinity;
  const onFrame = (out: FrameOutput) => {
    lastError = out.dockError;
    if (dockStage) {
      // The live window fades in exactly as fast as the monitor lines up with it.
      const opacity = Number.isFinite(out.dockError) ? clamp01(1 - (out.dockError - 1.5) / 14) : 0;
      if (Math.abs(opacity - dockOpacity) > 0.004 || (opacity !== dockOpacity && (opacity === 0 || opacity === 1))) {
        dockOpacity = opacity;
        dockStage.style.opacity = String(opacity);
        dockStage.toggleAttribute("data-shown", opacity > 0.01);
        dockStage.toggleAttribute("data-live", opacity > 0.96);
      }
    }
    const kind = out.hot?.kind ?? "";
    if (kind !== hotKind) {
      hotKind = kind;
      root.toggleAttribute("data-world-hot", kind !== "");
    }
    if (tip) {
      const text = out.hot?.kind === "tile" ? out.hot.label : "";
      if (text !== tipText) {
        tipText = text;
        tip.textContent = text;
        tip.toggleAttribute("data-on", text !== "");
      }
    }
  };

  // The class has to come off again, or its animation would hold the canvas's
  // opacity for good.
  root.addEventListener("animationend", (event) => {
    if (event.animationName === "world-cut") root.classList.remove("world-cut");
  });
  const onCut = () => {
    if (!home) return;
    root.classList.remove("world-cut");
    // Reading a layout property restarts the animation on the same frame.
    void canvas.offsetWidth;
    root.classList.add("world-cut");
  };

  /* ---- The pointer ---------------------------------------------------- */

  const isUi = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest("a, button, input, textarea, select, label, iframe, summary, [data-ui]") !== null;

  const point = (event: MouseEvent) => {
    const origin = canvasRect();
    return { x: event.clientX - origin.left, y: event.clientY - origin.top };
  };

  if (home) {
    window.addEventListener(
      "pointermove",
      (event) => {
        pointerFree = !isUi(event.target);
        world?.setPointer(point(event));
        if (tip) {
          tip.style.setProperty("--x", `${event.clientX}px`);
          tip.style.setProperty("--y", `${event.clientY}px`);
        }
      },
      { passive: true },
    );
    // A CLICK that did not travel, not a press: a finger put down to scroll, or
    // a drag that selects text, must never send the reader to another page.
    let pressedAt = { x: 0, y: 0 };
    window.addEventListener(
      "pointerdown",
      (event) => {
        pressedAt = { x: event.clientX, y: event.clientY };
      },
      { passive: true },
    );
    window.addEventListener("click", (event) => {
      if (!world || event.button !== 0 || isUi(event.target)) return;
      if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 8) return;
      pointerFree = true;
      world.setPointer(point(event));
      void world.press().then((hit) => {
        if (hit?.kind === "tile") window.location.assign(RING_ROUTES[hit.ring] ?? "/plugins");
      });
      // A finger leaves no pointer behind; without this the camera stays leaning.
      if ((event as PointerEvent).pointerType && (event as PointerEvent).pointerType !== "mouse") {
        world.setPointer(null);
      }
    });
    const release = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") world?.setPointer(null);
    };
    window.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("pointerleave", () => world?.setPointer(null));
  }

  /* ---- Start ---------------------------------------------------------- */

  const idle = () =>
    new Promise<void>((resolve) => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 1200 });
      else setTimeout(resolve, 200);
    });

  /**
   * Wait until the page's largest paint has happened. The scene's downloads
   * must not stand in line ahead of the headline; after it they are welcome.
   */
  const painted = () =>
    new Promise<void>((resolve) => {
      let observer: PerformanceObserver | null = null;
      const done = () => {
        observer?.disconnect();
        resolve();
      };
      try {
        observer = new PerformanceObserver((list) => {
          if (list.getEntries().length > 0) done();
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        // No such entry type here (Safari, Firefox): the timer below decides.
      }
      setTimeout(done, 1500);
    });

  /**
   * The scene is gone or never came: hand the page back as the plain page,
   * with nothing the scene wrote left on it, and with the reader still in the
   * chapter they were reading (the plain page's chapters are far shorter).
   */
  const giveUp = (error: unknown) => {
    console.warn("[world] no 3D scene; the page continues without it", error);
    world = null;
    listen = null;
    const reading = chapters.find((el) => {
      const box = el.getBoundingClientRect();
      return box.top <= window.innerHeight * 0.5 && box.bottom > window.innerHeight * 0.5;
    });
    const wasScrolled = window.scrollY > 0;
    root.classList.remove("world-on", "world-live", "world-ready", "world-cut");
    root.classList.add("world-off");
    root.removeAttribute("data-world-hot");
    if (dockStage) {
      dockStage.style.removeProperty("opacity");
      dockStage.removeAttribute("data-shown");
      dockStage.removeAttribute("data-live");
    }
    if (tip) {
      tip.textContent = "";
      tip.removeAttribute("data-on");
    }
    if (reading && wasScrolled) reading.scrollIntoView({ block: "start" });
  };

  const start = async () => {
    await painted();
    await idle();
    let link: WorldLink;
    try {
      const opened = await openWorld(canvas, {
        tier: { small: small || !home, calm, maxPixelRatio: small ? 1.5 : home ? 2 : 1.5 },
        stargazers: data.stargazers,
      });
      canvas = opened.canvas;
      link = opened.link;
    } catch (error) {
      giveUp(error);
      return;
    }
    world = link;
    listen = (on) => link.setListening(on);
    link.onLost(() => giveUp(new Error("the graphics context was lost")));
    measure();
    link.resize(size.width, size.height);
    syncPause();
    link.start(getFrame, onFrame, onCut);
    root.classList.add("world-live");

    // The rest streams in behind the first screen, one piece per quiet moment.
    const first = keys[0]?.ch ?? CHANNELS_AT_REST;
    await idle();
    if (home || first.pods > 0) await link.extend({ pods: true });
    if (home || first.rings > 0) {
      await idle();
      try {
        const sheet = await loadMarkSheet(data.rings.sheet);
        await link.extend({ rings: { ...data.rings, sheet } });
      } catch (error) {
        console.warn("[world] the marks did not load; the orbits stay empty", error);
      }
    }
    if (home) {
      await idle();
      await link.extend({ dawn: true });
      await idle();
      await link.extend({ edges: true });
    }
  };

  // `?world=debug` lets a check read what the page believes about the scene.
  if (/[?&]world=debug/.test(window.location.search)) {
    (window as unknown as { __world: () => unknown }).__world = () => ({
      threaded: world?.threaded ?? null,
      line: world?.debug() ?? null,
      hidden: document.hidden,
      focused: document.hasFocus(),
      size,
      canvas: [canvas.clientWidth, canvas.clientHeight],
      dockInView,
      dockRect: dockRect(),
      dockError: lastError,
      keys: keys.map((key) => `${key.chapter}@${Math.round(key.y)}`),
      pinHeight,
      column,
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
    });
  }

  if (document.readyState === "complete") void start();
  else window.addEventListener("load", () => void start(), { once: true });
}
