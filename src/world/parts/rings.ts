/**
 * The hologram above the holo table: every service, skill and command-line
 * tool the app reaches, as three rings of small tiles turning around one
 * point. One ring is lit at a time.
 *
 * All tiles are one draw call. Each tile's place on its ring is computed in the
 * vertex shader from its angle, so nothing is moved on the processor; the same
 * arithmetic is repeated in `pick` to find the tile under the pointer.
 *
 * The marks identify third-party services and imply no partnership; the room's
 * lightbox says so beside them (docs/LOGOS.md).
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Vector3,
  type Ray,
} from "three";

import { breathe, makeCanvas, type Context, type Pen } from "../kit";
import { RINGS } from "../script";
import type { Channels } from "../timeline";

/**
 * What the page hands over: the marks' sprite sheet, already decoded (an SVG
 * can only be decoded on the page, src/world/link.ts), and the names on the
 * tiles.
 */
export interface RingData {
  /** The sprite sheet: `columns` marks per row, square cells. */
  sheet: ImageBitmap;
  columns: number;
  /** Every mark in sheet order. */
  marks: readonly string[];
  /** Names of the marks that are command-line tools; they ride the third ring. */
  clis: readonly string[];
  skills: readonly string[];
}

export interface RingPick {
  label: string;
  ring: number;
}

export interface Rings {
  mesh: Mesh;
  update(ch: Channels, time: number): void;
  /** The tile the ray meets first, if any. */
  pick(ray: Ray): RingPick | null;
  setHover(pick: RingPick | null): void;
}

const VERTEX = /* glsl */ `
  attribute vec4 aCell;
  attribute vec3 aPlace;
  attribute vec2 aSize;
  attribute float aIndex;
  uniform vec3 uCenter;
  uniform vec3 uRingY;
  uniform vec3 uRingR;
  uniform vec3 uPhase;
  uniform float uRings;
  uniform float uFocus;
  uniform float uHover;
  uniform float uTime;
  /* 1 for the tiles themselves; more for the glow drawn around them. */
  uniform float uGrow;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying vec2 vSize;
  varying float vRing;
  varying float vHover;
  varying float vDepth;
  varying float vHeight;
  float pick(vec3 v, float i) {
    return i < 0.5 ? v.x : (i < 1.5 ? v.y : v.z);
  }
  void main() {
    float ring = aPlace.y;
    float radius = pick(uRingR, ring);
    float angle = aPlace.x + pick(uPhase, ring);
    // The hologram shows one ring at a time. Its tiles rise out of the table
    // into their places, one after another; the others are folded back into it.
    float shown = uRings * (1.0 - clamp(abs(uFocus - (ring + 1.0)), 0.0, 1.0));
    float appear = smoothstep(aPlace.z * 0.5, aPlace.z * 0.5 + 0.5, shown);
    float hover = 1.0 - step(0.5, abs(uHover - aIndex));
    vec2 size = aSize * appear * (1.0 + 0.12 * hover) * uGrow;
    vec3 center = uCenter + vec3(
      sin(angle) * radius,
      pick(uRingY, ring) * appear + sin(uTime * 0.6 + aPlace.z * 40.0) * 0.012 - (1.0 - appear) * 0.72,
      cos(angle) * radius
    );
    vec3 right = vec3(cos(angle), 0.0, -sin(angle));
    vec3 world = center + right * position.x * size.x + vec3(0.0, 1.0, 0.0) * position.y * size.y;
    vec4 view = viewMatrix * vec4(world, 1.0);
    vUv = uv;
    vAtlas = mix(aCell.xy, aCell.zw, uv);
    vSize = aSize;
    vRing = ring;
    vHover = hover;
    vDepth = -view.z;
    vHeight = world.y;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tAtlas;
  uniform vec3 uCard;
  uniform vec3 uInk;
  uniform vec3 uLine;
  uniform vec3 uAccent;
  uniform vec3 uGround;
  uniform float uFocus;
  uniform float uDim;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying vec2 vSize;
  varying float vRing;
  varying float vHover;
  varying float vDepth;
  varying float vHeight;
  void main() {
    // A rounded rectangle, measured in metres so every tile gets the same corner.
    float corner = 0.018;
    vec2 p = (vUv - 0.5) * vSize;
    vec2 q = abs(p) - (vSize * 0.5 - vec2(corner));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    float aa = fwidth(d) + 0.0001;
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    if (alpha < 0.02) discard;

    bool front = gl_FrontFacing;
    bool paper = vRing > 0.5 && vRing < 1.5;
    bool terminal = vRing > 1.5;
    float cover = front ? texture2D(tAtlas, vAtlas).r : 0.0;
    float focus = 1.0 - clamp(abs(uFocus - (vRing + 1.0)), 0.0, 1.0);

    // Projected light has no black: the darkest a tile gets is a deep blue.
    vec3 glass = mix(uCard, uAccent, 0.1 + 0.12 * focus);
    vec3 fill = paper ? uInk : glass;
    vec3 mark = paper ? uGround : uInk;
    vec3 color = mix(fill, mark, cover);

    // The edge: a hairline, in the accent while the tile's ring is the lit one.
    float edge = smoothstep(-0.004 - aa, -0.004 + aa, d);
    vec3 rim = mix(uLine, uAccent, focus);
    if (!paper) color = mix(color, rim, edge);

    // A command-line tool's tile wears a window's title bar: a line and three dots.
    if (terminal && front) {
      float bar = p.y - (vSize.y * 0.5 - 0.03);
      float line = 1.0 - smoothstep(0.0, 0.001 + aa, abs(bar));
      vec2 dots = vec2(p.x + vSize.x * 0.5 - 0.022, p.y - (vSize.y * 0.5 - 0.015));
      float dot = 0.0;
      for (int i = 0; i < 3; i++) {
        dot = max(dot, 1.0 - smoothstep(0.0034, 0.0034 + aa, length(dots - vec2(float(i) * 0.013, 0.0))));
      }
      color = mix(color, uLine, max(line, dot) * (1.0 - edge));
    }

    // An unlit ring is a presence, not a subject; paper would outshine the lit one.
    float level = mix(paper ? 0.1 : 0.34, 1.0, focus);
    level *= front ? 1.0 : 0.34;
    level *= mix(1.0, 0.45, smoothstep(1.6, 3.8, vDepth));
    // Projected light: a faint line travels up through every tile.
    float scan = 0.9 + 0.1 * sin(vHeight * 180.0 - uTime * 3.0);
    level = min(1.0, level * scan + 0.25 * vHover) * uDim;
    gl_FragColor = vec4(color * level, alpha);
    #include <colorspace_fragment>
  }
`;

