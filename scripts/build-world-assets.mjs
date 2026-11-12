#!/usr/bin/env node
/**
 * Turn the 3D models as Blender exports them (art/<name>/out, not committed)
 * into what the site ships (src/assets/world, committed).
 *
 *   mascot.glb                 geometry compressed with meshopt, its texture
 *                              inside as WebP
 *   room-<zone>.glb            one zone of the room, geometry only; its light
 *                              lives in separate textures so the scene can
 *                              blend night into morning and pick a size for
 *                              the device
 *   room-<atlas>-<state>.webp  the baked light, full size, and -1k.webp at half
 *
 * A zone that Blender has not exported yet is skipped, and what is already in
 * src/assets/world stays as it is.
 *
 * Run it after rebuilding a model:  node scripts/build-world-assets.mjs
 * See docs/world.md, "The models".
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ART = join(ROOT, "art");
const ROOM = join(ART, "room", "out");
const OUT = join(ROOT, "src", "assets", "world");
mkdirSync(OUT, { recursive: true });

/** The zones of the room (art/room/spec.py), and the shell they stand in. */
const ZONES = ["shell", "desk", "right", "lounge", "window", "corner"];

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

/** A model that keeps its own texture: the mascot. */
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

/** One zone: its model without textures, and its atlases in two states and two sizes. */
async function zone(name) {
  const source = join(ROOM, `${name}.glb`);
  if (!existsSync(source)) return console.warn(`  (skipped ${name}: ${source} is missing)`);
  const document = await io.read(source);

  // The light is shipped beside the model, not inside it. A baked mesh's
  // material is named `Bake_<atlas>`; that name is how the scene finds the files.
  const atlases = new Set();
  for (const material of document.getRoot().listMaterials()) {
    if (material.getName().startsWith("Bake_")) atlases.add(material.getName().slice(5));
    material.setBaseColorTexture(null).setEmissiveTexture(null);
  }
  await document.transform(prune({ keepLeaves: true, keepAttributes: true }), ...compress);
  const target = join(OUT, `room-${name}.glb`);
  await io.write(target, document);
  report(target);

  for (const atlas of atlases) {
    for (const state of ["night", "dawn"]) {
      const png = join(ROOM, `${atlas}_${state}.png`);
      if (!existsSync(png)) {
        console.warn(`  (missing ${png})`);
        continue;
      }
      const full = join(OUT, `room-${atlas}-${state}.webp`);
      const half = join(OUT, `room-${atlas}-${state}-1k.webp`);
      await sharp(png).resize(2048, 2048).webp({ quality: 84, effort: 6 }).toFile(full);
      await sharp(png).resize(1024, 1024).webp({ quality: 82, effort: 6 }).toFile(half);
      report(full);
      report(half);
    }
  }
}

console.log("world assets:");
await textured("mascot", 1024);
for (const name of ZONES) await zone(name);
