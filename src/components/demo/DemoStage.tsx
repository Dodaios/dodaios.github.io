import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AppFrame } from "./app/AppFrame";
import { AppShell, HomeSidebar, SearchBar, SidebarFrame, type IdeLayout, type Section } from "./app/AppShell";
import { Conversation, type ActivityRow, type CallState, type HomeTurn } from "./app/Conversation";
import {
  CALENDAR_PROMPT,
  DEMO_THREADS,
  HOME_HISTORY,
  LOGIN_PROMPT,
  LOGIN_THREAD_ID,
  SCOUT_DONE,
  SCOUT_RUNNING,
  genericThreadTurn,
  replyFor,
  type AgentId,
} from "./app/demoData";
import { CLI_NAMES, now } from "./app/Markup";
import { ThreadTree, ThreadView, type LiveThread } from "./app/Threads";
import "./demo-stage.css";

/**
 * The hero's demo stage — the app itself, cloned in DOM, and usable.
 *
 * The window is a clone, not a drawing: its markup is copied from the app's
 * components (src/components/demo/app/) and styled by the app's own compiled
 * stylesheet, rendered in a document of its own (AppFrame). It is laid out at
 * a real app size and scaled down like a screenshot, so the type keeps the
 * app's proportion to the window. See docs/hero.md.
 *
 * Left alone it plays one errand: the person asks for a failing test to be
 * fixed, the assistant hands the job to an agent, and the Agentic IDE shows
 * that agent at work until its pull request is open. The first press inside
 * the window ends the tour for good, and from then on the visitor drives —
 * the sidebar leads to the sections, the threads open, and both composers
 * take what is typed into them.
 */

/*
 * The first screen needs the shell, the conversation and the thread view: the
 * tour plays in those three. The sections a reader only reaches by pressing —
 * Agents, Plugins and the Agentic IDE's grid — load when they are first opened,
 * so they do not weigh on the page's start.
 */
const AgentsView = lazy(() => import("./app/AgentsView").then((m) => ({ default: m.AgentsView })));
const PluginsView = lazy(() => import("./app/PluginsView").then((m) => ({ default: m.PluginsView })));
const GridScene = lazy(() => import("./app/GridScene").then((m) => ({ default: m.GridScene })));
const GridNav = lazy(() => import("./app/GridScene").then((m) => ({ default: m.GridNav })));

/** The app window, in CSS px — a common laptop-sized app window. */
const WINDOW_W = 1360;
const WINDOW_H = 758;

/**
 * How long the agent's run takes when nobody watches it in the Agentic IDE: a
 * little more than its thread needs to play, so a thread that is being watched
 * always ends on its own last frame and never on this timer.
 */
const BACKGROUND_RUN_MS = 9600;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Below this factor the app's type is too small to read, let alone to press.
 * A phone is narrower than that, so there the window stops shrinking: it keeps
 * this size, loses its sidebar off the left edge and its right side off the
 * right one, and shows the middle of the app — the conversation.
 */
const MIN_SCALE = 0.46;
/** The sidebar's width, which a held window slides out of view. */
const SIDEBAR_W = 240;

/**
 * The factor that makes the window as wide as the column it sits in, and how
 * far a window held at `MIN_SCALE` is slid to the left. The wrapper carries
 * the window's own ratio, so its height follows — the window is never squeezed
 * to fit a height.
 */
