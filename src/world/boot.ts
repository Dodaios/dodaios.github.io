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
import type { ZoneName } from "./parts/room";
import { REPO_SCREEN, SCRIPT, STILLS } from "./script";
import {
  CHANNELS_AT_REST,
  isDock,
  buildKeys,
  clamp01,
  sample,
  type ChapterSpan,
  type DockShot,
  type DockTarget,
  type ScreenQuad,
  type Key,
} from "./timeline";
import type { FrameInput, FrameOutput } from "./World";

interface WorldData {
  scene: string;
  stargazers: number;
  rings: Omit<RingData, "sheet"> & { sheet: string };
  /** The words of every label in the room, and their variants (`id:variant`). */
  labels: Record<string, string[]>;
  /** The places pinned on the globe: latitude, longitude and head count in threes, and their names. */
  globe: { pins: number[]; labels: string[] };
}

/** The app window's size and the scale below which it stops shrinking (DemoStage.tsx). */
const WINDOW_W = 1360;
const WINDOW_H = 758;
const MIN_SCALE = 0.46;
const SIDEBAR_W = 240;

const RING_ROUTES = ["/plugins", "/skills", "/clis"];
/** What the pointer's label says over a thing in the room that answers a press. */
const SPOT_TIPS: Record<string, string> = {
  install: "Press to copy the command",
  stars: "Star it on GitHub",
  quote1: "Read it where it was said",
  quote2: "Read it where it was said",
  quote3: "Read it where it was said",
};
/** The zone of the room each chapter of the front page stands in (the desk is always there). */
const CHAPTER_ZONE: Record<string, ZoneName | undefined> = {
  agents: "right",
  plugins: "lounge",
  skills: "lounge",
  clis: "lounge",
  stars: "window",
  open: "corner",
  install: "corner",
};
/** Which zones of the room a still view needs besides the desk. */
const STILL_ZONES: Record<string, ZoneName[]> = {
  plugins: ["lounge", "window"],
  skills: ["lounge", "window"],
  clis: ["lounge", "window"],
  quiet: ["window", "lounge"],
};

const root = document.documentElement;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Set while a scene is running: the room acts out what happens on the page. */
let stage: {
  listen(on: boolean): void;
  label(id: string, variant?: string): void;
  act(name: string): void;
} | null = null;

talk();
copyCommand();

const firstCanvas = document.querySelector<HTMLCanvasElement>("[data-world]");
const dataNode = document.getElementById("world-data");
if (firstCanvas && dataNode && root.classList.contains("world-on")) {
  // From here on this script answers for the page: until this class is there
  // nothing is hidden, so a page whose script never arrives still shows itself.
  root.classList.add("world-ready");
  run(firstCanvas, JSON.parse(dataNode.textContent || "{}") as WorldData);
}

/**
 * Hold to talk. It plays one scripted exchange and belongs to the page, not to
 * the scene: it works on the plain page too, where there is no room to act it out.
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
  let rest = 0;
  let held = false;

  const stop = () => {
    window.clearInterval(typing);
    window.clearTimeout(pending);
    window.clearTimeout(rest);
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
    stage?.listen(true);
    stage?.label("voice", "listening");
    said.textContent = "";
    reply.textContent = "";
    // What the sign on the desk says while the button is held, said in the page.
    if (status) status.textContent = status.dataset.listening ?? "";
    type(said, request, 42);
  };
  const end = () => {
    if (!held) return;
    held = false;
    stop();
    hold.setAttribute("aria-pressed", "false");
    stage?.listen(false);
    // Letting go early still sends the whole sentence: this is a simulation.
    said.textContent = request;
    stage?.label("voice", "heard");
    stage?.act("voice-run");
    // The sign goes back to what it says when nobody is talking.
    rest = window.setTimeout(() => stage?.label("voice"), 9000);
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

/** The command for the reader's own system, as the head's probe named it. */
function commandFor(button: HTMLElement): string {
  return (root.dataset.os === "windows" ? button.dataset.windows : button.dataset.unix) ?? "";
}

