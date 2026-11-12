/**
 * Every piece of text in the room. Nothing is laid over the picture: a headline
 * is a light bar above the monitor, a lightbox on a wall, lettering above the
 * screens, marker on the whiteboard, a card on the corkboard.
 *
 * The words come from the page (it hands them over as it starts, and the same
 * words are in its markup for a reader who cannot see the scene); this part
 * draws them onto the quads the room's models carry (`Text_*`, art/room/spec.py).
 */
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  SRGBColorSpace,
  type Mesh,
  type Texture,
} from "three";

import { makeCanvas, type Context, type Pen } from "../kit";
import type { Channels } from "../timeline";

/** The lines of each label, by the quad's name without its `Text_` prefix. */
export type LabelTexts = Record<string, readonly string[]>;

export interface Labels {
  /** Give every quad that has arrived its drawing. Safe to call again. */
  attach(quads: Map<string, Mesh>): void;
  /** Change a label's words (the star count, what the mascot heard). */
  set(id: string, lines: readonly string[]): void;
  update(ch: Channels, reveal: number): void;
}

const SANS = '"Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const HAND = '"Segoe Print", "Bradley Hand", "Marker Felt", "Comic Sans MS", cursive';

interface Paint {
  ink: string;
  paper: string;
  ground: string;
  glass: string;
  accent: string;
  muted: string;
}

type Draw = (g: Pen, w: number, h: number, lines: readonly string[], paint: Paint, small: boolean) => void;

interface Spec {
  /** Canvas size in px; the quad's own proportions. */
  size: readonly [number, number];
  /** The canvas covers the quad (a lit face) or only adds ink to what is baked under it. */
  opaque: boolean;
  /** How the label takes the room's light: it shines on its own, or it is print. */
  lit: "emits" | "print-light" | "print-dark";
  draw: Draw;
}

