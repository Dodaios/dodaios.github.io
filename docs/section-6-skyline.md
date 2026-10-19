# Section 6 — "Built in public": the commit skyline

`src/sections/BuiltInPublic.astro`, drawn by
`src/components/skyline/CommitSkyline.tsx` (pure maths in `model.ts`).
Nav label: **Built in public**. Anchor: `#built-in-public`.

## Why it changed

Until 2026-10-19 this section was a YouTube gallery of development videos
with a subscriber/follower stat row. The videos showed the maintainer's face,
and the maintainer asked to no longer be visible on the internet. The gallery,
its poster frames and `scripts/fetch-video-thumbs.mjs` were removed. Since
then the site contacts neither YouTube nor Discord; the privacy policy and the
footer sentence say so.

## What it shows

Every day of the last year as a box; its height is the number of commits that
landed on `main` of the public repository that day. Seen from above it is a
heat map, from the corner a skyline.

The section is pinned (a `[data-track]` of `260svh` with a sticky
`[data-viewport]`, like the globe). Across the pinned span the scroll position
drives the picture — `SCRUB` in CommitSkyline.tsx: the calendar holds, rises
into the skyline week by week, then the camera turns slightly and closes in on
the weeks that have commits. Scrolling back runs it backwards. Narrow, short
and reduced-motion windows drop the pin; the skyline then rises once when it
comes into view. The toggle swings the camera by hand and holds until the next
scroll.
Hover or tap a day for its count, arrow keys walk the grid, a legend swatch
isolates one level, and in 3D a drag orbits (double-click resets).

The component was adapted from a community component the maintainer
supplied. It is drawn in ink and paper only: the five levels are the site's
tokens (`--hairline-strong`, `--muted-soft`, `--body`, `--ink` over an empty
floor mixed from `--canvas` and `--ink`), read at runtime so no hex value is
written in the component.

## Rules

- **Real data only.** `scripts/fetch-commit-activity.mjs` counts every commit
  on `main` per UTC day of its committer date into
  `src/data/commit-activity.json`; the `social-counts` workflow refreshes it
  daily. Not `stats/commit_activity`: it lags and undercounts (5,852 against
  5,988 on 2026-10-19). There is no sample-data fallback.
- **Live on top.** The browser counts the commits since the last stored day
  by the same rule and adds them, on load and every five minutes while the tab
  is visible; the caption then says "counted live". A failed or oversized read
  keeps the build. The privacy policy names this call.
- **Counts only.** No author names, messages or hashes are fetched or stored.
- **The empty months stay.** The repository is younger than the year the
  picture spans; a skyline that starts flat is the truth.
- **The caption names the read date**, as the globe section does.
- **The scroll drives it, both ways.** Never a one-way animation triggered by
  scrolling; the pose is a function of the position in the span.
- **No shadows, weight 400 figures, no second hue.** See `docs/design.md`.
