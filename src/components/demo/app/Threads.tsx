/**
 * The Agentic IDE in its thread layout — a clone of the app's thread view.
 *
 * Markup and class names are copied from the running app's own DOM and its
 * components: agentic/threads/ThreadTree.tsx with ThreadStartIcons.tsx,
 * ThreadPullRequests.tsx and ThreadTreeSubagents.tsx (the sidebar: start rows,
 * projects, day lines, the pull request and worktree marks), ThreadView.tsx and
 * ThreadHeader.tsx (the frame and its title row), ThreadTimeline.tsx (the
 * person's message, the grey lines of work with one white sentence between
 * them, the working line with its pet, clock and tokens, the "Worked for" fold,
 * the answer and the changed-files card), ThreadSubagents.tsx (the one line the
 * sub-agents run under, and the dock above the composer), ThreadComposer.tsx
 * with ThreadPickers.tsx, and ThreadBranchBar.tsx with ThreadMachineChip,
 * ThreadFolderChip and ThreadPlanUsage (the strip under the composer: machine,
 * folder, branch and how much of the plan is spent).
 *
 * The composer is real: what is typed into it starts a turn, and the thread
 * answers from demoData.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { PROSE_THREAD } from "./classes";
import { SidebarFrame } from "./AppShell";
import {
  ASSISTANT_NAME,
  OTHER_PROJECTS,
  PLAN_USAGE,
  PROJECT,
  type CliMark,
  type DemoThread,
  type FileChange,
  type SubAgent,
  type ThreadStep,
  type ThreadTurn,
} from "./demoData";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Diff,
  Ellipsis,
  FileDiff,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  Laptop,
  LoaderCircle,
  Maximize2,
  Mic,
  Plus,
  Square,
  SquarePen,
  X,
} from "./lucide";
import { AgentMark, Blocks, PR_TONE, PullRequestIcon, formatTokens, traceDuration, usePlayhead } from "./Markup";
import { PetMark, cn } from "./Pet";

export interface LiveTurn extends ThreadTurn {
  id: number;
  /** Still to be played; a turn that is not live shows complete. */
  live: boolean;
  /** When a live turn began, on the clock of `now()` in Markup.tsx. */
  startedAt?: number;
}

export interface LiveThread extends Omit<DemoThread, "turns"> {
  turns: LiveTurn[];
}

const PROJECT_PATH = `~/code/${PROJECT}`;

// ---------------------------------------------------------------------------
// What a turn shows at each moment of its run
// ---------------------------------------------------------------------------

interface TurnMoment {
  /** Steps on screen, and the one that carries the live shine (-1: none). */
  steps: number;
  live: number;
  /** Whether the sub-agents were started, and how many have finished. */
  subs: boolean;
  subsDone: number;
  /** How far the run is, 0 to 1: the working line's tokens follow it. */
  progress: number;
  done: boolean;
}

type Beat = { kind: "idle" | "step" | "sub"; ms: number };

const STEP_MS: Record<ThreadStep["kind"], number> = {
  line: 1600,
  said: 1300,
  agents: 1300,
};

/**
 * A turn's run as beats: a pause while the agent gets ready, then each step,
 * and after the sub-agents' line one beat per sub-agent finishing.
 */
function beatsOf(turn: ThreadTurn): Beat[] {
  const beats: Beat[] = [{ kind: "idle", ms: 900 }];
  for (const step of turn.steps) {
    beats.push({ kind: "step", ms: STEP_MS[step.kind] });
    if (step.kind === "agents") (turn.subagents ?? []).forEach(() => beats.push({ kind: "sub", ms: 1250 }));
  }
  return beats;
}

function momentAt(turn: ThreadTurn, beats: Beat[], step: number): TurnMoment {
  const total = turn.subagents?.length ?? 0;
  const agents = turn.steps.some((entry) => entry.kind === "agents");
  if (step >= beats.length) {
    return {
      steps: turn.steps.length,
      live: -1,
      subs: agents && total > 0,
      subsDone: total,
      progress: 1,
      done: true,
    };
  }
  const moment: TurnMoment = {
    steps: 0,
    live: -1,
    subs: false,
    subsDone: 0,
    progress: (step + 1) / (beats.length + 1),
    done: false,
  };
  for (let i = 0; i <= step; i++) {
    const beat = beats[i];
    if (beat.kind === "step") {
      const kind = turn.steps[moment.steps].kind;
      moment.steps += 1;
      moment.live = kind === "said" ? -1 : moment.steps - 1;
      if (kind === "agents") moment.subs = true;
    } else if (beat.kind === "sub") moment.subsDone += 1;
  }
  return moment;
}

/** The running clock of a turn, in the app's own format ("4.2s", "1m 02s"). */
function useElapsed(running: boolean, fromMs: number): string {
  const [ms, setMs] = useState(fromMs);
  useEffect(() => {
    if (!running) return;
    const start = performance.now() - fromMs;
    const id = window.setInterval(() => setMs(performance.now() - start), 1000);
    return () => window.clearInterval(id);
  }, [running, fromMs]);
  return traceDuration(ms);
}

// ---------------------------------------------------------------------------
// The start rows' own marks (ThreadStartIcons.tsx)
// ---------------------------------------------------------------------------

function StartIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

