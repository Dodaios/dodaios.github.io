/**
 * The three orbits: every service, skill and command-line tool the app reaches,
 * as tiles circling the desk. One ring is lit at a time.
 *
 * All tiles are one draw call. Each tile's place on its ring is computed in the
 * vertex shader from its angle, so nothing is moved on the processor; the same
 * arithmetic is repeated in `pick` to find the tile under the pointer.
 *
 * The marks identify third-party services and imply no partnership; the page
 * says so beside them (docs/LOGOS.md).
 */
import {
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
  Vector2,
  Vector3,
  type Ray,
} from "three";

import { breathe, makeCanvas, type Context, type Pen } from "../kit";
import { RING_CENTER_Z, RINGS } from "../script";
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
  /** Names of the marks that are command-line tools; the rest ride the first ring. */
  clis: readonly string[];
  skills: readonly string[];
}

export interface RingPick {
  label: string;
  ring: number;
}

export interface Rings {
  mesh: Mesh;
  /** `shift` is the camera's lens shift: it tells which side the page's copy is on. */
  update(ch: Channels, time: number, shift: { x: number; y: number }): void;
  /** The tile the ray meets first, if any. */
  pick(ray: Ray): RingPick | null;
  setHover(pick: RingPick | null): void;
}

const VERTEX = /* glsl */ `
  attribute vec4 aCell;
  attribute vec3 aPlace;
  attribute vec2 aSize;
  attribute float aIndex;
  uniform vec3 uRingY;
  uniform vec3 uRingR;
  uniform vec3 uPhase;
  uniform float uCenterZ;
  uniform float uRings;
  uniform float uHover;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying vec2 vSize;
  varying float vRing;
  varying float vHover;
  varying float vDepth;
  varying vec2 vScreen;
  float pick(vec3 v, float i) {
    return i < 0.5 ? v.x : (i < 1.5 ? v.y : v.z);
  }
  void main() {
    float ring = aPlace.y;
    float radius = pick(uRingR, ring);
    float angle = aPlace.x + pick(uPhase, ring);
    float appear = smoothstep(aPlace.z * 0.6, aPlace.z * 0.6 + 0.4, uRings);
    float hover = 1.0 - step(0.5, abs(uHover - aIndex));
    vec2 size = aSize * appear * (1.0 + 0.1 * hover);
    vec3 center = vec3(
      sin(angle) * radius,
      pick(uRingY, ring) + sin(uTime * 0.6 + aPlace.z * 40.0) * 0.05,
      uCenterZ + cos(angle) * radius
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
    gl_Position = projectionMatrix * view;
    vScreen = gl_Position.xy / gl_Position.w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tAtlas;
  uniform vec3 uCard;
  uniform vec3 uInk;
  uniform vec3 uLine;
  uniform vec3 uGround;
  uniform float uFocus;
  uniform float uDim;
  uniform vec2 uCopy;
  varying vec2 vScreen;
  varying vec2 vUv;
  varying vec2 vAtlas;
  varying vec2 vSize;
  varying float vRing;
  varying float vHover;
  varying float vDepth;
  void main() {
    // A rounded rectangle, measured in metres so every tile gets the same corner.
    float corner = 0.075;
    vec2 p = (vUv - 0.5) * vSize;
    vec2 q = abs(p) - (vSize * 0.5 - vec2(corner));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    float aa = fwidth(d) + 0.0005;
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    if (alpha < 0.02) discard;

    bool front = gl_FrontFacing;
    bool paper = vRing > 0.5 && vRing < 1.5;
    bool terminal = vRing > 1.5;
    float cover = front ? texture2D(tAtlas, vAtlas).r : 0.0;

    vec3 fill = paper ? uInk : uCard;
    vec3 mark = paper ? uGround : uInk;
    vec3 color = mix(fill, mark, cover);

    // The edge: a hairline on the dark tiles, none on the paper ones.
    float edge = smoothstep(-0.016 - aa, -0.016 + aa, d);
    if (!paper) color = mix(color, uLine, edge);

    // A command-line tool's tile wears a window's title bar: a line and three dots.
    if (terminal && front) {
      float bar = p.y - (vSize.y * 0.5 - 0.115);
      float line = 1.0 - smoothstep(0.0, 0.004 + aa, abs(bar));
      vec2 dots = vec2(p.x + vSize.x * 0.5 - 0.085, p.y - (vSize.y * 0.5 - 0.058));
      float dot = 0.0;
      for (int i = 0; i < 3; i++) {
        dot = max(dot, 1.0 - smoothstep(0.013, 0.013 + aa, length(dots - vec2(float(i) * 0.05, 0.0))));
      }
      color = mix(color, uLine, max(line, dot) * (1.0 - edge));
    }

    float focus = 1.0 - clamp(abs(uFocus - (vRing + 1.0)), 0.0, 1.0);
    // An unlit ring is a presence, not a subject; paper would outshine the lit one.
    float level = mix(paper ? 0.05 : 0.1, 1.0, focus);
    level *= front ? 1.0 : 0.3;
    level *= mix(1.0, 0.3, smoothstep(7.0, 17.0, vDepth));
    // Where the page's copy stands the tiles step back, so the words stay readable.
    float beside = smoothstep(-0.2, 0.3, vScreen.x * sign(uCopy.x)) * abs(uCopy.x);
    float above = smoothstep(-0.2, 0.3, vScreen.y) * uCopy.y;
    level *= 1.0 - 0.93 * max(beside, above);
    level = min(1.0, level + 0.25 * vHover) * uDim;
    gl_FragColor = vec4(color * level, alpha);
    #include <colorspace_fragment>
  }
`;

