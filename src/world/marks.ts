/**
 * The layout of the marks' sprite sheet (src/pages/world/marks.svg.ts), shared
 * by the page that builds it and the scene that reads it.
 */
export const MARK_SHEET_COLUMNS = 10;
/** Edge of one square cell, in the sheet's own units. */
export const MARK_SHEET_CELL = 256;

/**
 * The marks that stand for command-line tools (src/data/app-catalog.json,
 * "clis"), by the name they carry in src/components/logos/marks.ts. They ride
 * the third orbit; every mark rides the first.
 */
export const CLI_MARKS: readonly string[] = [
  "AWS",
  "Microsoft Azure",
  "Cloudflare",
  "Docker",
  "Firebase",
  "Fly.io",
  "GitHub",
  "GitLab",
  "Google Cloud",
  "Google Workspace",
  "Heroku",
  "Kubernetes",
  "Neon",
  "Netlify",
  "PlanetScale",
  "Railway",
  "Render",
  "Stripe",
  "Supabase",
  "Twilio",
  "Vercel",
];