/* The glow of a lit tile: light that spills past its edge, added to what is behind. */
const GLOW_FRAGMENT = /* glsl */ `
  uniform vec3 uAccent;
  uniform float uFocus;
  uniform float uDim;
  uniform float uGrow;
  varying vec2 vUv;
  varying float vRing;
  varying float vHover;
  void main() {
    float focus = 1.0 - clamp(abs(uFocus - (vRing + 1.0)), 0.0, 1.0);
    vec2 p = abs(vUv - 0.5) * 2.0;
    vec2 q = p - vec2(1.0 / uGrow);
    // Nothing over the tile's own face, most at its edge, none at the quad's.
    float outside = step(0.0, max(q.x, q.y));
    float d = length(max(q, 0.0)) / (1.0 - 1.0 / uGrow);
    // The far side of a ring glows less: it is seen through the near one.
    float side = gl_FrontFacing ? 1.0 : 0.25;
    float a = pow(1.0 - clamp(d, 0.0, 1.0), 3.0) * outside * side * (0.13 * focus + 0.16 * vHover) * uDim;
    gl_FragColor = vec4(uAccent * a, 1.0);
    #include <colorspace_fragment>
  }
`;

const COLUMNS = 10;
const ROWS = 8;
/** Tile sizes in metres. */
const MARK_TILE = 0.21;
const CARD_TILE = { width: 0.36, height: 0.225 };
/** How many tiles fit a ring of one metre's radius without touching. */
const MARK_TILES = 24;
const SKILL_CARDS = 14;

