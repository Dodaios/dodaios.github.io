# Section — "You draw the line"

`src/sections/TheLine.astro`, data and geometry in `src/lib/theLine.ts`.
Nav label: **Privacy**. Anchor: `#privacy`.

## Why it exists

It replaced the "Built in public" section on 2026-10-19. That section showed
the maintainer's face (video posters and a webcam inset), and the maintainer
asked to no longer be visible on the internet. The videos, their poster frames
(`public/video-thumbs/`), the fetch script and the stat row went with it. The
site therefore no longer contacts YouTube or Discord; the privacy policy and
the footer sentence were changed in the same commit.

## What it shows

A dotted line splits a diagram into "your computer" and "providers you pick".
The path of a spoken request runs across it: microphone, wake word, speech to
text, brain, voice, speaker, with memory feeding the brain. Three stages can
sit on either side, and the visitor moves them by clicking the part or using
the switch strip under the diagram. Small squares ride the path: hollow while
they are sound, solid while they are words, brighter once they are over the
line, with a ring where they cross it. Each strip cell says in words what that
stage sends over the line, or that it sends nothing.

## Rules

- **Nothing invented.** Every engine name and every "crosses" sentence is
  checked against the app repository; `src/lib/theLine.ts` lists where. When
  the app adds or drops a provider, or changes what a stage sends, this
  section changes with it.
- **It opens on the shipped default**, all three stages with a provider,
  because a fresh install starts there. Do not open it on "all local" to make
  the picture nicer.
- **The wake word, memory and API keys never move.** They are pinned inside
  because the app never sends them anywhere.
- **No scroll trap.** It is an ordinary one-screen bounded section between two
  sections that already hold the reader (see `OpenSource.astro`).
- **Animation only on screen, never under reduced motion.** Parts then jump
  instead of gliding and no packets are drawn.
- **Two drawings.** Below 640px the tall drawing replaces the wide one; both
  share one state.
- **Monochrome.** Ink, body, muted and the hairlines. The stage pastels are
  for agent timelines only.
