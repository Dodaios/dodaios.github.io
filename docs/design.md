# Design — the visual system

Binding for every surface of this site. Widths are governed by
[`layout.md`](layout.md); this file governs everything else. Where the two
appear to disagree, `layout.md` wins — it is the older contract and the hero
spec already builds on it.

Tokens live in `src/styles/tokens.css`. Never inline a hex value.

---

## Overview

An editorial, quietly-confident developer-tools voice. The page floor is **warm
near-black**, not pure black; the type on it is **warm off-white**, not pure
white. Display type sits at **weight 400** with negative tracking — a magazine
voice rather than a bombastic tech one. Depth comes from **hairlines only**: no
drop shadows, no elevation tiers. Sections breathe at an **80px rhythm**.

The floor is the running app's own dark theme, value for value, so the site and
the product it sells stand on the same ground. **There is no light mode** — the
page is dark at every system setting, which is why the tokens are defined once
on bare `:root` rather than split across a media query.

Key characteristics:

- Near-black canvas (`--canvas`), never `#000000` as the page floor.
- Off-white ink (`--ink`), never `#ffffff`.
- **Neutral greys, as in the app**: red, green and blue are equal in every
  surface, text and hairline value. The palette was a warm charcoal until
  2026-11-11 and moved to the app's own neutral scale with the app's brand.
- **The primary CTA is paper on ink.** The one hue is the app's own accent,
  `--accent`, and it marks state (a focus ring, a lit line, a live dot), never
  the ground of a button.
- Display weight stays 400 — never bold.
- Hairline-only depth; no shadows.
- Five pastel stage colours, scoped to agent-timeline visualisations only.
- Mono on every code surface, and code surfaces are roughly half the page.

## The scene behind the page

Since 2026-11-11 the site is a real-time 3D room ([`world.md`](world.md)).
The room follows this system rather than adding to it:

- **Its ground is the page's ground.** The canvas is cleared to `--canvas`.
- **Its colours are light, not paint.** The room's surfaces are the neutral
  greys of this palette (`art/room/spec.py` holds them), lit and baked. The few
  values the renderer adds at run time are the `--world-*` tokens: the lamp,
  the monitor's glow, the morning sun, the accent of a lit line, the gold of
  the wordmark. Nothing in the page may use them.
- **Three lights carry the mood**: the lamp's warm pool, the accent line behind
  the monitors, and the gold wordmark on the back wall. The gold is the
  wordmark's alone. None of them colours a control; the primary action is still
  paper on ink.
- **Words in the room are objects.** A sign, a board, a screen, a sheet of
  paper: never letters in the air. The same words are in the page
  (`world.md`, "Text in the room, and text in the page").
- **The page's own layer over the room is one row.** The HUD at the foot of the
  window holds the chapter's controls; a note in it brings a small ground of
  `--canvas` at 72 %. Buttons have the 8 px radius of the app. No pills.
- **The front page has no rails and no section marker**, and its foot paints
  `--canvas` under the legal text, the one ground a part of the front page
  paints for itself. A frame around a scene with depth reads as a window pane,
  and legal text over a picture is neither read nor looked at.

## What this is not

The reference document this system was adapted from described **another
product's brand** — its accent colour, its licensed typeface, its wordmark, even
its navigation labels. None of that is carried over, for three reasons:

1. **It is not ours.** A site wearing another company's accent colour and
   typeface reads as that company's site. Visitors would recognise them, not us.
   Copying trade dress this closely is also a legal exposure, not just a
   creative one.
2. **The typeface is licensed** and unavailable to us. The reference itself
   names Inter as the substitute; that is what we use, at weight 400 with
   negative tracking.
3. **It contradicts our own rebrand.** The app dropped its brand hue in favour
   of ink and paper. An accent-coloured site next to a colourless app makes the
   two read as different products.

What *is* carried over is the part that belongs to nobody: the scale, the
rhythm, the hairline-depth approach, and the editorial restraint. The reference
already contained an ink-on-cream CTA; promoting that to primary is what lets
this system work without a borrowed colour. The floor was later inverted to the
app's own dark theme, which leaves that CTA as paper on ink — the same one
action colour, read the other way round.

---

## Colour

### Surface
| Token | Value | Use |
|---|---|---|
| `--canvas` | `#0a0a0a` | Near-black page floor, the page's ONE ground (the app's `--background`) |
| `--canvas-soft` | `#1f1f1f` | Row hover and toolbar wells inside a card |
| `--surface-card` | `#171717` | Card surface, a small lift off the floor |
| `--surface-strong` | `#262626` | Badges, tags |

The scale runs the opposite way from a light theme: further from the floor means
**lighter**, not darker. A card lifts by moving toward the ink.