function NewThreadIcon({ className }: { className?: string }) {
  return (
    <StartIcon className={className}>
      <path d="M6 3.75h8A3 3 0 0 1 17 6.75v4.5a3 3 0 0 1-3 3H9.25L6 16.75v-2.5a3 3 0 0 1-3-3v-4.5a3 3 0 0 1 3-3z" />
      <path d="M10 6.9v4.7M7.65 9.25h4.7" />
    </StartIcon>
  );
}

function SearchThreadsIcon({ className }: { className?: string }) {
  return (
    <StartIcon className={className}>
      <circle cx="8.75" cy="8.75" r="5.5" />
      <path d="M12.75 12.75 16.75 16.75" />
    </StartIcon>
  );
}

function TeamThreadIcon({ className }: { className?: string }) {
  return (
    <StartIcon className={className}>
      <path d="M5 7.25h5a2.5 2.5 0 0 1 2.5 2.5v2.25a2.5 2.5 0 0 1-2.5 2.5H7.5L5 16.5v-2A2.5 2.5 0 0 1 2.5 12V9.75A2.5 2.5 0 0 1 5 7.25z" />
      <path d="M7.75 5.25v-.25A2.25 2.25 0 0 1 10 2.75h5.25A2.25 2.25 0 0 1 17.5 5v2.75a2.25 2.25 0 0 1-2.25 2.25V12l-1.75-1.6" />
    </StartIcon>
  );
}

function LiveVoiceIcon({ className }: { className?: string }) {
  return (
    <StartIcon className={className}>
      <path d="M3.5 8.75v2.5M6.75 6v8M10 3.5v13M13.25 7v6M16.5 8.5v3" />
    </StartIcon>
  );
}

// ---------------------------------------------------------------------------
// Sub-agents (ThreadSubagents.tsx)
// ---------------------------------------------------------------------------

function SubagentMark({ done, className }: { done: boolean; className?: string }) {
  return done ? (
    <Check className={cn("h-3.5 w-3.5 shrink-0 text-success", className)} aria-hidden />
  ) : (
    <LoaderCircle className={cn("h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground", className)} aria-hidden />
  );
}

/** "3 sub-agents · 1 working · 2 done": what the dock counts. */
function subagentSummary(total: number, done: number): string {
  const parts = [`${total} ${total === 1 ? "sub-agent" : "sub-agents"}`];
  if (total - done > 0) parts.push(`${total - done} working`);
  if (done > 0 && done < total) parts.push(`${done} done`);
  return parts.join(" · ");
}

function SubagentProgress({ total, done, className }: { total: number; done: number; className: string }) {
  const running = total - done;
  return (
    <span
      aria-hidden="true"
      data-testid="thread-subagent-progress"
      className={cn("flex h-1 overflow-hidden rounded-full bg-secondary", className)}
    >
      {done > 0 && <span data-part="done" className="bg-success" style={{ width: `${(done / total) * 100}%` }} />}
      {running > 0 && (
        <span
          data-part="running"
          className="bg-foreground/35 animate-pulse"
          style={{ width: `${(running / total) * 100}%` }}
        />
      )}
    </span>
  );
}

/** `SubagentLine`: one sub-agent on one line. */
function SubagentLine({ sub, done, className }: { sub: SubAgent; done: boolean; className?: string }) {
  return (
    <button
      type="button"
      data-testid="thread-subagent-row"
      data-status={done ? "done" : "running"}
      className={cn(
        "group/line flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]",
        className,
        "transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      tabIndex={-1}
    >
      <SubagentMark done={done} />
      <span className="min-w-0 max-w-[45%] shrink-0 truncate font-medium text-foreground">{sub.title}</span>
      <span className="hidden shrink-0 rounded border border-border px-1 text-[10.5px] leading-4 text-muted-foreground sm:inline">
        {sub.kind}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-muted-foreground", !done && "live-tool-shine")}>
        {done ? sub.note : sub.doing}
      </span>
      {done && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">
          <span className="shrink-0 tabular-nums">{sub.stats}</span>
        </span>
      )}
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover/line:text-foreground"
        aria-hidden
      />
    </button>
  );
}

/** `SubagentRun`: the sub-agents as one quiet line of the thread, opening to a card of rows. */
function SubagentRun({ subs, done }: { subs: SubAgent[]; done: number }) {
  const [expanded, setExpanded] = useState(false);
  const busy = done < subs.length;
  const label = `${busy ? "Running" : "Ran"} ${subs.length} ${subs.length === 1 ? "sub-agent" : "sub-agents"}`;
  return (
    <div className="min-w-0" data-testid="thread-subagent-run" data-busy={busy || undefined}>
      <button
        type="button"
        aria-expanded={expanded}
        data-testid="thread-subagent-run-toggle"
        className="group/row relative block w-full min-w-0 rounded-md py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        tabIndex={-1}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex min-h-6 min-w-0 items-center gap-2.5 text-base leading-6">
          <span
            data-testid="thread-subagent-run-label"
            className={cn(
              "min-w-0 truncate text-muted-foreground transition-colors",
              busy ? "live-tool-shine" : "group-hover/row:text-foreground",
            )}
          >
            {label}
          </span>
          <span aria-hidden className="-ml-1.5 flex h-4 w-4 shrink-0 items-center justify-center">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground opacity-60 transition duration-200 group-hover/row:opacity-100",
                expanded && "rotate-90 opacity-70",
              )}
            />
          </span>
        </span>
      </button>
      {expanded && (
        <div
          role="region"
          data-testid="thread-subagent-run-rows"
          className="mb-2 mt-0.5 divide-y divide-border overflow-hidden rounded-xl border border-border"
        >
          {subs.map((sub, i) => (
            <SubagentLine key={sub.title} sub={sub} done={i < done} className="min-h-10 rounded-none px-3.5 py-2" />
          ))}
        </div>
      )}
    </div>
  );
}

