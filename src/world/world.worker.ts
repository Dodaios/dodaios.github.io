/**
 * The scene, on its own thread.
 *
 * Everything that is heavy about the 3D world happens here: parsing the
 * renderer, decoding the models, compiling shaders, and drawing every frame.
 * The page's thread only says where the camera is (src/world/link.ts), so
 * scrolling, typing and the page's own scripts never wait for the picture.
 *
 * The messages are the ones named in link.ts; this file is their other end.
 */
import { World, type Extras, type FrameInput, type FrameOutput, type WorldOptions } from "./World";

type Incoming =
  | { type: "init"; options: WorldOptions }
  | { type: "frame"; input: FrameInput }
  | { type: "pointer"; point: { x: number; y: number } | null }
  | { type: "resize"; width: number; height: number }
  | { type: "extend"; id: number; extras: Partial<Extras> }
  | { type: "press"; id: number }
  | { type: "listening"; on: boolean }
  | { type: "label"; id: string; lines: readonly string[] }
  | { type: "act"; name: string }
  | { type: "paused"; on: boolean };

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
};

let world: World | null = null;
let latest: FrameInput | null = null;
let sentError = Infinity;
let sentHot = "";
let received = 0;
let pulseAt = 0;

const hotKey = (hot: FrameOutput["hot"]) =>
  hot
    ? hot.kind === "tile"
      ? `tile:${hot.label}:${hot.ring}`
      : hot.kind === "spot"
        ? `spot:${hot.id}`
        : hot.kind === "pin"
          ? `pin:${hot.label}`
          : hot.kind
    : "";

/** Only what changed crosses back: the page has nothing to do with the rest. */
const report = (out: FrameOutput) => {
  // A sign of life about twice a second, so the page can tell a scene that is
  // drawing from one that has stopped.
  const now = performance.now();
  if (now - pulseAt > 500) {
    pulseAt = now;
    scope.postMessage({ type: "pulse", frames: world?.frames ?? 0, received });
  }
  const key = hotKey(out.hot);
  const moved =
    Number.isFinite(out.dockError) !== Number.isFinite(sentError) || Math.abs(out.dockError - sentError) > 0.2;
  if (!moved && key === sentHot) return;
  sentError = out.dockError;
  sentHot = key;
  scope.postMessage({ type: "frame", out: { dockError: out.dockError, hot: out.hot } });
};

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      World.create(message.options).then(
        (created) => {
          // Anything that throws in here must still reach the page as a
          // failure, or the page would wait for a scene that never answers.
          try {
            world = created;
            message.options.canvas.addEventListener("webglcontextlost", (lost) => {
              lost.preventDefault();
              world?.stop();
              scope.postMessage({ type: "lost" });
            });
            created.start(
              () => latest,
              report,
              () => scope.postMessage({ type: "cut" }),
            );
            scope.postMessage({ type: "ready", screen: created.screen });
          } catch (error) {
            scope.postMessage({ type: "failed", message: String(error) });
          }
        },
        (error: unknown) => scope.postMessage({ type: "failed", message: String(error) }),
      );
      break;
    case "frame":
      latest = message.input;
      received++;
      // The page posts one of these per frame of its own. If this thread's own
      // frame loop has gone quiet while they keep arriving (seen in Chrome: a
      // worker's animation frames can stop while the page's carry on), draw on
      // the page's beat instead, so the scene keeps following the scroll and
      // the app's window still arrives when the camera reaches the monitor.
      if (world && world.idleFor > 150) world.step();
      break;
    case "pointer":
      world?.setPointer(message.point);
      break;
    case "resize":
      world?.resize(message.width, message.height);
      break;
    case "extend":
      (world?.extend(message.extras) ?? Promise.resolve()).then(
        () => scope.postMessage({ type: "extended", id: message.id }),
        (error: unknown) => scope.postMessage({ type: "extended", id: message.id, error: String(error) }),
      );
      break;
    case "press":
      scope.postMessage({ type: "pressed", id: message.id, hot: world?.press() ?? null });
      break;
    case "listening":
      world?.setListening(message.on);
      break;
    case "label":
      world?.setLabel(message.id, message.lines);
      break;
    case "act":
      world?.act(message.name);
      break;
    case "paused":
      world?.setPaused(message.on);
      break;
  }
};
