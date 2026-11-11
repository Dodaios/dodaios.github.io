# Voices — what people say

> Builds on [`world.md`](world.md) and [`design.md`](design.md). The quotes
> are shown in the Stars chapter, `src/sections/room/StarsChapter.astro`, and
> in the room as the cards pinned to the corkboard;
> their content is `src/data/voices.ts`.

Quotes from people who used the project, under the count of the people who
starred it. Until 2026-11-11 they were a band of their own under the
connection strip.

## What may be quoted

A quote on a marketing page is a claim about a real person. Four rules, and
they are repeated at the top of the data file because that is where a new
entry gets added:

- **Verbatim.** Copied from the source as written, typos included. A cut is
  marked with `…`. Nothing is reworded, merged or translated
- **Public and linked.** Every entry carries the URL where it was said and the
  card links there. Nothing from a direct message, a private channel or a
  server that needs an invite
- **Third parties only.** Never the maintainer, never a bot, never a generated
  article
- **Removable.** Anyone quoted can ask to be taken out; the entry goes

Check a quote at its source before adding it. A platform that refuses
automated reads still has to be opened by hand once.

## How it moves

Two lanes of cards drift past each other, one each way, at different speeds so
they never lock. All of it is CSS — no JavaScript reaches the browser.

- Each lane holds its cards **twice**. The second copy lets the track slide by
  exactly one copy's length and start over without a seam; it is `aria-hidden`
  and out of the tab order, so every quote is announced and reached once
- A lane **stops** while the pointer or the keyboard focus is on it
- A mask fades both ends, so a card arrives and leaves instead of being cut by
  the column's edge — and so the lane never draws a hard line across the rails
- `prefers-reduced-motion`: no drift. The lanes are two still rows that scroll
  by hand, and the second copy is not drawn

## Cards

Hairline card on `--surface-card`, as everywhere on this site. The quote in
ink, then who said it and where. The mark beside the name is the first letter
of the name — no profile pictures are fetched or bundled.

## Forbidden

- A quote without a public URL
- Rewording, tidying or translating a quote
- A star rating, a score, or a count the page cannot prove
- Fetching avatars or anything else from a third party at render time
