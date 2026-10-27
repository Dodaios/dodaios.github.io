/**
 * The CLIs demo script.
 *
 * Read out of the app and then checked a second time against the source. Four
 * things the adversarial pass threw out, all of them plausible:
 *
 *  - A hand-picked row order. The API sorts by (category, display_name), so
 *    GitHub CLI is roughly the eleventh row, not the first.
 *  - The risk badge "monitor" beside `gh pr list --state open`. `monitor` is
 *    the CLI's DEFAULT tier; the gate resolves per command, and gh's whitelist
 *    contains `gh pr list*`, so this exact command comes back `safe`. Pairing
 *    it with "monitor" would misstate the product's own safety gate — and it
 *    is the more interesting claim anyway: a read command is auto-downgraded.
 *  - A green safe badge. Nothing in the app's risk styles is green; safe is the
 *    quietest grey of the four.
 *  - "Target:" as a label on the CLI picker. No such string exists.
 *
 * Everything below — binary, commands, auth mode, tier, blocked and allowed
 * patterns, the example call — is verbatim from dodaios/clis/catalog/seed_catalog.json.
 * The connection statuses are this machine's runtime state, not catalog facts.
 */

import { cliMark } from "@/components/window-demo/marks";

export type CliStatus = "connected" | "disconnected" | "not installed";

export interface DemoCli {
  id: string;
  name: string;
  category: string;
  status: CliStatus;
  /** Bundled vendor mark, when one exists for this CLI's company. */
  logo?: string;
  /** Drawn as a mask over the text ink rather than as a picture. */
  mono?: boolean;
}

/**
 * Catalog CLI id -> vendor mark file, ported from the app's own CliLogo.
 *
 * The mapping goes id -> VENDOR -> file, because a user recognises the company,
 * not the binary: nobody scans a list for "wrangler", they look for the
 * Cloudflare cloud. Exact ids, never substrings — `gh` and `glab` share no
 * letters with their companies.
 *
 * The second value is the app's own `mono` flag: those files are single-colour
 * glyphs, so they are painted with the page's ink and survive a theme change.
 */
const VENDOR: Record<string, [file: string, mono: boolean]> = {
  aws: ["aws.svg", true],
  az: ["azure.svg", false],
  docker: ["docker.svg", false],
  firebase: ["firebase.svg", false],
  flyctl: ["fly.svg", false],
  gcloud: ["google-cloud.svg", false],
  gh: ["github.svg", true],
  glab: ["gitlab.svg", false],
  gws: ["google.svg", false],
  heroku: ["heroku.svg", false],
  kubectl: ["kubernetes.svg", false],
  neonctl: ["neon.svg", false],
  netlify: ["netlify.svg", false],
  pscale: ["planetscale.svg", true],
  railway: ["railway.svg", true],
  render: ["render.svg", true],
  stripe: ["stripe.svg", true],
  supabase: ["supabase.svg", false],
  twilio: ["twilio.svg", false],
  vercel: ["vercel.svg", true],
  wrangler: ["cloudflare.svg", true],
};

/**
 * The whole catalog, in the order the API sorts it: by category, then display
 * name. Twenty-two entries, verbatim from dodaios/clis/catalog/seed_catalog.json.
 *
 * dodaiosctl is the one with no vendor — it is this project's own control CLI,
 * and the app draws a category glyph for it rather than inventing a mark.
 */
const CATALOG_ROWS: Array<[id: string, name: string, category: string]> = [
  ["firebase", "Firebase CLI", "baas"],
  ["neonctl", "Neon CLI", "baas"],
  ["pscale", "PlanetScale CLI", "baas"],
  ["supabase", "Supabase CLI", "baas"],
  ["aws", "AWS CLI v2", "cloud"],
  ["az", "Azure CLI", "cloud"],
  ["wrangler", "Cloudflare Wrangler", "cloud"],
  ["gcloud", "Google Cloud CLI", "cloud"],
  ["docker", "Docker CLI", "container"],
  ["kubectl", "Kubernetes CLI", "container"],
  ["gh", "GitHub CLI", "git"],
  ["glab", "GitLab CLI", "git"],
  ["flyctl", "Fly.io CLI", "paas"],
  ["heroku", "Heroku CLI", "paas"],
  ["netlify", "Netlify CLI", "paas"],
  ["railway", "Railway CLI", "paas"],
  ["render", "Render CLI", "paas"],
  ["vercel", "Vercel CLI", "paas"],
  ["stripe", "Stripe CLI", "payments"],
  ["twilio", "Twilio CLI", "payments"],
  ["dodaiosctl", "Dodaios Control CLI", "self"],
  ["gws", "Google Workspace CLI", "workspace"],
];

