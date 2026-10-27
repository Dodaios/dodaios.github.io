/**
 * The repository walkthrough — the click path, and the repository it walks.
 *
 * Four beats of one visit to github.com/Dodaios/Dodaios: the
 * root, the application package, the installer directory, and the first lines
 * of the installer itself. It is the path a careful visitor actually takes
 * before running an install one-liner, which is the whole argument the section
 * around it makes.
 *
 * ## Nothing here is written by hand
 *
 * Every listing, the description, the topics, the licence, the counts, the tip
 * commit and the eighteen lines of source come out of `src/data/repo-map.json`,
 * which `scripts/fetch-repo-map.mjs` reads from GitHub's API and commits. A
 * hand-typed listing of sixty-four entries is a claim nobody re-checks, and
 * this page's rule is that nothing on it is invented. What IS decided here is
 * the path — which three directories are opened, in which order.
 *
 * ## The sort is ours, and it has to be
 *
 * The contents API returns one alphabetical run with directories and files
 * mixed together; github.com lists every directory first and then every file.
 * Drawing the API's order would draw a listing no visitor has ever seen at that
 * URL, so the order is rebuilt here — see `ordered`.
 */

import map from "@/data/repo-map.json";

export interface Entry {
  name: string;
  type: string;
}

/** Which listing a frame is showing. The keys are the fetcher's own. */
export type PageKey = keyof typeof map.pages;

export interface Frame {
  /** A directory listing, or one file's source. */
  view: "tree" | "blob";
  /** The listing to draw. Ignored by the blob view. */
  page: PageKey;
  /**
   * The row the pointer is resting on, by name.
   *
   * A name and not an index: the index moves the moment a directory gains an
   * entry above it, and the fetcher rewrites this listing whenever it does. The
   * view resolves the name against the rows it is drawing, so a renamed
   * directory loses its hover rather than moving the pointer onto a neighbour.
   */
  hover?: string;
  /** True on the frame whose pointer rests on the breadcrumb's repo link. */
  hoverCrumb?: boolean;
  /** What the address bar reads, after the host. */
  path: string;
  /** How long this beat holds, in ms. */
  duration: number;
}

export const REPO: string = map.repo;
export const BRANCH: string = map.branch;
export const DESCRIPTION: string = map.description;
export const TOPICS: string[] = map.topics;
export const LICENSE: string = map.license ?? "";
export const LANGUAGE: string = map.language ?? "";
export const STARS: number = map.stars;
export const FORKS: number = map.forks;
export const OPEN_ISSUES: number = map.openIssues;
export const LAST_COMMIT = map.lastCommit;
export const FILE = map.file;

/**
 * One listing in github.com's own order: directories first, then files, each
 * run alphabetical. `localeCompare` with `numeric` is what puts `.agents`
 * before `assets` and keeps a `v2` after a `v10` from happening.
 */
export function ordered(key: PageKey): Entry[] {
  const entries = map.pages[key].entries as Entry[];
  const byName = (a: Entry, b: Entry) =>
    a.name.localeCompare(b.name, "en", { numeric: true });
  return [
    ...entries.filter((e) => e.type === "dir").sort(byName),
    ...entries.filter((e) => e.type !== "dir").sort(byName),
  ];
}

/** How many entries each listing holds, for the line under the table. */
export function total(key: PageKey): number {
  return map.pages[key].entries.length;
}

/**
 * The path, as the address bar spells it.
 *
 * Built from the repository and branch the fetcher recorded rather than from
 * three literals, so a renamed default branch cannot leave the demo showing a
 * URL that 404s.
 */
const treeUrl = (dir: string) => (dir ? `/${REPO}/tree/${BRANCH}/${dir}` : `/${REPO}`);
const blobUrl = (file: string) => `/${REPO}/blob/${BRANCH}/${file}`;

/**
 * The four beats.
 *
 * The order is a real click path and not a tour of the prettiest screens: the
 * root, the application package, the installer directory, and the file the
 * install one-liner pipes into a shell. Each frame's pointer rests on whatever
 * the NEXT frame opens, so the visit reads as one person clicking rather than
 * as four screenshots.
 *
 * ONE TRANSITION IS ELIDED, and it is in the middle on purpose. Getting from
 * `dodaios/` to `install/` is two clicks — up to the root, then down again — and
 * the pointer on beat two rests on the breadcrumb that makes the first of them.
 * Spending a whole beat on the root a second time would buy nothing but
 * literalism. It sits in the middle rather than at the end because the last
 * beat is the payoff: the file the section's headline promises, held longest
 * because it is the only frame with something to READ.
 */
export const FRAMES: Frame[] = [
  { view: "tree", page: "root", hover: "dodaios", path: treeUrl(""), duration: 3400 },
  {
    view: "tree",
    page: "dodaios",
    hoverCrumb: true,
    path: treeUrl("dodaios"),
    duration: 3200,
  },
  {
    view: "tree",
    page: "install",
    hover: FILE.path.split("/")[1],
    path: treeUrl("install"),
    duration: 3200,
  },
  { view: "blob", page: "install", path: blobUrl(FILE.path), duration: 4800 },
];

/**
 * What a screen reader is told instead of the stage, which is aria-hidden.
 *
 * It states the repository and what the pictures show, because the useful fact
 * here is that the code is public and readable — not the order four mock
 * screens appear in. The link beside the demo is the real way in.
 */
export const DEMO_DESCRIPTION =
  `A walkthrough of the ${REPO} repository on GitHub: the root listing, the ` +
  `application package, the install directory, and the first lines of ` +
  `install.ps1 — the script the install command runs. The repository is ` +
  `public and ${LICENSE}-licensed.`;
