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
landed on the default branch of the public repository that day. Seen from
above it is a heat map, from the corner a skyline. The 3D view rises out of the
flat one the first time it scrolls into view; a toggle swings the camera back.
Hover or tap a day for its count, arrow keys walk the grid, a legend swatch
isolates one level, and in 3D a drag orbits (double-click resets).

The component was adapted from a community component the maintainer
supplied. It is drawn in ink and paper only: the five levels are the site's
tokens (`--hairline-strong`, `--muted-soft`, `--body`, `--ink` over an empty
floor mixed from `--canvas` and `--ink`), read at runtime so no hex value is
written in the component.

## Rules

- **Real data only.** `scripts/fetch-commit-activity.mjs` reads GitHub's
  `stats/commit_activity` into `src/data/commit-activity.json`; the
  `social-counts` workflow refreshes it daily. There is no sample-data
  fallback.
- **Counts only.** No author names, messages or hashes are fetched or stored.
- **The empty months stay.** The repository is younger than the year the
  picture spans; a skyline that starts flat is the truth.
- **The caption names the read date**, as the globe section does.
- **No scroll trap.** An ordinary bounded band; the globe above already holds
  the reader.
- **No shadows, weight 400 figures, no second hue.** See `docs/design.md`.
