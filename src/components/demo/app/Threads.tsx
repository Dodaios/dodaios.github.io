/**
 * The Agentic IDE in its thread layout — a clone of the app's thread view.
 *
 * Markup and class names are copied from the running app's own DOM:
 * agentic/threads/ThreadTree.tsx with ThreadTreeSubagents.tsx (the sidebar),
 * ThreadView.tsx and ThreadHeader.tsx (the frame and its title row),
 * ThreadTimeline.tsx (the person's message, the stretches of work, the answer,
 * the changed-files card), ThreadSubagents.tsx (the group in the turn and the
 * dock above the composer), ThreadComposer.tsx with ThreadPickers.tsx,
 * ThreadBranchBar.tsx and ThreadRunsOn.tsx (the composer and what hangs under
 * it), and the empty thread of ThreadView.tsx ("What should we build in …?").
 *
 * The composer is real: what is typed into it starts a turn, and the thread
 * answers from demoData.ts.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PROSE_THREAD } from "./classes";
import { SidebarFrame } from "./AppShell";
import {
  ASSISTANT_NAME,
  OTHER_PROJECTS,
  PROJECT,
  type CliMark,
  type DemoThread,
  type FileChange,
  type SubAgent,
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
  GitBranch,
  LoaderCircle,
  Maximize2,
  Mic,
  Plus,
  Search,
  Server,
  ShieldAlert,
  Square,
  SquarePen,
  Users,
  X,
} from "./lucide";
import { AgentMark, Blocks, PR_TONE, PullRequestIcon, usePlayhead, useSeconds } from "./Markup";
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

// ---------------------------------------------------------------------------
// What a turn shows at each moment of its run
// ---------------------------------------------------------------------------

interface TurnMoment {
  /** Lines of work on screen, and the one still running among them (-1: none). */
  lines: number;
  shining: number;
  /** Whether the sub-agents were started, and how many have finished. */
  subs: boolean;
  subsDone: number;
  done: boolean;
}

type Beat = { kind: "idle" | "line" | "subs" | "sub"; ms: number };

/**
 * A turn's run as beats: a pause, the first stretch of work, the sub-agents
 * starting and finishing one by one, then the remaining stretches.
 */
function beatsOf(turn: ThreadTurn): Beat[] {
  const beats: Beat[] = [{ kind: "idle", ms: 900 }];
  turn.lines.forEach((_, i) => {
    beats.push({ kind: "line", ms: 1500 });
    if (i === 0 && turn.subagents?.length) {
      beats.push({ kind: "subs", ms: 1300 });
      turn.subagents.forEach(() => beats.push({ kind: "sub", ms: 1250 }));
    }
  });
  return beats;
}

function momentAt(turn: ThreadTurn, beats: Beat[], step: number): TurnMoment {
  const total = turn.subagents?.length ?? 0;
  if (step >= beats.length) return { lines: turn.lines.length, shining: -1, subs: total > 0, subsDone: total, done: true };
  const moment: TurnMoment = { lines: 0, shining: -1, subs: false, subsDone: 0, done: false };
  for (let i = 0; i <= step; i++) {
    const beat = beats[i];
    if (beat.kind === "line") {
      moment.lines += 1;
      moment.shining = moment.lines - 1;
    } else if (beat.kind === "subs") {
      moment.subs = true;
      moment.shining = -1;
    } else if (beat.kind === "sub") moment.subsDone += 1;
  }
  return moment;
}

// ---------------------------------------------------------------------------
// The sidebar (ThreadTree.tsx)
// ---------------------------------------------------------------------------

const TREE_BUTTON =
  "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-base text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PROJECT_ROW = "group relative flex min-h-8 items-center rounded-md pr-1 transition-colors hover:bg-muted";
const PROJECT_BUTTON =
  "flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-base flex-1 text-foreground-secondary group-hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PROJECT_ACTION =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] hover:bg-background/70 hover:text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const THREAD_ROW = "group/thread relative flex min-h-8 items-center rounded-md transition-colors hover:bg-muted";
