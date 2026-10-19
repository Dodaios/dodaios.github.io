/**
 * The repository's live star and fork counts for the drawn GitHub window.
 *
 * `repo-map.json` is only refreshed when someone runs `data:repo-map`, so its
 * numbers go stale within days. The window starts on those built-in figures
 * (so the server-rendered HTML is never blank) and swaps in GitHub's current
 * figures once the browser has them.
 *
 * One request per page load at most: every caller shares the same promise, and
 * the answer is kept in sessionStorage for ten minutes, matching `LiveCount`,
 * because GitHub allows an anonymous IP sixty requests an hour. Any failure
 * returns null and the built-in figures stay on screen.
 */

import { useEffect, useState } from "react";

export interface RepoCounts {
  stars: number;
  forks: number;
}

const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

let pending: Promise<RepoCounts | null> | null = null;

function fetchCounts(repo: string): Promise<RepoCounts | null> {
  if (pending) return pending;
  const key = `pj:repo-counts:${repo}`;
  pending = (async () => {
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        const { stars, forks, at } = JSON.parse(cached);
        if (Date.now() - at < CACHE_MS && Number.isFinite(stars) && Number.isFinite(forks)) {
          return { stars, forks };
        }
      }
    } catch {
      // Storage denied in a private window is not a reason to skip the fetch.
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = await res.json();
      const stars = Number(body?.stargazers_count);
      const forks = Number(body?.forks_count);
      if (!Number.isFinite(stars) || stars < 0 || !Number.isFinite(forks) || forks < 0) return null;
      try {
        sessionStorage.setItem(key, JSON.stringify({ stars, forks, at: Date.now() }));
      } catch {
        // Caching is a nicety, not a requirement.
      }
      return { stars, forks };
    } catch {
      return null;
    }
  })();
  return pending;
}

export function useLiveRepoCounts(repo: string, initial: RepoCounts): RepoCounts {
  const [counts, setCounts] = useState(initial);
  useEffect(() => {
    let alive = true;
    fetchCounts(repo).then((live) => {
      if (alive && live) setCounts(live);
    });
    return () => {
      alive = false;
    };
  }, [repo]);
  return counts;
}
