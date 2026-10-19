/**
 * "You draw the line" — the data and the geometry behind the privacy section.
 *
 * One module, imported by the section's markup AND by its client script, so
 * the words a visitor reads and the diagram that moves cannot disagree.
 *
 * NOTHING HERE IS A PROMISE THE APP DOES NOT KEEP. Every engine named below is
 * a provider the app actually ships, read from the app repository's
 * `pyproject.toml` entry points (`jarvis.stt`, `jarvis.tts`, `jarvis.brain`)
 * and its plugins; every "leaves" sentence is what that stage sends when it
 * runs with a provider. Checked against the app on 2026-10-19:
 *
 *   wake word   always on the device (openWakeWord / Vosk); no audio is sent
 *               to detect it — jarvis/speech/wake_constants.py, pipeline.py
 *   speech      faster-whisper and Nemotron (sherpa-onnx) run locally; Groq,
 *               OpenAI, Gemini, Deepgram and others are the providers
 *   brain       Ollama and any local OpenAI-compatible server (LM Studio,
 *               llama.cpp, vLLM) run locally; a screenshot goes to the brain
 *               only when the user asks it to look (screen_context/service.py)
 *   voice       Piper runs locally; Gemini, ElevenLabs, Cartesia and others
 *               are the providers
 *   memory      SQLite in the app's data folder; API keys in the OS keychain
 *
 * THE STARTING STATE IS THE SHIPPED DEFAULT, NOT THE FLATTERING ONE. A fresh
 * install uses a provider for all three movable stages (`jarvis.toml.example`:
 * `groq-api`, `gemini-flash-tts`, a cloud brain), because that is what works
 * without a GPU. The section opens there and lets the visitor pull each one
 * inside. Opening on "nothing leaves" would be the better picture and a false
 * one. If the shipped defaults change, `DEFAULT_SIDE` changes with them.
 */

export type Side = "local" | "provider";

export type PartId =
  | "mic"
  | "wake"
  | "stt"
  | "brain"
  | "voice"
  | "speaker"
  | "memory";

export type MovableId = "stt" | "brain" | "voice";

export interface Part {
  readonly id: PartId;
  readonly label: string;
  /** The engine line under the label while the part runs on the computer. */
  readonly local: string;
  /** The engine line while it runs with a provider. Movable parts only. */
  readonly provider?: string;
  /** What crosses the line while this part runs with a provider. */
  readonly leaves?: string;
  /** What happens instead while it runs on the computer. */
  readonly stays?: string;
}

export const PARTS: Record<PartId, Part> = {
  mic: { id: "mic", label: "Microphone", local: "your voice" },
  wake: { id: "wake", label: "Wake word", local: "openWakeWord · Vosk" },
  stt: {
    id: "stt",
    label: "Speech to text",
    local: "faster-whisper · Nemotron",
    provider: "Groq · OpenAI · Deepgram",
    leaves: "A recording of what you say after the wake word.",
    stays: "Your voice turns into text on your own CPU or GPU.",
  },
  brain: {
    id: "brain",
    label: "Brain",
    local: "Ollama · LM Studio",
    provider: "OpenAI · Gemini · Grok",
    leaves:
      "The text of each request with the context it needs, and a screenshot when you ask it to look.",
    stays: "A model on your machine thinks it through. The request goes nowhere.",
  },
  voice: {
    id: "voice",
    label: "Voice",
    local: "Piper",
    provider: "Gemini · ElevenLabs",
    leaves: "The words of each reply, to be spoken.",
    stays: "The reply is spoken by a voice that lives on your disk.",
  },
  speaker: { id: "speaker", label: "Speaker", local: "the answer, out loud" },
  memory: { id: "memory", label: "Memory", local: "SQLite on your disk" },
};

/** The three stages a visitor can move, in the order a request meets them. */
export const MOVABLE: readonly MovableId[] = ["stt", "brain", "voice"];

/** A fresh install. See the note at the top of this file. */
export const DEFAULT_SIDE: Record<MovableId, Side> = {
  stt: "provider",
  brain: "provider",
  voice: "provider",
};

