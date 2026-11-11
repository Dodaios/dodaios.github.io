/**
 * The second monitor on the desk: the app's thread view, running. It shows what
 * happens after an order has been given: the request, the agent's work line by
 * line, its sub-agents, and the finished turn with its pull request.
 *
 * The pictures are the app's own view, not a drawing of it: frames of the
 * working clone on this site (src/components/demo), taken one after another
 * while it plays its errand (docs/world.md, "The models"). The first one
 * arrives with the desk; the rest follow when the room is in.
 */
import { MeshBasicMaterial, type Mesh, type Texture } from "three";

import { loadTexture, type Context } from "../kit";
import type { Channels } from "../timeline";

/** The frames, in order: `thread-01.webp`, `thread-02.webp`, ... */
const FRAMES = Object.entries(
  import.meta.glob<string>("../../assets/world/thread-*.webp", { query: "?url", import: "default", eager: true }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

/** Seconds each frame stays up; the last one is the finished turn and stays longest. */
const STEP = 1.5;
const HOLD_LAST = 7;

export interface Second {
  attach(quads: Map<string, Mesh>): void;
  /** Fetch the frames after the first. Safe to call twice. */
  load(): Promise<void>;
  /** An order was given: the thread starts from its first line. */
  run(): void;
  update(ch: Channels, reveal: number, time: number): void;
}

export function createSecond(ctx: Context): Second {
  const calm = ctx.tier.calm;
  const textures: (Texture | undefined)[] = [];
  const material = new MeshBasicMaterial({ toneMapped: false });
  let attached = false;
  let asked = false;
  let complete = false;
  let shown = -1;
  /** When the frame on screen was put up, and a restart that waits for the next update. */
  let since = 0;
  let restart = false;

  const show = (index: number) => {
    const texture = textures[index];
    if (!texture || index === shown) return;
    shown = index;
    material.map = texture;
    material.needsUpdate = true;
  };

  return {
    attach(quads) {
      const quad = quads.get("Screen2");
      if (!quad || attached || FRAMES.length === 0) return;
      attached = true;
      // With reduced motion the screen shows the finished turn and nothing plays.
      const first = calm ? FRAMES.length - 1 : 0;
      void loadTexture(FRAMES[first], ctx).then((texture) => {
        textures[first] = texture;
        quad.material = material;
        show(first);
      });
    },

    async load() {
      if (asked || calm) return;
      asked = true;
      await Promise.all(
        FRAMES.map(async (url, i) => {
          if (!textures[i]) textures[i] = await loadTexture(url, ctx);
        }),
      );
      complete = true;
    },

    run() {
      restart = true;
    },

    update(_ch, reveal, time) {
      material.color.setScalar(Math.min(1, reveal / 0.3));
      if (calm || !complete) return;
      if (restart || shown < 0) {
        restart = false;
        since = time;
        show(0);
        return;
      }
      const last = FRAMES.length - 1;
      if (time - since < (shown === last ? HOLD_LAST : STEP)) return;
      since = time;
      show(shown === last ? 0 : shown + 1);
    },
  };
}