### One ground, no section tone

**The page is one black from the nav to the footer.** `--canvas` is painted
once, by `body` in `global.css`, and nothing else paints a ground. Section
boundaries are `--rule`'s job.

For one build each section painted its own near-black under itself —
`--tone-deep` `#060605`, `--tone-floor` `#0a0a09`, `--tone-raised` `#131210`,
plus a shallow gradient inside each one — following the reference's white/near-black
alternation, dialled down to what a dark page can carry. A full inversion was
never an option: every app mockup on this page is a clone of the product's own
dark theme rather than an illustration, and cannot be re-lit.

Dialled down that far it did not read as alternation. It read as an uneven
black: three values within two points of each other, and a visible step at
every joint where one section's gradient ended dark and the next one's began
light. The maintainer asked for a single background black on 2026-08-29 and
named the deep sections' ground as the one to keep. (The values in this
paragraph are the warm ones of that time; `--canvas` is `#0a0a0a` since the
palette went neutral.)

The one thing this makes safe: `--surface-card` lifts 15 points off the ground,
and a tone used to be spent out of that same range — a card on `--tone-raised`
had 6 points of lift left and read as a slightly darker hole. With one ground,
nothing can eat the card step.

The mechanics — why a section must never take a `background` for its ground —
are in [`layout.md`](layout.md) § "One ground, no section tone", because what
they protect is the rails.

### Ink and text
| Token | Value | Use |
|---|---|---|
| `--ink` | `#fafafa` | Display, emphasis, **primary CTA background** |
| `--ink-active` | `#e0e0e0` | CTA press state |
| `--body` | `#c2c2c2` | Running text |
| `--muted` | `#ababab` | Sub-titles |
| `--muted-soft` | `#8a8a8a` | Disabled text |
| `--on-ink` | `#0a0a0a` | Dark text on a pale CTA |
| `--accent` | `#3d8bff` | The app's accent: focus rings, a link's underline on hover, a live mark |

Against the canvas: `--ink` 19.0:1, `--body` 11.1:1, `--muted` 8.6:1, all past
AAA. `--muted-soft` sits at 5.7:1 and is for disabled text and quiet notes.
`--accent` is 6.0:1 and never carries running text.

### Hairlines
`--hairline` `#262626` (1px divider) · `--hairline-soft` `#1c1c1c` (lighter) ·
`--hairline-strong` `#383838` (panel outline).

"Strong" still means more contrast, which on this ground means lighter. The
three keep their order; only the direction flipped.

### The page rule
`--rule` `#a3a3a3` — the two rails and every section boundary, and nothing else.

Not a fourth hairline: a different job. A hairline bounds an **object** and is
meant to be found only once the eye is already on it, so it sits a shade off the
floor. A rule draws the **structure of the page** and has to be legible before
the reader has decided to look at anything. `--hairline` is 1.3:1 against the
canvas, which is below the threshold where a 1px line survives a real screen —
the boundaries were visible in the design and invisible on the maintainer's
monitor until this token was split out (2026-08-29). `--rule` is 7.8:1, one step
between `--muted-soft` and `--muted`.

**A block as wide as the `content` column takes `--rule` on its outer edge**,
because that edge is the rail at that height. See docs/layout.md § "Blocks that
cross a rail". Everything narrower keeps `--hairline`.

### Agent timeline — the one coloured signature
`--stage-thinking` peach · `--stage-grep` mint · `--stage-read` blue ·
`--stage-edit` lavender · `--stage-done` gold.

These mark agent stages inside timeline visualisations. They are **not** status
colours, **not** decoration, and never appear outside a timeline.

### Agent identity and the Agents clone — the Agents section only
`--agent-*` (violet, sage, orange, sky, rose, lime, lilac, teal) and
`--agent-eye`: the app's companion palette, value for value, so an agent on
this page wears the colour it wears in the product. They fill agent symbols in
the Agents section (`src/sections/Agents.astro`) and nothing else — never
text, never chrome, never a second action colour.

`--session-*` are the neutral greys of the app's Agents screen as it renders
today, sampled from the running build. The Agents section is a clone of that
screen and is drawn in them; nothing else on the page uses them.

### Semantic
`--success` `#3fb98d` · `--error` `#ea5e7e`. Validation and confirmation only.

Both were lifted off their light-theme values, which were mixed for cream and go
muddy here — the old `#1f8a65` lands at 2.4:1 against a card. These clear 5:1.

---

## Typography

**Inter** for display and body, **JetBrains Mono** for every code surface.

Sizes are **rem**, shown here with the px they render at the 16px base. The
root font size grows with the viewport (`layout.md`), so these travel with it;
a px token here would freeze while the rem utilities around it grew.