/** Split `text` into lines no wider than `width` at the current font. */
function wrap(g: Pen, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The largest size at which `text` fits `width` on one line, within limits. */
function fit(g: Pen, text: string, width: number, font: (px: number) => string, max: number, min: number): number {
  let px = max;
  for (; px > min; px -= 2) {
    g.font = font(px);
    if (g.measureText(text).width <= width) break;
  }
  g.font = font(px);
  return px;
}

function spaced(g: Pen, em: number): void {
  // Letter spacing where the canvas offers it; plain text where it does not.
  (g as unknown as { letterSpacing?: string }).letterSpacing = `${em}em`;
}

const SPECS: Record<string, Spec> = {
  /* The light bar above the monitor: the page's headline, in light. */
  hero: {
    size: [1536, 143],
    opaque: true,
    lit: "emits",
    draw(g, w, h, lines, paint, small) {
      g.fillStyle = paint.glass;
      g.fillRect(0, 0, w, h);
      g.fillStyle = paint.ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const text = (lines[0] ?? "").toUpperCase();
      if (small) {
        // A phone sees only the middle of the monitor: two lines, kept inside it.
        const px = 30;
        g.font = `500 ${px}px ${MONO}`;
        spaced(g, 0.12);
        const rows = wrap(g, text, w * 0.46).slice(0, 2);
        rows.forEach((row, i) => g.fillText(row, w / 2, h / 2 + (i - (rows.length - 1) / 2) * px * 1.35));
      } else {
        spaced(g, 0.16);
        fit(g, text, w * 0.84, (px) => `500 ${px}px ${MONO}`, 50, 26);
        g.fillText(text, w / 2, h / 2 + 2);
      }
      spaced(g, 0);
    },
  },

  /* A small lit sign on the desk: what to do, then what it heard. */
  voice: {
    size: [720, 320],
    opaque: true,
    lit: "emits",
    draw(g, w, h, lines, paint) {
      g.fillStyle = paint.paper;
      g.fillRect(0, 0, w, h);
      g.fillStyle = paint.ground;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const rows = lines.slice(0, 2).map((line) => line.toUpperCase());
      rows.forEach((row, i) => {
        spaced(g, 0.02);
        const px = fit(g, row, w * 0.86, (size) => `800 ${size}px ${SANS}`, i === 0 ? 96 : 60, 30);
        const y = rows.length === 1 ? h / 2 : h * (i === 0 ? 0.36 : 0.72);
        g.fillText(row, w / 2, y + px * 0.04);
      });
      spaced(g, 0);
    },
  },

  /* Lettering on the wall above the six screens. */
  agents: {
    size: [2048, 232],
    opaque: false,
    lit: "print-light",
    draw(g, w, h, lines, paint) {
      g.fillStyle = paint.ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      spaced(g, -0.02);
      fit(g, lines[0] ?? "", w * 0.94, (px) => `500 ${px}px ${SANS}`, 150, 60);
      g.fillText(lines[0] ?? "", w / 2, h / 2);
      spaced(g, 0);
    },
  },

  /* The cinema lightbox behind the holo table: black letters on a lit face. */
  reach: {
    size: [1440, 400],
    opaque: true,
    lit: "emits",
    draw(g, w, h, lines, paint) {
      g.fillStyle = paint.paper;
      g.fillRect(0, 0, w, h);
      // The rails the letters hang on.
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (const y of [0.1, 0.56, 0.905]) g.fillRect(0, h * y, w, 3);
      g.fillStyle = paint.ground;
      g.textAlign = "center";
      g.textBaseline = "middle";
      spaced(g, 0.03);
      fit(g, (lines[0] ?? "").toUpperCase(), w * 0.9, (px) => `800 ${px}px ${SANS}`, 150, 60);
      g.fillText((lines[0] ?? "").toUpperCase(), w / 2, h * 0.335);
      fit(g, (lines[1] ?? "").toUpperCase(), w * 0.9, (px) => `700 ${px}px ${SANS}`, 70, 30);
      g.fillText((lines[1] ?? "").toUpperCase(), w / 2, h * 0.73);
      spaced(g, 0);
      // The small print under the bottom rail: whose marks these are.
      if (lines[2]) {
        g.globalAlpha = 0.7;
        fit(g, lines[2], w * 0.94, (px) => `500 ${px}px ${SANS}`, 19, 12);
        g.fillText(lines[2], w / 2, h * 0.965);
        g.globalAlpha = 1;
      }
    },
  },

  /* The counter on the window sill. */
  stars: {
    size: [800, 200],
    opaque: true,
    lit: "emits",
    draw(g, w, h, lines, paint) {
      g.fillStyle = paint.glass;
      g.fillRect(0, 0, w, h);
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillStyle = paint.ink;
      g.font = `500 120px ${MONO}`;
      const figure = lines[0] ?? "";
      g.fillText(figure, 48, h / 2 + 6);
      const x = 48 + g.measureText(figure).width + 36;
      g.fillStyle = paint.muted;
      spaced(g, 0.14);
      g.font = `500 30px ${MONO}`;
      const rows = (lines[1] ?? "").toUpperCase().split(" ");
      const half = Math.ceil(rows.length / 2);
      g.fillText(rows.slice(0, half).join(" "), x, h / 2 - 22);
      g.fillText(rows.slice(half).join(" "), x, h / 2 + 26);
      spaced(g, 0);
    },
  },

  /* The strip of paper across the top of the corkboard: what the board is. */
  board: {
    size: [1056, 136],
    opaque: false,
    lit: "print-dark",
    draw(g, w, h, lines, paint) {
      g.fillStyle = paint.ground;
      g.textAlign = "center";
      g.textBaseline = "middle";
      spaced(g, 0.08);
      fit(g, (lines[0] ?? "").toUpperCase(), w * 0.9, (px) => `700 ${px}px ${SANS}`, 58, 28);
      g.fillText((lines[0] ?? "").toUpperCase(), w / 2, h / 2 + 3);
      spaced(g, 0);
    },
  },

  /*
   * The whiteboard: what to do to have the app, top to bottom. A heading, one
   * line that says where the command goes, the command itself on a printed
   * slip, and what happens after it.
   */
  install: {
    size: [1600, 1000],
    opaque: false,
    lit: "print-dark",
    draw(g, w, _h, lines, paint) {
      const [title = "", paste = "", command = "", then = "", ...rest] = lines;
      const hint = rest.length > 0 ? rest[rest.length - 1] : "";
      const steps = rest.slice(0, -1);
      const marker = "rgb(18,24,38)";
      g.fillStyle = marker;
      g.strokeStyle = marker;
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.font = `700 112px ${HAND}`;
      g.fillText(title, 90, 168);
      // Underline, by hand.
      g.lineWidth = 7;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(92, 198);
      g.bezierCurveTo(300, 212, 520, 188, 92 + g.measureText(title).width * 0.96, 202);
      g.stroke();

      g.font = `400 56px ${HAND}`;
      g.fillText(paste, 92, 296);

      // The command: printed, on a slip taped to the board, so every character is exact.
      g.fillStyle = "rgba(255,255,255,0.97)";
      g.fillRect(84, 338, w - 168, 176);
      g.fillStyle = "rgba(0,0,0,0.1)";
      g.fillRect(84, 510, w - 168, 4);
      g.fillStyle = paint.ground;
      fit(g, command, w - 260, (px) => `500 ${px}px ${MONO}`, 46, 30);
      const rows = wrap(g, command, w - 260);
      rows.slice(0, 2).forEach((row, i) => g.fillText(row, 130, rows.length === 1 ? 444 : 412 + i * 60));
      // Tape.
      g.fillStyle = "rgba(210,210,210,0.85)";
      g.fillRect(140, 320, 120, 34);
      g.fillRect(w - 260, 320, 120, 34);
      // What a press on the board does, in the accent: the one hint in colour,
      // with an arrow up to the slip it is about.
      g.fillStyle = paint.accent;
      g.strokeStyle = paint.accent;
      g.font = `700 54px ${HAND}`;
      g.textAlign = "right";
      g.fillText(hint, w - 150, 596);
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(w - 118, 600);
      g.quadraticCurveTo(w - 84, 580, w - 104, 532);
      g.moveTo(w - 128, 548);
      g.lineTo(w - 104, 530);
      g.lineTo(w - 90, 558);
      g.stroke();

      g.fillStyle = marker;
      g.textAlign = "left";
      g.font = `400 56px ${HAND}`;
      g.fillText(then, 92, 680);
      g.font = `400 58px ${HAND}`;
      steps.slice(0, 3).forEach((row, i) => g.fillText(`${i + 1}.  ${row}`, 132, 772 + i * 84));
    },
  },
};

/* A card on the corkboard: what somebody said, and who. */
const QUOTE: Spec = {
  size: [580, 720],
  opaque: false,
  lit: "print-dark",
  draw(g, w, h, lines, paint) {
    g.fillStyle = paint.ground;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const text = `“${lines[0] ?? ""}”`;
    let px = 46;
    let rows: string[] = [];
    for (; px >= 26; px -= 2) {
      g.font = `500 ${px}px ${SANS}`;
      rows = wrap(g, text, w - 96);
      if (rows.length * px * 1.32 < h - 230) break;
    }
    rows.forEach((row, i) => g.fillText(row, 48, 110 + i * px * 1.32));
    g.globalAlpha = 0.62;
    g.font = `500 26px ${MONO}`;
    g.fillText(lines[1] ?? "", 48, h - 84);
    g.font = `400 22px ${MONO}`;
    g.fillText((lines[2] ?? "").toUpperCase(), 48, h - 48);
    g.globalAlpha = 1;
  },
};

export function createLabels(ctx: Context, texts: LabelTexts): Labels {
  const small = ctx.tier.small;
  const paint: Paint = {
    ink: `#${ctx.token("--ink").getHexString()}`,
    paper: `#${ctx.token("--world-screen").getHexString()}`,
    ground: `#${ctx.token("--canvas").getHexString()}`,
    glass: `#${ctx.token("--canvas").getHexString()}`,
    accent: `#${ctx.token("--accent").getHexString()}`,
    muted: `#${ctx.token("--muted").getHexString()}`,
  };
  const words = new Map<string, readonly string[]>(Object.entries(texts));
  const live = new Map<
    string,
    { spec: Spec; canvas: OffscreenCanvas | HTMLCanvasElement; texture: Texture; material: MeshBasicMaterial }
  >();

  const specFor = (id: string): Spec | null => SPECS[id] ?? (id.startsWith("quote") ? QUOTE : null);

  const redraw = (id: string) => {
    const entry = live.get(id);
    if (!entry) return;
    const g = entry.canvas.getContext("2d") as Pen;
    g.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    entry.spec.draw(g, entry.canvas.width, entry.canvas.height, words.get(id) ?? [], paint, small);
    entry.texture.needsUpdate = true;
  };

  return {
    attach(quads) {
      for (const [name, mesh] of quads) {
        if (!name.startsWith("Text_")) continue;
        const id = name.slice(5);
        if (live.has(id)) continue;
        const spec = specFor(id);
        if (!spec) continue;
        // Half the pixels on a phone: the quads are small on its screen.
        const scale = small ? 0.75 : 1;
        const canvas = makeCanvas(Math.round(spec.size[0] * scale), Math.round(spec.size[1] * scale));
        const g = canvas.getContext("2d") as Pen;
        g.scale(scale, scale);
        const texture = new CanvasTexture(canvas);
        // A model's UVs run downward (the glTF convention): no flip.
        texture.flipY = false;
        texture.colorSpace = SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.anisotropy = ctx.anisotropy;
        const material = new MeshBasicMaterial({
          map: texture,
          transparent: !spec.opaque,
          depthWrite: spec.opaque,
          toneMapped: false,
          polygonOffset: !spec.opaque,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        mesh.material = material;
        mesh.renderOrder = spec.opaque ? 0 : 1;
        live.set(id, { spec: { ...spec, size: [spec.size[0], spec.size[1]] }, canvas, texture, material });
        // The drawing itself is done at the label's own size, whatever the canvas.
        const entry = live.get(id)!;
        entry.spec.draw = (pen, _w, _h, lines, colours, phone) => spec.draw(pen, spec.size[0], spec.size[1], lines, colours, phone);
        redraw(id);
      }
    },

    set(id, lines) {
      words.set(id, lines);
      redraw(id);
    },

    update(ch, reveal) {
      const on = Math.min(1, reveal / 0.5);
      for (const [id, { spec, material }] of live) {
        // Seated at the monitor, the page's own headline lies on the bar: the
        // bar's letters would only show beside it where the two differ in size.
        if (id === "hero") material.color.setScalar(on * (1 - ch.dock));
        else if (spec.lit === "emits") material.color.setScalar(on);
        // Print takes the room's light: dim at night, full in the morning.
        else if (spec.lit === "print-light") material.color.setScalar(on * (0.62 + 0.38 * ch.dawn));
        else material.opacity = on;
      }
    },
  };
}
