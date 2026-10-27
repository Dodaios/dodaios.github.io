#!/usr/bin/env node
/**
 * The application's own catalogs, lifted into this repository as one file.
 *
 * The three detail pages — /plugins, /skills, /clis — are a listing of what
 * the product actually ships: twenty-four plugins, twenty-two command-line
 * tools and thirty built-in skills, each with the description, the sign-in
 * mode, the risk tier and the trigger patterns the app itself carries. Every
 * one of those is a fact that changes with the product, and a hand-typed copy
 * of seventy-six entries is a copy nobody re-checks. The site's rule is that
 * nothing on it is invented; the only way to hold that at this size is to read
 * the source and commit what came back.
 *
 * ## Why it is committed rather than read at build time
 *
 * This repository is its own git repo. A clone of it on a machine that has no
 * checkout of the application still has to build the site — so the data is a
 * file in `src/data/`, exactly like `stargazers.json` and `social-counts.json`,
 * and this script is the thing that refreshes it when the product moves.
 *
 * ## What it reads
 *
 *   dodaios/marketplace/seed_catalog.json     the plugin catalog
 *   dodaios/clis/catalog/seed_catalog.json    the command-line tool catalog
 *   dodaios/skills/builtin/<name>/SKILL.md    one file per built-in skill
 *
 * The application checkout is found at `--repo <path>`, then `$DODAIOS_REPO` (or the older `$JARVIS_REPO`),
 * then the parent directory of this one — which is where it sits in the
 * maintainer's working copy.
 *
 * ## Degrading honestly
 *
 * A run that cannot find the application, or that finds a catalog it does not
 * recognise, leaves the committed file exactly as it is and exits non-zero. It
 * never writes a partial catalog: half a listing is worse than a month-old one,
 * because the page cannot tell the reader which half it is.
 *
 * Usage:  node scripts/extract-app-catalog.mjs [--repo <path>] [--verbose]
 * Exit:   0 written or unchanged, 1 could not read the application
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "app-catalog.json");

const PLUGIN_CATALOG = join("dodaios", "marketplace", "seed_catalog.json");
const CLI_CATALOG = join("dodaios", "clis", "catalog", "seed_catalog.json");
const SKILLS_DIR = join("dodaios", "skills", "builtin");

/**
 * The two plugins that are a way IN rather than a way out.
 *
 * They carry neither an `mcp_server` block nor a `native_tool`, because nothing
 * about them is a tool the assistant calls: connecting one gives you a bot you
 * can message, and Dodaios answers there. Nothing in the catalog file says so —
 * the application names them in `dodaios/ui/web/marketplace_routes.py`
 * (`_CHANNEL_PLUGIN_IDS`), and that is the only place the fact is written down,
 * so this list is a copy of that one and has to move with it.
 */
const CHANNEL_PLUGINS = new Set(["telegram", "discord"]);

const argv = process.argv.slice(2);
const verbose = argv.includes("--verbose");
const repoFlag = argv.indexOf("--repo");

const log = (...args) => verbose && console.log(...args);

/** Stop with a reason. The committed file is never touched on this path. */
function bail(reason) {
  console.error(`extract-app-catalog: ${reason}`);
  console.error("the committed catalog was left untouched.");
  process.exit(1);
}

/** Where the application lives, in the documented order of preference. */
function findRepo() {
  const candidates = [
    repoFlag >= 0 ? argv[repoFlag + 1] : undefined,
    process.env.DODAIOS_REPO,
    process.env.JARVIS_REPO,
    join(ROOT, ".."),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (existsSync(join(path, PLUGIN_CATALOG))) return path;
    log(`not the application: ${path}`);
  }
  return null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    bail(`could not read ${path}: ${error.message}`);
  }
}

/* ---------------------------------------------------------------------------
 * Plugins
 *
 * The catalog carries a great deal the site has no use for — token prefixes,
 * validation endpoints, the step-by-step sign-in instructions. What is kept is
 * what a visitor deciding whether this product reaches their tools would want:
 * what it is, what it can do there, how signing in works and how long that
 * sign-in lasts.
 * ------------------------------------------------------------------------ */
