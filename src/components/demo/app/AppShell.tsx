/**
 * The app's window: the caption strip, the sidebar and the content sheet.
 *
 * Markup and class names are copied from the running app's own DOM — App.tsx
 * (the shell), layout/TopBar.tsx with SectionNavButtons and IdeLayoutSwitch
 * (the caption), layout/Sidebar.tsx, SidebarSearchBar.tsx, SidebarAgents.tsx
 * and the profile row (the sidebar). The app's own stylesheet (app.css) styles
 * them, so they render as the app renders them. Only the data is the demo's.
 * The caption also carries the status light (layout/StatusLight.tsx).
 *
 * Keep the class strings verbatim when the app changes; then run
 * scripts/sync-app-ui.mjs so the new classes are in app.css.
 */
import type { ReactNode } from "react";

import { ASSISTANT_NAME, DEMO_AGENTS, USER_NAME, type AgentId } from "./demoData";
import { AgentFace, cn } from "./Pet";
import { AgentsIcon, ArtifactsIcon, CodeIcon, ExtensionsIcon, MarketplaceIcon, SpeechIcon } from "./sectionIcons";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Download,
  Ellipsis,
  House,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  MessagesSquare,
  PanelBottom,
  PanelRight,
  Search,
} from "./lucide";

export { cn };

/** `SIDEBAR_DEFAULT_WIDTH` in the app's Sidebar.tsx. */
export const SIDEBAR_WIDTH = 240;

export type Section = "chats" | "agents" | "agentic-ide" | "plugins";
export type IdeLayout = "grid" | "threads";

type IconComponent = (props: { className?: string; strokeWidth?: number; "aria-hidden"?: boolean }) => ReactNode;

// ---------------------------------------------------------------------------
// Caption strip (TopBar.tsx, SectionNavButtons.tsx, IdeLayoutSwitch.tsx)
// ---------------------------------------------------------------------------

const NAV_BUTTON =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";
const SEGMENT =
  "relative z-[1] flex h-full items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT_PX = 40;

function LayoutSwitch({ layout, onLayout }: { layout: IdeLayout; onLayout: (next: IdeLayout) => void }) {
  const index = layout === "grid" ? 0 : 1;
  const tone = (on: boolean) => (on ? "text-foreground-strong" : "text-muted-foreground hover:text-foreground");
  return (
    <div
      role="radiogroup"
      data-testid="ide-layout-switch"
      className="relative flex h-7 items-center rounded-full border border-border bg-secondary/70 p-[3px] shadow-rim dark:bg-card pointer-events-auto"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-[3px] left-[3px] rounded-full border border-border-strong/60 bg-background shadow-[0_1px_2px_rgb(var(--scrim-rgb)/0.25)] dark:border-border-strong dark:bg-surface-raised transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: SEGMENT_PX,
          transform: `translateX(${index * SEGMENT_PX}px)`,
        }}
      />
      <button
        type="button"
        role="radio"
        data-testid="ide-layout-grid"
        aria-checked={layout === "grid"}
        className={cn(SEGMENT, tone(layout === "grid"))}
        style={{ width: SEGMENT_PX }}
        tabIndex={-1}
        onClick={() => onLayout("grid")}
      >
        <LayoutGrid className="h-4 w-4" strokeWidth={1.9} aria-hidden />
      </button>
      <button
        type="button"
        role="radio"
        data-testid="ide-layout-threads"
        aria-checked={layout === "threads"}
        className={cn(SEGMENT, tone(layout === "threads"))}
        style={{ width: SEGMENT_PX }}
        tabIndex={-1}
        onClick={() => onLayout("threads")}
      >
        <MessagesSquare className="h-4 w-4" strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

/** What runs and what waits on the person, for the caption's status light. */
export interface StatusCounts {
  running: number;
  needs: number;
}

/**
 * `StatusLight.tsx`: one calm chip in the caption, "2 running · 1 need you",
 * or "All quiet". Its list opens on a click in the app; here it is inert.
 */
