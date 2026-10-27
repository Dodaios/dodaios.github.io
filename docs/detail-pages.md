# Detail pages — `/plugins`, `/skills`, `/clis`

Binding for the three routes reached from the front page's feature run. Widths
come from [`layout.md`](layout.md), colour and type from
[`design.md`](design.md); this file governs what is on these pages, where it
comes from, and the one place they are allowed to leave the site's palette.

---

## Why they exist

The three feature sections on the front page each ended in a link — *See every
plugin*, *See how a skill is written*, *See every command-line tool* — and all
three went to `DOCS_URL`, a directory listing on GitHub. A reader who clicked a
sentence about plugins landed in a source tree and had to go looking. The
maintainer asked on 2026-08-29 for the three to lead to pages of our own, in our
own branding, drawn as the application draws them.

**They are routes, not subdomains.** A subdomain needs its own DNS record, its
own certificate and its own deploy, and buys nothing: a route ships with the
site, keeps the nav, the rails and the footer, and can be linked to from the
middle of a sentence.

---

## The rule this file exists for

**Nothing on these pages is written from memory.** Every entry, count, category,
pattern, tier and label is read out of the application's own source by
`scripts/extract-app-catalog.mjs` and committed as `src/data/app-catalog.json`.
The pages import it through `src/lib/catalog.ts` and never touch the JSON
directly.

That is not tidiness. These pages make a claim about a product — seventy-six
entries of it — and a hand-typed listing is a claim nobody re-checks. Three
things follow, and all three are binding:

1. **A number on the page is derived, never typed.** "24 plugins", "113 refused
   patterns", "19 of 22 tools start here" are all `.length` on the committed
   data. A figure typed into the markup is a figure that will be wrong after the
   next release and will look right forever.
2. **A label the application prints is the application's.** The sign-in modes
   (`One-Click`, `Browser Login`, `Access Token`), the sign-in lifetimes and the
   four risk tiers are copied from the running views and from
   `dodaios/clis/spec.py`. A visitor who reads this page and then installs the
   product must find the same word on the same row. Where a label needs
   explaining, the site adds a sentence beside it — it never rewrites the label.
   The one set of words that IS ours is the CLI category names, because the
   application draws a glyph there and never spells them out; `catalog.ts` says
   so at the point it defines them.
3. **The page names its source and its date.** `DetailFoot.astro` prints the
   file each listing was read from and the day the extract ran. A listing this
   long is a claim with a date on it, and hiding the date does not make it
   fresher.

Refreshing after a product change is `npm run data:app-catalog`. The script
finds the application at `--repo`, then `$DODAIOS_REPO`, then the parent
directory. It never writes a partial catalog: a run that cannot read the
application leaves the committed file alone and exits non-zero, because half a
listing is worse than a month-old one — the page cannot tell the reader which
half it is.

---

## The shape all three share

```
DetailHead      breadcrumb · h1 · standfirst beside it · three counts
the window      the application's own view, at page size, searchable
one or two      what the listing does not answer on its own
prose sections
DetailFoot      install line · the other two pages · source and date
Legal           the site's usual foot
```

Every section is the ordinary shell: `.section-inset` on the Container,
`.section-bounds` on the band inside it, `<SectionTrack nested />` in that band.
**Detail pages take the shell as it comes.** The front page's three feature
sections are the one run allowed to opt out of it (`layout.md` § "A run of
sections may opt out — together"), and that exception is theirs alone.

**`display-xl` is the page's `h1`, and there is exactly one.** `design.md` names
`display-lg` as the section head and `display-xl` as the exception for a
headline that carries the argument on its own. On the front page that exception
is `VoiceSwitch` and nothing else. A detail page has no hero, so its `h1` takes
`display-xl` — half a step down from the front page's hero — and every heading
under it is `display-lg`. One largest line per page, still.

**The head carries no `id="top"`, deliberately.** `SiteNav`'s script drives the
rails and the veil off the hero's floor and takes that id as the hero. A detail
page's head is a few hundred pixels tall, so the chrome would arrive part-way
through a heading. With no such element the script settles both at 1 on its
first measurement — the case it already documents — and the page simply has its
chrome from the top.

---

## The window is the application's palette; everything else is the site's

`src/styles/app.css` paints the window in the `--app-*` tokens — the running
application's own dark theme, read out of it value for value (`tokens.css`
§ "App mockup"). The hero does the same and for the same reason: a window
painted in the site's palette is an illustration of the product, and one painted
in the product's palette is the product.