function extractPlugins(repo) {
  const raw = readJson(join(repo, PLUGIN_CATALOG));
  const plugins = raw?.plugins;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    bail("the plugin catalog has no `plugins` array");
  }

  return plugins.map((p) => {
    if (!p.id || !p.display_name) bail(`a plugin entry has no id or name: ${JSON.stringify(p)}`);
    return {
      id: p.id,
      name: p.display_name,
      description: p.description ?? "",
      category: p.category ?? "Other",
      /* How the visitor signs in. `pat_paste` is a token they create and paste;
       * the two oauth modes are a browser round-trip. The app words them for a
       * person; see src/lib/catalog.ts, which is where that wording lives. */
      auth: p.auth?.mode ?? "unknown",
      /* How long that sign-in lasts before it has to be done again. */
      longevity: p.longevity ?? "unknown",
      /* How it actually reaches the service: a hosted MCP server, a tool built
       * into the app, or — for the two chat channels — neither, because the
       * connection runs the other way. All three exist in the catalog and the
       * difference is the most interesting thing on the row. */
      via: CHANNEL_PLUGINS.has(p.id)
        ? "channel"
        : p.mcp_server
          ? "mcp"
          : p.native_tool
            ? "native"
            : bail(`plugin ${p.id} reaches its service by no route this script knows`),
      featured: Boolean(p.featured),
    };
  });
}

/* ---------------------------------------------------------------------------
 * Command-line tools
 *
 * The interesting half of a CLI entry is the risk block: the tier every command
 * starts at, the patterns that are refused outright, and the patterns that are
 * waved through because they only read. That gate is the product's actual
 * safety claim, so it is carried over verbatim rather than summarised.
 * ------------------------------------------------------------------------ */
function extractClis(repo) {
  const raw = readJson(join(repo, CLI_CATALOG));
  const entries = raw?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    bail("the CLI catalog has no `entries` array");
  }

  return entries.map((c) => {
    if (!c.name || !c.display_name) bail(`a CLI entry has no name: ${JSON.stringify(c)}`);
    return {
      id: c.name,
      name: c.display_name,
      description: c.description ?? "",
      category: c.category ?? "other",
      binary: c.binary_name ?? c.name,
      homepage: c.homepage ?? "",
      /* What the app offers to install it with on this machine. */
      install: c.install?.recommended ?? null,
      /* `oauth_cli` hands the sign-in to the vendor's own binary; `api_key` and
       * `token` mean a secret the app stores; `none` means the tool is already
       * signed in or needs nothing. */
      auth: c.auth?.type ?? "none",
      risk: {
        tier: c.risk?.default_tier ?? "monitor",
        blocked: c.risk?.blacklist_patterns ?? [],
        allowed: c.risk?.whitelist_patterns ?? [],
      },
      examples: c.tool_schema_examples ?? [],
    };
  });
}

/* ---------------------------------------------------------------------------
 * Built-in skills
 *
 * One `SKILL.md` per directory: YAML frontmatter, then the instructions the
 * model reads. The site shows the frontmatter — that is the part that says what
 * a skill IS — and the first paragraph of the body is not carried over, because
 * a skill's body is written for the model and reads as an instruction sheet,
 * not as a description.
 * ------------------------------------------------------------------------ */
function extractSkills(repo) {
  const dir = join(repo, SKILLS_DIR);
  if (!existsSync(dir)) bail(`no built-in skills at ${dir}`);

  const skills = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, "SKILL.md");
    if (!existsSync(file)) continue;

    const text = readFileSync(file, "utf8");
    /* Frontmatter is the block between the first two `---` lines. Split on
     * three parts and take the middle: a body that itself contains `---` (a
     * markdown rule, and several do) then costs nothing. */
    const parts = text.split(/^---\s*$/m);
    if (parts.length < 3) bail(`${name}/SKILL.md has no frontmatter`);

    let fm;
    try {
      fm = parseYaml(parts[1]);
    } catch (error) {
      bail(`${name}/SKILL.md has unreadable frontmatter: ${error.message}`);
    }
    if (!fm?.name) bail(`${name}/SKILL.md declares no name`);

    skills.push({
      name: fm.name,
      version: fm.version ?? null,
      description: (fm.description ?? "").trim(),
      whenToUse: (fm.when_to_use ?? "").trim(),
      category: fm.category ?? "other",
      tags: fm.tags ?? [],
      author: fm.author ?? "builtin",
      license: fm.license ?? null,
      /* The plugin this skill is the voice of, when it is one. Twenty-three of
       * the thirty are: connecting Slack is what makes the Slack skill useful,
       * and the app pairs them by this id. */
      plugin: fm.plugin_id ?? null,
      risk: fm.risk_policy?.default_tier ?? "monitor",
      /* In frontmatter order, which is the order the app draws their glyphs.
       *
       * The three kinds spell their trigger in three different fields — a voice
       * trigger has a `pattern`, a schedule has a `cron` line and a hotkey has a
       * `combo`. Reading only the first two is the bug this comment exists to
       * stop coming back: it costs no error, it silently produced one trigger
       * with an empty pattern, and the page printed a keyboard glyph with
       * nothing beside it. */
      triggers: (fm.triggers ?? []).map((t) => {
        const pattern = t.pattern ?? t.cron ?? t.combo;
        if (!pattern) bail(`${name}: a ${t.type} trigger carries no pattern, cron or combo`);
        return { type: t.type, pattern, languages: t.language ?? [] };
      }),
      /* The settings a skill exposes, by name only. The values are this
       * machine's, not the product's. */
      config: fm.config ? Object.keys(fm.config) : [],
      /* `state: disabled` in frontmatter is a shipped default a user's own
       * preferences can override, so it is reported, not resolved. */
      state: fm.state ?? "enabled",
    });
  }

  if (skills.length === 0) bail("found no built-in skills");
  return skills;
}

