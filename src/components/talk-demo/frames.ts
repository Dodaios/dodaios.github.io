/**
 * The script for the "Code by talking" demo.
 *
 * Three coding agents sit in three panes of the Agentic IDE, each with a call
 * sign. The visitor watches someone speak three sentences and the panes pick
 * the work up one after another: T1 runs the tests, T2 fixes what T1 found,
 * T3 writes the changelog. Nothing is typed by hand; that is the point.
 *
 * Every frame is a full snapshot, so the view stays pure and a looping script
 * can never carry state from one pass into the next.
 */

export type PaneStatus = "idle" | "working" | "done";

export interface PaneState {
  status: PaneStatus;
  /** The brief Dodaios typed into the pane, shown as the prompt line. */
  brief?: string;
  /** Terminal lines under the brief, newest last. */
  lines: string[];
}

export interface Pane {
  sign: "T1" | "T2" | "T3";
  agent: string;
}

export const PANES: Pane[] = [
  { sign: "T1", agent: "Claude Code" },
  { sign: "T2", agent: "Codex" },
  { sign: "T3", agent: "OpenCode" },
];

export interface Frame {
  duration: number;
  /** The sentence being spoken in this beat, typed out in the voice bar. */
  say?: string;
  /** Which pane the last instruction reached, shown as a receipt. */
  delivered?: Pane["sign"];
  panes: Record<Pane["sign"], PaneState>;
}

const IDLE: PaneState = { status: "idle", lines: [] };

const SAY_1 = "T1, run the tests.";
const SAY_2 = "T2, fix whatever T1 finds.";
const SAY_3 = "T3, write the changelog for this release.";

const BRIEF_1 = "Run the full test suite and report every failure.";
const BRIEF_2 = "Fix the failing test_export_dates that T1 reported.";
const BRIEF_3 = "Write the changelog entry for v0.4 from the merged work.";

const T1_RUNNING: PaneState = {
  status: "working",
  brief: BRIEF_1,
  lines: ["$ pytest -q", "........................................"],
};
const T1_REPORTED: PaneState = {
  status: "done",
  brief: BRIEF_1,
  lines: [
    "$ pytest -q",
    "........................................F",
    "FAILED test_export_dates",
    "41 passed, 1 failed in 3.2s",
  ],
};
const T2_WORKING: PaneState = {
  status: "working",
  brief: BRIEF_2,
  lines: ["Reading export.py", "Dates were parsed in local time"],
};
const T2_DONE: PaneState = {
  status: "done",
  brief: BRIEF_2,
  lines: ["Reading export.py", "Dates were parsed in local time", "Edited export.py  +3 -1", "$ pytest -q", "42 passed in 3.1s"],
};
const T3_WORKING: PaneState = {
  status: "working",
  brief: BRIEF_3,
  lines: ["Reading 6 merged pull requests"],
};
const T3_DONE: PaneState = {
  status: "done",
  brief: BRIEF_3,
  lines: ["Reading 6 merged pull requests", "Wrote CHANGELOG.md  +14"],
};

export const FRAMES: Frame[] = [
  { duration: 1600, panes: { T1: IDLE, T2: IDLE, T3: IDLE } },
  { duration: 1900, say: SAY_1, panes: { T1: IDLE, T2: IDLE, T3: IDLE } },
  { duration: 1900, say: SAY_1, delivered: "T1", panes: { T1: T1_RUNNING, T2: IDLE, T3: IDLE } },
  { duration: 2000, say: SAY_1, delivered: "T1", panes: { T1: T1_REPORTED, T2: IDLE, T3: IDLE } },
  { duration: 2100, say: SAY_2, panes: { T1: T1_REPORTED, T2: IDLE, T3: IDLE } },
  { duration: 1900, say: SAY_2, delivered: "T2", panes: { T1: T1_REPORTED, T2: T2_WORKING, T3: IDLE } },
  { duration: 2500, say: SAY_3, panes: { T1: T1_REPORTED, T2: T2_WORKING, T3: IDLE } },
  { duration: 2000, say: SAY_3, delivered: "T3", panes: { T1: T1_REPORTED, T2: T2_WORKING, T3: T3_WORKING } },
  { duration: 4200, say: SAY_3, delivered: "T3", panes: { T1: T1_REPORTED, T2: T2_DONE, T3: T3_DONE } },
];

export const DEMO_DESCRIPTION =
  "A demo of the Agentic IDE with three coding agents in panes T1, T2 and T3. " +
  "Someone says \"T1, run the tests\", \"T2, fix whatever T1 finds\" and " +
  "\"T3, write the changelog\". Dodaios turns each sentence into a brief and " +
  "types it into the right pane: T1 finds one failing test, T2 fixes it and " +
  "the tests pass, and T3 writes the changelog.";