/* ---------------------------------------------------------------------------
 * Geometry
 *
 * Two drawings of the same diagram: a wide one with the line standing
 * upright between "your computer" on the left and "providers" on the right,
 * and a tall one for a phone with the line lying across it. Coordinates are
 * in each drawing's own viewBox units and name a part's CENTRE.
 * ------------------------------------------------------------------------ */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How a wire turns between two parts. `hv` runs across, then down; `vh` down,
 * then across; `vhv` and `hvh` split the run at its midpoint so the elbow
 * lands between the two parts rather than on either of them.
 */
export type Route = "hv" | "vh" | "vhv" | "hvh";

export interface Wire {
  readonly from: PartId;
  readonly to: PartId;
  readonly route: Route;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly node: { readonly w: number; readonly h: number };
  /** The line. `x` for the upright drawing, `y` for the lying one. */
  readonly line: { readonly axis: "x" | "y"; readonly at: number };
  /** Where each fixed part sits, and both seats of each movable one. */
  readonly fixed: Record<Exclude<PartId, MovableId>, Point>;
  readonly seats: Record<MovableId, Record<Side, Point>>;
  /** The request's path, in order. Packets ride it end to end. */
  readonly path: readonly Wire[];
  /** Memory feeds the brain; drawn, and ridden now and then. */
  readonly context: Wire;
  /** Where the two zone labels stand. */
  readonly labels: Record<Side, Point>;
  /** Whether the engine line under each label fits at this size. */
  readonly engines: boolean;
}

export const WIDE: Layout = {
  width: 960,
  height: 390,
  node: { w: 196, h: 60 },
  line: { axis: "x", at: 650 },
  fixed: {
    mic: { x: 120, y: 70 },
    wake: { x: 360, y: 70 },
    speaker: { x: 120, y: 330 },
    memory: { x: 240, y: 245 },
  },
  seats: {
    stt: { local: { x: 520, y: 160 }, provider: { x: 820, y: 160 } },
    brain: { local: { x: 520, y: 245 }, provider: { x: 820, y: 245 } },
    voice: { local: { x: 520, y: 330 }, provider: { x: 820, y: 330 } },
  },
  path: [
    { from: "mic", to: "wake", route: "hv" },
    { from: "wake", to: "stt", route: "hv" },
    { from: "stt", to: "brain", route: "vhv" },
    { from: "brain", to: "voice", route: "vhv" },
    { from: "voice", to: "speaker", route: "hv" },
  ],
  context: { from: "memory", to: "brain", route: "hvh" },
  labels: { local: { x: 22, y: 18 }, provider: { x: 678, y: 18 } },
  engines: true,
};

export const TALL: Layout = {
  width: 360,
  height: 560,
  node: { w: 104, h: 46 },
  line: { axis: "y", at: 390 },
  fixed: {
    mic: { x: 62, y: 62 },
    wake: { x: 62, y: 172 },
    speaker: { x: 298, y: 62 },
    memory: { x: 180, y: 172 },
  },
  seats: {
    stt: { local: { x: 62, y: 296 }, provider: { x: 62, y: 488 } },
    brain: { local: { x: 180, y: 296 }, provider: { x: 180, y: 488 } },
    voice: { local: { x: 298, y: 296 }, provider: { x: 298, y: 488 } },
  },
  path: [
    { from: "mic", to: "wake", route: "vh" },
    { from: "wake", to: "stt", route: "vh" },
    { from: "stt", to: "brain", route: "hvh" },
    { from: "brain", to: "voice", route: "hvh" },
    { from: "voice", to: "speaker", route: "vh" },
  ],
  context: { from: "memory", to: "brain", route: "vh" },
  labels: { local: { x: 14, y: 20 }, provider: { x: 14, y: 414 } },
  engines: false,
};

/** The corner points of one wire, ends included. */
export function wirePoints(a: Point, b: Point, route: Route): Point[] {
  switch (route) {
    case "hv":
      return [a, { x: b.x, y: a.y }, b];
    case "vh":
      return [a, { x: a.x, y: b.y }, b];
    case "vhv": {
      const mid = (a.y + b.y) / 2;
      return [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b];
    }
    case "hvh": {
      const mid = (a.x + b.x) / 2;
      return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
    }
  }
}

/** An SVG path `d` through a list of points. */
export function pointsToD(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

/** Where a part stands in a layout, for a given set of sides. */
export function seatOf(
  layout: Layout,
  id: PartId,
  sides: Record<MovableId, Side>,
): Point {
  if (id === "stt" || id === "brain" || id === "voice") {
    return layout.seats[id][sides[id]];
  }
  return layout.fixed[id];
}
