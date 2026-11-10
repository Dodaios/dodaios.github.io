/**
 * The app's pets — `pets/PetSprite.tsx` and `pets/PetMark.tsx`, with the
 * sprite sheets of four of its built-in pets (dodaios/ui/pets/builtin).
 *
 * Gigi is the app's default and plays the assistant; Bolt, Pip and Sprout are
 * the three placeholder agents. Never the maintainer's own choice of pet.
 */
import { useEffect, useRef } from "react";

import gigiSheet from "@/assets/app/gigi-sheet.png?url";
import boltSheet from "@/assets/app/pets/bolt.png?url";
import pipSheet from "@/assets/app/pets/pip.png?url";
import sproutSheet from "@/assets/app/pets/sprout.png?url";

export type PetId = "gigi" | "bolt" | "pip" | "sprout";
export type PetState = "idle" | "listening" | "talking" | "working";

const SHEETS: Record<PetId, string> = { gigi: gigiSheet, bolt: boltSheet, pip: pipSheet, sprout: sproutSheet };

/** The rows of a built-in pet.json the demo plays; all four pets share them. */
const ROWS: Record<PetState, { row: number; frames: number; fps: number; swing?: boolean }> = {
  idle: { row: 0, frames: 7, fps: 6 },
  listening: { row: 1, frames: 6, fps: 8 },
  talking: { row: 3, frames: 4, fps: 10, swing: true },
  working: { row: 7, frames: 8, fps: 8 },
};
const FRAME = 48;

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function PetSprite({ pet = "gigi", state = "idle", px }: { pet?: PetId; state?: PetState; px: number }) {
  const cell = useRef<HTMLDivElement>(null);
  const { row, frames, fps, swing } = ROWS[state];
  const factor = px / FRAME;
  const crisp = Number.isInteger(factor);

  useEffect(() => {
    const el = cell.current;
    if (!el) return;
    const place = (frame: number) => {
      el.style.backgroundPosition = `${-frame * FRAME}px ${-row * FRAME}px`;
    };
    place(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      if (swing) {
        const period = 2 * (frames - 1);
        const at = step % period;
        place(at < frames ? at : period - at);
      } else place(step % frames);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [row, frames, fps, swing]);

  return (
    <div
      aria-hidden
      data-testid="pet-sprite"
      data-state={state}
      className="relative shrink-0 overflow-hidden"
      style={{ width: px, height: px }}
    >
      <div
        ref={cell}
        data-testid="pet-sprite-cell"
        className={cn("absolute left-0 top-0 bg-no-repeat", crisp && "[image-rendering:pixelated]")}
        style={{
          width: FRAME,
          height: FRAME,
          backgroundImage: `url("${SHEETS[pet]}")`,
          backgroundPosition: `0px ${-row * FRAME}px`,
          transform: `scale(${factor})`,
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
}

/** `PetMark` — a pet as an inline mark. */
export function PetMark({
  pet = "gigi",
  size,
  state = "idle",
  className,
}: {
  pet?: PetId;
  size: number;
  state?: PetState;
  className?: string;
}) {
  return (
    <span data-testid="pet-mark" data-pet={pet} className={cn("inline-flex shrink-0 select-none", className)}>
      <PetSprite pet={pet} state={state} px={size} />
    </span>
  );
}

/** An agent's face in a list — `AgentPetFace` inside the app's avatar box. */
export function AgentFace({ pet, size, state = "idle" }: { pet: PetId; size: number; state?: PetState }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      <span className="agent-pet-face relative inline-flex shrink-0" data-agent-pet={pet}>
        <PetSprite pet={pet} state={state} px={size} />
      </span>
    </span>
  );
}
