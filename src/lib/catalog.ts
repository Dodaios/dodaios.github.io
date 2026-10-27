/**
 * The application's catalogs, typed — and worded the way the application words
 * them.
 *
 * `src/data/app-catalog.json` is machine-written from the product's own source
 * (see `scripts/extract-app-catalog.mjs`). This file is the only place that
 * turns its ids into English, and the English is the APPLICATION'S, copied from
 * the running views rather than composed here:
 *
 *   - the three sign-in modes are `AUTH_MODE_LABEL` in `PluginsView.tsx`
 *   - the three sign-in lifetimes are its `LONGEVITY_LABEL`
 *   - the four risk tiers are `RiskTier` in `dodaios/clis/spec.py`
 *
 * That matters more than it looks. A visitor who reads this page and then
 * installs the product should find the same words on the same rows; a site that
 * invents friendlier ones has described a product that does not exist. Where a
 * label needs a sentence of explanation the site adds one — the `hint` beside
 * each label — but the label itself is never rewritten.
 *
 * The detail pages import from here and never reach into the JSON directly, so
 * a shape change in the catalog is a compile error in one file.
 */

import catalog from "@/data/app-catalog.json";

/* ---------------------------------------------------------------------------
 * Plugins
 * ------------------------------------------------------------------------ */

/** How a visitor signs a plugin in. */
export type AuthMode = "pat_paste" | "hosted_mcp_oauth_dcr" | "oauth_pkce_loopback";

/** How long that sign-in lasts before it has to be done again. */
export type Longevity = "permanent" | "self_renewing" | "provider_limited";

/** How the plugin reaches the service once it is signed in. */
export type PluginRoute = "mcp" | "native" | "channel";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  category: string;
  auth: AuthMode;
  longevity: Longevity;
  via: PluginRoute;
  featured: boolean;
}

/** The app's own label, and one sentence saying what it means. */
export interface Wording {
  label: string;
  hint: string;
}

/** `AUTH_MODE_LABEL` in the application's PluginsView, with the site's gloss. */
export const AUTH_WORDING: Record<AuthMode, Wording> = {
  hosted_mcp_oauth_dcr: {
    label: "One-Click",
    hint: "A browser tab opens, you approve, and it is done. Nothing to copy.",
  },
  oauth_pkce_loopback: {
    label: "Browser Login",
    hint: "You sign in on the service's own page. The reply comes back to the app on your machine — no server of ours in between.",
  },
  pat_paste: {
    label: "Access Token",
    hint: "You create a token on the service, with the permissions it names, and paste it in.",
  },
};

/** `LONGEVITY_LABEL` in the application's PluginsView, with the site's gloss. */
export const LONGEVITY_WORDING: Record<Longevity, Wording> = {
  permanent: {
    label: "Stays connected",
    hint: "Signed in once, connected until you disconnect it.",
  },
  self_renewing: {
    label: "Renews itself",
    hint: "The connection refreshes in the background; you are not asked again.",
  },
  provider_limited: {
    label: "Sign in again periodically",
    hint: "The service caps how long a sign-in may last, so it asks again on its own schedule.",
  },
};

/** How the plugin reaches the service. Not a label the app prints — the app
 *  shows it as the presence or absence of a server — but a real difference
 *  between the entries, and the one a reader asks about. */
export const ROUTE_WORDING: Record<PluginRoute, Wording> = {
  mcp: {
    label: "Hosted server",
    hint: "The service publishes its own tool server and Dodaios calls it. Nothing to install.",
  },
  native: {
    label: "Built in",
    hint: "The tools ship inside the app, so this one works with no server in between.",
  },
  channel: {
    label: "A way in",
    hint: "This one runs the other way round: you message your own bot and your assistant answers there.",
  },
};

/* ---------------------------------------------------------------------------
 * Command-line tools
 * ------------------------------------------------------------------------ */

/** `RiskTier` in `dodaios/clis/spec.py`. `safe` and `block` are never a CLI's
 *  DEFAULT — they are what a matched pattern resolves a single command to. */
export type RiskTier = "safe" | "monitor" | "ask" | "block";

/** How the app signs a CLI in. */
export type CliAuth = "oauth_cli" | "api_key" | "config_file" | "none";

export interface Cli {
  id: string;
  name: string;
  description: string;
  category: string;
  binary: string;
  homepage: string;
  install: string | null;
  auth: CliAuth;
  risk: {
    tier: RiskTier;
    blocked: string[];
    allowed: string[];
  };
  examples: string[];
}