/** This machine's runtime state, not a catalog fact. */
const CONNECTED = new Set(["gcloud", "docker", "gh"]);
const INSTALLED = new Set(["glab"]);

export const CATALOG: DemoCli[] = CATALOG_ROWS.map(([id, name, category]) => {
  const vendor = VENDOR[id];
  return {
    id,
    name,
    category,
    status: CONNECTED.has(id)
      ? ("connected" as const)
      : INSTALLED.has(id)
        ? ("disconnected" as const)
        : ("not installed" as const),
    logo: vendor ? cliMark(vendor[0]) : undefined,
    mono: vendor ? vendor[1] : undefined,
  };
});

/** The one entry the demo opens, verbatim from the seed catalog. */
export const DETAIL = {
  name: "GitHub CLI",
  description: "GitHub Repos, PRs, Issues, Actions, Releases.",
  binary: "gh",
  commands: [
    { label: "Check", value: "gh --version" },
    { label: "Login", value: "gh auth login" },
    { label: "Status", value: "gh auth status" },
  ],
  authMode: "oauth_cli",
  defaultTier: "monitor",
  /** The catalog's blacklist. Four patterns; the demo shows all four. */
  blocked: [
    "gh repo delete *",
    "gh release delete *",
    "gh secret delete *",
    "gh secret set *",
  ],
  /** The catalog's whitelist has twelve; these are the four the story needs. */
  allowed: ["gh auth status*", "gh repo view*", "gh pr list*", "gh issue list*"],
};

/** The instruction the demo types, and what the app does with it. Both the
 *  instruction and the command are the catalog's own example call. */
export const RUN = {
  instruction: "Show my open pull requests",
  tool: "cli_gh",
  /** The RESOLVED tier, not the default: `gh pr list*` is on gh's whitelist,
   *  and a whitelist hit resolves to `safe`. */
  tier: "safe",
  exitCode: 0,
  command: "gh pr list --state open",
  duration: "412 ms",
};

export type Layout = "catalog" | "detail" | "gate" | "compose" | "result";

export interface Frame {
  duration: number;
  layout: Layout;
  hoverId?: string;
  /** How much of the instruction has been typed, for the composer frame. */
  typed?: number;
  caption: string;
}

export const CATALOG_TOTAL = CATALOG.length;
export const CONNECTED_TOTAL = CONNECTED.size;
/** Connected counts as installed: you cannot sign in to a binary you do not
 *  have. */
export const INSTALLED_TOTAL = CONNECTED.size + INSTALLED.size;

export const FRAMES: Frame[] = [
  {
    duration: 4200,
    layout: "catalog",
    caption:
      "The whole catalog of command-line tools Dodaios can drive: twenty-two of them, three connected here.",
  },
  {
    duration: 4200,
    layout: "detail",
    hoverId: "gh",
    caption:
      "Opening the GitHub CLI shows the binary it runs and the exact commands it uses to check it and sign in.",
  },
  {
    duration: 5000,
    layout: "gate",
    hoverId: "gh",
    caption:
      "Each tool carries its own blocked and allowed command patterns, so deleting a repository is refused before it is ever run.",
  },
  {
    duration: 3400,
    layout: "compose",
    caption:
      "In the test hub you ask in plain language: show my open pull requests.",
  },
  {
    duration: 5400,
    layout: "result",
    caption:
      "The answer comes with its evidence: which tool was picked, which risk tier the gate resolved, the exit code and the exact command that ran.",
  },
];

export const DEMO_DESCRIPTION = [
  "A demo of the app's CLIs section.",
  ...FRAMES.map((f) => f.caption),
].join(" ");
