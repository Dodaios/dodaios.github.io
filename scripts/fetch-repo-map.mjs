#!/usr/bin/env node
/**
 * The repository, as GitHub itself describes it — for the open-source section's
 * walkthrough.
 *
 * ## Why this is fetched and committed rather than written by hand
 *
 * The section draws a repository browser: three directory listings and the top
 * of one file, with the repository's own description, topics, licence and
 * counts beside them. Every one of those is a fact about a repository that
 * changes, and a hand-typed copy is a claim nobody re-checks. The site's rule
 * is that nothing on it is invented, and the only way to keep that true for a
 * listing of sixty-four entries is to read it from the source and commit what
 * came back.
 *
 * It is committed rather than fetched in the browser for the same reason the
 * social counts are: the page must be complete before any JavaScript runs, and
 * the tree API is not a call to spend on every visitor.
 *
 * ## What it reads
 *
 *   GET /repos/{repo}                      description, topics, licence, counts
 *   GET /repos/{repo}/contents/            the root listing
 *   GET /repos/{repo}/contents/dodaios     the application package
 *   GET /repos/{repo}/contents/install     the installer directory
 *   GET /repos/{repo}/contents/install/install.ps1   the head of one file
 *   GET /repos/{repo}/commits?per_page=1   the tip commit, for the listing head
 *
 * All five are public and anonymous. `GITHUB_TOKEN` is used when it is in the
 * environment — it only raises the rate limit, and the script is a supported,
 * green run without one.
 *
 * ## Degrading honestly
 *
 * A run that cannot reach GitHub leaves the committed file exactly as it is and
 * exits non-zero. It never writes a partial map: half a listing is worse than a
 * month-old one, because the page cannot tell the reader which half it is.
 *
 * Usage:  node scripts/fetch-repo-map.mjs [--verbose]
 * Exit:   0 written or unchanged, 1 could not read GitHub
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "repo-map.json");

const REPO = "Dodaios/Dodaios";
const API = "https://api.github.com";
const UA = "dodaios-website (repo map)";

/**
 * The three directories the walkthrough opens, in the order it opens them.
 *
 * They are the click path the demo takes, so they live here rather than in the
 * component: the component draws whatever pages this file holds, and adding a
 * fourth stop is a change to the script and its data, never to the markup.
 */
const PAGES = [
  { key: "root", path: "" },
  { key: "install", path: "install" },
  { key: "dodaios", path: "dodaios" },
];

/**
 * The file the walkthrough opens, and how much of it ships.
 *
 * `install/install.ps1` is the one file on this repository that a visitor has
 * the strongest reason to read before running: it is what the install one-liner
 * pipes into a shell. Eighteen lines is its header comment — what the script
 * says it does, in its own words, including the very command that fetches it.
 */
const FILE = { path: "install/install.ps1", lines: 18 };

const verbose = process.argv.includes("--verbose");
const say = (...args) => verbose && console.log(...args);

const headers = () => {
  const h = { "user-agent": UA, accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
};

async function getJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

/**
 * One directory listing, reduced to what the page draws.
 *
 * THE API'S ORDER IS NOT THE WEBSITE'S. `/contents/` returns one alphabetical
 * run with directories and files mixed together — `.codex`, `.dockerignore`,
 * `.env.example`, `.githooks` — while github.com lists every directory first
 * and then every file. Shipping the API's order would draw a listing no
 * visitor has ever seen at that URL, so the view sorts; this file keeps the
 * response as it came, because sorting is a drawing decision and belongs where
 * the drawing is.
 */
async function listing(path) {
  const url = `${API}/repos/${REPO}/contents/${path}`;
  const entries = await getJson(url);
  if (!Array.isArray(entries)) throw new Error(`not a directory: ${path || "/"}`);
  return entries.map((entry) => ({ name: entry.name, type: entry.type }));
}

/** The first `count` lines of a file, decoded from the API's base64 blob. */
async function head(path, count) {
  const blob = await getJson(`${API}/repos/${REPO}/contents/${path}`);
  const text = Buffer.from(blob.content ?? "", "base64").toString("utf8");
  const all = text.split(/\r?\n/);
  return { lines: all.slice(0, count), totalLines: all.length };
}

async function main() {
  let map;
  try {
    const meta = await getJson(`${API}/repos/${REPO}`);
    say(`repo: ${meta.full_name}, ${meta.stargazers_count} stars`);

    const pages = {};
    for (const page of PAGES) {
      pages[page.key] = { path: page.path, entries: await listing(page.path) };
      say(`  ${page.path || "/"}: ${pages[page.key].entries.length} entries`);
    }

    /* The listing's header row carries the repository's last commit, the way
     * github.com's does. One request, and the alternative is a header row that
     * either invents a commit or leaves a hole where every visitor's eye goes
     * first. The date is shipped as an ISO stamp and rendered absolutely — a
     * relative "2 hours ago" is true for one hour after a build. */
    const [tip] = await getJson(`${API}/repos/${REPO}/commits?per_page=1`);

    const file = await head(FILE.path, FILE.lines);
    say(`  ${FILE.path}: ${file.totalLines} lines, ${file.lines.length} shipped`);

    map = {
      repo: meta.full_name,
      branch: meta.default_branch,
      description: meta.description,
      license: meta.license?.spdx_id ?? null,
      language: meta.language,
      /* Six of them. The sidebar draws a wrapping row of pills and the
       * repository carries twenty; the rest would be four more lines of the
       * window's height spent on tags nobody reads at this size. */
      topics: (meta.topics ?? []).slice(0, 6),
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      openIssues: meta.open_issues_count,
      lastCommit: {
        message: (tip?.commit?.message ?? "").split(/\r?\n/)[0],
        sha: (tip?.sha ?? "").slice(0, 7),
        date: tip?.commit?.committer?.date ?? null,
      },
      readAt: new Date().toISOString(),
      pages,
      file: { path: FILE.path, ...file },
    };
  } catch (error) {
    console.error(`repo map: could not read GitHub — ${error.message}`);
    console.error("The committed map is unchanged.");
    return 1;
  }

  /* Compared without the stamp, so a run that confirms an unchanged repository
   * writes nothing. Restamping daily would commit, rebuild and redeploy the
   * whole site to move nothing — the same reason fetch-social-counts.mjs holds
   * its timestamps still. */
  const withoutStamp = (value) => {
    const { readAt, ...rest } = value;
    return JSON.stringify(rest);
  };

  let previous = null;
  try {
    previous = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* First run, or a file that is not readable JSON. Either way it is about
     * to be written; there is nothing to compare against and nothing to say. */
  }

  if (previous && withoutStamp(previous) === withoutStamp(map)) {
    console.log("repo map: unchanged.");
    return 0;
  }

  map.readAt = previous?.readAt && withoutStamp(previous) === withoutStamp(map)
    ? previous.readAt
    : map.readAt;

  writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n", "utf8");
  console.log(`repo map: written — ${Object.keys(map.pages).length} listings, ${map.file.lines.length} lines of ${map.file.path}.`);
  return 0;
}

process.exit(await main());
