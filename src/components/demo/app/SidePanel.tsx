/**
 * The Agentic IDE's right-hand side panel, cloned from the app's own markup.
 *
 * Every element and class string below is copied from the app's components:
 * sidePanel/IdeSidePanel (the <aside>, its header with the tab strip, "+",
 * split and maximize), sidePanel/sidePanelTabs (the registry: order, letters,
 * icons, labels), sidePanel/SurfaceLauncher (an open panel with no tab yet),
 resources/ResourcesTab, resources/ResourceRows, resources/ResourceChart
 * and resources/resourcesModel (the Resources tab), and AgentMark. English
 * strings come from the app's en.json. The app's compiled stylesheet styles them.
 *
 * The one thing that is not the app's DOM is the Resources chart: the app draws
 * it with a charting library. Here the same stacked areas, grid, axes and
 * margins are drawn with one inline SVG and positioned labels.
 *
 * Content is placeholder only: an invented "web-app" project and three agents.
 *
 * The panel's natural width in the app is 340 px (IdeSidePanel DEFAULT_PX); the
 * root here fills whatever box the caller gives it.
 */
import type { ReactNode } from "react";

import claudeLogo from "@/assets/app/claude-color.svg?url";
import openaiLogo from "@/assets/app/openai.svg?url";
import { PROJECT } from "./demoData";
import {
  Activity,
  Bot,
  Columns2,
  Cpu,
  CreditCard,
  ChevronRight,
  FileDiff,
  Files,
  FolderTree,
  GitBranch,
  Globe,
  Maximize2,
  MessageSquare,
  Plus,
  Search,
  SquareTerminal,
  Terminal,
  X,
} from "./lucide";
import { cn } from "./Pet";

/** IdeSidePanel DEFAULT_PX: the width the panel opens at. */
export const SIDE_PANEL_DEFAULT_PX = 340;

export type SidePanelTab = "launcher" | "resources";

type IconComponent = typeof Activity;

// ---------------------------------------------------------------------------
// IdeSidePanel: the frame and its header
// ---------------------------------------------------------------------------

const HEADER_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors " +
  "hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * IdeSidePanel as it looks with no tab open (the launcher) or with the
 * Resources tab in front.
 *
 * The app's panel header has no close button: the panel opens and shuts from
 * the window caption only (the panel button in AppShell.tsx).
 */
