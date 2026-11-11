/**
 * Small pieces several views of the clone share: rendered Markdown, the
 * coding CLIs' marks, the pull-request mark and a service's logo beside a
 * tool call.
 *
 * Markup and class names are copied from the app — agentic/AgentMark.tsx,
 * agentic/GitHubIcon.tsx with pullRequestTone.ts, and agentchat/ToolChoiceIcon
 * with toolIdentity.css. The Markdown wrapper is what the app's renderer
 * writes around a message.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import claudeLogo from "@/assets/app/claude-color.svg?url";
import geminiLogo from "@/assets/app/gemini.svg?url";
import openaiLogo from "@/assets/app/openai.svg?url";
import calendarLogo from "@/assets/app/plugins/google_calendar.svg?url";
import gmailLogo from "@/assets/app/plugins/gmail.svg?url";
import githubLogo from "@/assets/brands/github.svg?url";
import type { Block, CliMark, ToolLogo } from "./demoData";
import { cn } from "./Pet";

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** `**bold**` and `` `code` `` inside one line of text. */
export function Rich({ text }: { text: string }): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function Blocks({ blocks, className }: { blocks: Block[]; className: string }) {
  return (
    <div className={className}>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {blocks.map((block, i) => {
          if ("p" in block) {
            return (
              <p key={i}>
                <Rich text={block.p} />
              </p>
            );
          }
          const items = ("ul" in block ? block.ul : block.ol).map((item, n) => (
            <li key={n}>
              <Rich text={item} />
            </li>
          ));
          return "ul" in block ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

const CLI_LOGOS: Record<CliMark, { url: string; ink: boolean }> = {
  claude: { url: claudeLogo, ink: false },
  codex: { url: openaiLogo, ink: true },
  gemini: { url: geminiLogo, ink: false },
};

export const CLI_NAMES: Record<CliMark, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

/** `AgentMark` in its plain variant: a colour mark as an image, a mono one as a mask. */
export function AgentMark({ mark }: { mark: CliMark }) {
  const { url, ink } = CLI_LOGOS[mark];
  return (
    <span
      data-testid={`agent-mark-${mark}`}
      data-ground={ink ? "ink" : "any"}
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden text-micro font-bold tracking-tight text-muted-foreground opacity-70 h-4 w-4"
    >
      {ink ? (
        <span
          className="block bg-foreground h-full w-full"
          style={{
            WebkitMaskImage: `url("${url}")`,
            maskImage: `url("${url}")`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : (
        <img src={url} alt="" className="block object-contain h-full w-full" />
      )}
    </span>
  );
}

/** GitHub's Octicons (MIT), unmodified: `git-pull-request` and `git-merge`. */
const PR_PATHS = {
  open: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  merged:
    "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z",
} as const;

/** `PULL_REQUEST_TONE`: GitHub's own colour for each pull request state. */
export const PR_TONE = {
  open: "text-[#1a7f37] dark:text-[#3fb950]",
  merged: "text-[#8250df] dark:text-[#ab7df8]",
} as const;

export function PullRequestIcon({
  state,
  size,
  className,
}: {
  state: "open" | "merged";
  size: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" className={className}>
      <path d={PR_PATHS[state]} />
    </svg>
  );
}

const TOOL_LOGOS: Record<ToolLogo, { url: string; mono: boolean }> = {
  github: { url: githubLogo, mono: true },
  calendar: { url: calendarLogo, mono: false },
  gmail: { url: gmailLogo, mono: false },
};

/** `ToolChoiceIcon`: a service's real mark beside its call. */
export function ToolMark({ logo, size = 16 }: { logo: ToolLogo; size?: number }) {
  const { url, mono } = TOOL_LOGOS[logo];
  return (
    <span
      className="tool-identity inline-flex shrink-0"
      style={
        {
          "--tool-ink-light": "#181717",
          "--tool-ink-dark": "#f0f6fc",
        } as CSSProperties
      }
    >
      <span className="tool-choice-icon" data-plate="false" style={{ width: size, height: size }} aria-hidden>
        {mono ? (
          <span className="tool-choice-mask" style={{ "--tool-logo": `url("${url}")` } as CSSProperties} />
        ) : (
          <img src={url} alt="" />
        )}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Text that arrives a character at a time while `active`; whole otherwise. */
export function useTyped(full: string, active: boolean, msPerChar: number): string {
  const [shown, setShown] = useState(active ? "" : full);
  useEffect(() => {
    if (!active || prefersReducedMotion()) {
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

/** The clock scripts are started against. */
export function now(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

/**
 * A script's playhead: which of its frames is on. It moves on after each
 * frame's duration; the last frame stays. `done` is called once when the last
 * frame is reached. With reduced motion it starts on the last frame, so every
 * script reads as complete without moving.
 *
 * `startedAt` is when the script began (`now()`). A view that is opened while
 * its script is already running joins it where it stands instead of playing
 * it again from the top — a turn left running on one section has moved on by
 * the time the reader comes back to it.
 */
export function usePlayhead(
  durations: readonly number[],
  playing: boolean,
  onDone?: () => void,
  startedAt?: number,
): number {
  const last = durations.length;
  const [step, setStep] = useState(() => {
    if (!playing || prefersReducedMotion()) return last;
    let left = startedAt === undefined ? 0 : now() - startedAt;
    let at = 0;
    while (at < last && left >= durations[at]) left -= durations[at++];
    return at;
  });
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      onDone?.();
      return;
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), durations[step]);
    return () => window.clearTimeout(id);
    // `onDone` is deliberately not a dependency: it must fire once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, playing, last]);
  return step;
}

/** `traceDuration` (agentchat/traceEntries.ts): "4.2s", "41s", "1m 02s". */
export function traceDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** `formatTokens` (agentchat/toolView.ts): "812", "48.2k", "1.2M". */
export function formatTokens(n: number): string {
  const trim = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(1))}k`;
  return `${trim((n / 1_000_000).toFixed(1))}M`;
}

/** Whole seconds since mount, for a "Working for 12s" line. */
export function useSeconds(running: boolean, from = 0): number {
  const [seconds, setSeconds] = useState(from);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return seconds;
}

export function Cursor() {
  return (
    <span
      className={cn("ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 animate-pulse bg-current motion-reduce:animate-none")}
      aria-hidden
    />
  );
}
