/**
 * The front page: one conversation with the assistant — a clone of the app's
 * home view.
 *
 * Markup and class names are copied from the running app's own DOM:
 * views/HomeView.tsx and home/ChatStage.tsx (the stage), agentchat/AgentTimeline
 * in its lead look (the person's bubble, the assistant's bubbles with its pet
 * beside the newest turn), agentchat/WorkTrace.tsx (the folded work, and the
 * rail look while a turn still runs), agentchat/AgentComposer.tsx (the
 * composer), home/LeadActivityPanel.tsx (the Activity column) and
 * home/CallCard.tsx (the card of a running call — its level meter is a canvas
 * in the app and plain elements here, since the hero draws no canvas).
 *
 * The composer is real: what is typed into it is sent on Enter, and the
 * assistant answers from the scripts in demoData.ts.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { PROSE_LEAD } from "./classes";
import { ASSISTANT_NAME, type LeadReply, type LeadStep } from "./demoData";
import {
  ArrowUp,
  AudioLines,
  Bot,
  Captions,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock,
  Hand,
  Mic,
  PhoneOff,
  Plus,
  Settings2,
  ShieldAlert,
  Sun,
  X,
} from "./lucide";
import { AgentMark, Cursor, Rich, ToolMark, prefersReducedMotion, usePlayhead, useSeconds, useTyped } from "./Markup";
import { PetMark, cn, type PetState } from "./Pet";

export interface HomeTurn {
  id: number;
  stamp?: string;
  user: string;
  reply: LeadReply;
  /** Still to be played; a turn that is not live shows complete. */
  live: boolean;
  /** When a live turn began, on the clock of `now()` in Markup.tsx. */
  startedAt?: number;
}

export type CallState = "listening" | "thinking" | "speaking";

// ---------------------------------------------------------------------------
// The turn's work while it runs (WorkTrace.tsx, rail look)
// ---------------------------------------------------------------------------

const LINE_BUTTON =
  "group/line flex w-full min-w-0 items-center gap-2.5 rounded-md py-1.5 text-left trace-text text-muted-foreground transition-colors enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";
const RAIL_ROW_BUTTON =
  "group/trace flex w-full min-w-0 items-start gap-3 rounded-md py-1 text-left text-sm leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-default";

function StepMark({ step, small = false }: { step: LeadStep; small?: boolean }) {
  if (step.logo) return <ToolMark logo={step.logo} size={small ? 14 : 16} />;
  return <Bot aria-hidden className={small ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} strokeWidth={1.75} />;
}

