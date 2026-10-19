/**
 * Counts a year of commits to the public repository, day by day, and writes
 * them to src/data/commit-activity.json, which the "Built in public" skyline
 * renders.
 *
 *   node scripts/fetch-commit-activity.mjs
 *
 * WHY THE COMMIT LIST AND NOT `stats/commit_activity`. The statistics endpoint
 * is one request, but it is computed lazily, cached against an older tip and
 * leaves out commits the list includes: on 2026-10-19 it said 5,852 while the
 * branch held 5,988. The section's figure is the one a visitor can check by
 * opening the commit history, so it is counted from that history: every
 * commit on `main` in the window, bucketed by the UTC day of its committer
 * date — the day it landed, not the day it was first written.
 *
 * About sixty pages of a hundred. Anonymous requests get sixty an hour, so
 * `GITHUB_TOKEN` is used when it is set (the workflow passes its own; locally,
 * `GITHUB_TOKEN=$(gh auth token) node scripts/fetch-commit-activity.mjs`).
 * A run that fails part-way exits non-zero and leaves the committed file as
 * it was — the page keeps the last complete year rather than a partial one.
 *
 * The browser tops this up: CommitSkyline asks GitHub for the commits since
 * the last day stored here, so the page is current between two runs.
 *
 * Only counts are stored. No author, no message, no hash: the section shows
 * how much work landed and when, not who wrote it.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "commit-activity.json");
const REPO = "Dodaios/Dodaios";
const BRANCH = "main";
const DAY_MS = 86400000;
// The grid draws 53 weeks back from today; a little more costs nothing.
const SPAN_DAYS = 371;
const MAX_PAGES = 200;

const headers = { Accept: "application/vnd.github+json", "User-Agent": "dodaios-website" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const nextLink = (link) => /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;

const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const first = today - (SPAN_DAYS - 1) * DAY_MS;
const since = new Date(first).toISOString();

const counts = new Map();
let url = `https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=100&since=${since}`;
let pages = 0;
while (url) {
  if (++pages > MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages; refusing to guess`);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`);
  for (const commit of await res.json()) {
    const when = commit?.commit?.committer?.date;
    if (typeof when !== "string") continue;
    const day = when.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  url = nextLink(res.headers.get("link"));
}

const days = [];
for (let ms = first; ms <= today; ms += DAY_MS) {
  const date = new Date(ms).toISOString().slice(0, 10);
  days.push({ date, count: counts.get(date) ?? 0 });
}

const total = days.reduce((sum, d) => sum + d.count, 0);
// One day per line: small, and a refresh diffs as the handful of days that moved.
const body = [
  "{",
  ` "repo": ${JSON.stringify(REPO)},`,
  ` "readAt": ${JSON.stringify(new Date().toISOString())},`,
  ' "days": [',
  days.map((d) => `  ${JSON.stringify(d)}`).join(",\n"),
  " ]",
  "}",
  "",
].join("\n");
await writeFile(OUT, body);
console.log(`commit activity: ${days.length} days, ${total} commits in ${pages} pages -> ${OUT}`);