export async function createRings(ctx: Context, data: RingData, at: Vector3): Promise<Rings> {
  const scale = ctx.tier.small ? 1 : 2;
  const cellW = 204 * scale;
  const cellH = 128 * scale;
  const canvas = makeCanvas(cellW * COLUMNS, cellH * ROWS);
  const g = canvas.getContext("2d") as Pen;
  g.fillStyle = "black";
  g.fillRect(0, 0, canvas.width, canvas.height);

  // Marks: each in the square at the middle of its cell. A few at a time, so
  // the drawing never holds its thread for long.
  const sheet = data.sheet;
  const sourceCell = sheet.width / data.columns;
  for (let i = 0; i < data.marks.length; i++) {
    const sx = (i % data.columns) * sourceCell;
    const sy = Math.floor(i / data.columns) * sourceCell;
    const dx = (i % COLUMNS) * cellW + (cellW - cellH) / 2;
    const dy = Math.floor(i / COLUMNS) * cellH;
    g.drawImage(sheet, sx, sy, sourceCell, sourceCell, dx, dy, cellH, cellH);
    if (i % 10 === 9) await breathe();
  }
  sheet.close();

  // Skills: a page each, its name and a few lines of text under it.
  const firstSkillCell = Math.ceil(data.marks.length / COLUMNS) * COLUMNS;
  const skills = data.skills.slice(0, Math.min(SKILL_CARDS, COLUMNS * ROWS - firstSkillCell));
  g.fillStyle = "white";
  g.textBaseline = "alphabetic";
  skills.forEach((name, i) => {
    const cell = firstSkillCell + i;
    const x = (cell % COLUMNS) * cellW;
    const y = Math.floor(cell / COLUMNS) * cellH;
    const pad = 16 * scale;
    // The name in up to two lines, then a few lines of "text": a skill is a text file.
    g.font = `600 ${19 * scale}px "Inter", system-ui, "Segoe UI", sans-serif`;
    const words = name.split(" ");
    const rows: string[] = [];
    let row = "";
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (row && g.measureText(next).width > cellW - pad * 2) {
        rows.push(row);
        row = word;
      } else row = next;
    }
    if (row) rows.push(row);
    rows.slice(0, 2).forEach((text, line) => g.fillText(text, x + pad, y + pad + (18 + line * 24) * scale));
    const top = pad + (18 + Math.min(rows.length, 2) * 24) * scale;
    for (let line = 0; line < 3; line++) {
      const width = (cellW - pad * 2) * [0.9, 0.7, 0.44][line];
      g.globalAlpha = 0.3;
      g.fillRect(x + pad, y + top + line * 13 * scale, width, 4 * scale);
      g.globalAlpha = 1;
    }
  });

  const atlas = new CanvasTexture(canvas);
  atlas.format = RedFormat;
  atlas.generateMipmaps = true;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.anisotropy = ctx.anisotropy;

  // Which tile shows what, on which ring. Top: apps and models. Middle: skills.
  // Bottom: command-line tools.
  interface Tile {
    ring: number;
    cell: number;
    square: boolean;
    label: string;
  }
  const clis = new Set(data.clis);
  const tiles: Tile[] = [];
  const marksOf = (ring: number, wanted: boolean) =>
    data.marks
      .map((name, cell) => ({ ring, cell, square: true, label: name }))
      .filter((tile) => clis.has(tile.label) === wanted)
      .slice(0, MARK_TILES);
  tiles.push(...marksOf(0, false));
  skills.forEach((name, i) => tiles.push({ ring: 1, cell: firstSkillCell + i, square: false, label: name }));
  tiles.push(...marksOf(2, true));

  const count = tiles.length;
  const perRing = [0, 1, 2].map((ring) => tiles.filter((tile) => tile.ring === ring).length);
  const seen = [0, 0, 0];
  const cells = new Float32Array(count * 4);
  const places = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 2);
  const indices = new Float32Array(count);
  tiles.forEach((tile, i) => {
    const column = tile.cell % COLUMNS;
    const row = Math.floor(tile.cell / COLUMNS);
    const inset = tile.square ? (cellW - cellH) / 2 : 0;
    // The canvas is uploaded upside down (flipY), so its rows count from the top.
    const u0 = (column * cellW + inset) / canvas.width;
    const u1 = ((column + 1) * cellW - inset) / canvas.width;
    const v1 = 1 - (row * cellH) / canvas.height;
    const v0 = 1 - ((row + 1) * cellH) / canvas.height;
    cells.set([u0, v0, u1, v1], i * 4);
    const angle = (seen[tile.ring]++ / perRing[tile.ring]) * Math.PI * 2;
    places.set([angle, tile.ring, ((i * 0.61803) % 1) * 0.999], i * 3);
    sizes.set(tile.square ? [MARK_TILE, MARK_TILE] : [CARD_TILE.width, CARD_TILE.height], i * 2);
    indices[i] = i;
  });

  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute("aCell", new InstancedBufferAttribute(cells, 4));
  geometry.setAttribute("aPlace", new InstancedBufferAttribute(places, 3));
  geometry.setAttribute("aSize", new InstancedBufferAttribute(sizes, 2));
  geometry.setAttribute("aIndex", new InstancedBufferAttribute(indices, 1));
  geometry.instanceCount = count;

  const phase = new Vector3();
  const material = new ShaderMaterial({
    uniforms: {
      tAtlas: { value: atlas },
      uCard: { value: ctx.token("--surface-card") },
      uInk: { value: ctx.token("--ink") },
      uLine: { value: ctx.token("--hairline-strong") },
      uAccent: { value: ctx.token("--world-accent") },
      uGround: { value: ctx.token("--canvas") },
      uCenter: { value: at.clone() },
      uRingY: { value: new Vector3(RINGS[0].y, RINGS[1].y, RINGS[2].y) },
      uRingR: { value: new Vector3(RINGS[0].radius, RINGS[1].radius, RINGS[2].radius) },
      uPhase: { value: phase },
      uRings: { value: 0 },
      uFocus: { value: 0 },
      uHover: { value: -1 },
      uTime: { value: 0 },
      uDim: { value: 1 },
      uGrow: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
    alphaToCoverage: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  // The glow shares the tiles' geometry and every uniform that places them.
  const glowMaterial = new ShaderMaterial({
    uniforms: { ...material.uniforms, uGrow: { value: 1.6 } },
    vertexShader: VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const glow = new Mesh(geometry, glowMaterial);
  glow.frustumCulled = false;
  glow.renderOrder = 2;
  mesh.add(glow);

  const calm = ctx.tier.calm;
  const center = new Vector3();
  const normal = new Vector3();
  const right = new Vector3();
  const hit = new Vector3();
  let rings = 0;
  let focus = 0;
  let time = 0;

  return {
    mesh,

    update(ch, now) {
      time = calm ? 0 : now;
      rings = ch.rings;
      focus = ch.ring;
      phase.set(RINGS[0].speed * time, RINGS[1].speed * time, RINGS[2].speed * time);
      material.uniforms.uRings.value = ch.rings;
      material.uniforms.uFocus.value = ch.ring;
      material.uniforms.uTime.value = time;
      mesh.visible = ch.rings > 0.002;
    },

    pick(ray) {
      if (rings < 0.9) return null;
      let best: RingPick | null = null;
      let nearest = Infinity;
      for (let i = 0; i < count; i++) {
        const tile = tiles[i];
        if (Math.abs(focus - (tile.ring + 1)) > 0.3) continue;
        const ring = RINGS[tile.ring];
        const angle = places[i * 3] + ring.speed * time;
        normal.set(Math.sin(angle), 0, Math.cos(angle));
        center.set(at.x + normal.x * ring.radius, at.y + ring.y, at.z + normal.z * ring.radius);
        const facing = normal.dot(ray.direction);
        // Only tiles that show their face.
        if (facing > -0.05) continue;
        const along = center.clone().sub(ray.origin).dot(normal) / facing;
        if (along <= 0 || along >= nearest) continue;
        hit.copy(ray.direction).multiplyScalar(along).add(ray.origin).sub(center);
        right.set(normal.z, 0, -normal.x);
        if (Math.abs(hit.dot(right)) > sizes[i * 2] / 2 || Math.abs(hit.y) > sizes[i * 2 + 1] / 2 + 0.012) continue;
        nearest = along;
        best = { label: tile.label, ring: tile.ring };
        material.userData.hover = i;
      }
      if (!best) material.userData.hover = -1;
      return best;
    },

    setHover(pick) {
      material.uniforms.uHover.value = pick ? (material.userData.hover as number) : -1;
    },
  };
}
