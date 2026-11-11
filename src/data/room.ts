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
  lede: "Put Claude Code, Codex and OpenCode side by side and tell them what to do. Say “T1, run the tests” and Dodaios writes the brief and types it into the right pane, on the subscriptions you already pay for.",
  said: "T1, run the tests.",
  reply: "On it. I wrote the brief and typed it into pane T1.",
  listening: ["Listening"],
  note: "A simulation. This page never opens your microphone.",
};

export const AGENTS = {
  wall: "A team that works while you don't.",
  lede: "Each agent has its own chat, model, browser and routines. Dodaios leads, they talk to each other, and anything that sends waits for your OK.",
};

export const REACH = {
  plugins: {
    title: `${catalog.plugins.length} plugins`,
    line: "It reaches the tools you already use",
    lede: "Sign in once, and it can read your mail, find a file or start the music. When a connection stops working, it tells you which one and why.",
    link: "Every plugin",
  },
  skills: {
    title: `${catalog.skills.length} skills`,
    line: "Teach it once. A skill is a text file",
    lede: "Skills are what Dodaios knows how to do. Each one is a plain text file with a switch: a few lines saying what it is for, and what sets it off, be it a spoken phrase, a shortcut or the clock.",
    link: "How a skill is written",
  },
  clis: {
    title: `${catalog.clis.length} command-line tools`,
    line: "It drives your terminal, behind a gate",
    lede: "Ask in plain language; it picks the tool, runs the command, and shows you exactly what it ran and why that was allowed. Every tool carries its own list of commands that are refused before they start.",
    link: "Every command-line tool",
  },
  /** Said wherever the marks of other companies' services are in the picture. */
  marks: "Integrations shown for identification only. No affiliation or endorsement implied. All marks belong to their owners.",
};

export const STARS = {
  count: counts.platforms.github.value,
  unit: "GitHub stars",
  lede: "people have starred Dodaios on GitHub. Every light outside the window is one of them.",
  link: "Add yours",
  /** The three cards on the corkboard. */
  cards: voices.slice(0, 3),
};

export const OPEN = {
  title: "Read it before you run it.",
  sub: "Every line is on GitHub.",
  lede: "This is the repository the install command pulls from. Open it yourself. Nothing here sits behind a signup, and even this room shows you how it is put together.",
  link: "Open the repository",
  /** The blueprint's title block, and the plan drawn on it: who hands work to whom. */
  block: "Dodaios | Apache 2.0 | Open source",
  plan: ["You | voice or chat", "Dodaios | the lead", "Agents | one job each", "Your tools | plugins, skills, CLIs"],
};

export const INSTALL = {
  title: "Switch it on.",
  lede: "One command on Windows, macOS or Linux. It builds its own environment, fetches the voice models and opens the app.",
  steps: ["Run the command", "Pick a wake word", "Add a key, or skip it", "Say it"],
  stepNotes: [
    "It asks nothing else.",
    "Any phrase you like; the assistant takes its name from it.",
    "Every tier also has a local option that needs none.",
    "",
  ],
  hint: "press to copy",
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
    open: [OPEN.title, OPEN.sub, OPEN.block, ...OPEN.plan],
    install: [INSTALL.title, INSTALL_COMMANDS.unix, ...INSTALL.steps, INSTALL.hint],
    "install:windows": [INSTALL.title, INSTALL_COMMANDS.windows, ...INSTALL.steps, INSTALL.hint],
    "voice:listening": [...VOICE.listening],
    "voice:heard": [`“${VOICE.said}”`],
  };
  STARS.cards.forEach((card, i) => {
    labels[`quote${i + 1}`] = [card.text, card.author, card.source];
  });
  return labels;
}
