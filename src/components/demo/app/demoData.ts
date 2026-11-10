/**
 * Everything the hero demo says. Placeholder content only — an invented
 * person, an invented "web-app" project, three invented agents. No real
 * person, repository, account or conversation appears here.
 *
 * The text uses a tiny inline syntax, rendered by `Rich` in Markup.tsx:
 * `**bold**` and `` `code` ``.
 */
import type { PetId } from "./Pet";

export const USER_NAME = "Alex";
export const ASSISTANT_NAME = "Dodaios";
export const PROJECT = "web-app";

export type Block = { p: string } | { ul: string[] } | { ol: string[] };

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentId = "scout" | "atlas" | "quill";

export interface AgentMessage {
  who: "user" | "agent";
  /** A user message is plain text; an agent's reply is blocks. */
  text?: string;
  blocks?: Block[];
  /** The "Worked for …" line under a reply. */
  worked?: string;
  steps?: string;
  stamp?: string;
}

export interface DemoAgent {
  id: AgentId;
  name: string;
  pet: PetId;
  /** The agent's own colour: its status ring and the person's bubbles in its chat. */
  tint: string;
  preview: string;
  chat: AgentMessage[];
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "scout",
    name: "Scout",
    pet: "bolt",
    tint: "#c2410c",
    preview: "PR #482 is open and green",
    chat: [
      { who: "user", stamp: "Today 09:41 AM", text: "Keep an eye on the test runs of web-app and fix what breaks on main." },
      {
        who: "agent",
        blocks: [
          { p: "I watch the runs on `main` now. When one fails I open a thread in the Agentic IDE, fix it there and come back with a pull request." },
          { p: "**First find:** `login.spec` has failed since the session refactor. I am on it." },
        ],
        worked: "Worked for 12.4s",
        steps: "3 steps",
      },
    ],
  },
  {
    id: "atlas",
    name: "Atlas",
    pet: "pip",
    tint: "#1d4ed8",
    preview: "3 mails need you today",
    chat: [
      { who: "user", stamp: "Today 08:00 AM", text: "Every morning, read my inbox and tell me which mails need me." },
      {
        who: "agent",
        blocks: [
          { p: "Three mails need you today:" },
          {
            ol: [
              "**Acme Corp** asks for the signed offer by Friday.",
              "**Your accountant** needs two receipts from March.",
              "**Mira** moved the design review to 14:00.",
            ],
          },
          { p: "The other 41 are newsletters and notifications. I left them unread." },
        ],
        worked: "Worked for 10.0s",
        steps: "2 steps",
      },
    ],
  },
  {
    id: "quill",
    name: "Quill",
    pet: "sprout",
    tint: "#4d7c0f",
    preview: "Draft for week 40 is ready",
    chat: [
      { who: "user", stamp: "Yesterday 05:12 PM", text: "Write the release notes for week 40 from the merged pull requests." },
      {
        who: "agent",
        blocks: [
          { p: "The draft is in `docs/releases/week-40.md`. It covers 14 merged pull requests:" },
          { ul: ["**New:** share links that expire.", "**Fixed:** login on Safari, two crashes in the export.", "**Faster:** the dashboard loads in half the time."] },
          { p: "Tell me what to change, or say **publish** and I open the pull request." },
        ],
        worked: "Worked for 48.2s",
        steps: "9 steps",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The conversation on the front page
// ---------------------------------------------------------------------------

export type ToolLogo = "github" | "calendar" | "gmail";

export interface LeadStep {
  /** The call's line text, as the work trace writes it. */
  text: string;
  /** The muted detail after it. */
  detail: string;
  /** A real mark for a service call; absent for the product's own tools. */
  logo?: ToolLogo;
}

export interface LeadReply {
  thought: string;
  steps: LeadStep[];
  /** One bubble per paragraph, as the app draws the assistant's answer. */
  bubbles: string[];
  seconds: number;
  tokens: string;
  /** The agent this turn hands its work to, if any. */
  handoff?: AgentId;
}

export const LOGIN_PROMPT = "The login test is failing again. Can you have an agent fix it and open a PR?";
export const CALENDAR_PROMPT = "What's on my calendar today?";
const MAIL_PROMPT = "Anything in my inbox that needs me this morning?";

const LOGIN_REPLY: LeadReply = {
  thought:
    "The last run on main failed in login.spec after the session refactor. " +
    "That is a coding job in the web-app repo, so it goes to Scout in the Agentic IDE.",
  steps: [
    { text: "GitHub", detail: "Workflow runs on main: login.spec failed", logo: "github" },
    { text: "Handed off to Scout", detail: "Fix login.spec and open a PR" },
  ],
  bubbles: [
    "Scout is on it. The last run on `main` failed in `login.spec`, right after the session refactor.",
    "It will fix the test, run the whole suite and open a pull request. You can watch it work in the Agentic IDE. I will tell you when it is ready to review.",
  ],
  seconds: 7,
  tokens: "3k tokens",
  handoff: "scout",
};

const CALENDAR_REPLY: LeadReply = {
  thought: "A question about today. The calendar plugin is connected, so I read today's events there.",
  steps: [{ text: "Google Calendar", detail: "Events today: 3 found", logo: "calendar" }],
  bubbles: [
    "Three things today: standup at **10:00**, the design review at **14:00** and dinner with Sam at **19:30**.",
    "The design review has no agenda yet. Say the word and I draft one from the open issues.",
  ],
  seconds: 4,
  tokens: "2k tokens",
};

const MAIL_REPLY: LeadReply = {
  thought: "A question about mail. Atlas reads the inbox every morning, so I take its list and check it against the inbox.",
  steps: [{ text: "Gmail", detail: "Unread since yesterday: 44 mails", logo: "gmail" }],
  bubbles: [
    "Three mails need you: Acme Corp wants the signed offer by Friday, your accountant needs two receipts, and Mira moved the design review to **14:00**.",
    "The other 41 are newsletters and notifications. Atlas left them unread.",
  ],
  seconds: 5,
  tokens: "2k tokens",
};

const GENERIC_REPLY: LeadReply = {
  thought: "This is the demo on the website. Nothing runs here, so I say so and point at what the app would do.",
  steps: [],
  bubbles: [
    "I am the demo on the website, so I cannot run that here.",
    "In the app I would pick the right agent or plugin for it, do the work on your machine and tell you when it is done. Try one of the examples under this window, or download the app and ask me again.",
  ],
  seconds: 2,
  tokens: "1k tokens",
};

/** The agent's row in the Activity column, while it works and after. */
export const SCOUT_RUNNING = "Scout · Fix the failing login test";
export const SCOUT_DONE = "Scout · PR #482 is open";

/** The scripted answer that fits what was typed; an honest one when none does. */
export function replyFor(text: string): LeadReply {
  const said = text.toLowerCase();
  if (/(test|bug|fix|\bpr\b|pull request|code|build|deploy|agent|repo)/.test(said)) return LOGIN_REPLY;
  if (/(calendar|meeting|today|schedule|agenda|tomorrow)/.test(said)) return CALENDAR_REPLY;
  if (/(mail|inbox|email|message)/.test(said)) return MAIL_REPLY;
  return GENERIC_REPLY;
}

/** What the conversation already holds when the page opens. */
export const HOME_HISTORY: { stamp: string; user: string; reply: LeadReply }[] = [
  { stamp: "Today, 9:12 AM", user: MAIL_PROMPT, reply: MAIL_REPLY },
];

// ---------------------------------------------------------------------------
// Threads in the Agentic IDE
// ---------------------------------------------------------------------------

export type CliMark = "claude" | "codex" | "gemini";

export interface SubAgent {
  title: string;
  kind: string;
  note: string;
  stats: string;
}

export interface FileChange {
  dir: string;
  name: string;
  plus: number;
  minus: number;
}

export interface WorkLine {
  text: string;
  /** A `+n −m` pair after the line. */
  diff?: [number, number];
}

export interface ThreadTurn {
  user: string;
  time: string;
  /** The stretches of work, one line each. */
  lines: WorkLine[];
  subagents?: SubAgent[];
  worked: string;
  answer: Block[];
  files?: FileChange[];
}

export interface DemoThread {
  id: string;
  title: string;
  mark: CliMark;
  model: string;
  age: string;
  /** The branch the thread works on, shown under its composer. */
  branch: string;
  pr?: { state: "open" | "merged"; count?: number };
  /** A thread that is still working when the demo opens. */
  running?: boolean;
  landed?: boolean;
  turns: ThreadTurn[];
}

export const LOGIN_THREAD_ID = "t-login";

export const LOGIN_TURN: ThreadTurn = {
  user: "The login test fails on main since the session refactor. Fix it, run the whole suite and open a pull request.",
  time: "10:08 AM",
  lines: [
    { text: "Ran a command, searched the files" },
    { text: "Edited …/src/auth/session.ts", diff: [18, 6] },
  ],
  subagents: [
    { title: "Reproduce the login.spec failure", kind: "Explore", note: "Fails on the redirect back from the identity page", stats: "14 tools · 38k tokens · 0m 41s" },
    { title: "Trace the session refactor", kind: "general-purpose", note: "createSession lost the sameSite flag in the refactor", stats: "22 tools · 61k tokens · 1m 02s" },
    { title: "Run the whole suite", kind: "general-purpose", note: "214 tests passed, lint is clean", stats: "6 tools · 17k tokens · 0m 55s" },
  ],
  worked: "Worked for 1m 12s",
  answer: [
    { p: "The login test passes again. The refactor dropped the `sameSite` flag from the session cookie, so the browser refused the cookie on the redirect back from the identity page." },
    {
      ul: [
        "**Fix:** `createSession` sets the flag again, and `login.spec` now checks for it.",
        "**Checks:** 214 tests are green and lint is clean.",
      ],
    },
    { p: "Pull request **#482** is open and waits for your review." },
  ],
  files: [
    { dir: "…/src/auth/", name: "session.ts", plus: 18, minus: 6 },
    { dir: "…/tests/e2e/", name: "login.spec.ts", plus: 21, minus: 3 },
    { dir: "…/src/auth/", name: "cookies.ts", plus: 2, minus: 0 },
  ],
};

/** The answer to anything typed into a thread: honest about being a demo. */
export function genericThreadTurn(text: string, cli: string): ThreadTurn {
  return {
    user: text,
    time: "now",
    lines: [{ text: "Searched the files" }],
    worked: "Worked for 4s",
    answer: [
      { p: "This is the demo on the website, so no agent runs here." },
      {
        p: `In the app this message goes to ${cli} in \`${PROJECT}\`. It works in your checkout or in a worktree of its own, you watch every step in this thread, and it ends with a diff or a pull request.`,
      },
    ],
  };
}

export const DEMO_THREADS: DemoThread[] = [
  {
    id: LOGIN_THREAD_ID,
    title: "Fix the failing login test",
    mark: "claude",
    model: "Claude Opus 5.5",
    age: "now",
    branch: "fix/login-session",
    pr: { state: "open" },
    turns: [LOGIN_TURN],
  },
  {
    id: "t-share",
    title: "Add expiring share links",
    mark: "codex",
    model: "GPT-5.5",
    age: "32m",
    branch: "feat/share-links",
    pr: { state: "merged", count: 2 },
    landed: true,
    turns: [
      {
        user: "Add share links for drafts that expire after seven days. API, button on the dashboard, tests.",
        time: "9:31 AM",
        lines: [{ text: "Ran 4 commands, edited 6 files" }],
        worked: "Worked for 6m 40s",
        answer: [
          { p: "Drafts can be shared with a link that stops working after seven days." },
          {
            ul: [
              "**API:** `POST /drafts/:id/share` returns a signed link. An expired link answers 410.",
              "**Dashboard:** a Share button on every draft copies the link.",
              "**Tests:** 11 new ones, including the expiry.",
            ],
          },
          { p: "Both pull requests are merged: **#479** for the API and **#480** for the button." },
        ],
        files: [
          { dir: "…/src/api/", name: "share.ts", plus: 96, minus: 0 },
          { dir: "…/src/dashboard/", name: "ShareButton.tsx", plus: 58, minus: 4 },
          { dir: "…/tests/api/", name: "share.test.ts", plus: 143, minus: 0 },
        ],
      },
    ],
  },
  {
    id: "t-dark",
    title: "Dark mode for the dashboard",
    mark: "gemini",
    model: "Gemini 3.1 Pro",
    age: "now",
    branch: "feat/dark-mode",
    running: true,
    turns: [
      {
        user: "The dashboard needs a dark mode that follows the system setting. Keep the charts readable.",
        time: "10:02 AM",
        lines: [{ text: "Searched the files, read 9 files" }, { text: "Edited …/src/dashboard/theme.css", diff: [64, 12] }],
        worked: "Working",
        answer: [],
      },
    ],
  },
  {
    id: "t-react",
    title: "Upgrade to React 19",
    mark: "claude",
    model: "Claude Sonnet 5.5",
    age: "3h",
    branch: "chore/react-19",
    pr: { state: "merged" },
    landed: true,
    turns: [
      {
        user: "Upgrade the app to React 19 and fix whatever breaks.",
        time: "7:14 AM",
        lines: [{ text: "Ran 7 commands, edited 12 files" }],
        worked: "Worked for 11m 05s",
        answer: [
          { p: "The app runs on React 19. Two things had to change:" },
          {
            ul: [
              "`forwardRef` is gone from 8 components. They take `ref` as a prop now.",
              "The date picker pinned React 18, so it moved to its next major version.",
            ],
          },
          { p: "All 214 tests pass. Pull request **#476** is merged." },
        ],
        files: [
          { dir: "…/", name: "package.json", plus: 6, minus: 6 },
          { dir: "…/src/components/", name: "Field.tsx", plus: 9, minus: 14 },
          { dir: "…/src/components/", name: "DateRange.tsx", plus: 22, minus: 31 },
        ],
      },
    ],
  },
  {
    id: "t-disk",
    title: "Disk and RAM check",
    mark: "codex",
    model: "GPT-5.5",
    age: "1d",
    branch: "main",
    turns: [
      {
        user: "How full is the build machine?",
        time: "Yesterday",
        lines: [{ text: "Ran 3 commands" }],
        worked: "Worked for 9s",
        answer: [
          { p: "The build machine is fine: the disk is at **61%** and the memory at **38%**." },
          { p: "The largest folder is the Docker cache with 41 GB. Say so if I should prune it." },
        ],
      },
    ],
  },
];

export const OTHER_PROJECTS = ["docs-site", "infra"];

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type PluginIcon =
  | "github" | "vercel" | "notion" | "slack" | "linear" | "google_calendar" | "gmail" | "figma" | "supabase";

export interface DemoPlugin {
  id: PluginIcon;
  name: string;
  about: string;
  /** A dark mark the app inverts on its dark theme. */
  invert?: boolean;
  connected: boolean;
}

/** The catalogue's groups, in the app's own order and wording. */
export const PLUGIN_GROUPS: { title: string; plugins: DemoPlugin[] }[] = [
  {
    title: "Popular",
    plugins: [
      { id: "github", name: "GitHub", about: "Repos, issues, pull requests and Actions runs", invert: true, connected: true },
      { id: "vercel", name: "Vercel", about: "Deployments, runtime logs, domains and env-vars", invert: true, connected: false },
      { id: "notion", name: "Notion", about: "Pages, databases and comments — multi-workspace", invert: true, connected: false },
      { id: "slack", name: "Slack", about: "Search, read and post in your channels and DMs", connected: true },
      { id: "linear", name: "Linear", about: "Issues, projects, cycles and roadmap for software teams", connected: false },
      { id: "google_calendar", name: "Google Calendar", about: "See your schedule and create, move or delete events by voice", connected: true },
    ],
  },
  {
    title: "Calendar & Mail",
    plugins: [{ id: "gmail", name: "Gmail", about: "Read, send, organize and delete mail in your inbox", connected: true }],
  },
  {
    title: "Developer",
    plugins: [
      { id: "supabase", name: "Supabase", about: "Tables, SQL, logs and edge functions", connected: false },
      { id: "figma", name: "Figma", about: "Read designs, comments and components", connected: false },
    ],
  },
];