function StatusLight({ status }: { status: StatusCounts }) {
  const parts: string[] = [];
  if (status.running > 0) parts.push(`${status.running} running`);
  if (status.needs > 0) parts.push(`${status.needs} need you`);
  const summary = parts.length > 0 ? parts.join(" · ") : "All quiet";
  return (
    <button
      type="button"
      aria-label={`Status: ${summary}`}
      title={summary}
      aria-haspopup="dialog"
      aria-expanded="false"
      data-testid="status-light"
      data-running={status.running}
      data-needs-you={status.needs}
      data-tone="calm"
      className={cn(
        "pointer-events-auto mx-1 inline-flex h-6 shrink-0 items-center gap-1.5 self-center rounded-full px-2.5 text-body transition-colors duration-150 hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        status.needs > 0 ? "text-foreground" : "text-muted-foreground",
      )}
      tabIndex={-1}
    >
      <span
        aria-hidden
        data-testid="status-light-dot"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          status.running > 0 || status.needs > 0 ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="hidden whitespace-nowrap tabular-nums md:inline" data-testid="status-light-text">
        {summary}
      </span>
    </button>
  );
}

function TopBar({
  section,
  layout,
  canGoBack,
  status,
  sidePanel,
  onHome,
  onBack,
  onLayout,
  onSidePanel,
}: {
  section: Section;
  layout: IdeLayout;
  canGoBack: boolean;
  status: StatusCounts;
  sidePanel: boolean;
  onHome: () => void;
  onBack: () => void;
  onLayout: (next: IdeLayout) => void;
  onSidePanel?: () => void;
}) {
  const ide = section === "agentic-ide";
  return (
    <div
      data-testid="window-caption"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[120] flex h-8 items-stretch bg-transparent"
    >
      <div className="flex shrink-0 items-center" data-testid="section-nav-buttons" role="group">
        <button type="button" data-testid="section-nav-home" className={NAV_BUTTON} tabIndex={-1} onClick={onHome}>
          <House className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="section-nav-back"
          disabled={!canGoBack}
          className={NAV_BUTTON}
          tabIndex={-1}
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" data-testid="section-nav-forward" disabled className={NAV_BUTTON} tabIndex={-1}>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="relative flex shrink-0 items-center">
        <button
          type="button"
          aria-expanded="false"
          data-testid="layout-menu-button"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-secondary hover:text-foreground"
          tabIndex={-1}
        >
          <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
          <span>Layout</span>
        </button>
      </div>
      <div className="pywebview-drag-region min-w-0 flex-1" />
      {ide && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center">
          <LayoutSwitch layout={layout} onLayout={onLayout} />
        </div>
      )}
      <div className="flex shrink-0 items-center">
        <StatusLight status={status} />
        {ide && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-pressed="false"
              aria-label="Show terminal"
              title="Show terminal"
              data-testid="thread-terminal-toggle"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              tabIndex={-1}
            >
              <PanelBottom className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-expanded={sidePanel}
              aria-label={sidePanel ? "Close side panel" : "Open side panel"}
              title={sidePanel ? "Close side panel" : "Open side panel"}
              aria-controls="ide-side-panel"
              data-testid="ide-side-panel-toggle"
              onClick={onSidePanel}
              className={cn(
                "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                sidePanel && "bg-secondary text-foreground",
              )}
              tabIndex={-1}
            >
              <PanelRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar (Sidebar.tsx and the pieces it renders)
// ---------------------------------------------------------------------------

const ROW_CLASS =
  "flex min-h-8 w-full items-center gap-3 rounded-lg px-3 text-base text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** `NavRow` in Sidebar.tsx. */
function NavRow({
  id,
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  id: string;
  icon: IconComponent;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <div>
        <button
          type="button"
          tabIndex={-1}
          data-testid={`nav-row-${id}`}
          onClick={onClick}
          className={cn(
            "group relative flex h-8 w-full items-center gap-3 rounded-lg px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "jarvis-nav-active bg-secondary text-foreground-strong" : "text-foreground hover:bg-secondary",
          )}
        >
          <Icon
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              "h-[18px] w-[18px] shrink-0 transition-colors",
              active ? "text-foreground-strong" : "text-foreground",
            )}
          />
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="truncate">{label}</span>
          </span>
        </button>
      </div>
    </li>
  );
}