/** Copy the install command, and say so on the button for a moment. */
function copyCommand(): boolean {
  const button = document.querySelector<HTMLButtonElement>("[data-copy-install]");
  if (!button) return false;
  const label = button.textContent ?? "";
  let back = 0;
  const copy = () => {
    navigator.clipboard?.writeText(commandFor(button)).then(
      () => {
        button.textContent = button.dataset.done ?? label;
        window.clearTimeout(back);
        back = window.setTimeout(() => (button.textContent = label), 2200);
      },
      () => {
        // Refused (no permission, no user gesture): the command is still in the page to select.
      },
    );
  };
  button.addEventListener("click", copy);
  return true;
}

function run(firstCanvas: HTMLCanvasElement, data: WorldData): void {
  const home = data.scene === "home";
  const small = matchMedia("(max-width: 767px), (pointer: coarse) and (max-width: 1100px)").matches;
  const chapters = home ? Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]")) : [];
  /*
   * Two screens of the room carry a piece of the page: the desk's monitor is the
   * app's window, the display on the wall is the repository. Each has a stage
   * in the page, and the camera docks onto whichever the reader is at.
   */
  type DockId = DockShot["dock"];
  const DOCK_IDS: readonly DockId[] = ["desk", "repo"];
  const dockStage = document.querySelector<HTMLElement>('[data-dock-stage="desk"]');
  const stages: Record<DockId, HTMLElement | null> = {
    desk: dockStage,
    repo: document.querySelector<HTMLElement>('[data-dock-stage="repo"]'),
  };
  /** The window inside each stage that the screen has to match. */
  const FRAMES: Record<DockId, string> = { desk: ".demo-window", repo: ".repo-window" };
  /** Which chapter each stage belongs to, and where in it the camera is docked (for the keyboard). */
  const DOCK_CHAPTER: Record<DockId, { chapter: string; at: number }> = {
    desk: { chapter: "hero", at: 0 },
    repo: { chapter: "open", at: 0.56 },
  };
  const agentCount = document.querySelector<HTMLElement>("[data-agents-count]");
  const tip = document.querySelector<HTMLElement>("[data-world-tip]");

  let canvas = firstCanvas;
  let world: WorldLink | null = null;
  let keys: Key[] = [];
  let spans: ChapterSpan[] = [];
  let pinHeight = window.innerHeight;
  let size = { width: 1, height: 1 };
  let pointerFree = true;
  /** The stage whose chapter is on or near the screen. */
  let dockNear: DockId | null = null;
  /** The stage the last frame was docked onto. */
  let frameDock: DockId | null = null;
  let queued = false;
  let stillPaused = false;
  let current: HTMLElement | null = null;
  /** Set once the scene has been given up: the page is the plain page from then on. */
  let gone = false;
  /** What has to be undone when that happens. */
  const undo: (() => void)[] = [];

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

  /** Tell each chapter how far through it the reader is, and which one they are in. */
  const progress = new WeakMap<HTMLElement, number>();
  const applyScroll = () => {
    queued = false;
    if (gone) return;
    const y = window.scrollY;
    const view = window.innerHeight;
    dockNear = null;
    // (A cast, because the compiler does not follow an assignment into a callback.)
    let reading = null as HTMLElement | null;
    chapters.forEach((el, i) => {
      const span = spans[i];
      if (!span) return;
      const top = span.top - y;
      const bottom = top + span.height;
      const near = bottom > -view * 0.5 && top < view * 1.5;
      if (near) for (const id of DOCK_IDS) if (DOCK_CHAPTER[id].chapter === span.id && stages[id]) dockNear = id;
      // The chapter the middle of the window is in owns the foot of the screen.
      if (top <= view * 0.5 && bottom > view * 0.5) reading = el;
      if (!near) return;
      const stretch = Math.max(1, span.height - pinHeight);
      const p = Math.round(clamp01(-top / stretch) * 1000) / 1000;
      if (progress.get(el) !== p) {
        progress.set(el, p);
        el.style.setProperty("--p", String(p));
      }
    });
    if (reading !== current) {
      current?.removeAttribute("data-current");
      current = reading;
      current?.setAttribute("data-current", "");
    }
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

  /*
   * The keyboard walks the room too. Every chapter's controls are in the tab
   * order wherever the camera is; when the focus lands in a chapter the reader
   * is not in, the page goes there and the scene follows. The first chapter has
   * two places: the app's window with its starters at its start, and its row
   * of buttons once the chair has rolled back.
   */
  const followFocus = (event: FocusEvent) => {
    if (gone || !root.classList.contains("world-live")) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const chapter = target?.closest<HTMLElement>("[data-chapter]");
    if (!target || !chapter) return;
    const span = spans[chapters.indexOf(chapter)];
    if (!span) return;
    const stretch = Math.max(0, span.height - pinHeight);
    const docked = dockStage?.hasAttribute("data-shown") ?? false;
    const inStage = target.closest<HTMLElement>("[data-dock-stage]");
    let at: number | null = null;
    if (inStage) {
      // A control on one of the room's screens: go and stand in front of it.
      const id = inStage.dataset.dockStage as DockId;
      at = inStage.hasAttribute("data-shown") ? null : (DOCK_CHAPTER[id]?.at ?? 0);
    } else if (span.id === "hero") at = docked || chapter !== current ? 1 : null;
    else if (chapter !== current) at = 0.5;
    if (at !== null) window.scrollTo({ top: span.top + stretch * at, behavior: "instant" });
  };
  if (home) document.addEventListener("focusin", followFocus);

  /* ---- The frame, as the scene asks for it ---------------------------- */

  const canvasRect = () => canvas.getBoundingClientRect();

  /**
   * Where the app's window is on the page, whole: on a phone the stage holds
   * the window at MIN_SCALE and lets it run out of the frame on both sides, and
   * the monitor has to match the window, not the frame.
   */
  const dockRect = (id: DockId): FrameInput["dockRect"] => {
    const frame = stages[id]?.querySelector<HTMLElement>(FRAMES[id]);
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    if (box.width <= 0) return null;
    const origin = canvasRect();
    // The display on the wall is its window, edge to edge.
    if (id !== "desk") return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
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

  let ringShown = 1;
  const getFrame = (): FrameInput | null => {
    if (!world || gone) return null;
    const id = dockNear;
    const rect = id ? dockRect(id) : null;
    const quad: ScreenQuad | null =
      id === "desk"
        ? { center: world.screen.center, width: (world.screen.height * WINDOW_W) / WINDOW_H, height: world.screen.height, yaw: 0 }
        : id === "repo"
          ? REPO_SCREEN
          : null;
    // On a phone the wall display would be a few lines high. There the
    // repository is a panel over the picture, as tall as it needs to be, and
    // the camera only looks at the display instead of matching it.
    const panel = id === "repo" && small;
    const docks: Partial<Record<DockId, DockTarget>> = {};
    if (id && rect && quad && !panel) docks[id] = { ...quad, rect };
    const state = sample(keys, window.scrollY, size, docks, calm);
    if (!state) return null;
    const docking = id === "desk" ? state.ch.dock : id === "repo" ? state.ch.repo : 0;
    frameDock = docking > 0.02 && !panel ? id : null;
    // The panel follows the chapter, not the scene's report of a fit: there is none to wait for.
    if (small) showStage("repo", panel ? docking : 0);
    if (agentCount) {
      const lit = String(Math.round(state.ch.agents));
      if (agentCount.textContent !== lit) agentCount.textContent = lit;
    }
    // The lightbox behind the holo table names the ring that is lit.
    const ring = Math.round(state.ch.ring);
    if (ring >= 1 && ring !== ringShown) {
      ringShown = ring;
      stage?.label("reach", String(ring));
    }
    // Behind a page of text the scene is scenery: nothing in it takes the pointer.
    return {
      pose: state.pose,
      ch: state.ch,
      dockRect: frameDock ? rect : null,
      dockQuad: frameDock ? quad : null,
      pointerFree: home && pointerFree,
    };
  };

  const dockOpacity: Record<DockId, number> = { desk: -1, repo: -1 };
  const showStage = (id: DockId, opacity: number) => {
    const el = stages[id];
    const was = dockOpacity[id];
    if (!el || !(Math.abs(opacity - was) > 0.004 || (opacity !== was && (opacity === 0 || opacity === 1)))) return;
    dockOpacity[id] = opacity;
    el.style.opacity = String(opacity);
    el.toggleAttribute("data-shown", opacity > 0.01);
    el.toggleAttribute("data-live", opacity > 0.96);
  };
  let hotKey = "";
  let lastError = Infinity;
  const onFrame = (out: FrameOutput) => {
    lastError = out.dockError;
    // The live window fades in exactly as fast as the screen lines up with it.
    const fit = Number.isFinite(out.dockError) ? clamp01(1 - (out.dockError - 1.5) / 14) : 0;
    for (const id of DOCK_IDS) if (!(small && id === "repo")) showStage(id, id === frameDock ? fit : 0);
    const hot = out.hot;
    const key = hot
      ? hot.kind === "tile"
        ? `tile:${hot.label}`
        : hot.kind === "spot"
          ? `spot:${hot.id}`
          : hot.kind === "pin"
            ? `pin:${hot.label}`
            : hot.kind
      : "";
    if (key !== hotKey) {
      hotKey = key;
      root.toggleAttribute("data-world-hot", key !== "");
      if (tip) {
        const text =
          hot?.kind === "tile" || hot?.kind === "pin" ? hot.label : hot?.kind === "spot" ? (SPOT_TIPS[hot.id] ?? "") : "";
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

  /** A thing in the room was pressed: do what its counterpart in the page does. */
  const pressSpot = (id: string) => {
    if (id === "install") document.querySelector<HTMLButtonElement>("[data-copy-install]")?.click();
    else if (id === "stars") document.querySelector<HTMLAnchorElement>("#stargazers .hud a")?.click();
    else if (id.startsWith("quote")) document.querySelector<HTMLAnchorElement>(`[data-quote="${id.slice(5)}"]`)?.click();
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
    let byMouse = true;
    window.addEventListener(
      "pointerdown",
      (event) => {
        pressedAt = { x: event.clientX, y: event.clientY };
        byMouse = event.pointerType === "mouse";
      },
      { passive: true },
    );
    window.addEventListener("click", (event) => {
      if (!world || event.button !== 0 || isUi(event.target)) return;
      if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 8) return;
      pointerFree = true;
      world.setPointer(point(event));
      // Under a mouse the scene has already said what the pointer is over. Act
      // on that at once: copying and opening a page need the press itself, and
      // an answer that comes back from another thread is no longer the press.
      const known = byMouse && hotKey.startsWith("spot:") ? hotKey.slice(5) : "";
      if (known) pressSpot(known);
      void world.press().then((hit) => {
        if (hit?.kind === "tile") window.location.assign(RING_ROUTES[hit.ring] ?? "/plugins");
        else if (hit?.kind === "spot" && !known) pressSpot(hit.id);
      });
      // A finger leaves no pointer behind; without this the camera stays leaning.
      if (!byMouse) world.setPointer(null);
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
    if (gone) return;
    gone = true;
    console.warn("[world] no 3D scene; the page continues without it", error);
    world?.dispose();
    for (const step of undo.splice(0)) step();
    world = null;
    stage = null;
    // What the scene counted up is a plain fact again.
    if (agentCount) agentCount.textContent = agentCount.dataset.total ?? agentCount.textContent;
    const reading = current;
    const wasScrolled = window.scrollY > 0;
    root.classList.remove("world-on", "world-live", "world-settled", "world-ready", "world-cut");
    root.classList.add("world-off");
    root.removeAttribute("data-world-hot");
    current?.removeAttribute("data-current");
    for (const el of Object.values(stages)) {
      el?.style.removeProperty("opacity");
      el?.removeAttribute("data-shown");
      el?.removeAttribute("data-live");
    }
    if (tip) {
      tip.textContent = "";
      tip.removeAttribute("data-on");
    }
    if (reading && wasScrolled) reading.scrollIntoView({ block: "start" });
  };

  /** The words of a label, or of one of its variants (`id:variant` in the page's data). */
  const words = (id: string, variant?: string) => (variant && data.labels[`${id}:${variant}`]) || data.labels[id] || [];

  const start = async () => {
    await painted();
    await idle();
    // The reader's own system decides which command the whiteboard carries.
    const labels = { ...data.labels };
    if (root.dataset.os === "windows" && labels["install:windows"]) labels.install = labels["install:windows"];
    let link: WorldLink;
    try {
      const opened = await openWorld(canvas, {
        tier: { small: small || !home, calm, maxPixelRatio: small ? 1.5 : home ? 2 : 1.5 },
        stargazers: data.stargazers,
        labels,
        globe: data.globe,
      });
      canvas = opened.canvas;
      link = opened.link;
    } catch (error) {
      giveUp(error);
      return;
    }
    world = link;
    stage = {
      listen: (on) => link.setListening(on),
      label: (id, variant) => link.setLabel(id, id === "install" ? labels.install : words(id, variant)),
      act: (name) => link.act(name),
    };
    link.onLost(() => giveUp(new Error("the graphics context was lost")));
    measure();
    link.resize(size.width, size.height);
    syncPause();
    // The page opens seated at the monitor: the window is already where it
    // belongs, so it must not blink out while the scene takes over.
    if (dockStage && keys[0] && keys[1] && isDock(keys[0].shot) && isDock(keys[1].shot) && window.scrollY < keys[1].y) {
      frameDock = "desk";
      showStage("desk", 1);
    }
    link.start(getFrame, onFrame, onCut);
    root.classList.add("world-live");
    // Two frames on, the page has been laid out as the room's: from here its
    // rows may fade (world.css).
    requestAnimationFrame(() => requestAnimationFrame(() => !gone && root.classList.add("world-settled")));

    // The star counter follows the live figure the page fetches (LiveCount).
    const figure = document.querySelector<HTMLElement>("[data-stars-count]");
    if (figure) {
      const unit = data.labels.stars?.[1] ?? "";
      const tell = () => {
        const text = figure.textContent?.trim();
        // Never a zero: the page's figure passes through one while it counts up.
        if (text && /^[\d.,\s]+$/.test(text) && /[1-9]/.test(text)) link.setLabel("stars", [text, unit]);
      };
      const watcher = new MutationObserver(tell);
      watcher.observe(figure, { childList: true, characterData: true, subtree: true });
      undo.push(() => watcher.disconnect());
      tell();
    }

    // The rest of the room arrives while the reader is still at the desk, in
    // the order the tour visits it, one piece per quiet moment.
    const first = keys[0]?.ch ?? CHANNELS_AT_REST;
    let zones: ZoneName[] = home ? ["right", "lounge", "window", "corner"] : (STILL_ZONES[data.scene] ?? STILL_ZONES.quiet);
    // A reader who arrived somewhere else (a link to a chapter) gets that
    // station first.
    const here = CHAPTER_ZONE[current?.dataset.chapter ?? ""];
    if (home && here) zones = [here, ...zones.filter((zone) => zone !== here)];
    try {
      for (const zone of zones) {
        await idle();
        if (gone) return;
        await link.extend({ zones: [zone] });
        if (zone === "lounge" && (home || first.rings > 0)) {
          try {
            const sheet = await loadMarkSheet(data.rings.sheet);
            if (gone) return;
            await link.extend({ rings: { ...data.rings, sheet } });
          } catch (error) {
            console.warn("[world] the marks did not load; the hologram stays empty", error);
          }
        }
      }
      if (home) {
        await idle();
        if (gone) return;
        await link.extend({ frames: true });
        await idle();
        if (gone) return;
        await link.extend({ dawn: true });
      }
    } catch (error) {
      // A station that did not arrive would leave its chapter with no words.
      giveUp(error);
    }
  };

  // `?world=debug` lets a check read what the page believes about the scene.
  if (/[?&]world=debug/.test(window.location.search)) {
    (window as unknown as { __world: () => unknown }).__world = () => ({
      threaded: world?.threaded ?? null,
      line: world?.debug() ?? null,
      hidden: document.hidden,
      size,
      canvas: [canvas.clientWidth, canvas.clientHeight],
      dockNear,
      dockRect: dockNear ? dockRect(dockNear) : null,
      dockError: lastError,
      keys: keys.map((key) => `${key.chapter}@${Math.round(key.y)}`),
      pinHeight,
      current: current?.dataset.chapter ?? null,
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
    });
  }

  if (document.readyState === "complete") void start();
  else window.addEventListener("load", () => void start(), { once: true });
}
