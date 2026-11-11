/**
 * The six screens on the agents wall. Each is a pane of the app's Agentic IDE
 * (a title strip with the agent's name and its command-line tool) with that
 * tool's terminal session under it, drawn the way such a session looks: the
 * request in its own bar, each tool call as a bullet with its result hanging
 * under it, edits as a red and a green line, the tool's "working" line and the
 * prompt box at the foot.
 *
 * What they show is data (src/data/sessions.ts), which the page lists as well.
 * The sessions are scripted and claim nothing.
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

import { AGENT_SESSIONS, type Line, type Session } from "@/data/sessions";

import { makeCanvas, type Context, type Pen } from "../kit";
import { AGENT_COUNT } from "../script";
import type { Channels } from "../timeline";

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '"Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** How each tool's own terminal says that it is busy, and the colour it says it in. */
const TOOLS: Record<string, { token: string; busy: string; hint: string }> = {
  "Claude Code": { token: "--tui-claude", busy: "Working…", hint: "esc to interrupt" },
  Codex: { token: "--tui-codex", busy: "Working", hint: "esc to interrupt" },
  "Gemini CLI": { token: "--tui-gemini", busy: "Thinking…", hint: "esc to cancel" },
  OpenCode: { token: "--tui-opencode", busy: "Working…", hint: "esc interrupt" },
};
/** The first word of a step that is a tool call: `Read tests/login.spec.ts` is `Read(tests/login.spec.ts)`. */
const TOOL_VERBS = new Set(["Read", "Search", "Edit", "Bash", "Run", "Write", "Screenshot"]);

interface Pane {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  texture: Texture;
  material: MeshBasicMaterial;
  session: Session;
  job: readonly Line[];
  shown: number;
  until: number;
  /** 0 asleep, 1 awake. */
  lit: number;
  drawnLit: number;
  dirty: boolean;
  /** Advances while the pane works, for the "working" mark. */
  beat: number;
  /** The job is done and its last screen is being left up. */
  resting: boolean;
}

export interface Terminals {
  attach(quads: Map<string, Mesh>): void;
  update(ch: Channels, reveal: number, time: number): void;
}

