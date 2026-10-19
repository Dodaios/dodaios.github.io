/**
 * Fetches a year of daily commit counts for the public repository and writes
 * them to src/data/commit-activity.json, which the "Built in public" skyline
 * renders.
 *
 *   node scripts/fetch-commit-activity.mjs
 *
 * The source is GitHub's `stats/commit_activity` endpoint: the last 52 weeks
 * of commits to the default branch, one count per day, Sunday first. It is
 * public and anonymous; `GITHUB_TOKEN` is used when it is set, only to raise
 * the rate limit.
 *
 * GitHub computes these statistics lazily. The first request after a quiet
 * spell answers 202 with no body while it builds them, so the script asks
 * again until it gets a 200. A run that never gets one exits non-zero and
 * leaves the committed file as it was — the page keeps the last real year
 * rather than showing an empty one.
 *
 * Days after today are dropped. The endpoint pads the current week out to
 * Saturday, and those empty future days would end every "current streak" on
 * a zero that has not happened yet.
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
const ATTEMPTS = 12;
const WAIT_MS = 5000;
const DAY_MS = 86400000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWeeks() {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "dodaios-website" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/stats/commit_activity`, { headers });
    if (res.status === 200) {
      const weeks = await res.json();
      if (Array.isArray(weeks) && weeks.length) return weeks;
    } else if (res.status !== 202) {
      throw new Error(`GitHub answered ${res.status} ${res.statusText}`);
    }
    await sleep(WAIT_MS);
  }
  throw new Error(`no statistics after ${ATTEMPTS} attempts; GitHub is still computing them`);
}

const weeks = await fetchWeeks();
const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const days = [];
for (const week of weeks) {
  week.days.forEach((count, i) => {
    const ms = week.week * 1000 + i * DAY_MS;
    if (ms > today) return;
    days.push({ date: new Date(ms).toISOString().slice(0, 10), count });
  });
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
console.log(`commit activity: ${days.length} days, ${total} commits -> ${OUT}`);
