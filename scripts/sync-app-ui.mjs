#!/usr/bin/env node
/**
 * Copy the app's own stylesheet into the hero demo, cut down to what the demo
 * uses.
 *
 *   node scripts/sync-app-ui.mjs <path-to-app>/dodaios/ui/web/dist/assets
 *
 * The hero demo (src/components/demo/app/) is a clone of the app built from
 * the app's own markup — the same elements and the same class names as its
 * components. Styled by the app's compiled CSS, it renders exactly as the app
 * does, and a restyle of the app reaches the demo by running this script
 * again rather than by someone redrawing it by eye.
 *
 * The app's sheets come to ~500 KB together. Only rules whose classes all appear somewhere in
 * the clone's source are kept, plus every rule that names no class at all
 * (the theme variables, the base element rules) and the keyframes those kept
 * rules animate with. @font-face is dropped: the demo ships its own two font
 * files and declares them itself (AppFrame.tsx).
 *
 * Run it after changing the clone's markup too — a class that is new to the
 * clone is not in the cut-down sheet until this runs.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLONE_DIR = join(ROOT, "src", "components", "demo", "app");
const OUT = join(CLONE_DIR, "app.css");

const assets = process.argv[2];
if (!assets) {
  console.error("usage: node scripts/sync-app-ui.mjs <app>/dodaios/ui/web/dist/assets");
  process.exit(2);
}

// The app's entry sheet is the one its index.html links. A build folder that
// has been rebuilt in place keeps older index-*.css files beside it, so the
// name is read from the page instead of guessed from the sizes.
const html = readFileSync(join(assets, "..", "index.html"), "utf8");
const entry = /assets\/(index-[\w-]+\.css)/.exec(html)?.[1];
if (!entry || !existsSync(join(assets, entry))) {
  console.error(`no entry stylesheet linked from ${resolve(assets, "..", "index.html")}`);
  process.exit(1);
}

// The app splits the styles of its lazy views into sheets of their own
// (WorkTrace, AgentTimeline, SocietyView, ...). The clone copies markup from
// those views too, so every such sheet is read after the entry sheet. Where a
// rebuild left two files of one view behind, the newer one wins. The editor,
// the game and the arcade are never cloned and are skipped for their size.
// `mobile` is the phone-companion page's sheet: it redefines the `:root` tokens.
const SKIP = /^(index|monacoRuntime|Verse|ArcadeCabinet|RetroArcade|mobile)/;
const chunks = new Map();
for (const n of readdirSync(assets)) {
  if (!n.endsWith(".css") || SKIP.test(n)) continue;
  const stem = n.replace(/-[\w-]{8}\.css$/, "");
  const mtime = statSync(join(assets, n)).mtimeMs;
  if (!chunks.has(stem) || chunks.get(stem).mtime < mtime) chunks.set(stem, { n, mtime });
}
const sheets = [entry, ...[...chunks.values()].map((c) => c.n).sort()];
const sheet = { n: sheets.join(", "), size: sheets.reduce((sum, n) => sum + statSync(join(assets, n)).size, 0) };

// Every token the clone's source could be naming as a class. Over-inclusive
// on purpose: a stray word that happens to be a class name costs one rule, a
// missed class costs a broken look.
const used = new Set();
for (const name of readdirSync(CLONE_DIR)) {
  if (!/\.(tsx?|jsx?)$/.test(name)) continue;
  const text = readFileSync(join(CLONE_DIR, name), "utf8");
  // Split on whitespace, quotes and braces only: a Tailwind class can hold
  // brackets, commas, `=` and `>` (`data-[x=true]:…`, `[&>.a]:…`,
  // `transition-[a,b]`), and splitting on those would drop its rule.
  for (const token of text.split(/[\s"'`{}]+/)) if (token) used.add(token);
}

/** The classes a selector needs, unescaped (`.hover\:bg-x:hover` -> `hover:bg-x`). */
function classesOf(selector) {
  const out = [];
  const re = /\.((?:\\.|[\w-])+)/g;
  let m;
  while ((m = re.exec(selector))) out.push(m[1].replace(/\\(.)/g, "$1"));
  return out;
}

function selectorWanted(selector) {
  // A class inside :is()/:where()/:not() is a context, not a requirement of
  // the element itself (`.dark\:x:is(.dark *)`), so only the leading part is
  // checked strictly; `dark` is always present on the clone's root.
  return classesOf(selector).every((c) => c === "dark" || used.has(c));
}

const root = postcss.parse(sheets.map((n) => readFileSync(join(assets, n), "utf8")).join("\n"));
const animations = new Set();

root.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
  const kept = rule.selectors.filter(selectorWanted);
  if (kept.length === 0) {
    rule.remove();
    return;
  }
  rule.selectors = kept;
  rule.walkDecls(/^animation(-name)?$/, (decl) => {
    for (const word of decl.value.split(/[\s,]+/)) animations.add(word);
  });
});

root.walkAtRules((at) => {
  if (at.name === "font-face") at.remove();
  else if (/keyframes$/i.test(at.name) && !animations.has(at.params.trim())) at.remove();
});
// Media and supports blocks left empty by the cut.
root.walkAtRules((at) => {
  if (at.nodes && at.nodes.length === 0) at.remove();
});

const header =
  "/* GENERATED by scripts/sync-app-ui.mjs from the app's " + sheet.n + " — do not edit by hand. */\n";
const css = header + root.toString().replace(/\n{2,}/g, "\n");
writeFileSync(OUT, css);
console.log(`app.css: ${(css.length / 1024).toFixed(1)} KB from ${(sheet.size / 1024).toFixed(1)} KB (${sheet.n})`);
