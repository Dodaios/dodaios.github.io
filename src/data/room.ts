/**
 * The words of the front page, once.
 *
 * The same words are used twice: as text in the page (what a screen reader
 * reads, and what a browser without the scene shows) and as objects in the 3D
 * room (a light bar, a lightbox, lettering on a wall, a whiteboard). Both read
 * them from here, so the room can never say something the page does not.
 *
 * Voice: a senior engineer who respects the reader's time. Say what it does.
 * No claim the product does not keep. See docs/world.md, "The words".
 */
import catalog from "@/data/app-catalog.json";
import counts from "@/data/social-counts.json";
import { voices } from "@/data/voices";
import { INSTALL_COMMANDS } from "@/lib/install";

export const HERO = {
  headline: "The open-source agent OS for your desktop",
  line: "Dodaios runs your coding agents, browser and apps by voice or chat, on your own machine. Bring your own subscription.",
};

export const VOICE = {
  sign: ["Say it.", "It gets done."],
  lede: "Say what you need. Dodaios writes the brief, hands it to a coding agent in a thread of its own, and tells you when it is done: Claude Code, Codex or OpenCode, on the subscriptions you already pay for.",
  said: "The login test is failing again. Have an agent fix it.",
  reply: "On it. Scout has the job. Watch the thread on the second screen.",
  listening: ["Listening"],
  /** What the desk's second monitor shows, said for the page. */
  second: "The second screen shows the thread that order starts: the agent's work line by line, its sub-agents, and the pull request at the end. The window above plays the same errand.",
  note: "A simulation. This page never opens your microphone.",
};

export const AGENTS = {
  wall: "A team that works while you don't.",
  lede: "Each agent has its own chat, model, browser and routines. Dodaios leads, they talk to each other, and anything that sends waits for your OK.",
};

export const REACH = {
  plugins: {
    title: "It uses your apps",
    line: `${catalog.plugins.length} plugins: mail, calendar, chat, notes, code`,
    lede: "Sign in once, and it can read your mail, find a file or start the music. When a connection stops working, it tells you which one and why.",
    link: "Every plugin",
  },
  skills: {
    title: "It knows your routines",
    line: `${catalog.skills.length} skills. Each one is a text file you can read`,
    lede: "Skills are what Dodaios knows how to do. Each one is a plain text file with a switch: a few lines saying what it is for, and what sets it off, be it a spoken phrase, a shortcut or the clock.",
    link: "How a skill is written",
  },
  clis: {
    title: "It drives your terminal",
    line: `${catalog.clis.length} command-line tools, each behind a safety gate`,
    lede: "Ask in plain language; it picks the tool, runs the command, and shows you exactly what it ran and why that was allowed. Every tool carries its own list of commands that are refused before they start.",
    link: "Every command-line tool",
  },
  /** Said wherever the marks of other companies' services are in the picture. */
  marks: "Integrations shown for identification only. No affiliation or endorsement implied. All marks belong to their owners.",
};

/** How a skill's file name reads to a person: `morning-routine` is "Morning routine". */
const SKILL_NAMES: Record<string, string> = {
  api: "API",
  cal_com: "Cal.com",
  clickup: "ClickUp",
  gcloud: "gcloud",
  github: "GitHub",
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  google_drive: "Google Drive",
  home_assistant: "Home Assistant",
  youtube_music: "YouTube Music",
};
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
function skillTitle(name: string): string {
  const [kind, ...rest] = name.split("-");
  const word = (part: string) => SKILL_NAMES[part] ?? part.replace(/_/g, " ");
  // A skill that belongs to a plugin or a command-line tool is that tool's playbook.
  if ((kind === "plugin" || kind === "cli") && rest.length > 0) return `${sentence(word(rest.join("-")))} playbook`;
  return sentence(name.split("-").map(word).join(" "));
}
/**
 * The skills the hologram and the page name: the routines first, then the
 * playbooks that come with the plugins. As many as fit one ring.
 */
export const REACH_SKILLS: readonly string[] = [...catalog.skills]
  .sort((a, b) => Number(/^(plugin|cli)-/.test(a.name)) - Number(/^(plugin|cli)-/.test(b.name)))
  .slice(0, 14)
  .map((skill) => skillTitle(skill.name));

export const STARS = {
  count: counts.platforms.github.value,
  unit: "GitHub stars",
  lede: "people have starred Dodaios on GitHub. The globe carries a pin for every place they say they live, and every light outside the window is one of them.",
  link: "Add yours",
  /** The strip across the top of the corkboard. */
  board: "What people say about Dodaios",
  /** The three cards on the corkboard. */
  cards: voices.slice(0, 3),
};

export const OPEN = {
  title: "Read it before you run it.",
  sub: "Every line is on GitHub.",
  lede: "The screen on the wall is the repository the install command pulls from, live: its files, its latest commits and what each of them changed. Open anything. Nothing here sits behind a signup.",
  link: "Open it on GitHub",
};

export const INSTALL = {
  title: "Install it with one command.",
  /** The whiteboard's own heading and the line above the command. */
  board: "Install Dodaios",
  paste: "Paste this line into your terminal:",
  then: "Then it asks you three things:",
  lede: "One command on Windows, macOS or Linux. It builds its own environment, fetches the voice models and opens the app.",
  steps: ["Pick a wake word", "Add a key, or skip it", "Say what you need"],
  stepNotes: [
    "Any phrase you like; the assistant takes its name from it.",
    "Every tier also has a local option that needs none.",
    "That is all.",
  ],
  hint: "click the board to copy it",
  copy: "Copy the command",
  copied: "Copied",
};

/** The lines of every label in the room, by the quad's name without `Text_` (src/world/parts/labels.ts). */
export function roomLabels(): Record<string, string[]> {
  const labels: Record<string, string[]> = {
    hero: [HERO.headline],
    voice: [...VOICE.sign],
    agents: [AGENTS.wall],
    reach: [REACH.plugins.title, REACH.plugins.line, REACH.marks],
    "reach:1": [REACH.plugins.title, REACH.plugins.line, REACH.marks],
    "reach:2": [REACH.skills.title, REACH.skills.line, REACH.marks],
    "reach:3": [REACH.clis.title, REACH.clis.line, REACH.marks],
    stars: [new Intl.NumberFormat("en-US").format(STARS.count), STARS.unit],
    board: [STARS.board],
    install: [INSTALL.board, INSTALL.paste, INSTALL_COMMANDS.unix, INSTALL.then, ...INSTALL.steps, INSTALL.hint],
    "install:windows": [INSTALL.board, INSTALL.paste, INSTALL_COMMANDS.windows, INSTALL.then, ...INSTALL.steps, INSTALL.hint],
    "voice:listening": [...VOICE.listening],
    "voice:heard": [`“${VOICE.said}”`],
  };
  STARS.cards.forEach((card, i) => {
    labels[`quote${i + 1}`] = [card.text, card.author, card.source];
  });
  return labels;
}