/** `SubagentDock`: the tray above the composer that keeps the sub-agents in reach. */
function Dock({ subs, done }: { subs: SubAgent[]; done: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="thread-subagent-dock"
      className="relative mx-auto -mb-4 w-[calc(100%-2.75rem)] overflow-hidden rounded-t-2xl border border-b-0 border-border bg-sidebar pb-4"
    >
      {open && (
        <nav
          data-testid="thread-subagent-dock-list"
          className="max-h-[40vh] overflow-y-auto border-b border-border/70 px-1 pb-1 pt-1.5 scrollbar-jarvis"
        >
          {subs.map((sub, i) => (
            <SubagentLine key={sub.title} sub={sub} done={i < done} />
          ))}
        </nav>
      )}
      <button
        type="button"
        aria-expanded={open}
        data-testid="thread-subagent-dock-toggle"
        title={open ? "Hide the sub-agents" : "Show the sub-agents"}
        className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        tabIndex={-1}
        onClick={() => setOpen(!open)}
      >
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary" data-testid="thread-subagent-count">
          {subagentSummary(subs.length, done)}
        </span>
        <SubagentProgress total={subs.length} done={done} className="w-20 shrink-0" />
        <ChevronUp
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sidebar (ThreadTree.tsx)
// ---------------------------------------------------------------------------

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ROW = "flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-base";
const ACTION_ROW = `group/action flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-base text-foreground transition-colors hover:bg-secondary ${FOCUS_RING}`;
const ACTION_ICON =
  "h-[18px] w-[18px] shrink-0 text-foreground-secondary transition-colors group-hover/action:text-foreground";
const HOVER_ACTION = `flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] hover:bg-background/70 hover:text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${FOCUS_RING}`;
const ROW_HOVER_SHOWN =
  "w-0 opacity-0 group-hover/thread:w-auto group-hover/thread:pr-1 group-hover/thread:opacity-100 group-focus-within/thread:w-auto group-focus-within/thread:pr-1 group-focus-within/thread:opacity-100 [@media(hover:none)]:w-auto [@media(hover:none)]:pr-1 [@media(hover:none)]:opacity-100";
const ROW_HOVER_HIDDEN = "group-hover/thread:hidden group-focus-within/thread:hidden [@media(hover:none)]:hidden";
const SUB_ROW =
  "group/sub relative flex min-h-7 min-w-0 items-center gap-2 rounded-md py-0.5 pr-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground-secondary";

function threadWorking(thread: LiveThread): boolean {
  return Boolean(thread.running) || thread.turns.some((turn) => turn.live);
}

/** `DayLine`: where a project's threads cross into an earlier day. */
function DayLine({ label }: { label: string }) {
  return (
    <div
      role="separator"
      aria-label={label}
      data-testid="thread-day-line"
      className="flex h-6 select-none items-center gap-2 pr-2 pt-1 pl-[34px]"
    >
      <span className="shrink-0 text-micro text-muted-foreground/70">{label}</span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border/70" />
    </div>
  );
}

function ProjectRow({ name, open, onNew }: { name: string; open: boolean; onNew?: () => void }) {
  return (
    <div className="group relative flex min-h-8 items-center rounded-md pr-1 transition-colors hover:bg-muted">
      <button
        type="button"
        aria-expanded={open}
        title={`~/code/${name}`}
        className={cn(ROW, "flex-1 text-foreground-secondary group-hover:text-foreground", FOCUS_RING)}
        tabIndex={-1}
      >
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
      <button type="button" title="New thread" className={HOVER_ACTION} tabIndex={-1} onClick={onNew}>
        <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <button type="button" title="New team thread" className={HOVER_ACTION} tabIndex={-1}>
        <TeamThreadIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ThreadTree({
  threads,
  selected,
  subsDone,
  onOpen,
  onNew,
}: {
  threads: LiveThread[];
  selected: string | null;
  /** How many sub-agents of the open thread have finished; null while it has started none. */
  subsDone: number | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <SidebarFrame
      header={
        <>
          <span data-testid="sidebar-style-avatar" data-variant="logo" className="relative shrink-0 h-5 w-5">
            <PetMark size={20} />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="truncate font-medium text-foreground-strong">{ASSISTANT_NAME}</span>
            <span data-testid="sidebar-voice-dot" role="img" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          </div>
        </>
      }
    >
      <div data-testid="ide-thread-tree" className="flex-1 px-2 pb-3 pt-2">
        <div role="group" aria-label="Threads" className="flex flex-col gap-px">
          <button
            type="button"
            data-testid="thread-tree-new-thread"
            className={ACTION_ROW}
            tabIndex={-1}
            onClick={onNew}
          >
            <NewThreadIcon className={ACTION_ICON} />
            <span className="min-w-0 flex-1 truncate">New thread</span>
          </button>
          <button
            type="button"
            data-testid="thread-tree-search"
            aria-haspopup="dialog"
            className={ACTION_ROW}
            tabIndex={-1}
          >
            <SearchThreadsIcon className={ACTION_ICON} />
            <span className="min-w-0 flex-1 truncate">Search</span>
          </button>
          <button type="button" data-testid="thread-tree-new-team" className={ACTION_ROW} tabIndex={-1}>
            <TeamThreadIcon className={ACTION_ICON} />
            <span className="min-w-0 flex-1 truncate">New team thread</span>
          </button>
          <button type="button" data-testid="thread-tree-voice" className={ACTION_ROW} tabIndex={-1}>
            <LiveVoiceIcon className={ACTION_ICON} />
            <span className="min-w-0 flex-1 truncate">Dodaios Live</span>
          </button>
        </div>
        <div className="flex min-h-8 items-end justify-between gap-2 pb-1 pl-2 pr-1 pt-4 text-sm text-muted-foreground">
          <span className="truncate">Projects</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Connect project folder"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                FOCUS_RING,
              )}
              tabIndex={-1}
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mb-px" data-testid={`thread-project-${PROJECT}`}>
          <ProjectRow name={PROJECT} open onNew={onNew} />
          <div className="mb-2 flex flex-col gap-px">
            {threads.map((thread, i) => {
              const open = thread.id === selected;
              const subs = open && subsDone !== null ? thread.turns.flatMap((turn) => turn.subagents ?? []) : [];
              const day = thread.day && thread.day !== threads[i - 1]?.day ? thread.day : null;
              return (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  open={open}
                  day={day}
                  working={threadWorking(thread)}
                  subs={subs}
                  subsDone={subsDone ?? 0}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        </div>
        {OTHER_PROJECTS.map((name) => (
          <div className="mb-px" key={name} data-testid={`thread-project-${name}`}>
            <ProjectRow name={name} open={false} />
          </div>
        ))}
      </div>
    </SidebarFrame>
  );
}

/** `ThreadPullRequests`: GitHub's symbol in GitHub's colour, and how many there are. */
function PullRequestMark({ pr }: { pr: NonNullable<DemoThread["pr"]> }) {
  return (
    <span
      role="img"
      className={cn("flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums", PR_TONE[pr.state])}
    >
      <PullRequestIcon state={pr.state} size={16} className="shrink-0" />
      {pr.count && pr.count > 1 && <span>{pr.count}</span>}
    </span>
  );
}

function ThreadRow({
  thread,
  open,
  day,
  working,
  subs,
  subsDone,
  onOpen,
}: {
  thread: LiveThread;
  open: boolean;
  day: string | null;
  working: boolean;
  subs: SubAgent[];
  subsDone: number;
  onOpen: (id: string) => void;
}) {
  const [folded, setFolded] = useState(false);
  const subOpen = subs.length > 0 && !folded;
  return (
    <>
      {day && <DayLine label={day} />}
      <div
        data-testid={`thread-row-${thread.id}`}
        className={cn(
          "group/thread relative flex min-h-8 items-center rounded-md transition-colors hover:bg-muted",
          open && "bg-muted",
        )}
      >
        {subs.length > 0 && (
          <button
            type="button"
            aria-expanded={subOpen}
            data-testid="thread-subagents-fold"
            className="absolute left-2 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
            onClick={() => setFolded(subOpen)}
          >
            {subOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          title={thread.title}
          className={cn(
            ROW,
            "flex-1 py-1",
            FOCUS_RING,
            open ? "text-foreground-strong" : "text-foreground-secondary group-hover/thread:text-foreground",
          )}
          aria-current={open ? "page" : undefined}
          tabIndex={-1}
          onClick={() => onOpen(thread.id)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <AgentMark mark={thread.mark} />
          </span>
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          {thread.pr && !working && <PullRequestMark pr={thread.pr} />}
          {thread.worktree && (
            <span
              role="img"
              title={`Works in the worktree ${thread.worktree}`}
              data-testid={`thread-worktree-${thread.id}`}
              className="flex shrink-0 items-center"
            >
              <GitBranch aria-hidden className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            </span>
          )}
          <span className={cn("flex w-3.5 shrink-0 items-center justify-center", ROW_HOVER_HIDDEN)}>
            {working && <LoaderCircle role="img" className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </span>
        </button>
        <div
          data-testid={`thread-actions-${thread.id}`}
          className={cn("flex shrink-0 items-center overflow-hidden", ROW_HOVER_SHOWN)}
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded="false"
            className="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
          >
            <Ellipsis className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {subOpen && (
        <div
          role="group"
          data-testid="thread-tree-subagents"
          className="relative mb-0.5 flex flex-col gap-px before:absolute before:bottom-1.5 before:left-[19px] before:top-0.5 before:w-px before:rounded-full before:bg-border"
        >
          {subs.map((sub, i) => (
            <button
              key={sub.title}
              type="button"
              title={`${sub.title} · ${sub.kind}`}
              data-testid="thread-tree-subagent"
              data-status={i < subsDone ? "done" : "running"}
              className={SUB_ROW}
              style={{ paddingLeft: 32 }}
              tabIndex={-1}
            >
              <SubagentMark done={i < subsDone} />
              <span className={cn("min-w-0 flex-1 truncate", i >= subsDone && "live-tool-shine")}>{sub.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The composer (ThreadComposer.tsx) and the strip under it (ThreadBranchBar.tsx)
// ---------------------------------------------------------------------------

const HEADER_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
const MODEL_PICKER =
  "flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-border-strong h-8 w-auto max-w-[240px] gap-1.5 rounded-lg border-transparent bg-transparent px-2 py-0 text-sm font-medium text-foreground/80 shadow-none hover:border-transparent hover:bg-secondary hover:text-foreground focus-visible:ring-1 aria-expanded:bg-secondary aria-expanded:text-foreground aria-expanded:ring-0 [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5";
const QUIET_PICKER =
  "flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong h-7 w-auto max-w-[240px] gap-1.5 rounded-lg bg-transparent px-2.5 py-0 text-sm font-medium text-foreground-secondary hover:bg-secondary hover:text-foreground";
const STRIP_BUTTON =
  "flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function Composer({
  mark,
  model,
  draft,
  working,
  onDraft,
  onSend,
}: {
  mark: CliMark;
  model: string;
  draft: string;
  working: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
}) {
  const canSend = draft.trim().length > 0 && !working;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };
  return (
    <div className="relative z-10 overflow-hidden rounded-3xl border border-border bg-card shadow-[0_8px_24px_-12px_rgb(var(--scrim-rgb)/0.5)] transition-colors focus-within:border-border-strong">
      <textarea
        rows={2}
        data-testid="thread-composer-input"
        aria-label="Message the coding agent"
        placeholder={
          working
            ? "Queue a follow-up for when the agent is done"
            : "Ask for changes, send follow-ups, or attach images"
        }
        className="block max-h-[40vh] min-h-[84px] w-full resize-none bg-transparent px-4 pb-2 pt-4 text-base leading-6 text-foreground outline-none placeholder:text-faint-foreground sm:px-5"
        style={{ height: 84 }}
        tabIndex={-1}
        spellCheck={false}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex min-w-0 items-center justify-between gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="-ms-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&>*]:shrink-0">
          <span className="inline-flex min-w-0 items-center">
            <button
              type="button"
              role="combobox"
              aria-expanded="false"
              aria-label="Coding agent and model"
              data-testid="thread-model-picker"
              className={MODEL_PICKER}
              tabIndex={-1}
            >
              <AgentMark mark={mark} />
              <span className="min-w-0 flex-1 truncate">{model}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
            </button>
          </span>
          <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />
          <button
            type="button"
            role="combobox"
            aria-expanded="false"
            aria-label="Reasoning effort"
            data-testid="thread-effort-picker"
            className={QUIET_PICKER}
            tabIndex={-1}
          >
            <span className="min-w-0 flex-1 truncate">High</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          </button>
          <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />
          <button
            type="button"
            role="combobox"
            aria-expanded="false"
            aria-label="What the agent may do without asking"
            data-testid="thread-access-picker"
            className={QUIET_PICKER}
            tabIndex={-1}
          >
            <span className="min-w-0 flex-1 truncate">Ask before acting</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid="dictation-button"
            aria-label="Dictate"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong rounded-full"
            tabIndex={-1}
          >
            <Mic className="h-4 w-4" aria-hidden />
          </button>
          {working ? (
            <button
              type="button"
              data-testid="thread-stop"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              data-testid="thread-send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={onSend}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[0_1px_2px_rgb(var(--accent-rgb)/0.3)] transition-[opacity,transform] duration-150 hover:scale-105 hover:opacity-95 disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The strip under the composer: the machine, the folder and the branch the
 * thread works in, and at its right end how much of the plan is spent. A new
 * thread can ask for a worktree of its own.
 */
function WorkBar({ branch, draft, locked }: { branch: string; draft: boolean; locked: boolean }) {
  return (
    <div
      className="relative mx-auto -mt-4 flex w-[calc(100%-2.75rem)] items-center gap-2 rounded-b-2xl border border-t-0 border-border bg-sidebar pb-1 pe-2 ps-1 pt-5"
      data-testid="thread-branch-bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <button
          type="button"
          data-testid="thread-machine"
          title="Runs on"
          aria-expanded="false"
          className={STRIP_BUTTON}
          tabIndex={-1}
        >
          <Laptop className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[150px] truncate">This computer</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="thread-folder"
          title={PROJECT_PATH}
          aria-expanded="false"
          className={STRIP_BUTTON}
          tabIndex={-1}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[240px] truncate">{PROJECT}</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="thread-branch"
          aria-haspopup="menu"
          aria-expanded="false"
          title={locked ? "The agent works on this branch" : "Switch branch"}
          disabled={!draft && locked}
          className={STRIP_BUTTON}
          tabIndex={-1}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[220px] truncate font-mono">{branch}</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded="false"
        data-testid="thread-plan-usage"
        data-severity="normal"
        title={`${PLAN_USAGE.plan}: ${PLAN_USAGE.limit} limit ${PLAN_USAGE.percent}% used. Click for every limit and when it resets.`}
        className={cn(STRIP_BUTTON, "shrink-0")}
        tabIndex={-1}
      >
        <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[120px] truncate">{PLAN_USAGE.plan}</span>
        <span aria-hidden className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${PLAN_USAGE.percent}%` }} />
        </span>
        <span className="shrink-0 tabular-nums">
          {PLAN_USAGE.limit} {PLAN_USAGE.percent}%
        </span>
      </button>
      {draft && (
        <button
          type="button"
          aria-pressed="false"
          data-testid="thread-worktree-toggle"
          title="Give the new thread a worktree of its own"
          className={cn(STRIP_BUTTON, "shrink-0")}
          tabIndex={-1}
        >
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">New worktree</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One turn (ThreadTimeline.tsx)
// ---------------------------------------------------------------------------

const SENTENCE = "text-[15px] leading-[21px] text-foreground/95 [overflow-wrap:anywhere]";

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1.5 text-[13px] tabular-nums">
      {added > 0 && <span className="text-success">+{added}</span>}
      {removed > 0 && <span className="text-destructive">−{removed}</span>}
    </span>
  );
}

/** `StretchView` with its `WorkRow`: one grey line of work, its thought under it while it runs. */
function WorkLine({
  step,
  live,
  stamp,
}: {
  step: Extract<ThreadStep, { kind: "line" }>;
  live: boolean;
  stamp: string;
}) {
  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <button
          type="button"
          aria-expanded="false"
          className="group/row relative block w-full min-w-0 rounded-lg text-left -my-1.5 py-[3.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          tabIndex={-1}
        >
          <span className="flex min-w-0 items-center min-h-[21px] gap-1 text-[15px] leading-[21px]">
            <span
              className={cn(
                "min-w-0 truncate transition-colors duration-100 text-muted-foreground",
                live
                  ? "live-tool-shine"
                  : "group-hover/row:text-foreground-secondary group-focus-visible/row:text-foreground-secondary",
              )}
            >
              {step.text}
            </span>
            {step.diff && <DiffStat added={step.diff[0]} removed={step.diff[1]} />}
            <span aria-hidden className="flex h-[21px] w-3.5 shrink-0 items-center justify-center">
              <ChevronRight
                strokeWidth={2.25}
                className="h-3.5 w-3.5 transition-[transform,opacity,color] duration-100 ease-out motion-reduce:transition-none text-muted-foreground group-hover/row:text-foreground-secondary"
              />
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2.5 pl-2">
              <span className="text-xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
                {stamp}
                {!live && step.took ? ` · ${step.took}` : ""}
              </span>
            </span>
          </span>
        </button>
      </div>
      {live && step.thought && (
        <p data-testid="thread-thought-live" className={cn("m-0 mt-3", SENTENCE)}>
          {step.thought}
        </p>
      )}
    </div>
  );
}

/** `ThoughtSentence`: what the agent said between two lines, one white sentence. */
function ThoughtSentence({ text }: { text: string }) {
  return (
    <div className="min-w-0" data-testid="thread-thought-sentence">
      <p className={cn(SENTENCE, "m-0")}>{text}</p>
    </div>
  );
}

/** `WorkingLine`: the pet at work, its clock, the tokens in and out, the sub-agents working. */
function WorkingLine({
  clock,
  starting,
  tokens,
  agents,
}: {
  clock: string;
  starting: boolean;
  tokens: [number, number] | null;
  agents: number;
}) {
  return (
    <div
      className="-mt-1 flex h-7 min-w-0 items-center gap-2.5 text-sm text-muted-foreground"
      data-testid="thread-working"
    >
      <span className="sr-only">Working for {clock}</span>
      <PetMark size={24} state="working" />
      {starting && (
        <span aria-hidden className="live-tool-shine truncate text-[15px] leading-[21px]">
          Getting ready
        </span>
      )}
      <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground/80">
        <span className="tabular-nums">{clock}</span>
      </span>
      {tokens && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/80" data-testid="thread-working-tokens">
          · ↑ {formatTokens(tokens[0])} · ↓ {formatTokens(tokens[1])}
        </span>
      )}
      {agents > 0 && (
        <span className="truncate text-xs text-muted-foreground/80">
          · {agents} {agents === 1 ? "sub-agent" : "sub-agents"} working
        </span>
      )}
    </div>
  );
}

function CopyButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={-1}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

const FILE_ROW =
  "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function ChangeCount({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn("shrink-0 tabular-nums", className)}>
      <span className="text-success">+{added}</span> <span className="text-destructive">-{removed}</span>
    </span>
  );
}

function ChangedFiles({ files }: { files: FileChange[] }) {
  const plus = files.reduce((sum, file) => sum + file.plus, 0);
  const minus = files.reduce((sum, file) => sum + file.minus, 0);
  return (
    <section
      aria-label="Changed files"
      data-testid="thread-changed-files"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground-secondary"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] border-[1.5px] border-current">
            <Diff className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground-strong">
            {files.length} {files.length === 1 ? "file changed" : "files changed"}
          </div>
          <ChangeCount added={plus} removed={minus} className="text-sm" />
        </div>
        <button
          type="button"
          aria-pressed="false"
          className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
        >
          Show changes
        </button>
      </div>
      <ul>
        {files.map((file) => (
          <li key={file.dir + file.name}>
            <button
              type="button"
              aria-expanded="false"
              title={`${file.dir}${file.name}`}
              className={FILE_ROW}
              tabIndex={-1}
            >
              <span className="flex min-w-0 flex-1">
                {file.dir && (
                  <span dir="rtl" className="min-w-0 shrink-[999] truncate text-left text-muted-foreground">
                    <bdi dir="ltr">{file.dir}</bdi>
                  </span>
                )}
                <span className="min-w-0 max-w-full shrink-0 truncate text-foreground">{file.name}</span>
              </span>
              <ChangeCount added={file.plus} removed={file.minus} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UserBubble({ turn }: { turn: LiveTurn }) {
  return (
    <div className="group flex flex-col items-end gap-1" data-testid="thread-user-message">
      <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-foreground">
        <div className="whitespace-pre-wrap text-base leading-6 [overflow-wrap:anywhere]">{turn.user}</div>
      </div>
      <div className="flex items-center gap-1 pr-1 text-xs text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <span className="tabular-nums">{turn.time}</span>
        <CopyButton label="Copy message" />
      </div>
    </div>
  );
}

function Turn({
  turn,
  stuck,
  onDone,
  onMoment,
}: {
  turn: LiveTurn;
  /** A thread that is working when the demo opens never finishes its turn. */
  stuck: boolean;
  onDone: (id: number) => void;
  onMoment: (moment: TurnMoment) => void;
}) {
  const beats = useMemo(() => beatsOf(turn), [turn]);
  const step = usePlayhead(
    beats.map((beat) => beat.ms),
    turn.live,
    () => onDone(turn.id),
    turn.startedAt,
  );
  const played = momentAt(turn, beats, turn.live ? step : beats.length);
  const moment: TurnMoment = stuck
    ? {
        steps: turn.steps.length,
        live: turn.steps.length - 1,
        subs: false,
        subsDone: 0,
        progress: 0.8,
        done: false,
      }
    : played;
  const clock = useElapsed(!moment.done, stuck ? 372_000 : 0);
  const subs = turn.subagents ?? [];
  const starting = !moment.done && moment.steps === 0;
  const tokens: [number, number] | null = starting
    ? null
    : [Math.round(turn.tokens[0] * moment.progress), Math.round(turn.tokens[1] * moment.progress)];

  // The sidebar and the dock show the same sub-agents; tell the view where they stand.
  const key = `${moment.subs}:${moment.subsDone}:${moment.done}`;
  useLayoutEffect(() => {
    onMoment(moment);
    // `key` carries everything of the moment the view reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const renderStep = (entry: ThreadStep, i: number) => {
    if (entry.kind === "said") return <ThoughtSentence key={i} text={entry.text} />;
    if (entry.kind === "agents") return <SubagentRun key={i} subs={subs} done={moment.subsDone} />;
    return <WorkLine key={i} step={entry} live={i === moment.live} stamp={turn.time} />;
  };
  const agentsWorking = moment.subs ? subs.length - moment.subsDone : 0;
  const hasAgents = turn.steps.some((entry) => entry.kind === "agents") && subs.length > 0;

  return (
    <>
      <UserBubble turn={turn} />
      <div
        className="flex min-w-0 flex-col gap-5"
        data-testid="thread-turn"
        data-status={moment.done ? "done" : "running"}
      >
        {moment.done && (
          <div>
            <button
              type="button"
              aria-expanded="false"
              data-testid="thread-worked-for"
              className="-my-1.5 flex items-center gap-1 rounded-lg py-[3.5px] text-[15px] leading-[21px] text-muted-foreground transition-colors duration-100 hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <span className="tabular-nums">Worked for {turn.worked}</span>
              <ChevronRight
                aria-hidden
                strokeWidth={2.25}
                className="h-3.5 w-3.5 transition-transform duration-100 ease-out motion-reduce:transition-none"
              />
            </button>
            <div aria-hidden className="mt-3 border-b border-border/70" />
          </div>
        )}
        {moment.done && hasAgents && (
          <div className="flex flex-col gap-5" data-testid="thread-turn-subagents">
            <SubagentRun subs={subs} done={subs.length} />
          </div>
        )}
        {!moment.done && turn.steps.slice(0, moment.steps).map(renderStep)}
        {moment.done ? (
          <>
            <Blocks blocks={turn.answer} className={PROSE_THREAD} />
            {turn.files && <ChangedFiles files={turn.files} />}
            <div
              className="-mt-3 flex items-center gap-1.5 text-xs text-muted-foreground empty:hidden"
              data-testid="thread-turn-closing"
            >
              <CopyButton label="Copy answer" />
            </div>
          </>
        ) : (
          <WorkingLine clock={clock} starting={starting} tokens={tokens} agents={agentsWorking} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The view (ThreadView.tsx, ThreadHeader.tsx)
// ---------------------------------------------------------------------------

export function ThreadView({
  thread,
  draft,
  onDraft,
  onSend,
  onTurnDone,
  onSubs,
  onNew,
}: {
  /** The open thread; null for the empty one a new thread starts from. */
  thread: LiveThread | null;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onTurnDone: (threadId: string, turnId: number) => void;
  /** Where the open thread's sub-agents stand, for the sidebar. */
  onSubs: (done: number | null) => void;
  onNew: () => void;
}) {
  const [moment, setMoment] = useState<TurnMoment | null>(null);
  const [composerHeight, setComposerHeight] = useState(180);
  const timeline = useRef<HTMLDivElement>(null);
  const composerBox = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const follow = () => {
      el.scrollTop = el.scrollHeight;
    };
    follow();
    const observer = new MutationObserver(follow);
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [thread?.id]);

  // How tall the composer is, so the conversation scrolls clear of it.
  useLayoutEffect(() => {
    const box = composerBox.current;
    if (!box) return;
    setComposerHeight(box.offsetHeight);
    const observer = new ResizeObserver(() => setComposerHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [thread?.id]);

  if (!thread) {
    return (
      <div className="relative flex h-full min-h-0 flex-col" data-testid="thread-view">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-10">
          <h2 className="text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
            {"What should we build in "}
            <button
              type="button"
              data-testid="thread-project-picker"
              aria-haspopup="menu"
              aria-expanded="false"
              className="inline-flex items-center gap-1 rounded-md font-semibold text-foreground-strong hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              {PROJECT}
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
            ?
          </h2>
          <div className="mt-7 w-full">
            <div className="mx-auto w-full max-w-3xl">
              <Composer
                mark="claude"
                model="Claude Opus 5.5"
                draft={draft}
                working={false}
                onDraft={onDraft}
                onSend={onSend}
              />
              <WorkBar branch="main" draft locked={false} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const working = Boolean(thread.running) || thread.turns.some((turn) => turn.live);
  const lastTurn = thread.turns[thread.turns.length - 1];
  const subs = lastTurn?.subagents ?? [];
  const showDock = subs.length > 0 && Boolean(moment?.subs);

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="thread-view">
      <header
        data-testid="thread-header"
        className="flex h-9 shrink-0 select-none items-center gap-1 border-b border-border pl-3 pr-1.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <AgentMark mark={thread.mark} />
          <span
            data-testid="thread-header-title"
            className="truncate text-sm font-medium text-foreground"
            title={thread.title}
          >
            {thread.title}
          </span>
        </div>
        {thread.landed && (
          <span
            data-header-control="true"
            data-verdict="DONE"
            role="img"
            className="inline-flex h-4 shrink-0 cursor-default items-center rounded border px-1 text-[10px] font-medium leading-none tracking-wide"
            style={{ color: "rgb(63, 162, 102)", borderColor: "transparent" }}
          >
            landed
          </span>
        )}
        {thread.pr && !working && (
          <button
            type="button"
            data-header-control="true"
            data-testid="session-github-status"
            aria-expanded="false"
            className="inline-flex h-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current opacity-75"
            style={{ color: "rgb(163, 163, 163)" }}
            tabIndex={-1}
          >
            <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <PullRequestIcon
                state={thread.pr.state}
                size={16}
                className={cn("block shrink-0", PR_TONE[thread.pr.state])}
              />
            </span>
            {thread.pr.count && thread.pr.count > 1 && (
              <span className="text-[10px] leading-none tabular-nums" aria-hidden="true">
                {thread.pr.count}
              </span>
            )}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="thread-header-review-changes"
            title="Review changes"
            className={HEADER_BUTTON}
            tabIndex={-1}
          >
            <FileDiff className="h-[15px] w-[15px]" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="thread-header-show-in-git"
            title="Show in Git"
            className={HEADER_BUTTON}
            tabIndex={-1}
          >
            <FolderGit2 className="h-[15px] w-[15px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded="false"
            data-testid="thread-header-more"
            className={HEADER_BUTTON}
            tabIndex={-1}
          >
            <Ellipsis className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-pressed="false"
            data-testid="thread-header-maximize"
            className={HEADER_BUTTON}
            tabIndex={-1}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="thread-header-new"
            title="New thread here"
            className={HEADER_BUTTON}
            tabIndex={-1}
            onClick={onNew}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="thread-header-close"
            title="Close"
            disabled={working}
            className={HEADER_BUTTON}
            tabIndex={-1}
            onClick={onNew}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={timeline} data-testid="thread-timeline" className="relative h-full overflow-y-auto scrollbar-jarvis">
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 pt-6"
            style={{ paddingBottom: composerHeight + 24 }}
          >
            {thread.turns.map((turn, i) => (
              <Turn
                key={turn.id}
                turn={turn}
                stuck={Boolean(thread.running) && i === thread.turns.length - 1 && turn.answer.length === 0}
                onDone={(id) => onTurnDone(thread.id, id)}
                onMoment={(next) => {
                  if (i !== thread.turns.length - 1) return;
                  setMoment(next);
                  onSubs(next.subs ? next.subsDone : null);
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        ref={composerBox}
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background from-70% to-transparent px-5 pb-4 pt-6"
      >
        <div className="pointer-events-auto">
          <div className="mx-auto w-full max-w-3xl">
            {showDock && <Dock subs={subs} done={moment?.subsDone ?? 0} />}
            <Composer
              mark={thread.mark}
              model={thread.model}
              draft={draft}
              working={working}
              onDraft={onDraft}
              onSend={onSend}
            />
            <WorkBar branch={thread.branch} draft={false} locked={working} />
          </div>
        </div>
      </div>
    </div>
  );
}
