#!/usr/bin/env node
/**
 * Cut the narrow copies of the demo backdrops.
 *
 * Each demo well is painted with one 1536px-wide image. A phone draws that
 * well about 360 CSS pixels wide, so it downloaded 375 kB to show what a
 * 768px copy shows in a quarter of the bytes (Lighthouse, 2026-11-10: 431 kB
 * of the first load was these two paintings at the wrong size).
 *
 * This writes `<name>-768.webp` and `<name>-1024.webp` beside every master.
 * `src/components/window-demo/backdrops.ts` offers all three widths and the
 * browser picks. The masters are never rewritten.
 *
 * Run it after adding or replacing a backdrop:
 *
 *   node scripts/build-backdrop-variants.mjs
 *
 * The copies are committed. They are derived, but the deploy build must not
 * depend on re-encoding images on every push, and a painting that changes
 * twice a year is cheaper to keep than to regenerate.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOLDERS = ["src/assets/demo-backgrounds", "src/assets/hero"];
export const WIDTHS = [768, 1024];
const VARIANT = /-(\d+)\.webp$/;

const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)} kB`;

for (const folder of FOLDERS) {
  const dir = path.join(root, folder);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".webp") || VARIANT.test(name)) continue;
    const master = path.join(dir, name);
    const { width } = await sharp(master).metadata();
    for (const target of WIDTHS) {
      if (!width || width <= target) continue;
      const out = path.join(dir, name.replace(/\.webp$/, `-${target}.webp`));
      await sharp(master)
        .resize({ width: target, kernel: "lanczos3" })
        .webp({ quality: 80, effort: 6 })
        .toFile(out);
      console.log(`${path.relative(root, out)}  ${kb(out)}  (master ${width}px, ${kb(master)})`);
    }
  }
}