/**
 * One whole skill file, verbatim, for the page that explains what a skill IS.
 *
 * The listing answers "what can it do"; nothing in a listing answers "what am I
 * writing if I write one". The only honest answer to that is the file, so the
 * page prints a real one — frontmatter exactly as it is on disk, and the head of
 * the body underneath to show that the rest is instructions in plain English
 * rather than code.
 *
 * `morning-routine` because it is the one built-in that carries all three kinds
 * of trigger at once — a spoken phrase, a second phrase, and a cron line — plus
 * settings and tags. A shorter file would need a sentence explaining what it is
 * missing.
 */
const EXAMPLE_SKILL = "morning-routine";

/** How much of the body to carry. Enough to show its shape, not the whole
 *  instruction sheet — which is written for the model, not for a reader. */
const EXAMPLE_BODY_LINES = 14;

function extractExample(repo) {
  const path = join(repo, SKILLS_DIR, EXAMPLE_SKILL, "SKILL.md");
  if (!existsSync(path)) bail(`the example skill ${EXAMPLE_SKILL} is gone from the product`);

  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const parts = text.split(/^---\s*$/m);
  if (parts.length < 3) bail(`${EXAMPLE_SKILL}/SKILL.md has no frontmatter`);

  const body = parts.slice(2).join("---").trim().split("\n");

  return {
    name: EXAMPLE_SKILL,
    source: `${SKILLS_DIR.split(/[\\/]/).join("/")}/${EXAMPLE_SKILL}/SKILL.md`,
    /* Verbatim, including the blank lines and the folded scalars. The page
     * prints it as it is; reflowing it would make it a paraphrase of a file. */
    frontmatter: parts[1].replace(/^\n+|\n+$/g, ""),
    body: body.slice(0, EXAMPLE_BODY_LINES).join("\n"),
    /* So the page can say how much it is NOT showing rather than implying the
     * file ends there. */
    bodyLines: body.length,
  };
}

function main() {
  const repo = findRepo();
  if (!repo) {
    bail(
      "no application checkout found. Pass --repo <path> or set DODAIOS_REPO; " +
        `it is the directory containing ${PLUGIN_CATALOG}.`,
    );
  }
  log(`application: ${repo}`);

  const catalog = {
    /* What produced this file, so the next person does not have to guess. */
    generator: "scripts/extract-app-catalog.mjs",
    generated: new Date().toISOString().slice(0, 10),
    sources: {
      plugins: PLUGIN_CATALOG.split(/[\\/]/).join("/"),
      clis: CLI_CATALOG.split(/[\\/]/).join("/"),
      skills: `${SKILLS_DIR.split(/[\\/]/).join("/")}/*/SKILL.md`,
    },
    plugins: extractPlugins(repo),
    clis: extractClis(repo),
    skills: extractSkills(repo),
    exampleSkill: extractExample(repo),
  };

  const next = `${JSON.stringify(catalog, null, 2)}\n`;
  const held = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

  /* `generated` moves every run, so comparing the whole file would report a
   * change on a day nothing moved. Compare the catalog itself. */
  const strip = (text) => {
    try {
      const { generated, ...rest } = JSON.parse(text);
      return JSON.stringify(rest);
    } catch {
      return null;
    }
  };

  if (strip(held) === strip(next)) {
    console.log(
      `catalog unchanged: ${catalog.plugins.length} plugins, ` +
        `${catalog.clis.length} CLIs, ${catalog.skills.length} skills`,
    );
    return;
  }

  writeFileSync(OUT, next, "utf8");
  console.log(
    `wrote src/data/app-catalog.json: ${catalog.plugins.length} plugins, ` +
      `${catalog.clis.length} CLIs, ${catalog.skills.length} skills`,
  );
}

main();
