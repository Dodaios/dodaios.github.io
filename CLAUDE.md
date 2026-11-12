# CLAUDE.md

Binding rules for every coding agent in this repository — Claude Code, Codex,
Gemini CLI, whichever. `AGENTS.md` is the twin of this file: change one, change
both.

## What this is

The marketing website for the Dodaios project, which was called Personal Jarvis
until October 2026. It replaces the previous site, which was retired on
2026-08-28 together with its repository.

## Where this folder lives

This is its **own git repository**, sitting inside the Dodaios app
checkout as `personaljarvisweb/` so one folder holds both projects.

- The **parent** folder is the app's repo and is **public**. This repo is
  separate, with its own remote and its own history. They share a folder, never
  a history.
- The parent's `.gitignore` hides `personaljarvisweb/`, so nothing here is visible to the
  app repo and nothing here can be staged or pushed from it.
- Read the app's source freely for reference — it is one level up — but never
  edit, stage, or commit anything outside this folder from here.

## The dev server

There is exactly **one** dev server for this site, and it lives at a fixed
address:

**http://127.0.0.1:4399**

- Start it with `npm run dev`. That runs Astro's background instance, so it is
  shared rather than owned: a second `npm run dev` prints "already running" and
  exits. The port is pinned in `astro.config.mjs` with `strictPort`, so it
  cannot quietly relocate to the next free port.
- `npm run dev:status` reports whether it is up, `npm run dev:logs` shows its
  output, `npm run dev:stop` ends it. There is no restart command: stop, then
  start.
- **Never stand up a second server for this site.** Not `astro dev` on another
  port, not `astro preview`, not `python -m http.server` or `npx http-server`
  over `dist/`. Each one becomes a tab frozen at the build it was born with,
  and someone will later read it as the live site.
- **Only this address is ever named.** Every link handed to the maintainer — in
  a message, a commit, a note — is this one. Hot reload is on, so it always
  shows current source without a build.

**The one exception: a throwaway server for a check.** A browser pass or a
side-by-side comparison may need its own clean build on its own port. That is
allowed under two conditions — it runs from a private worktree or a scratch
directory, never from this folder, and it is **stopped when the check ends**,
on success or failure. It is never presented as "the site".

**Why:** a stale copy is worse than no copy. It answers, it looks right, and it
reports work that no longer exists — so a fix gets done twice, or a bug gets
hunted that was gone an hour ago.

## The 3D world

The site is one real-time 3D room, and the front page is a scrolled tour of
it that starts seated at the desk, with the working app on the monitor. **Read
`docs/world.md` before touching `src/world/`, `src/sections/room/`,
`src/styles/world.css` or `art/`.**

The short version:

- The page works without the scene. Never put a word, a link or a control only
  in the scene.
- Words in the room are on an object (a sign, a board, a screen), never
  floating, and the same words are in the page: both come from
  `src/data/room.ts`.
- The scene runs in a worker. Nothing in `src/world/World.ts`,
  `src/world/kit.ts` or `src/world/parts/` may touch `window` or `document`.
- Nothing draws before the page has painted (`docs/performance.md`).
- The models are built by the scripts in `art/` and shipped by
  `node scripts/build-world-assets.mjs`. Never edit a file in
  `src/assets/world/` by hand.

## Layout is binding

**`docs/layout.md` governs every section of this site.** Read it before writing
any markup. It is not a style suggestion; it is the layout contract, and
`scripts/check-style.mjs` enforces the mechanical half of it.

The short version:

- **Three width steps, no fourth.** `prose` — `max(672px, 26vw)` — for
  headlines, body copy, CTAs and forms. `content` — `max(1280px, 50vw)` — for
  images, screenshots, cards, grids and demos. `full` (100%) for background
  colours, gradients and dividers **only** — never text, never controls.
- **The goal is the "middle two quarters":** on a wide screen the outer two
  quarters stay empty and the middle two carry the content. A fixed pixel width
  hits that at exactly one screen size and degrades into a ribbon on anything
  wider; a bare percentage is 195px on a phone. `max()` of the two is what makes
  it hold everywhere.
- **One container decides width.** `src/lib/widths.ts` and
  `src/styles/layout.css` are the only files allowed to name a raw width. A
  section never sets its own `max-width`.
- **Padding lives in the container.** 24px per side, 32px from `md` up. Never
  add horizontal padding to a section on top of it.
- **Never a bare viewport unit for a width.** A share is only allowed with a
  pixel floor under it, as in the two steps above. `50vw` alone gives 195px on a
  phone.
- **`100svh`, never `100vh`.** On iOS the address bar collapses on scroll and
  `vh` is measured against the collapsed viewport, so a `100vh` hero jumps
  while the bar animates.
- **Type scales with the viewport too**, via the root font size and a
  floor-plus-share `clamp()` on display type — a wide screen gets a bigger page,
  not the same page with more empty space.
- **One boundary shape, used by every section.** A section is a band framed by
  two rules held `--section-inset` inside its own edges, so two sections always
  meet the same way: closing line, twice the inset of air, opening line. A
  section never opens with a bare `.section-rule` on top of a framed body —
  that is what drew two and three lines at one joint. A run of sections may
  opt out together; a single one may not.
- **Each section paints its own ground** with `data-tone` on `.section-tone`,
  so neighbours separate by tone as well as by a line. Never as a `background`
  on the section — that paints over the rails.
- **Tuning is four numbers for width**, all in `src/styles/layout.css`: the two
  shares (`--prose-share`, `--content-share`) and the two floors. Vertical
  pacing is two more in the same file: `--section-inset` and `--section-pad`.

Run `npm run check:style` before you commit. A violation fails the build. If
an exception is genuinely right, mark the line `layout-allow: <why>` — a reason
is mandatory, because "why" is the only thing that makes an exception
reviewable.

## Language

Everything committed is **English** — code, comments, docs, commit messages.
German appears only in user-facing site copy and its translation files.

## How work ships

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), one per finished
  step.
- **Pushing is not automatic.** Push only when explicitly asked.
- Never commit secrets, `.env` files, keys, or tokens.
- Every change works in both light and dark mode.