| Role | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|
| display-mega | 4.5rem (72px) | 400 | 1.1 | -2.16px | Hero h1 |
| display-xl | 3.25rem (52px) | 400 | 1.1 | -1.3px | A section head that carries the argument |
| display-lg | 2.25rem (36px) | 400 | 1.2 | -0.72px | Section heads |
| display-md | 1.625rem (26px) | 400 | 1.25 | -0.325px | Sub-section heads |
| display-sm | 1.375rem (22px) | 400 | 1.3 | -0.11px | Card group titles |
| title-md | 1.125rem (18px) | 600 | 1.4 | 0 | Component titles |
| title-sm | 1rem (16px) | 600 | 1.4 | 0 | List labels |
| body | 1rem (16px) | 400 | 1.5 | 0 | Default body |
| body-sm | 0.875rem (14px) | 400 | 1.5 | 0 | Footer body |
| caption | 0.8125rem (13px) | 400 | 1.4 | 0 | Captions |
| caption-upper | 0.6875rem (11px) | 600 | 1.4 | 0.88px | Section labels, pill labels |
| code | 0.8125rem (13px) | 400 | 1.5 | 0 | Code — JetBrains Mono |
| button | 0.875rem (14px) | 500 | 1.0 | 0 | CTA labels |
| nav-link | 0.875rem (14px) | 500 | 1.4 | 0 | Top nav |

**Principles**

- Display weight stays 400. Dropping to 700 is the single fastest way to lose
  this look.
- Negative tracking on display only, never on body.
- Mono on every code surface, inline and block.
- **`display-lg` is the section head; `display-xl` is the exception.** It is for
  a section whose headline carries the argument on its own — set beside its
  standfirst rather than above it, where `display-lg` reads as a caption next to
  the picture below. It is half a step down from the hero, so the page still has
  exactly one largest line. Two sections at `display-xl` means one of them
  should not be. On the front page: `VoiceSwitch.astro` only.
- **A page with no hero spends `display-xl` on its `h1`.** The rule above is
  "one largest line per page", not "one per site". A detail page
  (`/plugins`, `/skills`, `/clis`) opens on a sentence rather than a painting,
  so its `h1` is the exception there and every heading under it is
  `display-lg` — the same shape as the front page, one step down the whole way.
  See [`detail-pages.md`](detail-pages.md).

---

## Rhythm and layout

4px base unit. Tokens: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · **80 (section)**.

Vertical section padding is 80px. Cards inside a band sit close together
(16–24px gap) — the space belongs between sections, not inside them.

**Widths come from [`layout.md`](layout.md)**, not from this file: `prose` is
`max(672px, 26vw)`, `content` is `max(1280px, 50vw)`, `full` is 100% — via the
one `Container`. They are a formula, not a constant, so the column keeps its
share of a wide screen. The reference system named a flat 1200px; that is
exactly the shape of constant this site had to move away from.

Grids inside `content`: 3-up for benefit cards at desktop, 2-up for splits,
5-column footer.

---

## Depth

**Hairlines only.** No shadow tokens exist, and none should be added.

| Level | Treatment | Use |
|---|---|---|
| Flat | `--canvas` | Body bands, footer |
| Card | `--surface-card` + 1px `--hairline` | Content cards |
| Well | `--canvas-soft` | Row hover, toolbars inside a card |
| Mockup | app values + 1px `--hairline-strong` | The product window |

The product mockup is still the one element that reads as elevated, but it is
read by its **edge** rather than its fill. It carries the app's own near-black,
which on this floor is within a shade of the page, so the hero gives it
`--hairline-strong` instead of the usual hairline. That is the honest move in a
dark theme; a `box-shadow` would flatten it into a generic SaaS page, and
retuning the app values to fake a lift would stop the demo being a clone.

---

## Shape

`--radius-xs` 4px (inline tags) · `--radius-sm` 6px (compact rows) ·
`--radius-md` 8px (**buttons, inputs**) · `--radius-lg` 12px (**cards, panes**) ·
`--radius-xl` 16px (rare) · `--radius-pill` (pills, badges, avatars).

The compact 8px button radius is deliberate — a developer dialect, not a
consumer one.

---

## Components

**Top nav** — **no ground, no border, no rule under it.** Lettering only, fixed
over the whole document at 4rem tall (`--nav-height`), on the `content` step:
wordmark left in ink, the section links centred in `--body` and lit to ink for
the current one, one primary CTA right. It used to be a `--canvas` band with a
hairline along its bottom, pinned inside the hero; it left the hero on
2026-08-29 and lost both, because a band across the top of the page is the frame
the first screen is meant not to have.

