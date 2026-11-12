/**
 * Plugins / Skills / MCP — a clone of the app's extensions catalogue.
 *
 * Markup and class names are copied from the running app's own DOM: the
 * catalogue dialog of the extensions section (its "Extensions" column with
 * the installed list, the Plugins pane with its search, tabs and rows).
 *
 * The marks are the app's own bundled files and identify the service a row
 * connects to — see src/assets/brands/LOGOS.md for the rule they follow.
 *
 * A row's plus is live: it connects the plugin, as the app's does.
 */
import { useEffect, useState } from "react";

import figma from "@/assets/app/plugins/figma.svg?url";
import github from "@/assets/app/plugins/github.svg?url";
import gmail from "@/assets/app/plugins/gmail.svg?url";
import googleCalendar from "@/assets/app/plugins/google_calendar.svg?url";
import linear from "@/assets/app/plugins/linear.svg?url";
import notion from "@/assets/app/plugins/notion.svg?url";
import slack from "@/assets/app/plugins/slack.svg?url";
import supabase from "@/assets/app/plugins/supabase.svg?url";
import vercel from "@/assets/app/plugins/vercel.svg?url";
import { PLUGIN_GROUPS, type DemoPlugin, type PluginIcon as PluginId } from "./demoData";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "./lucide";
import { cn } from "./Pet";
import { ConnectorIcon, PluginIcon, SkillIcon } from "./sectionIcons";

const ICONS: Record<PluginId, string> = {
  github,
  vercel,
  notion,
  slack,
  linear,
  google_calendar: googleCalendar,
  gmail,
  figma,
  supabase,
};

const NAV_BUTTON =
  "flex min-w-0 items-center gap-3 rounded-lg px-2.5 text-left text-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-10";
const TOOL_BUTTON =
  "grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background h-10 w-10";
const ROW_ACTION =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