const COLUMNS = 10;
const ROWS = 8;
/** Tile sizes in metres. */
const MARK_TILE = 0.62;
const CARD_TILE = { width: 0.98, height: 0.615 };

export async function createRings(ctx: Context, data: RingData): Promise<Rings> {
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
  const skills = data.skills.slice(0, COLUMNS * ROWS - firstSkillCell);
  g.fillStyle = "white";
  g.textBaseline = "alphabetic";
  skills.forEach((name, i) => {
    const cell = firstSkillCell + i;
    const x = (cell % COLUMNS) * cellW;
    const y = Math.floor(cell / COLUMNS) * cellH;
    const pad = 16 * scale;
    g.font = `500 ${13 * scale}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
    let label = name;
    while (label.length > 4 && g.measureText(label).width > cellW - pad * 2) label = `${label.slice(0, -2)}…`;
    g.fillText(label, x + pad, y + pad + 12 * scale);
    for (let line = 0; line < 4; line++) {
      const width = (cellW - pad * 2) * [0.92, 0.74, 0.86, 0.48][line];
      g.globalAlpha = 0.34;
      g.fillRect(x + pad, y + pad + (30 + line * 16) * scale, width, 5 * scale);
      g.globalAlpha = 1;
    }
  });

  const atlas = new CanvasTexture(canvas);
  atlas.format = RedFormat;
  atlas.generateMipmaps = true;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.magFilter = LinearFilter;
  atlas.anisotropy = ctx.anisotropy;

  // Which tile shows what, on which ring.
  interface Tile {
    ring: number;
    cell: number;
    square: boolean;
    label: string;
  }
  const clis = new Set(data.clis);
  const tiles: Tile[] = [];
  data.marks.forEach((name, cell) => tiles.push({ ring: 0, cell, square: true, label: name }));
  skills.forEach((name, i) => tiles.push({ ring: 1, cell: firstSkillCell + i, square: false, label: name }));
  // The tools ring is the widest and has the fewest names: each rides it twice.
  for (let lap = 0; lap < 2; lap++) {
    data.marks.forEach((name, cell) => {
      if (clis.has(name)) tiles.push({ ring: 2, cell, square: true, label: name });
    });
  }

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
      uGround: { value: ctx.token("--canvas") },
      uRingY: { value: new Vector3(RINGS[0].y, RINGS[1].y, RINGS[2].y) },
      uRingR: { value: new Vector3(RINGS[0].radius, RINGS[1].radius, RINGS[2].radius) },
      uPhase: { value: phase },
      uCenterZ: { value: RING_CENTER_Z },
      uRings: { value: 0 },
      uFocus: { value: 0 },
      uHover: { value: -1 },
      uTime: { value: 0 },
      uDim: { value: 1 },
      uCopy: { value: new Vector2() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
    alphaToCoverage: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  const calm = ctx.tier.calm;
  const center = new Vector3();
  const normal = new Vector3();
  const right = new Vector3();
  const hit = new Vector3();
  let rings = 0;
  let time = 0;

  return {
    mesh,

    update(ch, now, shift) {
      time = calm ? 0 : now;
      // The subject is shifted away from the copy: left of centre means the copy is on the right.
      (material.uniforms.uCopy.value as Vector2).set(
        Math.max(-1, Math.min(1, -shift.x * 2.6)),
        Math.max(0, Math.min(1, -shift.y * 2.6)),
      );
      rings = ch.rings;
      phase.set(RINGS[0].speed * time, RINGS[1].speed * time, RINGS[2].speed * time);
      material.uniforms.uRings.value = ch.rings;
      material.uniforms.uFocus.value = ch.ring;
      material.uniforms.uTime.value = time;
      material.uniforms.uDim.value = 1 - 0.5 * ch.wire;
      mesh.visible = ch.rings > 0.002;
    },

    pick(ray) {
      if (rings < 0.9) return null;
      let best: RingPick | null = null;
      let nearest = Infinity;
      for (let i = 0; i < count; i++) {
        const tile = tiles[i];
        const ring = RINGS[tile.ring];
        const angle = places[i * 3] + ring.speed * time;
        normal.set(Math.sin(angle), 0, Math.cos(angle));
        center.set(normal.x * ring.radius, ring.y, RING_CENTER_Z + normal.z * ring.radius);
        const facing = normal.dot(ray.direction);
        // Only tiles that show their face.
        if (facing > -0.05) continue;
        const along = center.clone().sub(ray.origin).dot(normal) / facing;
        if (along <= 0 || along >= nearest) continue;
        hit.copy(ray.direction).multiplyScalar(along).add(ray.origin).sub(center);
        right.set(normal.z, 0, -normal.x);
        if (Math.abs(hit.dot(right)) > sizes[i * 2] / 2 || Math.abs(hit.y) > sizes[i * 2 + 1] / 2 + 0.05) continue;
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