export function SidePanel({ tab, onTab }: { tab: SidePanelTab; onTab: (tab: SidePanelTab) => void }) {
  const tabs = tab === "resources" ? (["resources"] as const) : ([] as const);
  return (
    <aside
      id="ide-side-panel"
      data-testid="ide-side-panel"
      aria-label="Side panel"
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-card/40"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <div
          role="tablist"
          aria-label="Side panel tabs"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg transition-colors"
        >
          {tabs.map((id) => (
            <div
              key={id}
              className="group/tab flex h-8 min-w-0 shrink-0 touch-none select-none items-center gap-1 rounded-lg pl-2.5 pr-1 text-sm transition-colors bg-secondary text-foreground"
            >
              <button
                type="button"
                tabIndex={-1}
                role="tab"
                aria-selected
                aria-controls="ide-side-panel-content"
                data-testid={`ide-side-panel-tab-${id}`}
                className="flex min-w-0 items-center gap-1.5 focus-visible:outline-none"
              >
                <Activity className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate font-medium">Resources</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Close tab: Resources"
                title="Close tab"
                data-testid={`ide-side-panel-close-${id}`}
                onClick={() => onTab("launcher")}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="relative">
          <button
            type="button"
            tabIndex={-1}
            data-testid="ide-side-panel-add"
            aria-label="Add a tab"
            title="Add a tab"
            aria-haspopup="menu"
            aria-expanded={false}
            className={HEADER_BTN}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          tabIndex={-1}
          data-testid="ide-side-panel-split"
          aria-label="Split: show two tabs side by side"
          title="Open a second tab to split the panel"
          aria-pressed={false}
          disabled
          className={HEADER_BTN}
        >
          <Columns2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-testid="ide-side-panel-maximize"
          aria-label="Fill the whole view"
          title="Fill the whole view"
          aria-pressed={false}
          className={HEADER_BTN}
        >
          <Maximize2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div
        id="ide-side-panel-content"
        role="tabpanel"
        data-testid="ide-side-panel-content"
        className="relative min-h-0 flex-1"
      >
        {tab === "launcher" ? (
          <SurfaceLauncher onResources={() => onTab("resources")} />
        ) : (
          <div data-testid="ide-side-panel-column-resources" className="absolute inset-0 h-full">
            <ResourcesTab />
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Where the side panel opens, right of the grid or the thread
 * (AgenticIdeView): no width while it is shut, DEFAULT_PX while it is open.
 * The caption's panel button (AppShell.tsx) opens and shuts it.
 */
export function SidePanelHost({ children }: { children?: ReactNode }) {
  return (
    <div
      data-testid="ide-side-panel-host"
      className="h-full shrink-0 relative transition-[width] duration-200 motion-reduce:transition-none"
      style={{ width: children ? SIDE_PANEL_DEFAULT_PX : 0 }}
    >
      {children && (
        <div data-testid="ide-side-panel-body" className="relative h-full">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SurfaceLauncher: what an open panel with no tab shows
// ---------------------------------------------------------------------------

/**
 * The launcher's rows in the app's order: the browser, a plain terminal, then
 * every other registry tab (SIDE_PANEL_TABS).
 */
const SURFACES: readonly {
  id: string;
  label: string;
  icon: IconComponent;
  shortcut: string;
}[] = [
  { id: "browser", label: "Browser", icon: Globe, shortcut: "B" },
  { id: "terminal", label: "Terminal", icon: SquareTerminal, shortcut: "T" },
  { id: "agents", label: "Agents", icon: Bot, shortcut: "A" },
  { id: "changes", label: "Changes", icon: FileDiff, shortcut: "C" },
  { id: "files", label: "Folder", icon: FolderTree, shortcut: "F" },
  { id: "search", label: "Search", icon: Search, shortcut: "S" },
  { id: "git", label: "Git", icon: GitBranch, shortcut: "G" },
  { id: "skills", label: "Skills", icon: Files, shortcut: "K" },
  { id: "chat", label: "Chat", icon: MessageSquare, shortcut: "H" },
  {
    id: "subscriptions",
    label: "Subscriptions",
    icon: CreditCard,
    shortcut: "U",
  },
  { id: "resources", label: "Resources", icon: Activity, shortcut: "R" },
];

function SurfaceKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[11px] font-medium leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}

function SurfaceLauncher({ onResources }: { onResources: () => void }) {
  return (
    <div
      tabIndex={-1}
      aria-label="Open a surface"
      data-testid="ide-side-panel-launcher"
      className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 outline-none"
    >
      <div className="w-full max-w-xs py-6">
        <h3 className="mb-3 text-center text-sm font-medium text-foreground">Open a surface</h3>
        <div className="flex flex-col gap-0.5">
          {SURFACES.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                tabIndex={-1}
                aria-disabled={false}
                aria-keyshortcuts={action.shortcut}
                data-testid={`ide-side-panel-launch-${action.id}`}
                onClick={action.id === "resources" ? onResources : undefined}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                <SurfaceKbd>{action.shortcut}</SurfaceKbd>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentMark (AgentMark.tsx), the plain small variant the resource rows use
// ---------------------------------------------------------------------------

type CliMark = "claude" | "codex" | "gemini";

/** Claude's mark is full colour on a clear ground (an <img>); Codex's is an ink mask; Gemini CLI has no entry. */
const AGENT_LOGOS: Record<CliMark, { url: string; ground: "any" | "ink" } | null> = {
  claude: { url: claudeLogo, ground: "any" },
  codex: { url: openaiLogo, ground: "ink" },
  gemini: null,
};

function AgentMark({ agent, label }: { agent: CliMark; label: string }) {
  const asset = AGENT_LOGOS[agent];
  return (
    <span
      data-testid={`agent-mark-${agent}`}
      data-ground={asset?.ground ?? "none"}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden text-micro font-bold tracking-tight text-muted-foreground opacity-70 h-4 w-4"
    >
      {asset?.ground === "ink" ? (
        <span
          className="block bg-foreground h-full w-full"
          style={{
            WebkitMaskImage: `url("${asset.url}")`,
            maskImage: `url("${asset.url}")`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : asset ? (
        <img src={asset.url} alt="" className="block object-contain h-full w-full" />
      ) : (
        <span className="font-mono">{label.trim().slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// resourcesModel: formats and the spark path, as the app computes them
// ---------------------------------------------------------------------------

const LOCALE = "en-US";
/** WINDOW_S: the charts reach back five minutes. */
const WINDOW_S = 300;
/** One sample every two seconds (POLL_MS), so a full window holds 150. */
const SLOTS = 150;

/** "843 MB", "1.2 GB". */
function formatMemory(mb: number): string {
  const value = Math.max(0, mb);
  if (value >= 1024) {
    const gb = value / 1024;
    return `${gb.toLocaleString(LOCALE, { maximumFractionDigits: gb >= 100 ? 0 : 1 })} GB`;
  }
  return `${Math.round(value).toLocaleString(LOCALE)} MB`;
}

/** One decimal below ten, none above: 0.4 %, 9.5 %, 37 %. */
function formatPercent(value: number): string {
  const clamped = Math.max(0, value);
  const digits = clamped > 0 && clamped < 10 ? 1 : 0;
  return `${clamped.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

function sparkPath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  options: { ceiling?: number; floor?: number; slots?: number } = {},
): string {
  const slots = Math.max(2, options.slots ?? values.length);
  const offset = slots - values.length;
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return "";
  const top = options.ceiling ?? Math.max(options.floor ?? 0, ...present);
  const scale = top > 0 ? top : 1;
  const points: string[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const x = ((index + offset) / (slots - 1)) * width;
    const y = height - 1 - (Math.min(value, scale) / scale) * (height - 2);
    points.push(`${points.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  });
  if (points.length === 1) points.push(points[0].replace("M", "L"));
  return points.join(" ");
}

// ---------------------------------------------------------------------------
// Demo readings: five minutes of samples, ending at the figures on screen
// ---------------------------------------------------------------------------

/** A smooth, repeatable wobble around `base` that lands on `end` at the last sample. */
function wobble(base: number, amp: number, seed: number, end: number, startAt = 0): (number | null)[] {
  return Array.from({ length: SLOTS }, (_, i) => {
    if (i < startAt) return null;
    if (i === SLOTS - 1) return end;
    const value =
      base +
      amp *
        (0.6 * Math.sin(i * 0.21 + seed) +
          0.4 * Math.sin(i * 0.057 + seed * 2.3) +
          0.25 * Math.sin(i * 0.83 + seed * 0.7));
    return Math.max(0, Math.round(value * 10) / 10);
  });
}

const num = (values: readonly (number | null)[]) => values.map((value) => value ?? 0);

const AGENT_CPU = {
  scout: wobble(15, 6, 0.4, 18),
  atlas: wobble(8, 4, 2.1, 9.4),
  // Quill started three minutes ago: its line begins there.
  quill: wobble(4, 2, 4.7, 3.8, 60),
};

const CPU_GROUPS = {
  agents: num(AGENT_CPU.scout).map((v, i) => v + num(AGENT_CPU.atlas)[i] + num(AGENT_CPU.quill)[i]),
  linked: Array.from({ length: SLOTS }, () => 0),
  app: num(wobble(2.4, 0.6, 1.3, 2.6)),
  other: num(wobble(11, 3, 3.3, 10.4)),
};

const CPU_TOTAL = CPU_GROUPS.agents.map((v, i) => v + CPU_GROUPS.linked[i] + CPU_GROUPS.app[i] + CPU_GROUPS.other[i]);

const SYSTEM = {
  cpu_percent: CPU_TOTAL[SLOTS - 1],
  cores_logical: 16,
  memory_percent: 46,
  memory_used_mb: 15053,
  memory_total_mb: 32768,
  per_core: [71, 38, 55, 22, 64, 30, 47, 18, 59, 41, 26, 68, 35, 50, 29, 45],
  gpu: { util_percent: 12, memory_used_mb: 3174, memory_total_mb: 12288 },
};

const SERIES = {
  cpu: CPU_TOTAL,
  memory: num(wobble(45, 1.2, 0.9, SYSTEM.memory_percent)),
  gpu: num(wobble(10, 6, 5.1, SYSTEM.gpu.util_percent)),
};

/** The four owners of load, in stacking order from the baseline up (GROUPS). */
const GROUPS = [
  { key: "agents", label: "Coding agents", color: "var(--rs-agents)" },
  { key: "linked", label: "Connected apps", color: "var(--rs-linked)" },
  { key: "app", label: "This app", color: "var(--rs-app)" },
  { key: "other", label: "Everything else", color: "var(--rs-other)" },
] as const;

interface Load {
  cpu_percent: number;
  memory_mb: number;
}

interface Tool extends Load {
  icon: IconComponent;
  label: string;
  category: string;
  processes: number;
}

interface Agent extends Load {
  id: keyof typeof AGENT_CPU;
  agent: CliMark;
  label: string;
  agent_label: string;
  processes: number;
  runtime: Load & { processes: number };
  tools: Tool[];
}

/** Heaviest first by processor, the order rankAgents gives. */
const AGENTS: Agent[] = [
  {
    id: "scout",
    agent: "claude",
    label: "Scout",
    agent_label: "Claude Code",
    processes: 9,
    cpu_percent: 18,
    memory_mb: 1230,
    runtime: { cpu_percent: 11.2, memory_mb: 640, processes: 2 },
    tools: [
      {
        icon: Terminal,
        label: "npm run dev",
        category: "Command",
        processes: 2,
        cpu_percent: 4.1,
        memory_mb: 310,
      },
      {
        icon: Globe,
        label: "Chromium",
        category: "Browser",
        processes: 5,
        cpu_percent: 2.7,
        memory_mb: 280,
      },
    ],
  },
  {
    id: "atlas",
    agent: "codex",
    label: "Atlas",
    agent_label: "Codex",
    processes: 4,
    cpu_percent: 9.4,
    memory_mb: 860,
    runtime: { cpu_percent: 7.9, memory_mb: 690, processes: 2 },
    tools: [
      {
        icon: SquareTerminal,
        label: "pwsh",
        category: "Shell",
        processes: 2,
        cpu_percent: 1.5,
        memory_mb: 170,
      },
    ],
  },
  {
    id: "quill",
    agent: "gemini",
    label: "Quill",
    agent_label: "Gemini CLI",
    processes: 3,
    cpu_percent: 3.8,
    memory_mb: 540,
    runtime: { cpu_percent: 3.8, memory_mb: 540, processes: 3 },
    tools: [],
  },
];

const GROUP_LOAD: Record<(typeof GROUPS)[number]["key"], Load> = {
  agents: { cpu_percent: CPU_GROUPS.agents[SLOTS - 1], memory_mb: 2630 },
  linked: { cpu_percent: 0, memory_mb: 0 },
  app: { cpu_percent: CPU_GROUPS.app[SLOTS - 1], memory_mb: 1126 },
  other: { cpu_percent: CPU_GROUPS.other[SLOTS - 1], memory_mb: 11297 },
};

const ROW_MAX = Math.max(...AGENTS.map((agent) => agent.cpu_percent));

/** The palette as custom properties, for the chart, the legend and the bars. */
const PALETTE = cn(
  "[--rs-agents:#2a78d6] [--rs-linked:#eb6834] [--rs-app:#1baf7a] [--rs-other:#a3a3a3]",
  "dark:[--rs-agents:#3987e5] dark:[--rs-linked:#d95926] dark:[--rs-app:#199e70] dark:[--rs-other:#5c5c5c]",
);

const processCount = (count: number) => (count === 1 ? "1 process" : `${count} processes`);

// ---------------------------------------------------------------------------
// ResourcesTab: three meters, who used what over time, and the agents behind it
// ---------------------------------------------------------------------------

function Tile({
  metric,
  selected,
  label,
  value,
  hint,
  series,
}: {
  metric: string;
  selected: boolean;
  label: string;
  value: string;
  hint: string;
  series: readonly number[];
}) {
  const path = sparkPath(series, 100, 22, { ceiling: 100, slots: SLOTS });
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={selected}
      data-testid={`resources-tile-${metric}`}
      className={cn(
        "relative min-w-0 flex-1 overflow-hidden rounded-lg border px-2.5 pb-1.5 pt-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-foreground/60 bg-secondary" : "border-border hover:bg-muted",
      )}
    >
      <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="block truncate text-[19px] font-semibold leading-tight tabular-nums text-foreground-strong">
        {value}
      </span>
      <span className="block truncate text-[10.5px] text-muted-foreground">{hint}</span>
      <svg
        aria-hidden
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
        className="mt-1 h-[22px] w-full text-foreground/55"
      >
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </button>
  );
}

function Cores({ cores }: { cores: readonly number[] }) {
  return (
    <div data-testid="resources-cores" className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">Cores</span>
      <div
        role="img"
        aria-label={`Load of each of the ${cores.length} cores`}
        className="flex min-w-0 flex-1 flex-wrap gap-[2px]"
      >
        {cores.map((load, index) => (
          <span
            key={index}
            title={`Core ${index + 1}: ${formatPercent(load)}`}
            className="h-3.5 min-w-[6px] flex-1 rounded-[2px] bg-foreground/[0.07]"
            style={{ maxWidth: 18 }}
          >
            <span
              className="block h-full w-full rounded-[2px]"
              style={{
                background: "var(--rs-agents)",
                opacity: Math.max(0, Math.min(1, load / 100)),
              }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Chart margins and axis sizes of the app's AreaChart (top 6, right 6, Y axis 38 wide, X axis 30 high). */
const CHART = { top: 6, right: 6, left: 38, bottom: 30 };

/**
 * ResourceChart: the last five minutes of processor load, stacked by owner, on
 * the whole machine's 0-100 % scale. Drawn in a 100 x 100 box stretched over
 * the plot area; strokes keep their width.
 */
function ResourceChart() {
  const x = (index: number) => ((WINDOW_S - (SLOTS - 1 - index) * 2) / WINDOW_S) * 100;
  const y = (value: number) => 100 - Math.max(0, Math.min(100, value));
  let below = Array.from({ length: SLOTS }, () => 0);
  const layers = GROUPS.map((group) => {
    const above = CPU_GROUPS[group.key].map((value, i) => below[i] + value);
    const top = above.map((value, i) => `${x(i).toFixed(2)} ${y(value).toFixed(2)}`);
    const base = below.map((value, i) => `${x(i).toFixed(2)} ${y(value).toFixed(2)}`).reverse();
    below = above;
    return {
      key: group.key,
      color: group.color,
      area: `M${top.join(" L")} L${base.join(" L")} Z`,
      line: `M${top.join(" L")}`,
    };
  });
  const xTicks = [4, 3, 2, 1, 0];
  return (
    <div data-testid="resources-chart" data-metric="cpu" className="h-[168px] w-full">
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: CHART.left,
            top: CHART.top,
            width: `calc(100% - ${CHART.left + CHART.right}px)`,
            height: `calc(100% - ${CHART.top + CHART.bottom}px)`,
            overflow: "visible",
          }}
        >
          {[0, 50, 100].map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={100}
              y1={y(tick)}
              y2={y(tick)}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: "hsl(var(--foreground) / 0.1)" }}
            />
          ))}
          {layers.map((layer) => (
            <g key={layer.key}>
              <path d={layer.area} style={{ fill: layer.color, fillOpacity: 0.9, stroke: "none" }} />
              <path
                d={layer.line}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.5}
                strokeLinejoin="round"
                style={{ fill: "none", stroke: "hsl(var(--background))" }}
              />
            </g>
          ))}
        </svg>
        {[100, 50, 0].map((tick) => (
          <span
            key={tick}
            className="text-muted-foreground tabular-nums"
            style={{
              position: "absolute",
              right: `calc(100% - ${CHART.left - 8}px)`,
              top: `calc(${CHART.top}px + (100% - ${CHART.top + CHART.bottom}px) * ${(100 - tick) / 100})`,
              transform: "translateY(-50%)",
              fontSize: 10,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {`${tick} %`}
          </span>
        ))}
        {xTicks.map((minutes) => (
          <span
            key={minutes}
            className="text-muted-foreground"
            style={{
              position: "absolute",
              left: `calc(${CHART.left}px + (100% - ${CHART.left + CHART.right}px) * ${(WINDOW_S - minutes * 60) / WINDOW_S})`,
              top: `calc(100% - ${CHART.bottom - 10}px)`,
              transform: "translateX(-50%)",
              fontSize: 10,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {minutes === 0 ? "now" : `-${minutes} min`}
          </span>
        ))}
      </div>
    </div>
  );
}

const ROW_BUTTON =
  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The two figures every row ends in; processor (the sorted one) in full ink. */
function Figures({ load }: { load: Load }) {
  return (
    <span className="flex shrink-0 items-baseline text-[11.5px] tabular-nums">
      <span data-figure="share" className="w-[52px] text-right text-foreground">
        {formatPercent(load.cpu_percent)}
      </span>
      <span data-figure="memory" className="w-[62px] text-right text-muted-foreground">
        {formatMemory(load.memory_mb)}
      </span>
    </span>
  );
}

function ShareBar({ value, max, color }: { value: number; max: number; color: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div aria-hidden className="mx-1.5 h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
    </div>
  );
}

function Spark({ values }: { values: readonly (number | null)[] }) {
  const path = sparkPath(values, 56, 18, { floor: 2, slots: SLOTS });
  if (!path) return <span aria-hidden className="w-14 shrink-0" />;
  return (
    <svg aria-hidden viewBox="0 0 56 18" className="h-[18px] w-14 shrink-0 text-muted-foreground">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DetailLine({
  icon: Icon,
  title,
  note,
  load,
  action,
  testId,
}: {
  icon: IconComponent;
  title: ReactNode;
  note?: ReactNode;
  load: Load;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <li data-testid={testId} className="group/line flex items-center gap-2 py-1 pl-1.5 pr-1.5">
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-foreground">{title}</span>
        {note ? <span className="block truncate text-[11px] text-muted-foreground">{note}</span> : null}
      </span>
      {action}
      <Figures load={load} />
    </li>
  );
}

function AgentRow({ agent, open }: { agent: Agent; open: boolean }) {
  const sub = [agent.agent_label, "Pane", PROJECT, processCount(agent.processes)];
  return (
    <li data-testid="resources-agent" data-agent-id={agent.id} data-kind="pane" className="space-y-1">
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={open}
        aria-label={`Details of ${agent.label}`}
        className={ROW_BUTTON}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <AgentMark agent={agent.agent} label={agent.agent_label || agent.label} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-foreground">{agent.label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{sub.join(" · ")}</span>
        </span>
        <Spark values={AGENT_CPU[agent.id]} />
        <Figures load={agent} />
      </button>
      <ShareBar value={agent.cpu_percent} max={ROW_MAX} color="var(--rs-agents)" />
      {open ? (
        <div className="ml-[22px] border-l border-border pl-2">
          <ul>
            <DetailLine
              icon={Cpu}
              title="The agent itself"
              note={processCount(agent.runtime.processes)}
              load={agent.runtime}
              testId="resources-runtime"
            />
            {agent.tools.map((tool) => (
              <DetailLine
                key={tool.label}
                testId="resources-tool"
                icon={tool.icon}
                title={tool.label}
                note={`${tool.category} · ${processCount(tool.processes)}`}
                load={tool}
                action={
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`End ${tool.label}`}
                    data-testid="resources-end"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/line:opacity-100"
                  >
                    End
                  </button>
                }
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function GroupRow({
  testId,
  title,
  note,
  color,
  load,
}: {
  testId: string;
  title: string;
  note: string;
  color: string;
  load: Load;
}) {
  return (
    <li data-testid={testId} className="space-y-1">
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={false}
        aria-label={`Details of ${title}`}
        className={ROW_BUTTON}
      >
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none"
        />
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
        </span>
        <Figures load={load} />
      </button>
    </li>
  );
}

/** The resource view on the processor, the app's default metric, with the heaviest agent opened. */
function ResourcesTab() {
  const gpu = SYSTEM.gpu;
  return (
    <section data-testid="resources-tab" data-metric="cpu" className={cn("flex h-full min-h-0 flex-col", PALETTE)}>
      <div className="scrollbar-jarvis min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-3 [overflow-anchor:none]">
        <div className="flex gap-2">
          <Tile
            metric="cpu"
            selected
            label="Processor"
            value={formatPercent(SYSTEM.cpu_percent)}
            hint={`${SYSTEM.cores_logical} cores`}
            series={SERIES.cpu}
          />
          <Tile
            metric="memory"
            selected={false}
            label="Memory"
            value={formatPercent(SYSTEM.memory_percent)}
            hint={`${formatMemory(SYSTEM.memory_used_mb)} of ${formatMemory(SYSTEM.memory_total_mb)}`}
            series={SERIES.memory}
          />
          <Tile
            metric="gpu"
            selected={false}
            label="Graphics card"
            value={formatPercent(gpu.util_percent)}
            hint={`${formatMemory(gpu.memory_used_mb)} of ${formatMemory(gpu.memory_total_mb)}`}
            series={SERIES.gpu}
          />
        </div>

        <div className="space-y-2 rounded-lg border border-border px-2.5 pb-2.5 pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[12.5px] font-medium text-foreground">Who is using the processor</h3>
            <span className="shrink-0 text-[11px] text-muted-foreground">Last 5 minutes</span>
          </div>
          <ResourceChart />
          <ul data-testid="resources-legend" className="grid grid-cols-2 gap-x-3 gap-y-1">
            {GROUPS.map((group) => (
              <li key={group.key} data-group={group.key} className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: group.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{group.label}</span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {formatPercent(GROUP_LOAD[group.key].cpu_percent)}
                </span>
              </li>
            ))}
          </ul>
          <Cores cores={SYSTEM.per_core} />
        </div>

        <section aria-label="Coding agents">
          <h3 className="mb-1 flex items-center gap-2 px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              Coding agents
              <span
                data-testid="resources-agent-count"
                className="ml-2 rounded bg-muted px-1.5 text-[10px] font-normal tabular-nums"
              >
                {AGENTS.length}
              </span>
            </span>
            <span className="flex shrink-0 text-[10px] font-normal normal-case tracking-normal tabular-nums">
              <span className="w-[52px] text-right">CPU</span>
              <span className="w-[62px] text-right">Memory</span>
            </span>
          </h3>
          <ul className="space-y-1.5">
            {AGENTS.map((agent, index) => (
              <AgentRow key={agent.id} agent={agent} open={index === 0} />
            ))}
          </ul>
        </section>

        <ul className="space-y-1.5 border-t border-border pt-2">
          <GroupRow
            testId="resources-app"
            title="This app"
            note="Window, core and helpers"
            color="var(--rs-app)"
            load={GROUP_LOAD.app}
          />
          <GroupRow
            testId="resources-other"
            title="Everything else"
            note="The system and every other program"
            color="var(--rs-other)"
            load={GROUP_LOAD.other}
          />
        </ul>
      </div>
    </section>
  );
}