What keeps the words legible over what passes beneath them is a **veil**: a
gradient from `--canvas` to transparent, twice the nav's height, fading in as
soon as the page moves. Twice the height so that it ends in nothing and has no
bottom edge for the eye to read as the underside of a bar — the reader sees the
top of the page deepen, not a surface appear. A shadow would do the same job and
is not available here, and should not be: this system has no shadows at all (see
"Don't", below, and `scripts/check-style.mjs` § no-shadow, which fails the build
over one).

**Below 1024px the section links are hidden** and the wordmark and the CTA stay.
It was 768px until 2026-08-29, when the list grew from five section links to
seven: the row needs 921px for them and the old figure left it overlapping the
Download button on every screen between. **There is no hamburger, deliberately**
— a menu button opens a panel, a panel needs a ground, and a ground is the one
thing this nav is built not to have. The sections it lists are a few scroll
gestures apart on a phone, which is a shorter journey than opening a menu to
pick one. The layout, the veil's two timings and
the current-section rule are in [`layout.md`](layout.md) § "The nav".

**Primary CTA** — ink background, dark text, 14px/500, 12×20px padding, 44px
tall, `--radius-md`. On this floor that is a pale button — the brightest thing
on the page, which is what makes it the one action worth taking.

**Secondary CTA** — card-coloured on the floor, ink text, 1px
`--hairline-strong`, 44px tall, `--radius-md` (`.button--quiet`). Not a pill:
the app has no pill-shaped buttons, and neither has the site.

**Tertiary** — inline ink text link.

**Cards** — card surface, 1px `--hairline`, `--radius-lg`, 24px padding. A card
as wide as the `content` column is the exception: its side edges stand on the
rails, so it takes 1px `--rule` and the rails run through it unbroken.

**Product mockup card** — a card holding a multi-pane mockup, `--radius-lg`,
1px `--hairline-strong`, no padding (panes fill it edge to edge). Panes use
`--canvas-soft` and mono type. See [`hero.md`](hero.md) for how the hero builds
this.

**Timeline pill** — `--radius-pill`, 4×10px padding, caption-upper type,
background from the stage tokens.

**Code block** — card surface, 1px hairline, `--radius-lg`, 20px padding, mono.

**Pricing** — card surface, `--radius-lg`, 32px padding. The featured tier
inverts to ink — a pale panel — instead of wearing a coloured ribbon.

**Inputs** — card surface, ink text, `--radius-md`, 12×16px padding, 44px tall.

**Pre-footer CTA band** — canvas, centred display-lg headline, one primary CTA,
96px vertical padding.

**Footer** — canvas, body text, 5-column links, 64×48px padding.

---

## Do

- Keep the primary CTA as paper on ink. One action colour, used scarcely.
- Keep display at weight 400.
- Use the near-black canvas as the page floor — never pure black.
- Render every code surface in mono.
- Confine the stage pastels to timeline visualisations.

## Don't

- **Don't add a second action colour.** If everything is emphasised, nothing is.
- Don't set display type to 700+.
- **Don't add drop shadows.** Hairlines and the card-off-floor step carry the
  depth.
- **Don't reach for a light-theme value** because it "looks about right". The
  semantic pair and the hairlines were re-mixed for this ground; a colour that
  worked on cream usually fails here.
- Don't use the stage pastels for status, decoration, or charts.
- Don't inline a hex value. Add a token or use one.
- Don't reintroduce another product's accent colour or typeface.
- **Don't give a section a ground of its own.** The page has one, `--canvas`
  on `body`. A section `background` also paints over the rails.

---

## Responsive

| Name | Width | Changes |
|---|---|---|
| Mobile | `< 640px` | Hero h1 → 32px; mockup collapses to one pane; grids 1-up; no nav section links and no hamburger in their place |
| Tablet | `640–1024px` | Hero h1 56px; mockup compresses; grids 2-up; still no nav section links — they come back at 1024px, where the row is wide enough to hold all seven |
| Desktop | `1024–1280px` | Hero h1 72px; full multi-pane mockup; grids 3-up; the nav's section links are back, at the tighter `--space-base` gap |
| Wide | `> 1280px` | Content caps at 1280px (`layout.md`), margins become visible |

**Touch targets:** primary CTA 44px, secondary 40px minimum.

---

## Known gaps

- There is no light mode, and none is planned. If one is ever wanted, add it as
  `:root[data-theme="light"]` overrides — never move a colour's only definition
  into a block, or the page loses that colour wherever the block does not apply.
- Animation timings are out of scope, except the hero's, which
  [`hero.md`](hero.md) pins down.
- Hover states are documented per component as they are built, not here.