The two palettes are close, because the site's floor was taken from the app's.
**The line between them is the window's border**, and that border is the one
place inside `app.css` that reaches for a site token: `--hairline-strong`, not
`--app-border`. A border in the app's own hairline is one near-black on another
and the window has no edge at all. `design.md` § Depth settles it for the hero
and the rule is the same here — the mockup is read by its edge.

Nothing else in the page — heads, standfirsts, cards, the fact lists, the
closing band — uses an `--app-*` token.

---

## The window is markup, not a picture

The front page draws the application three times as a **scaled miniature**: a
fixed 1440-wide canvas, everything in design pixels, `transform: scale()` to
fit (`feature-section.md`). That technique buys a perfect small window and costs
everything a picture costs — the text is unreadable, unselectable, invisible to
a search engine, and the list has to stop at the seven rows that fit.

The detail pages want the opposite trade, so their window is **real markup at
real size**: same title bar, same three dots, same rows, in the page's own units.

They are deliberately not one shared component. The miniature has to carry two
unit systems to be scalable; this one does not, and the first person to merge
them would collapse the distinction. `AppWindow.astro` says so at the top.

---

## The listing is complete before JavaScript runs

Every row is server-rendered. `CatalogSearch.astro` filters what is already
there by setting `hidden`; it never builds a row, fetches one, or owns the list.
Three properties fall out of that and all three are the point: the page is whole
with JavaScript off and whole to a search engine, the rows are selectable text,
and a filter over seventy-six rows costs no hydration and no framework.

- The toolbar is `display: none` until `[data-js]` lands on the root element,
  written by an inline script before first paint. **A search box that does
  nothing is worse than no search box.**
- `data-search` on a row is built at build time (`searchText` in `catalog.ts`)
  and holds more than the row prints — an id, a binary name, a tag that did not
  fit — so a row stays findable by what it is, not only by what it shows.
- A group heading whose rows are all filtered out is hidden with them. A heading
  over nothing reads as a category the product has and the list forgot.

**`hidden` is spelled out in CSS** (`.app-row[hidden]`). The user-agent rule is
`[hidden] { display: none }` at specificity (0,1,0) — exactly what `.app-row`
scores, and the author sheet comes later, so `display: grid` wins and the filter
appears to do nothing at all.

---

## Controls that are drawn and not wired

The plugin rows carry the app's round connect button; the skill rows carry its
toggle, switched on. Neither does anything, both are `aria-hidden`, and that is
the honest arrangement: this page lists a catalog and connects to nothing, so a
plus that opened a sign-in flow on a marketing site would be a lie about where
the reader is. The row is incomplete without them — they are what makes it the
application's row.

Anything a reader can actually operate is a real control: the search field, the
filter chips, the `<details>` on `/clis`.

---

## Per page

**`/plugins`** — the catalog, then how signing in works, then how a plugin
reaches its service. The listing shows what a **fresh install** looks like:
nothing connected, because connection state is this machine's and not a fact
about the product. The page says so on the row of counts.

**`/skills`** — a real `SKILL.md`, verbatim, before the listing. The link that
leads here says "See how a skill is written", so the page has to show one; a
listing answers "what can it do" and nothing in a listing answers "what am I
writing if I write one". `morning-routine` because it is the one built-in
carrying all three kinds of trigger at once.

The frontmatter is built as a **string** and handed over with `set:html`, not
mapped to elements. Astro preserves the whitespace between elements in its own
template, and inside a `<pre>` there is no insignificant whitespace: the mapped
version came out with the source file's indentation injected into every line, a
forty-line listing spread over four screens. The string is escaped, because it
is a file read off disk going into markup.

**`/clis`** — the catalog, the gate, then every refusal list in full. **The gate
is the point of this page, not the list.** A page that says "it can run your
cloud CLI" and stops there has described something nobody sensible would
install; what makes it installable is that each tool arrives with a written list
of commands refused before they start. So the page prints all 113 of them rather
than promising them, in a `<details>` per tool — the element ships the
disclosure behaviour, the keyboard handling and the announcement with no
JavaScript, and the closed content is still indexed.

---

## Adding a fourth

1. Add it to `DETAIL_PAGES` in `src/lib/nav.ts`. That is the only place a route
   is spelled, and `detailHref` is how a section links to one.
2. Give the front-page section that owns it a `detailHref` link, and name the
   section it belongs to in the entry, so the nav lights the right word.
3. Extend `scripts/extract-app-catalog.mjs` if it needs data the product owns.
   Never type the data into the page.
4. If the page needs a heading style a third page would also want, it goes in
   `src/styles/detail.css`, not a scoped block.