/** `SidebarAgents.tsx`. `working` lights the agent's pulse dot. */
function SidebarAgents({
  working,
  onAgent,
}: {
  working: Partial<Record<AgentId, boolean>>;
  onAgent: (id: AgentId) => void;
}) {
  return (
    <section className="mt-5 px-2" aria-label="Agents" data-testid="sidebar-agents">
      <h2 className="px-3 pb-1.5 text-sm text-muted-foreground">Agents</h2>
      <ul className="space-y-px">
        {DEMO_AGENTS.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              tabIndex={-1}
              title={agent.name}
              data-testid="sidebar-agent-row"
              onClick={() => onAgent(agent.id)}
              className="flex h-8 w-full items-center gap-3 rounded-lg px-3 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground hover:bg-secondary"
            >
              <span className="-ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                <AgentFace pet={agent.pet} size={20} state={working[agent.id] ? "working" : "idle"} />
              </span>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {working[agent.id] && (
                <span
                  data-testid="sidebar-agent-state"
                  data-state="working"
                  className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-faint"
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent animate-jarvis-pulse" />
                  Working
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The profile row at the foot of every sidebar. */
export function SidebarFoot() {
  return (
    <div className="shrink-0 border-t border-border px-2 py-1.5">
      <div className="flex items-center gap-0.5">
        <button type="button" tabIndex={-1} data-testid="sidebar-profile-toggle" className={cn(ROW_CLASS, "min-w-0 flex-1")}>
          <span className="relative shrink-0">
            <span
              aria-hidden
              data-testid="sidebar-profile-initial"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase text-muted-foreground"
            >
              {USER_NAME.charAt(0)}
            </span>
          </span>
          <span data-testid="sidebar-profile-name" className="min-w-0 flex-1 truncate text-left">
            {USER_NAME}
          </span>
        </button>
        <div className="relative">
          <button
            type="button"
            tabIndex={-1}
            data-testid="update-button"
            data-state="idle"
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Download aria-hidden strokeWidth={1.75} className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          tabIndex={-1}
          data-testid="nav-row-marketplace"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MarketplaceIcon aria-hidden strokeWidth={1.75} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** The sidebar's frame; the front page and the Agentic IDE fill it differently. */
export function SidebarFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <aside
      style={{ width: SIDEBAR_WIDTH }}
      data-testid="sidebar"
      data-railed="false"
      className="jarvis-nav-surface relative isolate z-20 flex h-full shrink-0 flex-col pt-8"
    >
      <div className="flex h-10 items-center px-4">
        <div className="flex items-center w-full gap-2">{header}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-jarvis">{children}</div>
      <SidebarFoot />
    </aside>
  );
}

/** `SidebarSearchBar.tsx`. */
export function SearchBar() {
  return (
    <div role="search" className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1">
        <div className="flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors border-border bg-input hover:border-border-strong">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-expanded="false"
            aria-label={`Search ${ASSISTANT_NAME}`}
            title={`Search ${ASSISTANT_NAME}`}
            placeholder="Search"
            data-testid="sidebar-search"
            readOnly
            tabIndex={-1}
            className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span data-testid="sidebar-voice-dot" role="img" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span className="hidden shrink-0 items-center gap-0.5 sm:inline-flex" aria-hidden>
            {["Ctrl", "Space"].map((cap) => (
              <kbd
                key={cap}
                className="rounded border border-border bg-background px-1 font-sans text-[10px] leading-4 text-muted-foreground"
              >
                {cap}
              </kbd>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The front page's sidebar: the sections, the agents, the earlier chats. */
export function HomeSidebar({
  onSection,
  onAgent,
  working,
}: {
  onSection: (next: Section) => void;
  onAgent: (id: AgentId) => void;
  working: Partial<Record<AgentId, boolean>>;
}) {
  return (
    <SidebarFrame header={<SearchBar />}>
      <nav aria-label="Sections" className="space-y-px px-2 py-2">
        <ul className="space-y-px">
          <li>
            <button
              type="button"
              tabIndex={-1}
              data-testid="sidebar-new-chat"
              aria-label={ASSISTANT_NAME}
              title={ASSISTANT_NAME}
              onClick={() => onSection("chats")}
              className={ROW_CLASS}
            >
              <MessageCircle aria-hidden strokeWidth={1.75} className="h-[18px] w-[18px] shrink-0" />
              <span>{ASSISTANT_NAME}</span>
            </button>
          </li>
          <NavRow id="agents" icon={AgentsIcon as IconComponent} label="Agents" onClick={() => onSection("agents")} />
          <NavRow
            id="agentic-ide"
            icon={CodeIcon as IconComponent}
            label="Agentic IDE"
            onClick={() => onSection("agentic-ide")}
          />
          <NavRow id="dictation" icon={SpeechIcon as IconComponent} label={`${ASSISTANT_NAME} Voice`} />
        </ul>
        <ul className="space-y-px">
          <NavRow
            id="plugins"
            icon={ExtensionsIcon as IconComponent}
            label="Plugins / Skills / MCP"
            onClick={() => onSection("plugins")}
          />
          <NavRow id="visualization" icon={ArtifactsIcon as IconComponent} label="Artifacts" />
        </ul>
        <button
          type="button"
          tabIndex={-1}
          data-testid="sidebar-more-toggle"
          aria-expanded="false"
          className="flex min-h-8 w-full items-center gap-3 rounded-lg px-3 text-base transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground"
        >
          <Ellipsis aria-hidden strokeWidth={1.75} className="h-[18px] w-[18px] shrink-0" />
          <span>More</span>
        </button>
      </nav>
      <SidebarAgents working={working} onAgent={onAgent} />
      <section className="mt-5 px-2 pb-3" aria-label="Earlier chats">
        <button
          type="button"
          data-testid="earlier-chats"
          className="flex h-8 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
        >
          <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">Earlier chats</span>
        </button>
      </section>
    </SidebarFrame>
  );
}

// ---------------------------------------------------------------------------
// The shell (App.tsx)
// ---------------------------------------------------------------------------

export function AppShell({
  section,
  layout,
  canGoBack,
  status,
  sidePanel = false,
  onHome,
  onBack,
  onLayout,
  onSidePanel,
  sidebar,
  overlay,
  children,
}: {
  section: Section;
  layout: IdeLayout;
  canGoBack: boolean;
  /** What the caption's status light counts. */
  status: StatusCounts;
  /** Whether the Agentic IDE's side panel is open. */
  sidePanel?: boolean;
  onHome: () => void;
  onBack: () => void;
  onLayout: (next: IdeLayout) => void;
  onSidePanel?: () => void;
  /** Absent where the app shows a section across the whole window (Agents). */
  sidebar: ReactNode;
  /** What the app draws over the window below the caption (Plugins). */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const framed = Boolean(sidebar);
  return (
    <div className="jarvis-nav-surface relative isolate flex h-screen w-screen overflow-hidden text-foreground">
      {sidebar}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* A section the app shows across the whole window (Agents) has neither
            the rule under the caption nor the sheet's rounded edge. */}
        {framed && <div className="h-8 shrink-0" data-testid="caption-rule" />}
        <div className={cn(framed && "jarvis-sheet", "flex min-h-0 min-w-0 flex-1 flex-col")}>
          <TopBar
            section={section}
            layout={layout}
            canGoBack={canGoBack}
            status={status}
            sidePanel={sidePanel}
            onHome={onHome}
            onBack={onBack}
            onLayout={onLayout}
            onSidePanel={onSidePanel}
          />
          <div className="min-h-0 flex-1 jarvis-section-stage" data-testid="jarvis-section-stage">
            {children}
          </div>
        </div>
      </main>
      {overlay}
    </div>
  );
}
