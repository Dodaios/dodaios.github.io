/**
 * The app's long class strings for rendered Markdown, copied verbatim from its
 * running markup and source: the lead's bubbles (agentchat/AgentTimeline), a
 * thread turn (agentic/threads/ThreadTimeline: PROSE with THREAD_MEDIA) and an
 * agent's chat bubble (agentchat/MessengerTurn: the same, without padding).
 * Kept apart so the views that use them stay readable.
 */
export const PROSE_LEAD =
  "prose prose-neutral max-w-none text-[15px] leading-[25px] text-foreground dark:prose-invert dark:text-foreground [overflow-wrap:anywhere] [&>div>:first-child]:mt-0 [&>div>:last-child]:mb-0 prose-p:my-2.5 prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground-strong prose-headings:mb-1.5 prose-headings:mt-5 prose-headings:font-semibold prose-headings:tracking-normal prose-headings:text-foreground-strong prose-h1:text-[17px] prose-h1:leading-[25px] prose-h2:text-[16px] prose-h2:leading-[25px] prose-h3:text-[15px] prose-h3:leading-[25px] prose-h4:text-[15px] prose-a:text-foreground-strong prose-a:underline prose-a:decoration-border-strong prose-a:underline-offset-2 prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.85em] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden prose-pre:my-2.5 prose-pre:bg-card prose-pre:text-[13px] prose-pre:leading-[20px] prose-li:my-1 prose-ul:my-2.5 prose-ol:my-2.5 prose-ul:pl-5 prose-ol:pl-5 prose-li:pl-1 prose-hr:my-5 prose-table:my-3 prose-table:text-[14px] prose-table:leading-[21px] prose-thead:text-foreground-strong prose-th:text-foreground-strong prose-td:text-foreground";

/** `PROSE` in ThreadTimeline.tsx: 15 px on a 21 px line. */
const PROSE =
  "prose prose-neutral max-w-none text-[15px] leading-[21px] text-foreground/95 dark:prose-invert dark:text-foreground/95 [overflow-wrap:anywhere] [&>div>:first-child]:mt-0 [&>div>:last-child]:mb-0 prose-p:my-2.5 prose-p:leading-[21px] prose-p:text-foreground/95 prose-li:text-foreground/95 prose-strong:font-semibold prose-strong:text-foreground-strong prose-headings:mb-1.5 prose-headings:mt-4 prose-headings:font-semibold prose-headings:tracking-normal prose-headings:text-foreground-strong prose-h1:text-lg prose-h2:text-base prose-h3:text-[15px] prose-h4:text-[15px] prose-a:text-foreground-strong prose-a:underline prose-a:decoration-border-strong prose-a:underline-offset-2 prose-code:rounded-[4px] prose-code:bg-foreground/[0.075] prose-code:px-1 prose-code:py-px prose-code:font-mono prose-code:text-[0.9em] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden prose-pre:my-2.5 prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-card prose-pre:text-sm prose-li:my-1 prose-li:leading-[21px] prose-ul:my-2.5 prose-ol:my-2.5 prose-ul:pl-5 prose-ol:pl-5 prose-table:my-3 prose-table:text-sm prose-th:text-foreground-strong prose-td:text-foreground";

/** `THREAD_MEDIA` in ThreadTimeline.tsx. */
const THREAD_MEDIA =
  "[&_[data-kind=image]_img]:max-h-48 [&_[data-kind=image]_img]:max-w-sm [&_[data-kind=image]_img]:border [&_[data-kind=image]_img]:border-border";

export const PROSE_THREAD = `${PROSE} ${THREAD_MEDIA}`;

export const PROSE_AGENT = `${PROSE} ${THREAD_MEDIA} py-0`;