function Row({
  plugin,
  state,
  onConnect,
}: {
  plugin: DemoPlugin;
  state: "connected" | "connecting" | "off";
  onConnect: (id: PluginId) => void;
}) {
  return (
    <li className="flex min-h-[72px] items-center gap-1 rounded-2xl pr-2 transition-colors hover:bg-secondary focus-within:bg-secondary">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={plugin.name}
        tabIndex={-1}
        onClick={() => state === "off" && onConnect(plugin.id)}
      >
        <div className="grid shrink-0 place-items-center overflow-hidden border h-12 w-12 rounded-xl bg-[hsl(var(--plugin-icon-surface))]">
          <img src={ICONS[plugin.id]} alt="" className={cn("h-8 w-8", plugin.invert && "invert")} />
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-lg font-medium text-foreground-strong">{plugin.name}</span>
          </span>
          <span className="block">
            <span className="block truncate text-base text-muted-foreground" title={plugin.about}>
              {plugin.about}
            </span>
          </span>
        </span>
      </button>
      {state === "connected" ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <span
            role="img"
            aria-label="Connected"
            title="Connected · Live"
            className="grid h-9 w-7 place-items-center text-success"
          >
            <Check className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label={`More actions for ${plugin.name}`}
              title="More actions"
              aria-expanded="false"
              className={ROW_ACTION}
              tabIndex={-1}
            >
              <Ellipsis className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>
        </span>
      ) : (
        <button
          type="button"
          className={ROW_ACTION}
          disabled={state === "connecting"}
          tabIndex={-1}
          onClick={() => onConnect(plugin.id)}
        >
          {state === "connecting" ? (
            <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <Plus className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
      )}
    </li>
  );
}

function Group({
  title,
  plugins,
  stateOf,
  onConnect,
}: {
  title: string;
  plugins: DemoPlugin[];
  stateOf: (plugin: DemoPlugin) => "connected" | "connecting" | "off";
  onConnect: (id: PluginId) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="px-3">
        <button
          type="button"
          className="group/heading inline-flex items-center gap-1.5 rounded-sm text-xl font-semibold text-foreground-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={-1}
        >
          {title}
          <ChevronRight
            className="h-5 w-5 text-foreground-faint transition-transform group-hover/heading:text-muted-foreground motion-safe:group-hover/heading:translate-x-0.5"
            aria-hidden
          />
        </button>
      </h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-x-6 gap-y-0.5">
        {plugins.map((plugin) => (
          <Row key={plugin.id} plugin={plugin} state={stateOf(plugin)} onConnect={onConnect} />
        ))}
      </ul>
    </section>
  );
}

export function PluginsView({ onClose }: { onClose: () => void }) {
  const all = PLUGIN_GROUPS.flatMap((group) => group.plugins);
  const [connected, setConnected] = useState<Set<PluginId>>(
    () => new Set(all.filter((plugin) => plugin.connected).map((plugin) => plugin.id)),
  );
  const [connecting, setConnecting] = useState<PluginId | null>(null);

  // A connect takes a moment, as the app's sign-in does.
  useEffect(() => {
    if (!connecting) return;
    const id = window.setTimeout(() => {
      setConnected((now) => new Set(now).add(connecting));
      setConnecting(null);
    }, 1100);
    return () => window.clearTimeout(id);
  }, [connecting]);

  const stateOf = (plugin: DemoPlugin) =>
    connected.has(plugin.id) ? "connected" : connecting === plugin.id ? "connecting" : "off";
  const connect = (id: PluginId) => {
    if (!connecting && !connected.has(id)) setConnecting(id);
  };
  const installed = all.filter((plugin) => connected.has(plugin.id));

  return (
    <div
      role="dialog"
      data-state="open"
      data-testid="plugin-catalog-dialog"
      className="jarvis-nav-surface fixed inset-x-0 bottom-0 top-8 z-40 flex flex-col overflow-hidden text-foreground outline-none [&_[aria-modal=true]]:overflow-y-auto"
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-sidebar md:w-[320px] xl:w-[400px] md:border-b-0 md:border-r">
          <h2 className="hidden px-5 pb-3 pt-5 text-xl font-semibold text-foreground-strong md:block">Extensions</h2>
          <nav className="flex gap-1 p-2 md:flex-col md:gap-1 md:px-3 md:py-0">
            <button
              type="button"
              aria-current="page"
              className={cn(NAV_BUTTON, "bg-secondary font-medium text-foreground-strong")}
              tabIndex={-1}
            >
              <PluginIcon aria-hidden strokeWidth={1.6} className="h-5 w-5 shrink-0" />
              <span className="truncate">Plugins</span>
            </button>
            <button
              type="button"
              className={cn(NAV_BUTTON, "text-muted-foreground hover:bg-secondary hover:text-foreground")}
              tabIndex={-1}
            >
              <ConnectorIcon aria-hidden strokeWidth={1.6} className="h-5 w-5 shrink-0" />
              <span className="truncate">MCPs</span>
            </button>
            <button
              type="button"
              className={cn(NAV_BUTTON, "text-muted-foreground hover:bg-secondary hover:text-foreground")}
              tabIndex={-1}
            >
              <SkillIcon aria-hidden strokeWidth={1.6} className="h-5 w-5 shrink-0" />
              <span className="truncate">Skills</span>
            </button>
          </nav>
          <div className="hidden min-h-0 flex-1 flex-col md:flex">
            <div className="flex h-9 items-center justify-between pl-5 pr-3 pt-6">
              <h3 className="text-base text-muted-foreground">Installed</h3>
              <button
                type="button"
                aria-pressed="false"
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={-1}
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="relative overflow-hidden mt-3 min-h-0 flex-1">
              <ul className="flex flex-col gap-0.5 px-3 pb-4">
                {installed.map((plugin) => (
                  <li key={plugin.id}>
                    <button
                      type="button"
                      className={cn(NAV_BUTTON, "w-full text-foreground hover:bg-secondary")}
                      tabIndex={-1}
                    >
                      <div className="grid shrink-0 place-items-center overflow-hidden border h-6 w-6 rounded-md bg-[hsl(var(--plugin-icon-surface))]">
                        <img src={ICONS[plugin.id]} alt="" className={cn("h-4 w-4", plugin.invert && "invert")} />
                      </div>
                      <span className="min-w-0 flex-1 truncate">{plugin.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
        <div data-plugin-pane="true" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="absolute right-3 top-2.5 z-10 flex items-center gap-1">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={-1}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex h-full min-h-0 flex-col bg-transparent">
            <div className="relative overflow-hidden flex-1">
              <div className="h-full w-full rounded-[inherit] [&>div]:!block" style={{ overflow: "hidden" }}>
                <div style={{ minWidth: "100%", display: "table" }}>
                  <div className="mx-auto w-full max-w-[1040px] px-6 pb-14 pt-14 sm:px-10">
                    <div className="flex flex-col gap-8">
                      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                        <div className="min-w-0">
                          <h2 className="text-2xl font-semibold text-foreground-strong">Plugins</h2>
                          <p className="mt-1.5 text-lg text-muted-foreground">
                            Connect your tools so your agents can work across them
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-[1_1_22rem] items-center justify-end gap-1.5">
                          <label className="flex h-10 min-w-0 max-w-72 flex-1 items-center gap-2.5 rounded-full border border-border bg-background px-3 text-muted-foreground focus-within:border-border-strong">
                            <Search className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 bg-transparent text-base text-foreground-faint">Search plugins…</span>
                          </label>
                          <button type="button" className={TOOL_BUTTON} tabIndex={-1}>
                            <RefreshCw className="h-[18px] w-[18px]" aria-hidden />
                          </button>
                          <button type="button" className={TOOL_BUTTON} tabIndex={-1}>
                            <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              aria-expanded="false"
                              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                              tabIndex={-1}
                            >
                              Add
                              <ChevronDown className="h-3.5 w-3.5 transition-transform" aria-hidden />
                            </button>
                          </div>
                        </div>
                      </header>
                      <div role="tablist" className="flex gap-1">
                        <button
                          type="button"
                          role="tab"
                          aria-selected="true"
                          className="rounded-full px-4 py-2 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring bg-secondary text-foreground-strong"
                          tabIndex={-1}
                        >
                          Built in
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected="false"
                          className="rounded-full px-4 py-2 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:bg-secondary hover:text-foreground"
                          tabIndex={-1}
                        >
                          Yours
                        </button>
                      </div>
                      {PLUGIN_GROUPS.map((group) => (
                        <Group key={group.title} title={group.title} plugins={group.plugins} stateOf={stateOf} onConnect={connect} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
