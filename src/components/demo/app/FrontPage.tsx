/**
 * The front page in voice mode — a clone of the app's VoiceStage.
 *
 * Markup and class names are copied from the app at HEAD:
 * components/home/VoiceStage.tsx (the stage, TranscriptLine),
 * home/Greeting.tsx, home/VoiceComposer.tsx, home/VoiceGlow.tsx (its CSS
 * fallback — the app's WebGL light is a canvas, which the hero may not use),
 * pets/PetSprite.tsx (Gigi, the app's default pet), and the rail look of
 * agentchat/WorkTrace.tsx + TraceTimeline.tsx for the turn's work.
 *
 * What plays is one spoken turn, scripted in `frontPageScript.ts`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import gigiSheet from "@/assets/app/gigi-sheet.png?url";
import githubLogo from "@/assets/brands/github.svg?url";
import { cn, USER_NAME } from "./AppShell";
import { Bot, ChevronRight, Keyboard, Mic, Sparkles } from "./lucide";
import { FRONT_TURN, type FrontFrame } from "./frontPageScript";

// ---------------------------------------------------------------------------
// Gigi (pets/PetSprite.tsx + the built-in pet.json)
// ---------------------------------------------------------------------------

type PetState = "idle" | "listening" | "talking" | "working";

/** The rows of dodaios/ui/pets/builtin/gigi/pet.json the demo plays. */
const GIGI: Record<PetState, { row: number; frames: number; fps: number; swing?: boolean }> = {
  idle: { row: 0, frames: 7, fps: 6 },
  listening: { row: 1, frames: 6, fps: 8 },
  talking: { row: 3, frames: 4, fps: 10, swing: true },
  working: { row: 7, frames: 8, fps: 8 },
};
const FRAME = 48;

function PetSprite({ state, px }: { state: PetState; px: number }) {
  const cell = useRef<HTMLDivElement>(null);
  const { row, frames, fps, swing } = GIGI[state];
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
          backgroundImage: `url("${gigiSheet}")`,
          backgroundPosition: `0px ${-row * FRAME}px`,
          transform: `scale(${factor})`,
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
}