/** `CallLine` — a finished call, one quiet line in the text's own size. */
function CallLine({ step }: { step: LeadStep }) {
  return (
    <div className="min-w-0" data-trace-entry="call">
      <button type="button" tabIndex={-1} className={LINE_BUTTON}>
        <StepMark step={step} />
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
function RunningCall({ step }: { step: LeadStep }) {
  return (
    <div data-trace-tool data-state="running">
      <div className="min-w-0 text-muted-foreground">
        <button type="button" tabIndex={-1} disabled className={RAIL_ROW_BUTTON}>
          <span aria-hidden className="trace-node trace-node-live">
            <StepMark step={step} small />
          </span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-foreground-secondary font-medium">
                <span className="trace-shimmer">{step.text}</span>
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground"> {step.detail}</span>
            </span>
          </span>
          <span className="shrink-0 text-xs leading-6 tabular-nums text-muted-foreground">1s</span>
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

// ---------------------------------------------------------------------------
// One turn (AgentTimeline.tsx, lead look)
// ---------------------------------------------------------------------------

function Bubble({ text }: { text: string }) {
  return (
    <div data-testid="lead-bubble" className="lead-bubble border border-border bg-card shadow-rim">
      <div className={PROSE_LEAD}>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p>
            <Rich text={text} />
          </p>
        </div>
      </div>
    </div>
  );
}

function LeadTurn({
  turn,
  newest,
  onDone,
  onPhase,
}: {
  turn: HomeTurn;
  newest: boolean;
  onDone: (id: number) => void;
  onPhase: (phase: CallState | null) => void;
}) {
  const { reply } = turn;
  const stepCount = reply.steps.length;
  const bubbleCount = reply.bubbles.length;
  // One frame of thought, one per call, one per bubble; then the turn is done.
  const durations = useRef([
    Math.min(3600, 900 + reply.thought.length * 22),
    ...reply.steps.map(() => 1250),
    ...reply.bubbles.map((bubble) => 700 + bubble.length * 14),
  ]).current;
  const step = usePlayhead(durations, turn.live, () => onDone(turn.id), turn.startedAt);
  const done = !turn.live || step >= durations.length;
  const thinking = !done && step === 0;
  const settled = done ? stepCount : Math.max(0, Math.min(stepCount, step - 1));
  const running = !done && step >= 1 && step <= stepCount;
  const shown = done ? bubbleCount : Math.max(0, Math.min(bubbleCount, step - stepCount));
  const thought = useTyped(reply.thought, thinking, 20);
  const seconds = useSeconds(turn.live && !done, 1);
  const pet: PetState = done ? "idle" : shown > 0 ? "talking" : "working";

  const phase: CallState | null = done ? null : shown > 0 ? "speaking" : "thinking";
  useEffect(() => {
    if (turn.live) onPhase(phase);
    // The parent's setter is stable; the phase is the only thing to follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, turn.live]);

  return (
    <div className="lead-turn" data-testid="agent-turn" data-look="lead" data-status={done ? "done" : "running"}>
      <div className="lead-face-lane" aria-hidden="true">
        {newest && (
          <span className="lead-face" data-testid="lead-face" data-pet={pet}>
            <PetMark size={32} state={pet} />
          </span>
        )}
      </div>
      <div className="lead-turn-body">
        <div className="min-w-0" data-testid="work-trace" data-look="rail" data-state={done ? "done" : "running"}>
          {done ? (
            <div className="min-w-0" data-testid="conversation-work-fold" data-open="false">
              <button
                type="button"
                aria-expanded="false"
                className="group/fold mb-1 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={-1}
              >
                <ChevronRight
                  className="h-3 w-3 shrink-0 opacity-70 transition-transform group-hover/fold:opacity-100"
                  aria-hidden
                />
                <span className="truncate">Thought for {reply.seconds}s</span>
              </button>
            </div>
          ) : (
            <>
              {thinking ? <LiveThought text={thought} seconds={seconds} /> : <Thought text={reply.thought} />}
              {reply.steps.map((entry, i) =>
                i < settled ? (
                  <CallLine key={entry.text} step={entry} />
                ) : i === settled && running ? (
                  <RunningCall key={entry.text} step={entry} />
                ) : null,
              )}
            </>
          )}
          {shown > 0 && (
            <div className="min-w-0" data-trace-reply="true">
              <div data-testid="agent-text" className="lead-bubbles">
                {reply.bubbles.slice(0, shown).map((bubble) => (
                  <Bubble key={bubble} text={bubble} />
                ))}
              </div>
            </div>
          )}
          <div className="trace-rail">
            <div className="trace-step">
              <div
                role="status"
                data-trace-status={done ? "done" : "working"}
                className="flex min-w-0 flex-wrap items-start gap-x-3 text-xs leading-6 text-muted-foreground trace-meta"
              >
                <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                  {done ? (
                    <>
                      <span className="tabular-nums">{reply.seconds}s</span>
                      <span aria-hidden="true" className="text-muted-foreground/50">
                        ·
                      </span>
                      <span className="tabular-nums">{reply.tokens}</span>
                    </>
                  ) : (
                    <>
                      <span className="trace-shimmer">Working</span>
                      <span className="tabular-nums">{seconds}s</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The composer (AgentComposer.tsx)
// ---------------------------------------------------------------------------

const PICKER =
  "flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-border-strong h-8 w-auto max-w-[240px] gap-1.5 rounded-lg border-transparent bg-transparent px-2 py-0 text-sm font-medium text-foreground/80 shadow-none hover:border-transparent hover:bg-secondary hover:text-foreground focus-visible:ring-1 aria-expanded:bg-secondary aria-expanded:text-foreground aria-expanded:ring-0 [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5";
const ROUND_ACTION = "ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors";

/**
 * The app's chip field: an editable element, not a textarea. The demo keeps
 * it uncontrolled so the caret stays where the person typing put it, and
 * writes into it only when the text was changed from outside (the autoplay's
 * typing, or the clear after a send).
 */
export function ChipField({
  value,
  placeholder,
  className,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  className: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
}) {
  const field = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (el && (el.textContent ?? "") !== value) el.textContent = value;
  }, [value]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div
      ref={field}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      data-testid="composer-chip-field"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={-1}
      className={className}
      onInput={(event) => {
        const el = event.currentTarget;
        const text = el.textContent ?? "";
        // An emptied field keeps a stray <br>; without it the placeholder shows.
        if (text === "" && el.childNodes.length > 0) el.textContent = "";
        onChange(text);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function Composer({
  draft,
  busy,
  onDraft,
  onSend,
  onCall,
}: {
  draft: string;
  busy: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
  onCall: () => void;
}) {
  const canSend = draft.trim().length > 0 && !busy;
  return (
    <div
      data-testid="agent-composer"
      className="relative flex flex-col transition-[border-color,box-shadow] gap-2 rounded-3xl border border-border bg-card px-3 pb-3 pt-3.5 shadow-rim focus-within:border-border-strong"
    >
      <div className="relative text-xs" data-testid="chat-commands" />
      <ChipField
        value={draft}
        placeholder="Ask anything…"
        className="composer-chip-field flex-1 bg-transparent py-1.5 text-foreground outline-none max-h-[50vh] scrollbar-jarvis min-h-[64px] px-2 text-base"
        onChange={onDraft}
        onSubmit={() => canSend && onSend()}
      />
      <div className="flex min-w-0 items-center gap-0.5" data-testid="composer-row">
        <button
          type="button"
          data-testid="composer-add"
          aria-expanded="false"
          className="inline-flex h-8 items-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 w-8 justify-center rounded-full"
          tabIndex={-1}
        >
          <Plus className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <span className="flex min-w-0 items-center" data-testid="composer-brain">
          <span className="inline-flex items-center min-w-0">
            <button type="button" role="combobox" aria-expanded="false" data-testid="composer-model" className={PICKER} tabIndex={-1}>
              <span className="relative inline-flex shrink-0">
                <AgentMark mark="claude" />
                <span
                  data-health="ok"
                  className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-popover bg-muted-foreground"
                />
              </span>
              <span className="min-w-0 flex-1 truncate">Claude Sonnet 5.5</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
            </button>
          </span>
          <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px shrink-0 bg-border-strong sm:block" />
          <span className="inline-flex shrink-0">
            <button type="button" role="combobox" aria-expanded="false" data-testid="composer-effort" className={PICKER} tabIndex={-1}>
              <span className="min-w-0 flex-1 truncate">High</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
            </button>
          </span>
        </span>
        <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px shrink-0 bg-border-strong sm:block" />
        <span className="inline-flex min-w-0 shrink">
          <button
            type="button"
            role="combobox"
            aria-expanded="false"
            data-testid="composer-permission"
            className="flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-border-strong h-8 w-auto gap-1.5 rounded-lg border-transparent bg-transparent px-2 py-0 text-sm font-medium text-foreground/80 shadow-none hover:border-transparent hover:bg-secondary hover:text-foreground focus-visible:ring-1 aria-expanded:bg-secondary aria-expanded:text-foreground aria-expanded:ring-0 [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5 max-w-[200px] max-md:[&>span.truncate]:sr-only"
            tabIndex={-1}
          >
            <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Ask before changes</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          </button>
        </span>
        <span className="min-w-2 flex-1" />
        <button
          type="button"
          data-testid="dictation-button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong rounded-full"
          tabIndex={-1}
        >
          <Mic className="h-4 w-4" aria-hidden />
        </button>
        {draft.trim().length > 0 ? (
          <button
            type="button"
            data-testid="composer-send"
            disabled={!canSend}
            onClick={onSend}
            className={cn(
              ROUND_ACTION,
              canSend ? "bg-accent text-accent-foreground hover:bg-accent/85" : "bg-secondary text-muted-foreground",
            )}
            tabIndex={-1}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            data-testid="composer-voice-mode"
            onClick={onCall}
            className={cn(ROUND_ACTION, "bg-accent text-accent-foreground hover:bg-accent/85 disabled:opacity-60")}
            tabIndex={-1}
          >
            <AudioLines className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card of a running call (CallCard.tsx)
// ---------------------------------------------------------------------------

const BARS = 36;

/** The call's level meter: bars that follow a voice. The app paints them on a canvas. */
function CallWave({ state }: { state: CallState }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const els = bars.current;
    const still = prefersReducedMotion();
    const levels = new Array<number>(BARS).fill(0);
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const voiced = state === "thinking" ? 0 : 0.3 + 0.3 * Math.abs(Math.sin(now / 140)) * (0.5 + 0.5 * Math.sin(now / 410));
      levels.shift();
      levels.push(still ? 0.15 : Math.max(0, Math.min(1, voiced)));
      levels.forEach((value, i) => {
        const el = els[i];
        if (el) el.style.height = `${Math.max(2, value * 24)}px`;
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [state]);
  return (
    <div aria-hidden className="flex h-6 w-full items-center text-foreground">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="flex flex-1 items-center justify-center">
          <span
            ref={(el) => {
              bars.current[i] = el;
            }}
            className="bg-current"
            style={{ width: "40%", minWidth: 1.5, height: 2, opacity: 0.35 + 0.65 * (i / BARS) } as CSSProperties}
          />
        </span>
      ))}
    </div>
  );
}

function RoundButton({
  testId,
  danger,
  onClick,
  children,
}: {
  testId: string;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      tabIndex={-1}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        danger
          ? "bg-destructive text-destructive-foreground hover:bg-destructive/85"
          : "bg-secondary text-foreground hover:bg-secondary/70",
      )}
    >
      {children}
    </button>
  );
}

const CALL_WORD: Record<CallState, string> = { listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

function CallCard({ state, onHangUp }: { state: CallState; onHangUp: () => void }) {
  return (
    <div
      data-testid="call-card"
      data-state={state}
      role="region"
      className="pointer-events-auto absolute right-3 top-3 z-20 w-[244px] rounded-2xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground-strong">{ASSISTANT_NAME}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{CALL_WORD[state]}</span>
      </div>
      <div className="mt-2">
        <CallWave state={state} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <RoundButton testId="call-settings">
          <Settings2 className="h-4 w-4" aria-hidden />
        </RoundButton>
        <RoundButton testId="call-transcript-toggle">
          <Captions className="h-4 w-4" aria-hidden />
        </RoundButton>
        <RoundButton testId="call-mute">
          <Mic className="h-4 w-4" aria-hidden />
        </RoundButton>
        <RoundButton testId="call-hang-up" danger onClick={onHangUp}>
          <PhoneOff className="h-4 w-4" aria-hidden />
        </RoundButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Activity column (LeadActivityPanel.tsx)
// ---------------------------------------------------------------------------

export interface ActivityRow {
  label: string;
  onOpen: () => void;
}

function ActivitySection({ icon, title, rows }: { icon: ReactNode; title: string; rows: ActivityRow[] }) {
  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="pl-5 text-xs text-foreground-faint">Nothing right now</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.label}>
              <button
                type="button"
                tabIndex={-1}
                onClick={row.onOpen}
                className="w-full truncate rounded-md px-2 py-1 pl-5 text-left text-sm text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityPanel({ running, done }: { running: ActivityRow[]; done: ActivityRow[] }) {
  return (
    <aside
      data-testid="lead-activity"
      className="flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border px-3 py-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground-strong">Activity</h2>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <ActivitySection icon={<Hand className="h-3.5 w-3.5" aria-hidden />} title="Waiting on you" rows={[]} />
      <ActivitySection icon={<CircleDot className="h-3.5 w-3.5" aria-hidden />} title="Running" rows={running} />
      <ActivitySection icon={<CircleCheck className="h-3.5 w-3.5" aria-hidden />} title="Done" rows={done} />
      <section className="space-y-1.5" data-testid="lead-brief">
        <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sun className="h-3.5 w-3.5" aria-hidden />
          Morning brief
        </h3>
        <div className="flex items-center gap-2 pl-5">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" data-testid="lead-brief-toggle" tabIndex={-1} />
            Every day at
          </label>
          <span className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-sm opacity-50">08:00</span>
        </div>
        <p className="pl-5 text-xs text-foreground-faint">
          A short summary of your day in this conversation. Runs only on a subscription or local model.
        </p>
      </section>
      <p className="mt-auto flex items-center gap-2 text-xs text-foreground-faint">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Ask in the conversation to schedule anything else.
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function Conversation({
  turns,
  draft,
  call,
  running,
  done,
  onDraft,
  onSend,
  onTurnDone,
  onCall,
  onHangUp,
  onPhase,
}: {
  turns: HomeTurn[];
  draft: string;
  /** The running call's state; null when no call runs. */
  call: CallState | null;
  running: ActivityRow[];
  done: ActivityRow[];
  onDraft: (text: string) => void;
  onSend: () => void;
  onTurnDone: (id: number) => void;
  onCall: () => void;
  onHangUp: () => void;
  onPhase: (phase: CallState | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  // Follow the newest line the way the app does while a turn streams.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const follow = () => {
      el.scrollTop = el.scrollHeight;
    };
    follow();
    const observer = new MutationObserver(follow);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  const busy = turns.some((turn) => turn.live);

  return (
    <div className="flex h-full min-h-0" data-testid="home-view">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col" data-testid="assistant-chat">
          <div className="flex h-full min-h-0 w-full flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col items-center" data-testid="chat-stage" data-empty="false">
                <div className="relative overflow-hidden min-h-0 w-full flex-1">
                  <div
                    ref={viewport}
                    data-radix-scroll-area-viewport=""
                    className="h-full w-full rounded-[inherit] [&>div]:!block"
                    style={{ overflow: "hidden scroll", overflowAnchor: "none", scrollbarWidth: "none" }}
                  >
                    <div style={{ minWidth: "100%", display: "table" }}>
                      <div className="relative mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-6 pt-8">
                        {turns.map((turn, i) => (
                          <TurnPair
                            key={turn.id}
                            turn={turn}
                            newest={i === turns.length - 1}
                            onDone={onTurnDone}
                            onPhase={onPhase}
                          />
                        ))}
                        <div aria-hidden="true" data-testid="chat-bottom-spacer" className="shrink-0" style={{ minHeight: 0 }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="relative w-full max-w-[720px] px-6 pb-5 pt-2">
                  <Composer draft={draft} busy={busy} onDraft={onDraft} onSend={onSend} onCall={onCall} />
                </div>
              </div>
            </div>
          </div>
          {call && <CallCard state={call} onHangUp={onHangUp} />}
        </div>
      </div>
      <div className="hidden lg:flex">
        <ActivityPanel running={running} done={done} />
      </div>
    </div>
  );
}

function TurnPair({
  turn,
  newest,
  onDone,
  onPhase,
}: {
  turn: HomeTurn;
  newest: boolean;
  onDone: (id: number) => void;
  onPhase: (phase: CallState | null) => void;
}) {
  return (
    <>
      {turn.stamp && (
        <div className="flex justify-center pt-2" data-testid="agent-time-stamp" aria-hidden="true">
          <span className="text-xs font-medium text-muted-foreground">{turn.stamp}</span>
        </div>
      )}
      <div className="flex justify-end" data-testid="agent-message-user">
        <div className="text-[15px] leading-[23px] jarvis-user-bubble lead-bubble-own max-w-[80%] px-4 py-2">
          <span data-testid="tool-choice-chips" data-editable="false" className="whitespace-pre-wrap">
            {turn.user}
          </span>
        </div>
      </div>
      <LeadTurn turn={turn} newest={newest} onDone={onDone} onPhase={onPhase} />
    </>
  );
}
