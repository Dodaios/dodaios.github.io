/**
 * The room's working screens: six on the agents wall, one upright beside the
 * main monitor. Each shows one coding agent in its terminal, doing a job line
 * by line, in the look of a pane of the app's Agentic IDE (a title strip with
 * the agent's name and its command-line tool, the session under it).
 *
 * What they show is data (src/data/sessions.ts), which the page lists as well.
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

import { AGENT_SESSIONS, T1_IDLE, T1_RUN, type Line, type Session } from "@/data/sessions";

import { makeCanvas, type Context, type Pen } from "../kit";
import { AGENT_COUNT } from "../script";
import type { Channels } from "../timeline";

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '"Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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
  tall: boolean;
}

export interface Terminals {
  attach(quads: Map<string, Mesh>): void;
  /** The mascot heard an order: pane T1 runs it. */
  run(): void;
  update(ch: Channels, reveal: number, time: number): void;
}

export function createTerminals(ctx: Context): Terminals {
  const calm = ctx.tier.calm;
  const hex = (name: string) => `#${ctx.token(name).getHexString()}`;
  const colors = {
    ground: hex("--surface-card"),
    strip: hex("--surface-strong"),
    line: hex("--hairline"),
    ink: hex("--ink"),
    muted: hex("--muted"),
    accent: hex("--accent"),
    good: hex("--success"),
    bad: hex("--error"),
  };
  const panes = new Map<string, Pane>();
  let turn = 0;

  const draw = (pane: Pane) => {
    const { canvas } = pane;
    const w = canvas.width;
    const h = canvas.height;
    const g = canvas.getContext("2d") as Pen;
    const unit = pane.tall ? w / 450 : w / 640;
    g.fillStyle = colors.ground;
    g.fillRect(0, 0, w, h);

    // The title strip of a pane: a status dot, who works here, and with what.
    const strip = 56 * unit;
    g.fillStyle = colors.strip;
    g.fillRect(0, 0, w, strip);
    g.fillStyle = colors.line;
    g.fillRect(0, strip, w, 1.5 * unit);
    const awake = pane.lit > 0.5;
    g.fillStyle = awake ? colors.good : colors.muted;
    g.beginPath();
    g.arc(24 * unit, strip / 2, 6.5 * unit, 0, Math.PI * 2);
    g.fill();
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = colors.ink;
    g.font = `600 ${24 * unit}px ${SANS}`;
    g.fillText(pane.session.agent, 44 * unit, strip / 2 + unit);
    const nameW = g.measureText(pane.session.agent).width;
    g.fillStyle = colors.muted;
    g.font = `400 ${21 * unit}px ${SANS}`;
    g.fillText(pane.session.tool, 44 * unit + nameW + 14 * unit, strip / 2 + unit);

    // The session: the newest lines, the oldest scrolled away.
    const size = 21 * unit;
    const leading = size * 1.55;
    const rows = Math.floor((h - strip - 24 * unit) / leading);
    const visible = pane.job.slice(0, pane.shown).slice(-rows);
    g.font = `400 ${size}px ${MONO}`;
    g.textBaseline = "alphabetic";
    const clip = (text: string, room: number) => {
      if (g.measureText(text).width <= room) return text;
      let cutAt = text.length;
      while (cutAt > 4 && g.measureText(`${text.slice(0, cutAt)}…`).width > room) cutAt--;
      return `${text.slice(0, cutAt)}…`;
    };
    visible.forEach((line, i) => {
      const y = strip + 38 * unit + i * leading;
      const x = 20 * unit;
      const room = w - x * 2;
      if (line.kind === "ask") {
        g.fillStyle = colors.accent;
        g.fillText("›", x, y);
        g.fillStyle = colors.ink;
        g.fillText(clip(line.text, room - 24 * unit), x + 24 * unit, y);
      } else if (line.kind === "step") {
        g.fillStyle = colors.muted;
        g.fillText("●", x, y);
        g.fillStyle = colors.ink;
        g.fillText(clip(line.text, room - 28 * unit), x + 28 * unit, y);
      } else if (line.kind === "ok") {
        g.fillStyle = colors.good;
        g.fillText(clip(`✓ ${line.text}`, room - 28 * unit), x + 28 * unit, y);
      } else if (line.kind === "add" || line.kind === "cut") {
        g.fillStyle = line.kind === "add" ? colors.good : colors.bad;
        g.globalAlpha = 0.9;
        g.fillText(clip(line.text, room - 28 * unit), x + 28 * unit, y);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = colors.muted;
        g.fillText(clip(line.text, room - 28 * unit), x + 28 * unit, y);
      }
    });
    // The cursor, waiting on the line after the last one.
    if (awake && pane.shown < pane.job.length) {
      g.fillStyle = colors.ink;
      g.fillRect(20 * unit, strip + 38 * unit + visible.length * leading - size * 0.82, 10 * unit, size);
    }
    pane.texture.needsUpdate = true;
    pane.drawnLit = pane.lit;
    pane.dirty = false;
  };

  const make = (mesh: Mesh, session: Session, tall: boolean): Pane => {
    const scale = ctx.tier.small ? 0.75 : 1;
    const canvas = tall ? makeCanvas(Math.round(450 * scale), Math.round(800 * scale)) : makeCanvas(Math.round(640 * scale), Math.round(400 * scale));
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
    return { canvas, texture, material, session, job, shown: calm ? job.length : 0, until: 0, lit: 0, drawnLit: -1, dirty: true, tall };
  };

  return {
    attach(quads) {
      for (let i = 0; i < AGENT_COUNT; i++) {
        const name = `Wall_${i + 1}`;
        const mesh = quads.get(name);
        if (mesh && !panes.has(name)) panes.set(name, make(mesh, AGENT_SESSIONS[i % AGENT_SESSIONS.length], false));
      }
      const side = quads.get("Screen2");
      if (side && !panes.has("Screen2")) {
        const pane = make(side, { agent: "T1", tool: "Claude Code", jobs: [T1_IDLE, T1_RUN] }, true);
        pane.lit = 1;
        pane.shown = pane.job.length;
        panes.set("Screen2", pane);
      }
    },

    run() {
      const pane = panes.get("Screen2");
      if (!pane) return;
      pane.job = T1_RUN;
      pane.shown = calm ? T1_RUN.length : 1;
      pane.until = 0;
      pane.dirty = true;
    },

    update(ch, reveal, time) {
      const on = Math.min(1, reveal / 0.4);
      const dim = 1 - 0.6 * ch.wire;
      for (const [name, pane] of panes) {
        const wall = name.startsWith("Wall_");
        if (wall) {
          const index = Number(name.slice(5)) - 1;
          const lit = Math.min(1, Math.max(0, ch.agents - index));
          if (lit > 0.5 !== pane.lit > 0.5) pane.dirty = true;
          pane.lit = lit;
        }
        // An unlit screen is not off: it idles, dim, like a monitor asleep.
        pane.material.color.setScalar(on * dim * (0.1 + 0.9 * pane.lit));

        if (!calm && pane.lit > 0.5) {
          if (pane.until === 0) pane.until = time + 0.6;
          if (time >= pane.until) {
            if (pane.shown < pane.job.length) {
              pane.until = time + (pane.job[pane.shown].wait ?? 0.4);
              pane.shown += 1;
              pane.dirty = true;
            } else if (wall) {
              // The job is done: a breath, then the next one starts from a clean pane.
              pane.until = time + 5;
              pane.shown = 0;
              pane.dirty = true;
            } else if (pane.job === T1_RUN) {
              pane.job = T1_IDLE;
              pane.shown = T1_IDLE.length;
              pane.until = time + 1e9;
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
