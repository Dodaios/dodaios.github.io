/**
 * YouTubeMark — the YouTube mark.
 *
 * Source and licence are recorded in docs/LOGOS.md. Every colour is stripped,
 * so the mark inherits the surrounding text colour through `currentColor` and
 * needs no second asset for dark mode.
 *
 * Not part of `marks.ts`. That list is the connection strip — the services
 * Dodaios itself talks to — and YouTube is not one of them. It labelled the
 * stat row of the "Built in public" section, retired on 2026-10-19, and has
 * no user on the page today.
 */
export function YouTubeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
