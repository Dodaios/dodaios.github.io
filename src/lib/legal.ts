/**
 * Who runs this site, and the facts the two legal pages state about it.
 *
 * ONE PLACE FOR THE OPERATOR'S IDENTITY. The imprint and the privacy policy
 * both name the operator; keeping the details here means a move or a new
 * address is one edit, and the two pages can never disagree.
 *
 * Every data flow the privacy policy describes is read from the code, not
 * assumed — see the comment on each entry in src/pages/privacy.astro. If the
 * site starts calling a new service, that page changes in the same commit.
 */

export const OPERATOR = {
  name: "Ruben Samuel Lütke",
  street: "Bahnhofstraße 27",
  city: "86666 Burgheim",
  country: "Germany",
  /* A Cloudflare Email Routing address on the site's own domain, forwarded
     to the operator's inbox, so the published contact is not a personal
     mailbox. */
  email: "contact@dodaios.ai",
} as const;

/** The date the legal texts were last reviewed against the code. */
export const LEGAL_UPDATED = "11 November 2026";

export const IMPRINT_HREF = "/imprint";
export const PRIVACY_HREF = "/privacy";
export const CODE_SIGNING_HREF = "/code-signing";
