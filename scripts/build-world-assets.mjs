#!/usr/bin/env node
/**
 * Turn the 3D models as Blender exports them (art/<name>/out, not committed)
 * into what the site ships (src/assets/world, committed).
 *
 *   mascot.glb, pod.glb   geometry compressed with meshopt, the texture inside
 *                         as WebP
 *   desk.glb              geometry only; its light lives in separate textures
 *                         so the scene can blend night into morning and pick a
 *                         size for the device
 *   desk-<atlas>-<state>.webp, and -1k.webp   the baked light, full and half size
 *   desk-edges.bin        the set's hard edges, for the wireframe
 *
 * Run it after rebuilding a model:  node scripts/build-world-assets.mjs
 * See docs/world.md, "The models".
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ART = join(ROOT, "art");
const OUT = join(ROOT, "src", "assets", "world");
mkdirSync(OUT, { recursive: true });

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} kB`;
const report = (path) => console.log(`  ${path.replace(ROOT, "").replaceAll("\\", "/")}  ${kb(path)}`);

/** Geometry compression that keeps every node, name and empty where it is. */
const compress = [
  reorder({ encoder: MeshoptEncoder, level: "medium" }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
];

/** A model that keeps its own texture: mascot, pod. */
async function textured(name, size) {
  const source = join(ART, name, "out", `${name}.glb`);
  if (!existsSync(source)) return console.warn(`  (skipped ${name}: ${source} is missing)`);
  const document = await io.read(source);
  await document.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", quality: 86, resize: [size, size] }),
    ...compress,
  );
  const target = join(OUT, `${name}.glb`);
  await io.write(target, document);
  report(target);
}

/**
 * The set's hard edges, as pairs of points: every edge where the surface turns
 * by more than `ANGLE` degrees or simply ends. Short ones are dropped, they
 * are the bevels and would only thicken every corner.
 */
function hardEdges(document) {
  const ANGLE = 38;
  const MIN_LENGTH = 0.012;
  const cos = Math.cos((ANGLE * Math.PI) / 180);
  const segments = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !["Near", "Far"].includes(node.getName())) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      const point = (i) => {
        const [x, y, z] = position.getElement(indices ? indices.getScalar(i) : i, []);
        return [
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        ];
      };
      const key = (p) => `${Math.round(p[0] * 4000)},${Math.round(p[1] * 4000)},${Math.round(p[2] * 4000)}`;
      /** edge key -> { a, b, normals: [] } */
      const edges = new Map();
      for (let i = 0; i < count; i += 3) {
        const corners = [point(i), point(i + 1), point(i + 2)];
        const u = corners[1].map((v, k) => v - corners[0][k]);
        const w = corners[2].map((v, k) => v - corners[0][k]);
        const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const length = Math.hypot(...normal);
        if (length < 1e-12) continue;
        const unit = normal.map((v) => v / length);
        for (let e = 0; e < 3; e++) {
          const a = corners[e];
          const b = corners[(e + 1) % 3];
          const ka = key(a);
          const kb2 = key(b);
          if (ka === kb2) continue;
          const id = ka < kb2 ? `${ka}|${kb2}` : `${kb2}|${ka}`;
          let edge = edges.get(id);
          if (!edge) edges.set(id, (edge = { a, b, normals: [] }));
          edge.normals.push(unit);
        }
      }
      for (const { a, b, normals } of edges.values()) {
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < MIN_LENGTH) continue;
        const open = normals.length === 1;
        const turned =
          normals.length >= 2 &&
          normals[0][0] * normals[1][0] + normals[0][1] * normals[1][1] + normals[0][2] * normals[1][2] < cos;
        if (open || turned) segments.push(a, b);
      }
    }
  }
  return segments;
}

/**
 * Pack the segments: a header of four floats (the size of one step, then the
 * offset on each axis) followed by one 16-bit triple per point.
 */
function packEdges(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k]));
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const step = span / 65535;
  const header = new Float32Array([step, min[0], min[1], min[2]]);
  const body = new Uint16Array(points.length * 3);
  points.forEach((p, i) => {
    for (let k = 0; k < 3; k++) body[i * 3 + k] = Math.round((p[k] - min[k]) / step);
  });
  return Buffer.concat([Buffer.from(header.buffer), Buffer.from(body.buffer)]);
}

async function desk() {
  const dir = join(ART, "desk", "out");
  const source = join(dir, "desk.glb");
  if (!existsSync(source)) return console.warn(`  (skipped desk: ${source} is missing)`);
  const document = await io.read(source);

  const segments = hardEdges(document);
  const edges = join(OUT, "desk-edges.bin");
  writeFileSync(edges, packEdges(segments));
  report(edges);
  console.log(`    ${segments.length / 2} edges`);

  // The light is shipped beside the model, not inside it.
  for (const material of document.getRoot().listMaterials()) {
    material.setBaseColorTexture(null).setEmissiveTexture(null);
  }
  await document.transform(prune({ keepLeaves: true, keepAttributes: true }), ...compress);
  const target = join(OUT, "desk.glb");
  await io.write(target, document);
  report(target);

  for (const atlas of ["near", "far"]) {
    for (const state of ["night", "dawn"]) {
      const png = join(dir, `${atlas}_${state}.png`);
      if (!existsSync(png)) {
        console.warn(`  (missing ${png})`);
        continue;
      }
      const full = join(OUT, `desk-${atlas}-${state}.webp`);
      const half = join(OUT, `desk-${atlas}-${state}-1k.webp`);
      await sharp(png).resize(2048, 2048).webp({ quality: 84, effort: 6 }).toFile(full);
      await sharp(png).resize(1024, 1024).webp({ quality: 82, effort: 6 }).toFile(half);
      report(full);
      report(half);
    }
  }
}

console.log("world assets:");
await textured("mascot", 1024);
await textured("pod", 1024);
await desk();