const THREAD_BUTTON =
  "flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-base flex-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const THREAD_HOVER =
  "absolute inset-y-0 right-0 flex items-center gap-1 rounded-r-md bg-gradient-to-l from-muted from-60% to-transparent pl-5 pr-1 transition-opacity pointer-events-none opacity-0 group-hover/thread:pointer-events-auto group-hover/thread:opacity-100 group-focus-within/thread:pointer-events-auto group-focus-within/thread:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100";
const SUB_ROW =
  "group/sub relative flex min-h-7 min-w-0 items-center gap-2 rounded-md py-0.5 pr-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground-secondary";

function SubagentMark({ done }: { done: boolean }) {
  return done ? (
    <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
  ) : (
    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
  );
}

function threadWorking(thread: LiveThread): boolean {
  return Boolean(thread.running) || thread.turns.some((turn) => turn.live);
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
        <div role="group" className="flex flex-col gap-px">
          <button type="button" data-testid="thread-tree-new-thread" className={TREE_BUTTON} tabIndex={-1} onClick={onNew}>
            <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">New thread</span>
          </button>
          <button type="button" data-testid="thread-tree-search" className={TREE_BUTTON} tabIndex={-1}>
            <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Search</span>
          </button>
          <button type="button" data-testid="thread-tree-new-team" className={TREE_BUTTON} tabIndex={-1}>
            <Users className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">New team thread</span>
          </button>
          <button type="button" data-testid="thread-tree-voice" className={TREE_BUTTON} tabIndex={-1}>
            <Mic className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Dodaios Live</span>
          </button>
        </div>
        <div className="flex min-h-8 items-end justify-between gap-2 pb-1 pl-2 pr-1 pt-4 text-sm text-muted-foreground">
          <span className="truncate">Projects</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mb-px">
          <div className={PROJECT_ROW}>
            <button type="button" aria-expanded="true" className={PROJECT_BUTTON} tabIndex={-1}>
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{PROJECT}</span>
            </button>
            <button type="button" className={PROJECT_ACTION} tabIndex={-1} onClick={onNew}>
              <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" className={PROJECT_ACTION} tabIndex={-1}>
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="mb-2 flex flex-col gap-px">
            {threads.map((thread) => {
              const open = thread.id === selected;
              const working = threadWorking(thread);
              const subs = open ? thread.turns.flatMap((turn) => turn.subagents ?? []) : [];
              return (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  open={open}
                  working={working}
                  subs={subsDone === null ? [] : subs}
                  subsDone={subsDone ?? 0}
                  onOpen={onOpen}
                />
              );
            })}
            <button
              type="button"
              className="flex min-h-7 items-center rounded-md text-left text-sm text-muted-foreground hover:text-foreground pl-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              Show 12 more
            </button>
          </div>
        </div>
        {OTHER_PROJECTS.map((name) => (
          <div className="mb-px" key={name}>
            <div className={PROJECT_ROW}>
              <button type="button" aria-expanded="false" className={PROJECT_BUTTON} tabIndex={-1}>
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </button>
              <button type="button" className={PROJECT_ACTION} tabIndex={-1}>
                <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
              <button type="button" className={PROJECT_ACTION} tabIndex={-1}>
                <Users className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </SidebarFrame>
  );
}

function ThreadRow({
  thread,
  open,
  working,
  subs,
  subsDone,
  onOpen,
}: {
  thread: LiveThread;
  open: boolean;
  working: boolean;
  subs: SubAgent[];
  subsDone: number;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div data-testid={`thread-row-${thread.id}`} className={cn(THREAD_ROW, open && "bg-muted")}>
        <button
          type="button"
          className={cn(
            THREAD_BUTTON,
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
          {thread.pr && !working && (
            <span
              role="img"
              className={cn("flex shrink-0 items-center gap-0.5 text-xs tabular-nums", PR_TONE[thread.pr.state])}
            >
              <PullRequestIcon state={thread.pr.state} size={14} className="shrink-0" />
              {thread.pr.count && <span>{thread.pr.count}</span>}
            </span>
          )}
          <span className="flex w-3.5 shrink-0 items-center justify-center">
            {working && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
          </span>
        </button>
        <div className={THREAD_HOVER}>
          <span className="text-micro tabular-nums text-muted-foreground">{thread.age}</span>
          <button
            type="button"
            aria-expanded="false"
            className="rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
          >
            <Ellipsis className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {subs.length > 0 && (
        <div
          role="group"
          data-testid="thread-tree-subagents"
          className="relative mb-0.5 flex flex-col gap-px before:absolute before:bottom-1.5 before:left-[19px] before:top-0.5 before:w-px before:rounded-full before:bg-border"
        >
          {subs.map((sub, i) => (
            <button
              key={sub.title}
              type="button"
              data-testid="thread-tree-subagent"
              data-status={i < subsDone ? "done" : "running"}
              className={SUB_ROW}
              style={{ paddingLeft: 32 }}
              tabIndex={-1}
            >
              <SubagentMark done={i < subsDone} />
              <span className="min-w-0 flex-1 truncate">{sub.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The composer (ThreadComposer.tsx) and what hangs on it
// ---------------------------------------------------------------------------

const HEADER_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
const MODEL_PICKER =
  "flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-border-strong h-8 w-auto max-w-[240px] gap-1.5 rounded-lg border-transparent bg-transparent px-2 py-0 text-sm font-medium text-foreground/80 shadow-none hover:border-transparent hover:bg-secondary hover:text-foreground focus-visible:ring-1 aria-expanded:bg-secondary aria-expanded:text-foreground aria-expanded:ring-0 [&>svg:last-child]:h-3.5 [&>svg:last-child]:w-3.5";
const QUIET_PICKER =
  "flex items-center text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong h-7 w-auto max-w-[240px] gap-1.5 rounded-lg bg-transparent px-2.5 py-0 text-sm font-medium";

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

function Dock({
  subs,
  done,
  open,
  onToggle,
}: {
  subs: SubAgent[];
  done: number;
  open: boolean;
  onToggle: () => void;
}) {
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
            <button
              key={sub.title}
              type="button"
              data-testid="thread-subagent-row"
              data-status={i < done ? "done" : "running"}
              className="group/line flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <SubagentMark done={i < done} />
              <span className="min-w-0 max-w-[45%] shrink-0 truncate font-medium text-foreground">{sub.title}</span>
              <span className="hidden shrink-0 rounded border border-border px-1 text-[10.5px] leading-4 text-muted-foreground sm:inline">
                {sub.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{i < done ? sub.note : "Working…"}</span>
              {i < done && (
                <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">
                  <span className="shrink-0 tabular-nums">{sub.stats}</span>
                </span>
              )}
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover/line:text-foreground"
                aria-hidden
              />
            </button>
          ))}
        </nav>
      )}
      <button
        type="button"
        aria-expanded={open}
        data-testid="thread-subagent-dock-toggle"
        className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        tabIndex={-1}
        onClick={onToggle}
      >
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary" data-testid="thread-subagent-count">
          {subs.length} sub-agents
        </span>
        <SubagentProgress total={subs.length} done={done} className="w-20 shrink-0" />
        <ChevronUp
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
          aria-hidden
        />
      </button>
    </div>
  );
}

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
        placeholder={working ? "Queue a follow-up for when the agent is done" : "Ask for changes, send follow-ups, or attach images"}
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
            <button type="button" role="combobox" aria-expanded="false" data-testid="thread-model-picker" className={MODEL_PICKER} tabIndex={-1}>
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
            data-testid="thread-effort-picker"
            className={cn(QUIET_PICKER, "text-foreground-secondary hover:bg-secondary hover:text-foreground")}
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
            data-testid="thread-access-picker"
            className={cn(QUIET_PICKER, "text-foreground-secondary hover:bg-secondary hover:text-foreground")}
            tabIndex={-1}
          >
            <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Ask before changes</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid="dictation-button"
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

function BranchBar({ branch }: { branch: string }) {
  return (
    <>
      <div
        className="relative mx-auto -mt-4 flex w-[calc(100%-2.75rem)] items-center justify-between gap-2 rounded-b-2xl border border-t-0 border-border bg-sidebar pb-1 pe-2 ps-1 pt-5"
        data-testid="thread-branch-bar"
      >
        <span className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 hover:bg-transparent hover:text-muted-foreground">
          <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">Current checkout</span>
        </span>
        <button
          type="button"
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-expanded="false"
          tabIndex={-1}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[220px] truncate font-mono">{branch}</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      </div>
      <div className="px-3 pt-1 text-xs text-muted-foreground" data-testid="thread-runs-on">
        <button
          type="button"
          aria-expanded="false"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
        >
          <Server className="h-3.5 w-3.5" aria-hidden />
          Runs on
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One turn (ThreadTimeline.tsx)
// ---------------------------------------------------------------------------

const WORK_ROW =
  "group/row relative block w-full min-w-0 rounded-md text-left py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_CHEVRON =
  "h-3.5 w-3.5 text-muted-foreground transition duration-200 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 opacity-60";
const ROW_TIME =
  "ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100";
const FILE_ROW =
  "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function ChangedFiles({ files }: { files: FileChange[] }) {
  const plus = files.reduce((sum, file) => sum + file.plus, 0);
  const minus = files.reduce((sum, file) => sum + file.minus, 0);
  return (
    <section data-testid="thread-changed-files" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
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
          <div className="truncate text-sm font-semibold text-foreground-strong">{files.length} files changed</div>
          <span className="shrink-0 tabular-nums text-sm">
            <span className="text-success">+{plus}</span> <span className="text-destructive">-{minus}</span>
          </span>
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
            <button type="button" aria-expanded="false" className={FILE_ROW} tabIndex={-1}>
              <span className="flex min-w-0 flex-1">
                <span className="min-w-0 shrink-[999] truncate text-left text-muted-foreground">
                  <bdi>{file.dir}</bdi>
                </span>
                <span className="min-w-0 max-w-full shrink-0 truncate text-foreground">{file.name}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-success">+{file.plus}</span> <span className="text-destructive">-{file.minus}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Turn({
  turn,
  stuck,
  onDone,
  onMoment,
  onDock,
}: {
  turn: LiveTurn;
  /** A thread that is working when the demo opens never finishes its turn. */
  stuck: boolean;
  onDone: (id: number) => void;
  onMoment: (moment: TurnMoment) => void;
  onDock: () => void;
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
    ? { lines: turn.lines.length, shining: turn.lines.length - 1, subs: false, subsDone: 0, done: false }
    : played;
  const seconds = useSeconds(!moment.done, stuck ? 372 : 1);
  const subs = turn.subagents ?? [];

  // The sidebar and the dock show the same sub-agents; tell the view where they stand.
  const key = `${moment.subs}:${moment.subsDone}:${moment.done}`;
  useLayoutEffect(() => {
    onMoment(moment);
    // `key` carries everything of the moment the view reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clock = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;

  return (
    <>
      <div className="group flex flex-col items-end gap-1" data-testid="thread-user-message">
        <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-foreground">
          <div className="whitespace-pre-wrap text-base leading-6 [overflow-wrap:anywhere]">{turn.user}</div>
        </div>
        <div className="flex items-center gap-1 pr-1 text-xs text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <span className="tabular-nums">{turn.time}</span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={-1}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5" data-testid="thread-turn" data-status={moment.done ? "done" : "running"}>
        {moment.done ? (
          <div>
            <button
              type="button"
              aria-expanded="false"
              data-testid="thread-worked-for"
              className="flex h-7 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
            >
              <span className="tabular-nums">{turn.worked}</span>
              <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150" aria-hidden />
            </button>
            <div aria-hidden="true" className="mt-1 border-b border-border/70" />
          </div>
        ) : (
          turn.lines.slice(0, moment.lines).map((line, i) => (
            <div className="min-w-0" key={line.text}>
              <button type="button" aria-expanded="false" className={WORK_ROW} tabIndex={-1}>
                <span className="flex min-h-6 min-w-0 items-center gap-2.5 text-base">
                  <span
                    className={cn(
                      "min-w-0 truncate transition-colors text-muted-foreground",
                      i === moment.shining ? "live-tool-shine" : "group-hover/row:text-foreground",
                    )}
                  >
                    {line.text}
                  </span>
                  {line.diff && (
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      <span className="text-success">+{line.diff[0]}</span>{" "}
                      <span className="text-destructive">−{line.diff[1]}</span>
                    </span>
                  )}
                  <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center -ml-1.5">
                    <ChevronRight className={ROW_CHEVRON} aria-hidden />
                  </span>
                  <span className={ROW_TIME}>{turn.time}</span>
                </span>
              </button>
            </div>
          ))
        )}
        {moment.subs && subs.length > 0 && (
          <section data-testid="thread-subagent-group" className="overflow-hidden rounded-xl border border-border bg-card">
            <button
              type="button"
              aria-expanded="false"
              data-testid="thread-subagent-group-toggle"
              className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              tabIndex={-1}
              onClick={onDock}
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground-secondary"
              >
                <Bot className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground-strong" data-testid="thread-subagent-group-count">
                  {subs.length} sub-agents
                </span>
                <SubagentProgress total={subs.length} done={moment.subsDone} className="mt-1.5 max-w-[14rem]" />
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 -rotate-90"
                aria-hidden
              />
            </button>
          </section>
        )}
        {moment.done ? (
          <>
            <Blocks blocks={turn.answer} className={cn("py-1", PROSE_THREAD)} />
            {turn.files && <ChangedFiles files={turn.files} />}
            <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground" data-testid="thread-turn-closing">
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={-1}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </>
        ) : (
          <div
            className="flex h-6 min-w-0 items-center px-1 text-sm leading-relaxed text-muted-foreground"
            data-testid="thread-working"
          >
            <span className="whitespace-nowrap">
              {"Working for "}
              <span className="tabular-nums">{clock}</span>
            </span>
          </div>
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
  const [dockOpen, setDockOpen] = useState(false);
  const [moment, setMoment] = useState<TurnMoment | null>(null);
  const timeline = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const follow = () => {
      el.scrollTop = el.scrollHeight;
    };
    follow();
    const observer = new MutationObserver(follow);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
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
              <Composer mark="claude" model="Claude Opus 5.5" draft={draft} working={false} onDraft={onDraft} onSend={onSend} />
              <BranchBar branch="main" />
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
          <span data-testid="thread-header-title" className="truncate text-sm font-medium text-foreground">
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
              <PullRequestIcon state={thread.pr.state} size={16} className={cn("block shrink-0", PR_TONE[thread.pr.state])} />
            </span>
            {thread.pr.count && (
              <span className="text-[10px] leading-none tabular-nums" aria-hidden="true">
                {thread.pr.count}
              </span>
            )}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" data-testid="thread-header-review-changes" className={HEADER_BUTTON} tabIndex={-1}>
            <FileDiff className="h-[15px] w-[15px]" aria-hidden />
          </button>
          <button type="button" data-testid="thread-header-show-in-git" className={HEADER_BUTTON} tabIndex={-1}>
            <FolderGit2 className="h-[15px] w-[15px]" aria-hidden />
          </button>
          <button type="button" aria-expanded="false" data-testid="thread-header-more" className={HEADER_BUTTON} tabIndex={-1}>
            <Ellipsis className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" aria-pressed="false" data-testid="thread-header-maximize" className={HEADER_BUTTON} tabIndex={-1}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" data-testid="thread-header-new" className={HEADER_BUTTON} tabIndex={-1} onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" data-testid="thread-header-close" className={HEADER_BUTTON} tabIndex={-1} onClick={onNew}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={timeline}
          data-testid="thread-timeline"
          className="h-full overflow-y-auto scrollbar-jarvis"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 pt-6" style={{ paddingBottom: showDock ? 289 : 240 }}>
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
                onDock={() => setDockOpen(true)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background from-70% to-transparent px-5 pb-4 pt-6">
        <div className="pointer-events-auto">
          <div className="mx-auto w-full max-w-3xl">
            {showDock && (
              <Dock subs={subs} done={moment?.subsDone ?? 0} open={dockOpen} onToggle={() => setDockOpen((open) => !open)} />
            )}
            <Composer
              mark={thread.mark}
              model={thread.model}
              draft={draft}
              working={working}
              onDraft={onDraft}
              onSend={onSend}
            />
            <BranchBar branch={thread.branch} />
          </div>
        </div>
      </div>
    </div>
  );
}
