/**
 * The "Code by talking" demo: a real recording, not a drawing.
 *
 * The clip is the Agentic IDE itself on a demo repo, with real Claude Code
 * panes doing the work a spoken sentence asked for. A hand-drawn imitation of
 * those panes never looked like the product, so the section shows the product.
 * The app's left sidebar is cropped away so the panes stay readable at the
 * well's size; the spoken lines are burned in as captions, since the clip
 * plays muted.
 */

import { DemoStage, usePrefersReducedMotion } from "@/components/window-demo/Stage";

// 1440x930: the 1672x1080 pane area of a 1080p screen recording.
const CANVAS_WIDTH = 1440;
const CANVAS_HEIGHT = 930;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CLIP = `${BASE}/media/code-by-talking.mp4`;
const POSTER = `${BASE}/media/code-by-talking-poster.jpg`;

const DEMO_DESCRIPTION =
  "A screen recording of the Agentic IDE with three Claude Code panes, T1, T2 " +
  "and T3. Someone says \"Tell T1 to run the tests\", \"Tell T2 to fix the " +
  "failing test\" and \"Tell T3 to write the changelog\". Dodaios turns each " +
  "sentence into a brief and types it into the right pane: T1 finds one " +
  "failing test, T2 fixes it and T3 writes the changelog.";

export function TalkDemo() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <DemoStage
      backdrop="talk"
      canvasWidth={CANVAS_WIDTH}
      canvasHeight={CANVAS_HEIGHT}
      description={DEMO_DESCRIPTION}
      // Full column width, so the well follows the clip's own shape.
      wellShape="aspect-[3/2] lg:p-10"
    >
      {/* Reduced motion shows the last frame, where every pane is done. */}
      <video
        key={reducedMotion ? "still" : "play"}
        src={CLIP}
        poster={POSTER}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        autoPlay={!reducedMotion}
        loop
        muted
        playsInline
        preload={reducedMotion ? "none" : "metadata"}
        className="block h-full w-full bg-black object-cover"
      />
    </DemoStage>
  );
}

export default TalkDemo;