function useStageFit(ref: { current: HTMLDivElement | null }): { scale: number; shift: number } {
  const [fit, setFit] = useState({ scale: 1, shift: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width } = el.getBoundingClientRect();
      if (width <= 0) return;
      const natural = width / WINDOW_W;
      setFit(natural >= MIN_SCALE ? { scale: natural, shift: 0 } : { scale: MIN_SCALE, shift: SIDEBAR_W * MIN_SCALE });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

let nextId = 1;
const id = () => nextId++;

function initialTurns(): HomeTurn[] {
  return HOME_HISTORY.map((entry) => ({ id: id(), stamp: entry.stamp, user: entry.user, reply: entry.reply, live: false }));
}

/** Every thread but the agent's own: that one appears with the hand-off. */
function initialThreads(): LiveThread[] {
  return DEMO_THREADS.filter((thread) => thread.id !== LOGIN_THREAD_ID).map((thread) => ({
    ...thread,
    turns: thread.turns.map((turn) => ({ ...turn, id: id(), live: false })),
  }));
}

function loginThread(live: boolean): LiveThread {
  const thread = DEMO_THREADS.find((entry) => entry.id === LOGIN_THREAD_ID)!;
  return { ...thread, turns: thread.turns.map((turn) => ({ ...turn, id: id(), live, startedAt: now() })) };
}

const TRY_CHIPS: { key: "fix" | "calendar" | "ide"; label: string }[] = [
  { key: "fix", label: "Fix the failing test" },
  { key: "calendar", label: "What's on my calendar?" },
  { key: "ide", label: "Open the Agentic IDE" },
];

export default function DemoStage({ className = "" }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { scale, shift } = useStageFit(wrap);
  const reduced = usePrefersReducedMotion();

  const [section, setSection] = useState<Section>("chats");
  const [trail, setTrail] = useState<Section[]>([]);
  const [layout, setLayout] = useState<IdeLayout>("threads");
  const [agentId, setAgentId] = useState<AgentId>("scout");

  const [turns, setTurns] = useState<HomeTurn[]>(initialTurns);
  const [homeDraft, setHomeDraft] = useState("");
  const [call, setCall] = useState<CallState | null>(null);

  const [threads, setThreads] = useState<LiveThread[]>(initialThreads);
  const [selected, setSelected] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const [subsDone, setSubsDone] = useState<number | null>(null);

  /** The visitor pressed something: the tour is over and stays over. */
  const [tookOver, setTookOver] = useState(false);
  const [cycle, setCycle] = useState(0);
  const typing = useRef(false);

  const login = threads.find((thread) => thread.id === LOGIN_THREAD_ID);
  const handedOff = Boolean(login);
  const loginRunning = Boolean(login?.turns.some((turn) => turn.live));

  // What the tour waits on, readable from inside its timers.
  const live = useRef({ handedOff, loginRunning });
  live.current = { handedOff, loginRunning };

  const go = useCallback((next: Section) => {
    setSection((now) => {
      if (now !== next) setTrail((past) => [...past.slice(-8), now]);
      return next;
    });
  }, []);

  const back = () => {
    const last = trail[trail.length - 1];
    if (!last) return;
    setTrail(trail.slice(0, -1));
    setSection(last);
  };

  const takeOver = useCallback(() => {
    setTookOver(true);
    // A sentence the tour was still typing is finished for the visitor to send.
    if (typing.current) {
      typing.current = false;
      setHomeDraft(LOGIN_PROMPT);
    }
  }, []);

  const sendHome = useCallback((text: string) => {
    const said = text.trim();
    if (!said) return;
    setTurns((all) => [...all, { id: id(), user: said, reply: replyFor(said), live: true, startedAt: now() }]);
    setHomeDraft("");
  }, []);

  const handOff = useCallback(() => {
    setThreads((all) => (all.some((thread) => thread.id === LOGIN_THREAD_ID) ? all : [loginThread(true), ...all]));
  }, []);

  const homeTurnDone = (turnId: number) => {
    const turn = turns.find((entry) => entry.id === turnId);
    setTurns((all) => all.map((entry) => (entry.id === turnId ? { ...entry, live: false } : entry)));
    if (turn?.reply.handoff) handOff();
  };

  const threadTurnDone = useCallback((threadId: string, turnId: number) => {
    setThreads((all) =>
      all.map((thread) =>
        thread.id === threadId
          ? { ...thread, turns: thread.turns.map((turn) => (turn.id === turnId ? { ...turn, live: false } : turn)) }
          : thread,
      ),
    );
  }, []);

  // The agent finishes whether or not anyone opens its thread to watch.
  useEffect(() => {
    if (!loginRunning) return;
    const timer = window.setTimeout(() => {
      setThreads((all) =>
        all.map((thread) =>
          thread.id === LOGIN_THREAD_ID
            ? { ...thread, turns: thread.turns.map((turn) => ({ ...turn, live: false })) }
            : thread,
        ),
      );
    }, BACKGROUND_RUN_MS);
    return () => window.clearTimeout(timer);
  }, [loginRunning]);

  const openLogin = useCallback(() => {
    handOff();
    setLayout("threads");
    setSelected(LOGIN_THREAD_ID);
    go("agentic-ide");
  }, [go, handOff]);

  const sendThread = () => {
    const said = threadDraft.trim();
    if (!said) return;
    setThreadDraft("");
    const open = threads.find((thread) => thread.id === selected);
    if (open) {
      const turn = { ...genericThreadTurn(said, CLI_NAMES[open.mark]), id: id(), live: true, startedAt: now() };
      setThreads((all) =>
        all.map((thread) => (thread.id === open.id ? { ...thread, age: "now", turns: [...thread.turns, turn] } : thread)),
      );
      return;
    }
    const thread: LiveThread = {
      id: `t-new-${id()}`,
      title: said.length > 44 ? `${said.slice(0, 44).trimEnd()}…` : said,
      mark: "claude",
      model: "Claude Opus 5.5",
      age: "now",
      branch: "main",
      turns: [{ ...genericThreadTurn(said, CLI_NAMES.claude), id: id(), live: true, startedAt: now() }],
    };
    setThreads((all) => [thread, ...all]);
    setSelected(thread.id);
  };

  // A call: the assistant listens, hears a request, and answers in the conversation.
  useEffect(() => {
    if (call !== "listening") return;
    if (turns.some((turn) => turn.live)) return;
    const timer = window.setTimeout(() => sendHome(live.current.handedOff ? CALENDAR_PROMPT : LOGIN_PROMPT), 2600);
    return () => window.clearTimeout(timer);
    // One request per call: it starts when the call does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call === null]);

  const onPhase = useCallback((phase: CallState | null) => {
    setCall((now) => (now === null ? null : (phase ?? "listening")));
  }, []);

  /**
   * The tour. Each wait is a timer this effect owns, so taking over (or
   * leaving the page) drops whatever was still to come.
   */
  useEffect(() => {
    if (tookOver || reduced) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => timers.push(window.setTimeout(resolve, ms)));
    const until = async (ready: () => boolean) => {
      while (!cancelled && !ready()) await wait(200);
    };
    void (async () => {
      await wait(1800);
      if (cancelled) return;
      typing.current = true;
      for (let i = 1; i <= LOGIN_PROMPT.length && !cancelled; i++) {
        setHomeDraft(LOGIN_PROMPT.slice(0, i));
        await wait(24);
      }
      if (cancelled) return;
      typing.current = false;
      await wait(500);
      if (cancelled) return;
      sendHome(LOGIN_PROMPT);
      await until(() => live.current.handedOff);
      await wait(1900);
      if (cancelled) return;
      openLogin();
      await wait(800);
      await until(() => !live.current.loginRunning);
      await wait(5600);
      if (cancelled) return;
      go("chats");
      await wait(4400);
      if (cancelled) return;
      // Start over from a clean window.
      setTurns(initialTurns());
      setThreads(initialThreads());
      setSelected(null);
      setTrail([]);
      setSubsDone(null);
      setCycle((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [tookOver, reduced, cycle, go, openLogin, sendHome]);

  // With reduced motion nothing plays: the window opens on the finished errand.
  useEffect(() => {
    if (!reduced) return;
    setTurns([...initialTurns(), { id: id(), user: LOGIN_PROMPT, reply: replyFor(LOGIN_PROMPT), live: false }]);
    setThreads([loginThread(false), ...initialThreads()]);
  }, [reduced]);

  const tryChip = (key: (typeof TRY_CHIPS)[number]["key"]) => {
    setTookOver(true);
    typing.current = false;
    if (key === "ide") {
      openLogin();
      return;
    }
    go("chats");
    if (turns.some((turn) => turn.live)) return;
    sendHome(key === "fix" ? LOGIN_PROMPT : CALENDAR_PROMPT);
  };

  const working: Partial<Record<AgentId, boolean>> = { scout: loginRunning };
  const openAgent = (next: AgentId) => {
    setAgentId(next);
    go("agents");
  };
  const scoutRow: ActivityRow[] = handedOff
    ? [{ label: loginRunning ? SCOUT_RUNNING : SCOUT_DONE, onOpen: openLogin }]
    : [];

  const openThread = threads.find((thread) => thread.id === selected) ?? null;
  const onIde = section === "agentic-ide";

  const sidebar =
    section === "agents" ? null : onIde && layout === "threads" ? (
      <ThreadTree
        threads={threads}
        selected={selected}
        subsDone={subsDone}
        onOpen={(threadId) => {
          setSubsDone(null);
          setSelected(threadId);
        }}
        onNew={() => setSelected(null)}
      />
    ) : onIde ? (
      <SidebarFrame header={<SearchBar />}>
        <Suspense fallback={null}>
          <GridNav onBack={() => go("chats")} />
        </Suspense>
      </SidebarFrame>
    ) : (
      <HomeSidebar onSection={go} onAgent={openAgent} working={working} />
    );

  return (
    <div className={className}>
      <div
        ref={wrap}
        className="demo-window"
        style={{ position: "relative", width: "100%", aspectRatio: `${WINDOW_W} / ${WINDOW_H}` }}
        aria-hidden="true"
      >
        <div
          style={{
            position: "absolute",
            left: -shift,
            top: 0,
            width: WINDOW_W,
            height: WINDOW_H,
            transformOrigin: "0 0",
            transform: `scale(${scale})`,
          }}
        >
          <AppFrame width={WINDOW_W} height={WINDOW_H} onInteract={takeOver}>
            <AppShell
              section={section}
              layout={layout}
              canGoBack={trail.length > 0}
              onHome={() => go("chats")}
              onBack={back}
              onLayout={setLayout}
              sidebar={sidebar}
              overlay={
                section === "plugins" ? (
                  <Suspense fallback={null}>
                    <PluginsView onClose={() => go("chats")} />
                  </Suspense>
                ) : undefined
              }
            >
              {section === "agents" ? (
                <Suspense fallback={null}>
                  <AgentsView agentId={agentId} working={working} onAgent={setAgentId} onLead={() => go("chats")} />
                </Suspense>
              ) : onIde ? (
                <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="sticky-agentic-ide">
                  {layout === "threads" ? (
                    <div className="min-h-0 flex-1">
                      <ThreadView
                        thread={openThread}
                        draft={threadDraft}
                        onDraft={setThreadDraft}
                        onSend={sendThread}
                        onTurnDone={threadTurnDone}
                        onSubs={setSubsDone}
                        onNew={() => setSelected(null)}
                      />
                    </div>
                  ) : (
                    <Suspense fallback={null}>
                      <GridScene />
                    </Suspense>
                  )}
                </div>
              ) : (
                <Conversation
                  turns={turns}
                  draft={homeDraft}
                  call={call}
                  running={loginRunning ? scoutRow : []}
                  done={loginRunning ? [] : scoutRow}
                  onDraft={setHomeDraft}
                  onSend={() => sendHome(homeDraft)}
                  onTurnDone={homeTurnDone}
                  onCall={() => setCall("listening")}
                  onHangUp={() => setCall(null)}
                  onPhase={onPhase}
                />
              )}
            </AppShell>
          </AppFrame>
        </div>
      </div>

      <div className="demo-try">
        <span className="demo-try__label">Try it yourself</span>
        {TRY_CHIPS.map((chip) => (
          <button key={chip.key} type="button" className="demo-try__chip" onClick={() => tryChip(chip.key)}>
            {chip.label}
          </button>
        ))}
      </div>

      <p className="sr-only">
        Interactive demo of the app. It opens on the front page, a conversation with the assistant. The person asks
        for a failing login test to be fixed; the assistant checks the failed run on GitHub and hands the job to an
        agent called Scout. The demo then moves to the Agentic IDE, where the agent's thread shows its work: three
        sub-agents reproduce the failure, trace its cause and run the test suite, and the thread ends with the changed
        files and an open pull request. The sidebar also leads to the agents and their chats and to the plugin
        catalogue. Three buttons under the window start the same errands: fix the failing test, ask what is on the
        calendar, and open the Agentic IDE.
      </p>
    </div>
  );
}
