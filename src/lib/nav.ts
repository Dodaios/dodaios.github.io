/**
 * The site nav's links — the one list, in page order.
 *
 * It lives here rather than in the component for the same reason the widths do:
 * the nav is not the only thing that has to agree with it. The scroll-spy reads
 * the same ids to decide which link is current, and a second hand-written copy
 * of the list is a copy that goes stale the moment a section is renamed,
 * reordered or removed — silently, because a link to an id that no longer
 * exists still renders and simply does nothing.
 *
 * ORDER IS LOAD-BEARING, not cosmetic. The spy resolves the current section by
 * walking this list and taking the LAST entry whose section has crossed under
 * the nav, so the entries have to be in the order the sections appear in
 * `src/pages/index.astro`. A misordered entry does not break the jump; it
 * lights the wrong link on the way past, which is harder to notice and harder
 * to attribute.
 *
 * NOT EVERY SECTION IS IN HERE. The hero is the top of the page and the
 * wordmark already goes there; the logo strip is a band the reader passes
 * THROUGH rather than one they navigate to; the install steps have the whole
 * Download button to themselves; and the legal foot is the end of the page,
 * which is one End key away. Everything a reader might want to be sent to IS
 * here, in page order.
 *
 * THAT WAS NOT TRUE UNTIL 2026-08-29. Three sections were added to the page
 * over the course of one afternoon — the stargazer globe, the open-source walk
 * and the legal foot — and the nav, whose list is this file, kept the shape it
 * had before any of them existed. Only `open-source` was added with it; the
 * globe and the build-in-public gallery, which had been on the page since the
 * morning, were left off on the theory that nobody navigates to social proof.
 * The maintainer's answer, on seeing the shipped nav, was that the sections
 * belong in it. WHEN A SECTION IS ADDED TO `index.astro`, IT IS ADDED HERE IN
 * THE SAME CHANGE unless one of the four reasons above applies to it.
 */

/** A nav entry that points at a section of this page. */
export interface NavLink {
  /** The `id` on the section element. The anchor and the spy both use it. */
  readonly id: string;
  /**
   * What the nav calls it. Short enough to sit beside six others AND the Docs
   * link at 1024px, which is the narrowest screen that still shows the row —
   * see the width note under the list.
   */
  readonly label: string;
}

/**
 * IN PAGE ORDER, and every label is carrying its section's own words: "Stars"
 * is what the globe section counts, "Privacy" is the eyebrow of the section
 * that took the place of "Built in public" on 2026-10-19. A nav label invented for the nav is a label the section never
 * confirms when the reader lands on it.
 *
 * THE ROW IS WIDTH-CONSTRAINED AND THIS LIST IS WHY. Seven section links, the
 * Docs link, the wordmark and the Download button share one `content` row, and
 * the row has no way to say it is full — flex simply pushes the wordmark and
 * the button towards each other until the labels run out through the Download
 * button. Seven entries need 977px of row and the two additions of 2026-08-29
 * cost 180px of that, which is why the links' gap steps down below 1280px (56px
 * back, bringing the row to 921px) and why the links are put away below 1024px
 * rather than below 768px — both in `layout.css`, with the arithmetic. ADDING A
 * NINTH ENTRY MEANS MEASURING AGAIN AT 1024px, not just typing a line here.
 */
export const NAV_LINKS: readonly NavLink[] = [
  { id: "features", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "clis", label: "CLIs" },
  { id: "agents", label: "Agents" },
  { id: "voice", label: "What changes" },
  { id: "stargazers", label: "Stars" },
  { id: "privacy", label: "Privacy" },
  { id: "open-source", label: "Open source" },
];

/**
 * The top of the page, as an anchor. The hero carries this id so the wordmark
 * has somewhere to send the reader — a bare `#` scrolls to the top too, but it
 * also writes a lone hash into the address bar and takes the page out of the
 * spy's own model of where it is.
 */
export const TOP_ID = "top";

/** The section the download button sends the reader to. */
export const INSTALL_ID = "install";

/**
 * The documentation, which is NOT a section of this page.
 *
 * Until now five places on the site linked to `#docs`, and no element on the
 * page has ever carried that id — every one of them was a link that scrolled
 * nowhere. The docs live in the repository, so that is where the link goes.
 * When this site grows a `/docs` route, this constant is the only line that
 * has to change.
 */
export const DOCS_URL = "https://github.com/Dodaios/Dodaios/tree/main/docs";

/* ---------------------------------------------------------------------------
 * The detail pages
 *
 * Three routes, one per feature section on the front page. They exist because
 * those three sections each ended in a link that left the site: "See every
 * plugin" went to a directory listing on GitHub, which is a source tree and not
 * an answer. The maintainer asked on 2026-08-29 for the three to lead to pages
 * of our own, in our own branding, drawn as the application draws them.
 *
 * They are ROUTES on this domain, not subdomains. A subdomain needs its own DNS
 * record, its own certificate and its own deploy; a route ships with the site,
 * keeps the nav, the rails and the footer, and can be linked to from the middle
 * of a sentence. Nothing about the pages would be better on a host of their own.
 *
 * See docs/detail-pages.md.
 * ------------------------------------------------------------------------ */

export type DetailPageId = "plugins" | "skills" | "clis";

export interface DetailPage {
  id: DetailPageId;
  /** The route. Trailing-slash-free, matching Astro's default output. */
  href: string;
  /** What a link to it says when it is one of several. */
  label: string;
  /** The section of the front page it belongs to. */
  section: string;
}

export const DETAIL_PAGES: readonly DetailPage[] = [
  { id: "plugins", href: "/plugins", label: "Every plugin", section: "features" },
  { id: "skills", href: "/skills", label: "How a skill is written", section: "skills" },
  { id: "clis", href: "/clis", label: "Every command-line tool", section: "clis" },
];

/**
 * The route of one detail page, by id.
 *
 * A function and not three exported constants, because the caller is a feature
 * section that already knows which page it belongs to and the point is that the
 * href is never typed twice. A typo in an id is a compile error here; a typo in
 * a string literal is a 404 nobody notices until someone clicks it.
 */
export function detailHref(id: DetailPageId): string {
  const page = DETAIL_PAGES.find((entry) => entry.id === id);
  /* Unreachable while the id is typed — which is the point of typing it. The
   * throw is what makes that true at build time rather than at read time: Astro
   * renders these pages statically, so a missing entry fails the build instead
   * of shipping an `undefined` href. */
  if (!page) throw new Error(`no detail page with id ${id}`);
  return page.href;
}

/**
 * An anchor that works from wherever it is rendered.
 *
 * The nav lists sections of the FRONT page. On the front page those are
 * `#features`; on `/plugins` the same link has to be `/#features`, or it points
 * at an id that page does not have and the click does nothing — which is the
 * exact defect `DOCS_URL` above exists to record. One helper, called by the nav
 * with its own pathname, so neither the list nor the markup has to know.
 */
export function sectionHref(id: string, pathname: string): string {
  return pathname === "/" ? `#${id}` : `/#${id}`;
}
