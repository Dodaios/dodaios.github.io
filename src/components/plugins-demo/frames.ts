/**
 * The plugins demo script.
 *
 * The list is the app's whole shipped catalog — all twenty-four, in the order
 * the catalog serves them, because a header reading "24 available" over five
 * rows reads as a broken list rather than a short one. The window shows about
 * seven at a time and scrolls, exactly as the app does.
 *
 * Marks come from `src/assets/brands/`, bundled at build time, so the demo makes
 * no network call — which docs/feature-section.md forbids. Two of the
 * twenty-four are not bundled: Stripe and Cloudflare publish no square
 * full-colour icon, and their real app icon IS a white glyph on the brand
 * colour, so the tinted fallback is the faithful rendering rather than a
 * placeholder.
 *
 * Connection status is this machine's runtime state, not a catalog fact.
 */

import { brandMark } from "@/components/window-demo/marks";

export type PluginStatus = "not_connected" | "connected" | "needs_reauth";

export interface DemoPlugin {
  id: string;
  name: string;
  category: string;
  status: PluginStatus;
  /** Bundled mark, when the app ships one for this id. */
  logo?: string;
  /** Draw the mark as a mask over the text ink instead of as a picture. */
  mono?: boolean;
  /** Brand colour for the tile, without the leading hash — see MarkTile. */
  tint?: string;
  /** Shown under the name while the status is `needs_reauth`. */
  reason?: string;
  /** The app's "Connected · Live": authorised AND it answered a call. */
  live?: boolean;
}

/**
 * The catalog, verbatim from dodaios/marketplace/seed_catalog.json — ids, names,
 * categories and order.
 *
 * No mark here is drawn as a mask. The bundled files are the light-on-dark set
 * the app ships, and this site's tile is dark, so each one is a picture. A mask
 * would flatten a filled mark to its silhouette — Notion's page would swallow
 * its own N. The two entries that carry a tint are the ones the app does not
 * bundle at all.
 */
const CATALOG: Array<
  [id: string, name: string, category: string, mono?: boolean, tint?: string]
> = [
  ["github", "GitHub", "Developer"],
  ["vercel", "Vercel", "Developer"],
  ["supabase", "Supabase", "Developer"],
  ["notion", "Notion", "Knowledge & Reading"],
  ["slack", "Slack", "Messaging"],
  ["linear", "Linear", "Developer"],
  ["stripe", "Stripe", "Developer", false, "635BFF"],
  ["cloudflare", "Cloudflare", "Developer", false, "F38020"],
  ["discord", "Discord", "Messaging"],
  ["telegram", "Telegram", "Messaging"],
  ["asana", "Asana", "Lists & Tasks"],
  ["google_drive", "Google Drive", "Files & Photos"],
  ["gmail", "Gmail", "Calendar & Mail"],
  ["google_calendar", "Google Calendar", "Calendar & Mail"],
  ["todoist", "Todoist", "Lists & Tasks"],
  ["clickup", "ClickUp", "Lists & Tasks"],
  ["dropbox", "Dropbox", "Files & Photos"],
  ["canva", "Canva", "Media & Creativity"],
  ["airtable", "Airtable", "Knowledge & Reading"],
  ["cal_com", "Cal.com", "Calendar & Mail"],
  ["home_assistant", "Home Assistant", "Home & Devices"],
  ["spotify", "Spotify", "Media & Creativity"],
  ["youtube_music", "YouTube Music", "Media & Creativity"],
  ["higgsfield", "Higgsfield", "Media & Creativity"],
];

/** Which are connected on this machine. Everything else starts disconnected,
 *  which is what a fresh install looks like. */
const CONNECTED = new Set(["github", "spotify"]);
const LIVE = new Set(["github"]);

export const ALL_DEMO_PLUGINS: DemoPlugin[] = CATALOG.map(
  ([id, name, category, mono, tint]) => ({
    id,
    name,
    category,
    status: CONNECTED.has(id) ? "connected" : "not_connected",
    live: LIVE.has(id),
    logo: brandMark(id),
    mono,
    tint,
  }),
);

const byId = (id: string) =>
  ALL_DEMO_PLUGINS.find((p) => p.id === id) as DemoPlugin;

/** Query "google" matches these three: the app searches name, description,
 *  category, id and the vendor family behind the OAuth client. */
const GOOGLE_HITS = ["gmail", "google_drive", "google_calendar"].map(byId);

export type FilterId = "all" | "installed" | "attention";

export interface Frame {
  duration: number;
  query: string;
  filter: FilterId;
  plugins: DemoPlugin[];
  busyId?: string;
  hoverId?: string;
  banner?: { title: string; detail: string };
  caption: string;
}

export const CATALOG_SIZE = ALL_DEMO_PLUGINS.length;

/**
 * Five frames: the shelf, a search, a connection being made, the result, and
 * the app noticing that a different connection died. The last beat is the point
 * of the section — an assistant that only works while its tokens are alive has
 * to notice when one stops working and say which one.
 *
 * The script loops. The first click hands it over for good.
 */
export const FRAMES: Frame[] = [
  {
    duration: 2200,
    query: "",
    filter: "all",
    plugins: ALL_DEMO_PLUGINS,
    caption:
      "The whole catalog: twenty-four services, two of them connected here.",
  },
  {
    duration: 2000,
    query: "google",
    filter: "all",
    plugins: GOOGLE_HITS,
    caption:
      "Searching for “google” narrows the list to Gmail, Google Drive and Google Calendar.",
  },
  {
    duration: 1000,
    query: "google",
    filter: "all",
    plugins: GOOGLE_HITS,
    busyId: "gmail",
    hoverId: "gmail",
    caption: "Connecting Gmail.",
  },
  {
    duration: 1800,
    query: "google",
    filter: "all",
    plugins: [
      { ...byId("gmail"), status: "connected", live: true },
      byId("google_drive"),
      byId("google_calendar"),
    ],
    hoverId: "gmail",
    caption: "Gmail is connected and answering.",
  },
  {
    duration: 3200,
    query: "",
    filter: "all",
    plugins: ALL_DEMO_PLUGINS.map((p) =>
      p.id === "spotify"
        ? {
            ...p,
            status: "needs_reauth" as const,
            live: false,
            reason: "The provider withdrew the authorization",
          }
        : p.id === "gmail"
          ? { ...p, status: "connected" as const, live: true }
          : p,
    ),
    banner: {
      title: "Spotify needs reconnecting",
      detail: "The provider withdrew the authorization — reconnect to keep it working.",
    },
    caption:
      "A warning above the list: Spotify needs reconnecting because the provider withdrew the authorization.",
  },
];

export const DEMO_DESCRIPTION = [
  "A demo of the app's Plugins section.",
  ...FRAMES.map((f) => f.caption),
].join(" ");