export const RISK_WORDING: Record<RiskTier, Wording> = {
  safe: {
    label: "Safe",
    hint: "Runs straight away. Reserved for commands that only read.",
  },
  monitor: {
    label: "Monitor",
    hint: "Runs, and is written down — what was run, and why it was allowed.",
  },
  ask: {
    label: "Ask",
    hint: "Stops and asks you first, every time.",
  },
  block: {
    label: "Block",
    hint: "Refused before it starts. Nothing runs.",
  },
};

export const CLI_AUTH_WORDING: Record<CliAuth, Wording> = {
  oauth_cli: {
    label: "The tool's own login",
    hint: "Dodaios runs the vendor's own sign-in command and never sees the credentials.",
  },
  api_key: {
    label: "API key",
    hint: "A key you paste once. It is kept in your operating system's keychain, never in a config file.",
  },
  config_file: {
    label: "Already signed in",
    hint: "It reads the config the tool wrote when you set it up yourself.",
  },
  none: {
    label: "No sign-in",
    hint: "Nothing to authorise — the tool needs no account.",
  },
};

/**
 * The categories the CLI catalog sorts by, in English.
 *
 * These ARE the site's own words, and the one set on this page that is — the
 * catalog stores short ids (`baas`, `paas`, `self`) and the application never
 * spells them out, because it draws a glyph per category instead
 * (`CATEGORY_GLYPHS` in its `CliLogo.tsx`). A page cannot print a glyph as a
 * heading, so each id is named after what its glyph means and what its members
 * actually are: `payments` holds Stripe and Twilio, so it is not "Payments"
 * alone, and `self` is this project's own control CLI.
 */
export const CLI_CATEGORY_LABEL: Record<string, string> = {
  baas: "Databases & backends",
  cloud: "Cloud platforms",
  container: "Containers",
  git: "Code hosting",
  paas: "Hosting & deploys",
  payments: "Payments & messaging",
  self: "This app",
  workspace: "Workspace",
};

/* ---------------------------------------------------------------------------
 * Skills
 * ------------------------------------------------------------------------ */

/** What sets a skill off. `schedule` is a cron line; the other two are typed
 *  or spoken by a person. */
export type TriggerType = "voice" | "hotkey" | "schedule";

export interface Trigger {
  type: TriggerType;
  /** A regular expression for voice, a chord for a hotkey, a cron line for a
   *  schedule. Shown verbatim — it is the file's own text. */
  pattern: string;
  languages: string[];
}

export interface Skill {
  name: string;
  version: string | null;
  description: string;
  whenToUse: string;
  category: string;
  tags: string[];
  author: string;
  license: string | null;
  /** The plugin this skill speaks for, when it is one. */
  plugin: string | null;
  risk: RiskTier;
  triggers: Trigger[];
  config: string[];
  state: string;
}

export const TRIGGER_WORDING: Record<TriggerType, Wording> = {
  voice: {
    label: "Spoken",
    hint: "A phrase, matched as you say it. Every built-in pattern is written for German and English at once.",
  },
  hotkey: {
    label: "Shortcut",
    hint: "A key chord, anywhere on the machine.",
  },
  schedule: {
    label: "Clock",
    hint: "A cron line. It runs whether or not you are at the keyboard.",
  },
};

/* ---------------------------------------------------------------------------
 * The catalog itself
 * ------------------------------------------------------------------------ */

export const PLUGINS = catalog.plugins as Plugin[];
export const CLIS = catalog.clis as Cli[];
export const SKILLS = catalog.skills as Skill[];

/** The day the committed file was last refreshed from the product. Printed at
 *  the foot of each detail page: a listing of seventy-six entries is a claim
 *  with a date on it, and hiding the date does not make it fresher. */
export const CATALOG_DATE = catalog.generated as string;

/** The files the entries were read out of, for the same reason. */
export const CATALOG_SOURCES = catalog.sources as Record<string, string>;

/**
 * Group rows by a key, keeping the order the catalog serves them in.
 *
 * A `Map` and not an object: an object with keys like `"Files & Photos"` keeps
 * insertion order for string keys, but an id that parses as an integer would
 * silently jump to the front, and the CLI categories are ids. One shape that
 * cannot surprise is cheaper than remembering which keys are safe.
 */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const held = groups.get(id);
    if (held) held.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/** How many distinct values a column has — for the fact rows in a page head. */
export function countDistinct<T>(rows: readonly T[], key: (row: T) => string): number {
  return new Set(rows.map(key)).size;
}

/**
 * The search text for a row, lower-cased once at build time.
 *
 * The filter in `CatalogSearch.astro` matches against this rather than against
 * the rendered markup, so a row stays findable by something the row does not
 * print — a plugin by its id, a CLI by its binary name, a skill by a tag that
 * did not fit. Built here so the page ships it as an attribute and the browser
 * does no work to derive it.
 */
export function searchText(...parts: Array<string | string[] | null | undefined>): string {
  return parts
    .flat()
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}
