/**
 * The Agents section — a clone of the app's agent roster and an agent's chat.
 *
 * Markup and class names are copied from the running app's own DOM:
 * views/DodaiosAgentsView.tsx (the frame), society/roster/RosterRail.tsx and
 * RosterRow.tsx (the roster with the assistant on top), and the society chat
 * (the transcript, the person's tinted bubble, the agent's bubble with its
 * "Worked for …" line, the composer). The `as-*` classes are the section's
 * own stylesheet, synced into app.css like everything else.
 *
 * The composer is real: a message typed into it is answered by the agent,
 * which says plainly that this is a demo.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { PROSE_AGENT } from "./classes";
import { ChipField } from "./Conversation";
import { ASSISTANT_NAME, DEMO_AGENTS, type AgentId, type AgentMessage, type DemoAgent } from "./demoData";
import { ChevronRight, Ellipsis, Mic, Plus, Search, Send } from "./lucide";
import { Blocks } from "./Markup";
import { AgentFace } from "./Pet";

const PLUS_ICON = "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none";

function RosterRow({
  agent,
  active,
  working,
  onOpen,
}: {
  agent: DemoAgent;
  active: boolean;
  working: boolean;
  onOpen: (id: AgentId) => void;
}) {
  return (
    <li className="relative">
      <div
        data-agent-id={agent.id}
        data-active={active ? "true" : undefined}
        className="as-row as-reveal-host select-none [&:has(>[data-row-main]:focus-visible)]:ring-2 [&:has(>[data-row-main]:focus-visible)]:ring-ring"
        style={{ "--agent-tint": agent.tint } as CSSProperties}
      >
        <button
          type="button"
          className="as-avatar rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
          onClick={() => onOpen(agent.id)}
        >
          <AgentFace pet={agent.pet} size={40} state={working ? "working" : "idle"} />
          <span data-status={working ? "working" : "idle"} data-testid="roster-status" className="as-status" />
        </button>
        <button
          type="button"
          data-row-main="true"
          className="flex min-w-0 flex-1 select-none flex-col justify-center gap-0.5 self-stretch text-left focus-visible:outline-none"
          tabIndex={-1}
          onClick={() => onOpen(agent.id)}
        >
          <span className="as-row-name">{agent.name}</span>
          <span className="as-row-preview" data-kind="message" data-testid="roster-preview">
            {working ? "Working in the Agentic IDE…" : agent.preview}
          </span>
        </button>
        <button
          type="button"
          aria-expanded="false"
          className="as-reveal as-round-button -mr-1 shrink-0"
          data-size="sm"
          data-testid="roster-row-more"
          tabIndex={-1}
        >
          <Ellipsis className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

function Message({ message, tint }: { message: AgentMessage; tint: string }) {
  if (message.who === "user") {
    return (
      <div className="flex flex-col gap-2">
        {message.stamp && (
          <p className="run-stamp" data-testid="transcript-stamp">
            <time>{message.stamp}</time>
          </p>
        )}
        <div className="flex min-w-0 max-w-[min(85%,42rem)] flex-col items-end gap-1 self-end">
          <div
            data-testid="user-bubble"
            className="jarvis-chat-tinted min-w-0 rounded-[20px] px-4 py-2.5 text-base leading-6 [overflow-wrap:anywhere]"
            style={{ background: tint, color: "rgb(255, 255, 255)" }}
          >
            <span data-testid="tool-choice-chips" data-editable="false" className="whitespace-pre-wrap">
              {message.text}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-1.5" data-testid="messenger-turn" data-status="done">
            <div className="flex min-w-0" data-testid="agent-message-bubble">
              <div className="jarvis-chat-in min-w-0 max-w-[min(85%,42rem)] rounded-[20px] px-4 py-2.5">
                <Blocks blocks={message.blocks ?? []} className={PROSE_AGENT} />
              </div>
            </div>
            {message.worked && (
              <button type="button" className="run-work" aria-expanded="false" data-testid="work-disclosure" tabIndex={-1}>
                <span className="min-w-0 truncate">
                  <span>{message.worked}</span>
                  {message.steps && (
                    <span>
                      <span className="run-work-sep" aria-hidden="true">
                        {" · "}
                      </span>
                      {message.steps}
                    </span>
                  )}
                </span>
                <ChevronRight className="run-work-chev h-3 w-3 shrink-0" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentsView({
  agentId,
  working,
  onAgent,
  onLead,
}: {
  agentId: AgentId;
  working: Partial<Record<AgentId, boolean>>;
  onAgent: (id: AgentId) => void;
  onLead: () => void;
}) {
  const agent = DEMO_AGENTS.find((entry) => entry.id === agentId) ?? DEMO_AGENTS[0];
  const [draft, setDraft] = useState("");
  /** What was said in each agent's chat on top of its scripted history. */
  const [said, setSaid] = useState<Partial<Record<AgentId, AgentMessage[]>>>({});
  const [pending, setPending] = useState<AgentId | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const messages = [...agent.chat, ...(said[agent.id] ?? [])];

  useLayoutEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.id, messages.length]);

  // The agent answers a moment after it was written to.
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => {
      const name = DEMO_AGENTS.find((entry) => entry.id === pending)?.name ?? "The agent";
      setSaid((all) => ({
        ...all,
        [pending]: [
          ...(all[pending] ?? []),
          {
            who: "agent",
            blocks: [
              { p: "I am the demo on the website, so nothing runs here." },
              { p: `In the app, ${name} takes this as its next job, works on it in the background with its own tools and memory, and answers you in this chat.` },
            ],
            worked: "Worked for 1.2s",
            steps: "1 step",
          },
        ],
      }));
      setPending(null);
    }, 1300);
    return () => window.clearTimeout(id);
  }, [pending]);

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setSaid((all) => ({ ...all, [agent.id]: [...(all[agent.id] ?? []), { who: "user", text }] }));
    setDraft("");
    setPending(agent.id);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col" data-testid="society-view">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col [--as-caption-gap:2rem]">
          <div data-testid="agent-card" className="agent-card-workspace flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
            <div
              className="agent-chat-layout agent-section as-shell"
              data-roster="full"
              data-options-open="false"
              data-testid="agent-shell"
              style={{ gridTemplateColumns: "280px minmax(0px, 1fr) 0px", "--agent-pane-width": "280px" } as CSSProperties}
            >
              <div className="as-region">
                <div className="flex min-h-0 flex-1 flex-col" data-testid="shell-roster">
                  <aside
                    data-testid="society-roster-rail"
                    className="agent-section as-roster flex h-full min-h-0 flex-col border-border w-full border-0"
                  >
                    <div className="as-roster-top">
                      <button type="button" className="as-round-button" aria-pressed="false" data-testid="roster-search-toggle" tabIndex={-1}>
                        <Search className="h-4 w-4" aria-hidden />
                      </button>
                      <div className="relative">
                        <button type="button" className="as-round-button" data-testid="society-create-button" aria-expanded="false" tabIndex={-1}>
                          <Plus className={PLUS_ICON} aria-hidden />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-center px-3 pb-3 pt-1">
                      <button
                        type="button"
                        className="as-hero"
                        data-testid="roster-lead"
                        style={{ "--agent-tint": "#ffcd61" } as CSSProperties}
                        tabIndex={-1}
                        onClick={onLead}
                      >
                        <span className="as-avatar as-hero-face">
                          <AgentFace pet="gigi" size={60} />
                          <span data-status="idle" data-testid="roster-status" className="as-status" />
                        </span>
                        <span className="as-hero-name">{ASSISTANT_NAME}</span>
                      </button>
                    </div>
                    <div className="relative overflow-hidden min-h-0 flex-1">
                      <div className="h-full w-full rounded-[inherit] [&>div]:!block" style={{ overflow: "hidden" }}>
                        <div style={{ minWidth: "100%", display: "table" }}>
                          <div className="flex flex-col gap-0.5 px-2 pb-3">
                            <ul className="flex flex-col gap-0.5" data-testid="roster-agents">
                              {DEMO_AGENTS.map((entry) => (
                                <RosterRow
                                  key={entry.id}
                                  agent={entry}
                                  active={entry.id === agent.id}
                                  working={Boolean(working[entry.id])}
                                  onOpen={onAgent}
                                />
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
              <div className="as-region as-stage" data-testid="shell-stage">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="agent-card-chat">
                    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div
                          className="relative flex h-full min-h-0 flex-col bg-background"
                          data-testid="society-chat"
                          style={{ "--chat-top-chrome": "32px" } as CSSProperties}
                        >
                          <div className="relative flex min-h-0 flex-1">
                            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                              <div
                                ref={transcript}
                                className="chat-scroller min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-[calc(var(--chat-top-chrome,0px)+1.25rem)] sm:px-6"
                                data-testid="society-transcript"
                                style={{ overflowAnchor: "none", scrollbarWidth: "none" }}
                              >
                                <div className="mx-auto w-full min-w-0 max-w-[52rem] flex flex-col gap-3">
                                  {messages.map((message, i) => (
                                    <Message key={i} message={message} tint={agent.tint} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
                            <div className="mx-auto w-full min-w-0 max-w-[52rem] as-composer relative flex items-end gap-1.5">
                              <div className="relative">
                                <button type="button" aria-expanded="false" data-testid="composer-plus" className="as-round-button" tabIndex={-1}>
                                  <Plus className={PLUS_ICON} aria-hidden />
                                </button>
                              </div>
                              <ChipField
                                value={draft}
                                placeholder={`Message ${agent.name}`}
                                className="composer-chip-field min-h-[32px] flex-1 bg-transparent px-1 py-1.5 text-sm leading-relaxed text-foreground outline-none max-h-[180px]"
                                onChange={setDraft}
                                onSubmit={send}
                              />
                              <button
                                type="button"
                                data-testid="dictation-button"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong rounded-full"
                                tabIndex={-1}
                              >
                                <Mic className="h-4 w-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                disabled={draft.trim().length === 0 || pending !== null}
                                data-testid="composer-send"
                                className="as-round-button"
                                data-tone="send"
                                tabIndex={-1}
                                onClick={send}
                              >
                                <Send className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