function PetMark({ size, state, className }: { size: number; state: PetState; className?: string }) {
  return (
    <span data-testid="pet-mark" data-pet="gigi" className={cn("inline-flex shrink-0 select-none", className)}>
      <PetSprite state={state} px={size} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Greeting, composer, glow
// ---------------------------------------------------------------------------

function useGreeting(): string {
  const [text, setText] = useState("Good morning");
  useEffect(() => {
    const hour = new Date().getHours();
    setText(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return `${text}, ${USER_NAME}`;
}

/** home/Greeting.tsx */
function Greeting({ subtitle, pet }: { subtitle?: string; pet: PetState }) {
  const text = useGreeting();
  return (
    <div className="flex flex-col items-center text-center transition-[opacity,transform]" data-testid="home-greeting">
      <PetMark size={48} state={pet} className="mb-3" />
      <h1 className="text-2xl font-normal tracking-tight text-foreground [text-wrap:balance]">{text}</h1>
      {subtitle && <p className="mt-2 max-w-md text-base text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/** The three dots of an open call (VoiceComposer.tsx). */
function BreathingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 200, 400].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** home/VoiceComposer.tsx, with the way back to typing on the left. */
function VoiceComposer({ hint, live }: { hint: string; live: boolean }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="voice-composer" data-active={live || undefined}>
      <div className="flex items-center gap-1 rounded-[22px] border border-border bg-card px-2.5 py-2.5 shadow-rim">
        <button
          type="button"
          tabIndex={-1}
          data-testid="voice-mode-exit"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Keyboard className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate px-1.5 text-reading text-muted-foreground" data-testid="voice-hint">
          {hint}
        </span>
        <button
          type="button"
          tabIndex={-1}
          data-testid="voice-prompt-mode"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-8 justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
        </button>
        {live ? (
          <button
            type="button"
            tabIndex={-1}
            data-testid="voice-call-stop"
            className="ml-0.5 inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-accent-soft px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BreathingDots />
            Stop
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            data-testid="voice-call-start"
            className="ml-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/85 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mic className="h-4 w-4" aria-hidden />
            Start
          </button>
        )}
      </div>
      <div className="flex justify-end px-3">
        <button
          type="button"
          tabIndex={-1}
          data-testid="voice-engine"
          className="inline-flex max-w-[320px] items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate font-medium text-foreground/80">OpenAI GPT-Live</span>
          <span className="truncate">(ChatGPT subscription)</span>
        </button>
      </div>
    </div>
  );
}

/** The three pools of VoiceGlow.tsx's CSS light. */
const BLOBS = [
  { x: 50, width: "min(760px, 90%)", height: "100%", alpha: 0.26, speed: 0.35, phase: 0, drift: 2, lift: 0.3 },
  { x: 40, width: "min(420px, 55%)", height: "80%", alpha: 0.22, speed: 0.6, phase: 2.1, drift: 5, lift: 0.5 },
  { x: 60, width: "min(420px, 55%)", height: "75%", alpha: 0.2, speed: 0.75, phase: 4.2, drift: 5, lift: 0.55 },
] as const;

function glowGradient(alpha: number): string {
  const stops = [
    [1, 0], [0.86, 12], [0.66, 24], [0.45, 36], [0.27, 48], [0.14, 59], [0.06, 69], [0.02, 78], [0, 88],
  ]
    .map(([k, at]) => `rgb(var(--accent-rgb) / ${(alpha * k).toFixed(3)}) ${at}%`)
    .join(", ");
  return `radial-gradient(ellipse 50% 70% at 50% 100%, ${stops})`;
}

/**
 * VoiceGlow's CSS light. The app drives it from the microphone and playback
 * levels; the demo has neither, so a synthetic level stands in — a voice-like
 * flutter while someone speaks, the app's own slow breath while it thinks.
 */
function VoiceGlow({ mode }: { mode: "rest" | "voice" | "thinking" }) {
  const blobs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const els = blobs.current.filter((b): b is HTMLDivElement => b !== null);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (mode === "rest" || reduced) {
      els.forEach((el) => {
        el.style.opacity = mode === "rest" ? "0.3" : "0.7";
        el.style.transform = "translateX(-50%)";
      });
      return;
    }
    let last = -1;
    let clock = 0;
    let frame = 0;
    const sway = BLOBS.map((b) => b.phase);
    const breath = BLOBS.map((b) => b.phase * 2);
    const tick = (now: number) => {
      const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      const voice =
        mode === "voice"
          ? 0.35 + 0.25 * Math.abs(Math.sin(clock * 5.3)) * (0.6 + 0.4 * Math.sin(clock * 1.7))
          : 0.24 + 0.08 * Math.sin(clock * 2.1);
      BLOBS.forEach((b, i) => {
        const el = els[i];
        if (!el) return;
        sway[i] += dt * b.speed * (1 + voice * 1.2);
        breath[i] += dt * b.speed * 1.3;
        const x = Math.sin(sway[i]) * (b.drift + voice * 5);
        const glow = 0.5 + 0.5 * Math.sin(breath[i]);
        el.style.opacity = Math.min(1, 0.5 + voice * 0.45 + glow * 0.08).toFixed(3);
        el.style.transform =
          `translateX(calc(-50% + ${x.toFixed(2)}%)) ` +
          `scale(${(1 + voice * 0.1).toFixed(3)}, ${(1 + voice * b.lift).toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <div
      aria-hidden
      data-testid="voice-glow"
      data-renderer="css"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[38vh] overflow-hidden"
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          ref={(el) => {
            blobs.current[i] = el;
          }}
          className={cn(
            "absolute bottom-0 origin-bottom will-change-[transform,opacity]",
            mode === "rest" && "transition-[opacity,transform] duration-700 ease-out",
          )}
          style={{
            left: `${b.x}%`,
            width: b.width,
            height: b.height,
            transform: "translateX(-50%)",
            opacity: 0.3,
            background: glowGradient(b.alpha),
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lane (VoiceStage.tsx TranscriptLine)
// ---------------------------------------------------------------------------

function Cursor() {
  return (
    <span
      className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 animate-pulse bg-current motion-reduce:animate-none"
      aria-hidden
    />
  );
}

function TranscriptLine({
  text,
  user,
  live = false,
  spoken = null,
}: {
  text: string;
  user: boolean;
  live?: boolean;
  spoken?: number | null;
}) {
  const reading = !user && spoken !== null;
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")} data-who={user ? "user" : "assistant"}>
      <span
        className={cn(
          "max-w-[80%] whitespace-pre-wrap text-reading",
          user ? "jarvis-user-bubble rounded-[20px] px-4 py-2.5 italic" : "text-foreground",
          live && !reading && (user ? "opacity-70" : "text-muted-foreground"),
        )}
      >
        {reading ? (
          <>
            <span data-testid="spoken-part">{text.slice(0, spoken ?? 0)}</span>
            <span className="text-muted-foreground transition-colors" data-testid="unspoken-part">
              {text.slice(spoken ?? 0)}
            </span>
          </>
        ) : (
          text
        )}
        {live && !reading && <Cursor />}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The turn's work (WorkTrace.tsx rail look + TraceTimeline.tsx)
// ---------------------------------------------------------------------------

const LINE_BUTTON =
  "group/line flex w-full min-w-0 items-center gap-2.5 rounded-md py-1.5 text-left trace-text text-muted-foreground transition-colors enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";
const RAIL_ROW_BUTTON =
  "group/trace flex w-full min-w-0 items-start gap-3 rounded-md py-1 text-left text-sm leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-default";

/** A service's real mark, the way `ToolChoiceIcon` draws a mono logo. */
function BrandMark({ logo }: { logo: string }) {
  return (
    <span
      className="tool-identity inline-flex shrink-0"
      style={{ "--tool-ink-light": "#181717", "--tool-ink-dark": "#f0f6fc" } as CSSProperties}
    >
      <span className="tool-choice-icon" data-plate="false" style={{ width: 16, height: 16 }} aria-hidden>
        <span className="tool-choice-mask" style={{ "--tool-logo": `url("${logo}")` } as CSSProperties} />
      </span>
    </span>
  );
}

function CallMark({ step }: { step: (typeof FRONT_TURN.steps)[number] }) {
  return step.logo === "github" ? (
    <BrandMark logo={githubLogo} />
  ) : (
    <Bot aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
  );
}

/** `CallLine` — a finished call, one quiet line in the text's own size. */
function CallLine({ step }: { step: (typeof FRONT_TURN.steps)[number] }) {
  return (
    <div className="min-w-0" data-trace-entry="call">
      <button type="button" tabIndex={-1} className={LINE_BUTTON}>
        <CallMark step={step} />
        <span className="min-w-0 truncate">{step.text}</span>
        <span className="min-w-0 flex-1 basis-0 truncate text-muted-foreground/70">{step.detail}</span>
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover/line:opacity-70 group-focus-visible/line:opacity-70"
        />
      </button>
    </div>
  );
}

/** A call still running — `TraceToolRow` in the rail look. */
function RunningCall({ step, seconds }: { step: (typeof FRONT_TURN.steps)[number]; seconds: number }) {
  return (
    <div data-trace-tool data-state="running">
      <div className="min-w-0 text-muted-foreground">
        <button type="button" tabIndex={-1} disabled className={RAIL_ROW_BUTTON}>
          <span aria-hidden className="trace-node trace-node-live">
            {step.logo === "github" ? <BrandMark logo={githubLogo} /> : <Bot className="h-3.5 w-3.5 shrink-0" />}
          </span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-foreground-secondary font-medium">
                <span className="trace-shimmer">{step.text}</span>
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground"> {step.detail}</span>
            </span>
          </span>
          <span className="shrink-0 text-xs leading-6 tabular-nums text-muted-foreground">{seconds}s</span>
        </button>
      </div>
    </div>
  );
}

/** A thought still streaming — `ReasoningTrace` in the rail look. */
function LiveThought({ text, seconds }: { text: string; seconds: number }) {
  return (
    <div className="min-w-0 text-muted-foreground">
      <button type="button" tabIndex={-1} disabled className={RAIL_ROW_BUTTON}>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="trace-shimmer">Thinking for {seconds}s</span>
        </span>
      </button>
      <div className="min-w-0 pb-1.5 pl-0">
        <div
          data-testid="reasoning-body"
          className="prose prose-sm max-h-60 max-w-none overflow-auto pb-1 text-sm leading-6 text-foreground-secondary dark:prose-invert [overflow-wrap:anywhere] prose-p:my-1 prose-p:text-foreground-secondary"
        >
          <p>
            {text}
            <Cursor />
          </p>
        </div>
      </div>
    </div>
  );
}

/** A finished thought — `Reasoning` in TraceTimeline.tsx. */
function Thought({ text }: { text: string }) {
  return (
    <div className="min-w-0 py-2" data-trace-entry="reasoning">
      <div className="prose max-w-none trace-text text-muted-foreground dark:prose-invert [overflow-wrap:anywhere] prose-p:my-1 prose-p:text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0 max-h-36 overflow-hidden">
        <p>{text}</p>
      </div>
    </div>
  );
}

/** The trace's state line: the pet at work while it runs, "Done" after. */
function StatusLine({ working, seconds }: { working: boolean; seconds: number }) {
  return (
    <div
      role="status"
      data-trace-status={working ? "working" : "done"}
      className="flex min-w-0 flex-wrap items-start gap-x-3 text-xs leading-6 text-muted-foreground py-1"
    >
      {working && (
        <span aria-hidden className="trace-node trace-node-pet" data-trace-pet="working">
          <PetMark size={32} state="working" />
        </span>
      )}
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
        <span>{working ? <span className="trace-shimmer">Working</span> : "Done"}</span>
        <span className="tabular-nums">{seconds}s</span>
      </span>
    </div>
  );
}

function useTyped(full: string, active: boolean, msPerChar: number): string {
  const [shown, setShown] = useState(active ? "" : full);
  useEffect(() => {
    if (!active) {
      setShown(full);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(full);
      return;
    }
    let i = 0;
    setShown("");
    const id = window.setInterval(() => {
      i += 1;
      setShown(full.slice(0, i));
      if (i >= full.length) window.clearInterval(id);
    }, msPerChar);
    return () => window.clearInterval(id);
  }, [full, active, msPerChar]);
  return shown;
}

/** The work of one voice turn: live while it runs, flat once it is done. */
function TurnWork({ frame }: { frame: FrontFrame }) {
  const { phase } = frame;
  const thinking = phase === "thinking";
  const thought = useTyped(FRONT_TURN.thought, thinking, 26);
  const done = phase === "speaking" || phase === "done";
  const items: ReactNode[] = [];

  if (thinking) items.push(<LiveThought key="t" text={thought} seconds={frame.seconds} />);
  else items.push(<Thought key="t" text={FRONT_TURN.thought} />);
  FRONT_TURN.steps.forEach((step, i) => {
    if (i < frame.settled) items.push(<CallLine key={step.text} step={step} />);
    else if (i === frame.settled && frame.running) items.push(<RunningCall key={step.text} step={step} seconds={1} />);
  });

  return (
    <div className="max-w-[85%] pl-1" data-testid="transcript-steps">
      <div className="min-w-0" data-testid="work-trace" data-look="rail" data-state={done ? "done" : "running"}>
        {items}
        <div className="trace-rail">
          <div className="trace-step">
            <StatusLine working={!done} seconds={done ? FRONT_TURN.seconds : frame.seconds} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

function hintFor(phase: FrontFrame["phase"]): string {
  switch (phase) {
    case "home":
      return "Say your wake word or press Start";
    case "thinking":
    case "working":
      return "Thinking…";
    case "speaking":
      return "Speaking…";
    default:
      return "Listening…";
  }
}

export function FrontPage({ frame }: { frame: FrontFrame }) {
  const { phase } = frame;
  const live = phase !== "home";
  const heard = useTyped(FRONT_TURN.said, phase === "listening", 45);
  const answering = phase === "speaking";
  const spoken = useTyped(FRONT_TURN.answer, answering, 38).length;
  const glow = phase === "home" ? "rest" : phase === "thinking" || phase === "working" ? "thinking" : "voice";

  const lane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = lane.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  if (phase === "home") {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden" data-testid="voice-stage" data-empty="true">
        <VoiceGlow mode={glow} />
        <div className="relative flex w-full max-w-[680px] flex-1 flex-col justify-center gap-7 px-6 pb-[14vh]">
          <Greeting subtitle="Say your wake word or press Start — the conversation shows up here." pet="idle" />
          <VoiceComposer hint={hintFor(phase)} live={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden" data-testid="voice-stage" data-empty="false">
      <VoiceGlow mode={glow} />
      <div ref={lane} className="relative min-h-0 w-full flex-1 overflow-hidden" data-testid="voice-transcript">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-6 pt-8">
          {phase === "listening" ? (
            <TranscriptLine text={heard} user live />
          ) : (
            <TranscriptLine text={FRONT_TURN.said} user />
          )}
          {phase !== "listening" && <TurnWork frame={frame} />}
          {(phase === "speaking" || phase === "done") && (
            <TranscriptLine text={FRONT_TURN.answer} user={false} spoken={phase === "speaking" ? spoken : null} />
          )}
          {phase === "speaking" && (
            <div className="pl-0.5" data-testid="voice-turn-indicator" aria-hidden>
              <PetMark size={48} state="talking" />
            </div>
          )}
        </div>
      </div>
      <div className="relative w-full max-w-[720px] px-6 pb-4 pt-2">
        <VoiceComposer hint={hintFor(phase)} live={live} />
      </div>
    </div>
  );
}