export function createTerminals(ctx: Context): Terminals {
  const calm = ctx.tier.calm;
  const hex = (name: string) => `#${ctx.token(name).getHexString()}`;
  const colors = {
    ground: hex("--surface-card"),
    strip: hex("--surface-strong"),
    line: hex("--hairline-strong"),
    ink: hex("--ink"),
    muted: hex("--muted"),
    good: hex("--success"),
    bad: hex("--error"),
  };
  const accents = new Map(Object.entries(TOOLS).map(([tool, look]) => [tool, hex(look.token)]));
  const panes = new Map<string, Pane>();
  let turn = 0;

  const draw = (pane: Pane) => {
    const { canvas } = pane;
    const w = canvas.width;
    const h = canvas.height;
    const g = canvas.getContext("2d") as Pen;
    const unit = w / 640;
    const awake = pane.lit > 0.5;
    const working = awake && pane.shown < pane.job.length;
    const look = TOOLS[pane.session.tool] ?? TOOLS["Claude Code"];
    const accent = accents.get(pane.session.tool) ?? colors.ink;

    g.globalAlpha = 1;
    g.fillStyle = colors.ground;
    g.fillRect(0, 0, w, h);

    // The pane's title strip, as in the app: a status dot, who works here, and with what.
    const strip = 50 * unit;
    g.fillStyle = colors.strip;
    g.fillRect(0, 0, w, strip);
    g.fillStyle = awake ? colors.good : colors.muted;
    g.beginPath();
    g.arc(22 * unit, strip / 2, 6 * unit, 0, Math.PI * 2);
    g.fill();
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = colors.ink;
    g.font = `600 ${22 * unit}px ${SANS}`;
    g.fillText(pane.session.agent, 40 * unit, strip / 2 + unit);
    const nameW = g.measureText(pane.session.agent).width;
    g.fillStyle = colors.muted;
    g.font = `400 ${19 * unit}px ${SANS}`;
    g.fillText(pane.session.tool, 40 * unit + nameW + 12 * unit, strip / 2 + unit);

    // The terminal under it.
    const size = 17.5 * unit;
    const leading = size * 1.5;
    const left = 18 * unit;
    const foot = 96 * unit; // the working line, the prompt box and the hint
    const rows = Math.max(1, Math.floor((h - strip - foot - 10 * unit) / leading));
    const visible = pane.job.slice(0, pane.shown).slice(-rows);
    g.font = `400 ${size}px ${MONO}`;
    g.textBaseline = "alphabetic";
    const clip = (text: string, room: number) => {
      if (g.measureText(text).width <= room) return text;
      let cutAt = text.length;
      while (cutAt > 4 && g.measureText(`${text.slice(0, cutAt)}…`).width > room) cutAt--;
      return `${text.slice(0, cutAt)}…`;
    };
    const bullet = (x: number, y: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x + size * 0.3, y - size * 0.3, size * 0.24, 0, Math.PI * 2);
      g.fill();
    };
    /** The corner a result hangs from. */
    const elbow = (x: number, y: number) => {
      g.strokeStyle = colors.muted;
      g.lineWidth = 1.4 * unit;
      g.beginPath();
      g.moveTo(x, y - size * 0.78);
      g.lineTo(x, y - size * 0.22);
      g.lineTo(x + size * 0.5, y - size * 0.22);
      g.stroke();
    };
    const indent = left + size * 1.15;
    const hang = indent + size * 1.25;

    visible.forEach((line, i) => {
      const y = strip + 14 * unit + (i + 1) * leading - size * 0.36;
      const running = working && i === visible.length - 1 && line.kind === "step";
      if (line.kind === "ask") {
        // The request, echoed in its own bar.
        g.fillStyle = colors.strip;
        g.fillRect(left - 6 * unit, y - size * 1.08, w - (left - 6 * unit) * 2, leading);
        g.fillStyle = colors.muted;
        g.font = `400 ${size}px ${MONO}`;
        g.fillText(">", left, y);
        g.fillStyle = colors.ink;
        g.fillText(clip(line.text, w - indent - left), indent, y);
      } else if (line.kind === "step") {
        const [verb, ...rest] = line.text.split(" ");
        const call = TOOL_VERBS.has(verb) && rest.length > 0;
        bullet(left, y, running ? colors.ink : call ? colors.good : colors.ink);
        g.fillStyle = colors.ink;
        if (call) {
          g.font = `700 ${size}px ${MONO}`;
          g.fillText(verb, indent, y);
          const verbW = g.measureText(verb).width;
          g.font = `400 ${size}px ${MONO}`;
          g.fillText(clip(`(${rest.join(" ")})`, w - indent - verbW - left), indent + verbW, y);
        } else {
          g.font = `400 ${size}px ${MONO}`;
          g.fillText(clip(line.text, w - indent - left), indent, y);
        }
      } else if (line.kind === "out" || line.kind === "ok") {
        elbow(indent + size * 0.2, y);
        g.font = `400 ${size}px ${MONO}`;
        g.fillStyle = line.kind === "ok" ? colors.good : colors.muted;
        g.fillText(clip(line.text, w - hang - left), hang, y);
      } else if (line.kind === "add" || line.kind === "cut") {
        // An edit: the line that went and the line that came, each on its own ground.
        g.globalAlpha = 0.2;
        g.fillStyle = line.kind === "add" ? colors.good : colors.bad;
        g.fillRect(hang - 6 * unit, y - size * 1.05, w - hang - left + 6 * unit, leading);
        g.globalAlpha = 1;
        g.font = `400 ${size}px ${MONO}`;
        g.fillStyle = line.kind === "add" ? colors.good : colors.bad;
        g.fillText(clip(line.text, w - hang - left - 4 * unit), hang, y);
      } else {
        bullet(left, y, colors.ink);
        g.font = `400 ${size}px ${MONO}`;
        g.fillStyle = colors.ink;
        g.fillText(clip(line.text, w - indent - left), indent, y);
      }
    });

    // The foot of the terminal: the tool's own "working" line, its prompt box, its hint.
    const boxH = 40 * unit;
    const boxY = h - 26 * unit - boxH;
    if (working) {
      const y = boxY - 12 * unit;
      // The working mark: six arms, turning a step at a time.
      const cx = left + size * 0.32;
      const cy = y - size * 0.32;
      g.strokeStyle = accent;
      g.lineWidth = 2 * unit;
      g.lineCap = "round";
      for (let arm = 0; arm < 3; arm++) {
        const angle = (arm * Math.PI) / 3 + (pane.beat % 2) * (Math.PI / 6);
        const reach = size * 0.34;
        g.beginPath();
        g.moveTo(cx - Math.cos(angle) * reach, cy - Math.sin(angle) * reach);
        g.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
        g.stroke();
      }
      g.font = `400 ${size}px ${MONO}`;
      g.fillStyle = accent;
      g.fillText(look.busy, indent, y);
      const busyW = g.measureText(look.busy).width;
      g.fillStyle = colors.muted;
      g.fillText(` (${look.hint})`, indent + busyW, y);
    }
    g.strokeStyle = colors.line;
    g.lineWidth = 1.5 * unit;
    g.beginPath();
    g.roundRect(left - 6 * unit, boxY, w - (left - 6 * unit) * 2, boxH, 7 * unit);
    g.stroke();
    g.font = `400 ${size}px ${MONO}`;
    g.fillStyle = colors.muted;
    g.fillText(">", left + 4 * unit, boxY + boxH / 2 + size * 0.34);
    if (awake && !working) {
      // Done: the cursor waits in the box.
      g.fillStyle = colors.ink;
      g.fillRect(left + 4 * unit + size * 1.1, boxY + boxH / 2 - size * 0.55, size * 0.5, size * 1.1);
    }
    g.font = `400 ${size * 0.82}px ${MONO}`;
    g.fillStyle = colors.muted;
    g.fillText("? for shortcuts", left, h - 9 * unit);

    pane.texture.needsUpdate = true;
    pane.drawnLit = pane.lit;
    pane.dirty = false;
  };

  const make = (mesh: Mesh, session: Session): Pane => {
    const scale = ctx.tier.small ? 0.75 : 1;
    const canvas = makeCanvas(Math.round(640 * scale), Math.round(400 * scale));
    const texture = new CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = ctx.anisotropy;
    const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    mesh.material = material;
    const job = session.jobs[0];
    return { canvas, texture, material, session, job, shown: calm ? job.length : 0, until: 0, lit: 0, drawnLit: -1, dirty: true, beat: 0, resting: false };
  };

  return {
    attach(quads) {
      for (let i = 0; i < AGENT_COUNT; i++) {
        const name = `Wall_${i + 1}`;
        const mesh = quads.get(name);
        if (mesh && !panes.has(name)) panes.set(name, make(mesh, AGENT_SESSIONS[i % AGENT_SESSIONS.length]));
      }
    },

    update(ch, reveal, time) {
      const on = Math.min(1, reveal / 0.4);
      for (const [name, pane] of panes) {
        const index = Number(name.slice(5)) - 1;
        const lit = Math.min(1, Math.max(0, ch.agents - index));
        if (lit > 0.5 !== pane.lit > 0.5) pane.dirty = true;
        pane.lit = lit;
        // An unlit screen is not off: it idles, dim, like a monitor asleep.
        pane.material.color.setScalar(on * (0.1 + 0.9 * pane.lit));

        if (!calm && pane.lit > 0.5) {
          if (pane.until === 0) pane.until = time + 0.6;
          if (time >= pane.until) {
            if (pane.shown < pane.job.length) {
              pane.until = time + (pane.job[pane.shown].wait ?? 0.4);
              pane.shown += 1;
              pane.beat += 1;
              pane.dirty = true;
            } else if (!pane.resting) {
              // The job is done: its last screen stays up for a while.
              pane.resting = true;
              pane.until = time + 7 + index * 0.9;
            } else {
              // Then the same request comes in again, on a clean pane.
              pane.resting = false;
              pane.shown = 1;
              pane.until = time + (pane.job[0].wait ?? 0.9);
              pane.dirty = true;
            }
          }
        }
      }
      // One pane redrawn per frame at most: a canvas upload is not free.
      const list = [...panes.values()];
      for (let i = 0; i < list.length; i++) {
        const pane = list[(turn + i) % list.length];
        if (pane.dirty) {
          draw(pane);
          turn = (turn + i + 1) % list.length;
          break;
        }
      }
    },
  };
}
