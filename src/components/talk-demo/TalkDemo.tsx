/**
 * The "Code by talking" demo container.
 *
 * Beyond the shared machinery it owns one beat: the spoken sentence appears a
 * character at a time in the voice bar, because the point is that a person
 * said it, and the pane picks it up only after it has been said.
 */

import {
  DemoStage,
  useFrameScript,
  usePrefersReducedMotion,
  useTypewriter,
} from "@/components/window-demo/Stage";
import { DEMO_DESCRIPTION, FRAMES } from "./frames";
import { CANVAS_HEIGHT, CANVAS_WIDTH, TalkView } from "./TalkView";
import "./talk-demo.css";

const DURATIONS = FRAMES.map((f) => f.duration);

export function TalkDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const { index, takeOver } = useFrameScript(DURATIONS, reducedMotion);
  // Reduced motion holds the last frame: every pane done, the whole story on
  // one screen, rather than the empty first beat.
  const frame = reducedMotion ? FRAMES[FRAMES.length - 1] : FRAMES[index];

  const typed = useTypewriter(frame.say ?? "", Boolean(frame.say), reducedMotion);

  return (
    <DemoStage
      backdrop="talk"
      canvasWidth={CANVAS_WIDTH}
      canvasHeight={CANVAS_HEIGHT}
      description={DEMO_DESCRIPTION}
      onTakeOver={takeOver}
    >
      <TalkView frame={frame} typed={typed} animate={!reducedMotion} />
    </DemoStage>
  );
}

export default TalkDemo;
