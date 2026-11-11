/**
 * What the room's terminals show: six coding agents on the wall, each at a job,
 * and pane T1 on the desk, where a spoken order lands. The room draws these
 * line by line (src/world/parts/terminals.ts) and the page lists them
 * (src/sections/room/), so the two cannot say different things.
 *
 * The sessions are scripted and claim nothing: invented people, an invented
 * project, no real repository and no real result. They show what a session
 * looks like.
 */
export type Kind = "ask" | "step" | "out" | "ok" | "add" | "cut" | "note";

export interface Line {
  kind: Kind;
  text: string;
  /** Seconds before the next line. */
  wait?: number;
}

export interface Session {
  agent: string;
  tool: string;
  jobs: readonly (readonly Line[])[];
}

const ask = (text: string): Line => ({ kind: "ask", text, wait: 0.9 });
const step = (text: string, wait = 0.55): Line => ({ kind: "step", text, wait });
const out = (text: string, wait = 0.3): Line => ({ kind: "out", text, wait });
const ok = (text: string, wait = 0.7): Line => ({ kind: "ok", text, wait });
const add = (text: string): Line => ({ kind: "add", text, wait: 0.16 });
const cut = (text: string): Line => ({ kind: "cut", text, wait: 0.16 });
const note = (text: string, wait = 1.1): Line => ({ kind: "note", text, wait });

/** The agents wall, screen by screen. */
export const AGENT_SESSIONS: readonly Session[] = [
  {
    agent: "Scout",
    tool: "Claude Code",
    jobs: [
      [
        ask("Fix the failing login test and open a PR"),
        step("Read tests/login.spec.ts"),
        step("Search createSession", 0.7),
        out("3 files"),
        step("Edit src/auth/session.ts"),
        cut("- const ttl = config.session"),
        add("+ const ttl = config.session.ttl ?? 3600"),
        step("Bash npm test -- login", 1.4),
        ok("12 passed"),
        step("Bash gh pr create", 1.0),
        ok("Pull request #482 opened"),
        note("Done in 1m 12s"),
      ],
    ],
  },
  {
    agent: "Atlas",
    tool: "Codex",
    jobs: [
      [
        ask("Add expiring share links"),
        step("Read src/share/links.ts"),
        step("Plan: schema, route, job, tests", 0.9),
        step("Edit db/migrations/0042_share_expiry.sql"),
        add("+ expires_at timestamptz"),
        step("Edit src/share/routes.ts"),
        add("+ if (link.expiresAt < now) return gone()"),
        step("Run pnpm test share", 1.5),
        ok("31 passed"),
        note("Waiting for your OK to push"),
      ],
    ],
  },
  {
    agent: "Quill",
    tool: "Gemini CLI",
    jobs: [
      [
        ask("Write the release notes for 4.3"),
        step("Bash git log v4.2.3..HEAD", 0.8),
        out("47 commits"),
        step("Read CHANGELOG.md"),
        step("Group by area: threads, voice, IDE", 1.0),
        step("Edit CHANGELOG.md"),
        add("+ ## 4.3.0"),
        add("+ - Threads keep running when you hang up"),
        ok("Draft ready: 9 entries"),
        note("Done in 48s"),
      ],
    ],
  },
  {
    agent: "Juno",
    tool: "OpenCode",
    jobs: [
      [
        ask("Upgrade the dashboard to React 19"),
        step("Read package.json"),
        step("Bash npm i react@19 react-dom@19", 1.6),
        out("added 2, changed 14"),
        step("Search forwardRef", 0.7),
        out("18 files"),
        step("Edit src/ui/Button.tsx"),
        cut("- export const Button = forwardRef("),
        add("+ export function Button({ ref, ...props })"),
        step("Bash npm run typecheck", 1.3),
        ok("0 errors"),
        note("14 of 18 files done"),
      ],
    ],
  },
  {
    agent: "Rio",
    tool: "Claude Code",
    jobs: [
      [
        ask("Why is the nightly build slow?"),
        step("Bash gh run list --workflow nightly", 0.9),
        out("last 10 runs: 21m, 22m, 38m, 41m"),
        step("Read .github/workflows/nightly.yml"),
        step("Bash gh run view 9127 --log", 1.2),
        out("cache miss: node_modules"),
        step("Edit .github/workflows/nightly.yml"),
        add("+ key: deps-${{ hashFiles('package-lock.json') }}"),
        ok("Next run will tell: expected 21m"),
        note("Done in 2m 03s"),
      ],
    ],
  },
  {
    agent: "Mika",
    tool: "Codex",
    jobs: [
      [
        ask("Dark mode for the settings page"),
        step("Read src/settings/Settings.tsx"),
        step("Search bg-white", 0.6),
        out("11 matches"),
        step("Edit src/settings/Settings.tsx"),
        cut('- className="bg-white text-black"'),
        add('+ className="bg-background text-foreground"'),
        step("Screenshot /settings (dark)", 1.3),
        ok("Contrast 13.2 : 1"),
        note("Done in 56s"),
      ],
    ],
  },
];

/** The upright monitor at the desk: pane T1, where a spoken order lands. */
export const T1_IDLE: readonly Line[] = [note("Ready. Say what you need.", 2.4)];
export const T1_RUN: readonly Line[] = [
  ask("Run the tests"),
  step("Bash npm test", 1.3),
  out("auth        12 passed"),
  out("share       31 passed"),
  out("threads     58 passed"),
  out("voice       27 passed", 0.5),
  ok("128 passed in 14.2s", 1.2),
  note("The result is read back to you.", 4),
];
