/**
 * The Agentic IDE's grid layout: three terminals working side by side, on a
 * loop. The panes and the workspace list are IdeScene.tsx; this file only
 * turns its steps and is what the stage loads when the grid is first opened.
 */
import { useEffect, useState, type ReactNode } from "react";

import { IDE_DURATIONS, IDE_STEPS, IdeMain, IdeNav } from "./IdeScene";

/** `panel`: the open side panel beside the grid; nothing while it is shut. */
export function GridScene({ panel }: { panel?: ReactNode }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(IDE_STEPS - 1);
      return;
    }
    const timer = window.setTimeout(() => setStep((s) => (s + 1) % IDE_STEPS), IDE_DURATIONS[step]);
    return () => window.clearTimeout(timer);
  }, [step]);
  return <IdeMain step={step} panel={panel} />;
}

export function GridNav() {
  return <IdeNav />;
}
