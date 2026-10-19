/**
 * The repository browser — pure. A frame in, a window out.
 *
 * A browser window on github.com, drawn in THIS page's palette rather than
 * GitHub's. That is not a shortcut: a pixel copy of another product's interface
 * is a picture of their brand sitting in the middle of ours, and the section's
 * job is to say "the code is public and you can read it", not to reproduce a
 * competitor's canvas colour. Structure is theirs — the tab row, the About box,
 * the file table, the blob view with its line numbers — because that structure
 * is what makes a visitor recognise where they are. Everything paints from
 * `tokens.css`, so the window sits in the page instead of on it.
 *
 * ## Design pixels
 *
 * Every measurement below is against the 1440x880 canvas, which renders at
 * roughly 0.84x on a desktop content column — so a design pixel is a little
 * over one real pixel and the numbers read close to their rendered size. That
 * ratio is nothing like the feature demos' 0.4x, which is why this file does
 * NOT use their `HAIRLINE = 2` and `RADIUS = 18` constants: at this scale those
 * would draw a two-pixel border and a fifteen-pixel radius. See
 * docs/feature-section.md for the technique.
 *
 * ## The table runs off the bottom, and that is the point
 *
 * A repository root has sixty-four entries and the window shows twelve. Nothing
 * fades them out and nothing counts them off: the table simply continues past
 * the bottom edge and the window clips it, which is exactly what a browser
 * viewport does with a long page. A fade would be this file inventing a
 * boundary the real page does not have.
 */

import { GitHubMark } from "@/components/logos/GitHubMark";
import {
  BRANCH,
  DESCRIPTION,
  FILE,
  FORKS,
  LANGUAGE,
  LAST_COMMIT,
  LICENSE,
  OPEN_ISSUES,
  REPO,
  STARS,
  TOPICS,
  ordered,
  type Frame,
} from "./frames";
import { useLiveRepoCounts } from "./useLiveRepoCounts";

export const CANVAS_WIDTH = 1440;
export const CANVAS_HEIGHT = 880;

/* --- The one layout, in design pixels ------------------------------------
 *
 * Named rather than inlined because the pointer has to land on a row, and a
 * pointer whose y is a second copy of the row geometry is a pointer that drifts
 * off its row the first time a row gets taller. `rowCentre` below is the only
 * place the two meet.
 */
const PAD = 40;
const CHROME_H = 60;
const BAR_H = 112;
const BODY_TOP = CHROME_H + BAR_H;
const BODY_PAD = 28;
const BRANCH_H = 40;
const BRANCH_GAP = 18;
const TABLE_TOP = BODY_TOP + BODY_PAD + BRANCH_H + BRANCH_GAP;
const TABLE_HEAD_H = 52;
const ROW_H = 44;
const ROWS_DRAWN = 14;
const SIDE_W = 400;
const MAIN_W = CANVAS_WIDTH - 2 * PAD - SIDE_W - PAD;

const HAIRLINE = "1px solid var(--hairline)";
const HAIRLINE_SOFT = "1px solid var(--hairline-soft)";

/** Where the pointer sits when it is resting on the row at `index`. */
function rowCentre(index: number): [number, number] {
  return [PAD + 150, TABLE_TOP + TABLE_HEAD_H + index * ROW_H + ROW_H / 2];
}

/** Where it sits when it is resting on the breadcrumb's repository link. */
const CRUMB_POINT: [number, number] = [PAD + 190, BODY_TOP + BODY_PAD + BRANCH_H / 2];

/**
 * Off the bottom edge, for a frame with nothing to point at.
 *
 * OUT of the window and not merely away from the rows: the file beat is the one
 * frame with something to read, and a pointer parked in the empty space under
 * the code box sits there for four and a half seconds looking like it meant to
 * click something. Sending it past the edge reads as the hand letting go, and
 * the travel out is the same 900ms as every other move.
 */
const RESTING_POINT: [number, number] = [PAD + 60, CANVAS_HEIGHT + 30];

// --- Icons ----------------------------------------------------------------

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function FolderIcon() {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6l2 2.4H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="m12 4 2.5 5.1 5.5.8-4 3.9.9 5.6L12 16.8 7.1 19.4l.9-5.6-4-3.9 5.5-.8Z" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <circle cx={7} cy={5} r={2.2} />
      <circle cx={17} cy={5} r={2.2} />
      <circle cx={12} cy={19} r={2.2} />
      <path d="M7 7.2v2.3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7.2M12 11.5v5.3" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6Z" />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M12 4v16M7 7h10M5 20h14" />
      <path d="m7 7-3 6h6ZM17 7l-3 6h6Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x={5} y={11} width={14} height={9} rx={2} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** The pointer. Filled with the ink and outlined in the ground, so it stays
 *  legible over a row that is highlighted and over one that is not. */
function Pointer() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 3.5 18.5 12l-5.6 1.1L10 19Z"
        fill="var(--ink)"
        stroke="var(--canvas)"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Pieces ---------------------------------------------------------------

/** The browser's own chrome: three dots and the address the visit is on. */
function BrowserChrome({ path }: { path: string }) {
  return (
    <div
      style={{
        height: CHROME_H,
        borderBottom: HAIRLINE,
        background: "var(--canvas-soft)",
        display: "flex",
        alignItems: "center",
        padding: `0 ${PAD}px`,
        position: "relative",
      }}
    >
      <span style={{ display: "flex", gap: 9 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: 999,
              background: "var(--hairline-strong)",
            }}
          />
        ))}
      </span>

      <span
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          width: 760,
          height: 34,
          borderRadius: 999,
          border: HAIRLINE,
          background: "var(--surface-card)",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 16px",
          fontSize: 16,
          color: "var(--muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ color: "var(--muted-soft)", display: "flex" }}>
          <LockIcon />
        </span>
        github.com
        {/* The path in ink, the host in muted — which is the one piece of a
            real address bar's emphasis that says where you actually are. */}
        <span style={{ color: "var(--ink)" }}>{path}</span>
      </span>
    </div>
  );
}

function CountPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      style={{
        height: 32,
        padding: "0 13px",
        borderRadius: 8,
        border: HAIRLINE,
        background: "var(--surface-card)",
        color: "var(--body)",
        fontSize: 15,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * GitHub's page header: who the repository is, and its tab row.
 *
 * `Code` is the only tab in ink with a rule under it, because that is the tab
 * every frame here is on — the demo never opens Issues, and an active state on
 * a tab the walkthrough does not visit would be a lie the eye picks up.
 */
function RepoHeader({ crumbHover }: { crumbHover: boolean }) {
  const [owner, name] = REPO.split("/");
  const { stars, forks } = useLiveRepoCounts(REPO, { stars: STARS, forks: FORKS });
  return (
    <div style={{ height: BAR_H, borderBottom: HAIRLINE, padding: `0 ${PAD}px` }}>
      <div style={{ height: 60, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--muted)", display: "flex" }}>
          <GitHubMark className="gh-mark" />
        </span>
        <span style={{ fontSize: 23, color: "var(--muted)" }}>
          {owner}
          <span style={{ padding: "0 6px", color: "var(--muted-soft)" }}>/</span>
          <span
            className={crumbHover ? "gh-link gh-link--hot" : "gh-link"}
            style={{ color: "var(--ink)", fontWeight: 600 }}
          >
            {name}
          </span>
        </span>
        <span
          style={{
            height: 26,
            padding: "0 11px",
            borderRadius: 999,
            border: HAIRLINE,
            color: "var(--muted)",
            fontSize: 14,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Public
        </span>

        <span style={{ flex: 1 }} />

        <CountPill icon={<StarIcon />} label={`Star ${stars}`} />
        <CountPill icon={<ForkIcon />} label={`Fork ${forks}`} />
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 30, height: 52 }}>
        {[
          { label: "Code", count: null as number | null, active: true },
          { label: "Issues", count: OPEN_ISSUES, active: false },
          { label: "Pull requests", count: null, active: false },
          { label: "Actions", count: null, active: false },
          { label: "Security", count: null, active: false },
          { label: "Insights", count: null, active: false },
        ].map((tab) => (
          <span
            key={tab.label}
            style={{
              paddingBottom: 12,
              fontSize: 17,
              color: tab.active ? "var(--ink)" : "var(--muted)",
              fontWeight: tab.active ? 500 : 400,
              borderBottom: tab.active ? "2px solid var(--ink)" : "2px solid transparent",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {tab.label}
            {tab.count !== null && (
              <span
                style={{
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: "var(--surface-strong)",
                  color: "var(--body)",
                  fontSize: 13,
                }}
              >
                {tab.count}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The branch pill, the path, and the button every GitHub page carries. */
function BranchBar({ crumbs, crumbHover }: { crumbs: string[]; crumbHover: boolean }) {
  const [, name] = REPO.split("/");
  return (
    <div style={{ height: BRANCH_H, display: "flex", alignItems: "center", gap: 14 }}>
      <span
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 8,
          border: HAIRLINE,
          background: "var(--surface-card)",
          color: "var(--body)",
          fontSize: 15,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {BRANCH}
        <span style={{ color: "var(--muted-soft)", fontSize: 11 }}>&#9660;</span>
      </span>

      <span style={{ fontSize: 19, color: "var(--muted)" }}>
        <span
          className={crumbHover ? "gh-link gh-link--hot" : "gh-link"}
          style={{ color: crumbs.length ? "var(--body)" : "var(--ink)", fontWeight: 600 }}
        >
          {name}
        </span>
        {crumbs.map((crumb, i) => (
          <span key={crumb}>
            <span style={{ padding: "0 7px", color: "var(--muted-soft)" }}>/</span>
            <span
              style={{
                color: i === crumbs.length - 1 ? "var(--ink)" : "var(--body)",
                fontWeight: 600,
              }}
            >
              {crumb}
            </span>
          </span>
        ))}
      </span>

      <span style={{ flex: 1 }} />

      <span
        style={{
          height: 32,
          padding: "0 15px",
          borderRadius: 8,
          background: "var(--ink)",
          color: "var(--on-ink)",
          fontSize: 15,
          fontWeight: 500,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        Code
        <span style={{ fontSize: 11 }}>&#9660;</span>
      </span>
    </div>
  );
}

/** The date under the tip commit, absolute — a relative one is true for an hour. */
function stamp(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The file table.
 *
 * Its header row is the repository's tip commit, the way github.com's is: the
 * short sha, the subject line, and the date it landed. It is the one part of a
 * listing that says the repository is alive rather than parked.
 */
function FileTable({ entries, hover }: { entries: { name: string; type: string }[]; hover?: string }) {
  return (
    <div
      style={{
        border: HAIRLINE,
        borderRadius: 12,
        background: "var(--surface-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: TABLE_HEAD_H,
          background: "var(--canvas-soft)",
          borderBottom: HAIRLINE,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 18px",
          fontSize: 15,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
          {LAST_COMMIT.sha}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--body)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {LAST_COMMIT.message}
        </span>
        <span style={{ color: "var(--muted)", flexShrink: 0 }}>
          {stamp(LAST_COMMIT.date)}
        </span>
      </div>

      {entries.slice(0, ROWS_DRAWN).map((entry, i) => (
        <div
          key={entry.name}
          className="gh-row"
          data-hovered={entry.name === hover ? "true" : undefined}
          style={{
            height: ROW_H,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 18px",
            borderTop: i === 0 ? undefined : HAIRLINE_SOFT,
          }}
        >
          <span
            style={{
              color: entry.type === "dir" ? "var(--muted)" : "var(--muted-soft)",
              display: "flex",
            }}
          >
            {entry.type === "dir" ? <FolderIcon /> : <FileIcon />}
          </span>
          <span
            style={{
              fontSize: 17,
              color: entry.type === "dir" ? "var(--ink)" : "var(--body)",
            }}
          >
            {entry.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The About box: what the repository says about itself, and nothing else. */
function About() {
  const { stars, forks } = useLiveRepoCounts(REPO, { stars: STARS, forks: FORKS });
  return (
    <div style={{ width: SIDE_W }}>
      <p style={{ fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>About</p>

      <p
        style={{
          marginTop: 12,
          fontSize: 16,
          lineHeight: 1.55,
          color: "var(--body)",
        }}
      >
        {DESCRIPTION}
      </p>

      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TOPICS.map((topic) => (
          <span
            key={topic}
            style={{
              height: 26,
              padding: "0 11px",
              borderRadius: 999,
              background: "var(--surface-strong)",
              color: "var(--body)",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {topic}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 22, display: "grid", gap: 13 }}>
        {[
          { icon: <BookIcon />, label: "Readme" },
          { icon: <ScaleIcon />, label: `${LICENSE} license` },
          { icon: <StarIcon />, label: `${stars} stars` },
          { icon: <ForkIcon />, label: `${forks} forks` },
        ].map((row) => (
          <span
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 16,
              color: "var(--body)",
            }}
          >
            <span style={{ color: "var(--muted)", display: "flex" }}>{row.icon}</span>
            {row.label}
          </span>
        ))}

        <span
          style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, color: "var(--body)" }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: 999,
              background: "var(--ink)",
              flexShrink: 0,
            }}
          />
          {LANGUAGE}
        </span>
      </div>
    </div>
  );
}

/**
 * The blob view: one file, with its line numbers.
 *
 * The line that fetches this very script is marked — a band of the raised
 * surface behind it, no colour. It is the sentence the whole section is built
 * around ("read it before you run it"), and it is also the exact line printed
 * one section further down the page, so a visitor can see that the two agree.
 */
function Blob() {
  const name = FILE.path.split("/").pop();
  const marked = FILE.lines.findIndex((line: string) => line.includes("| iex"));

  return (
    <div
      style={{
        border: HAIRLINE,
        borderRadius: 12,
        background: "var(--surface-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: TABLE_HEAD_H,
          background: "var(--canvas-soft)",
          borderBottom: HAIRLINE,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 18px",
          fontSize: 15,
        }}
      >
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{name}</span>
        <span style={{ color: "var(--muted)" }}>{FILE.totalLines} lines</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--muted)" }}>Raw</span>
        <span style={{ color: "var(--muted)" }}>Blame</span>
      </div>

      <div style={{ padding: "10px 0" }}>
        {FILE.lines.map((line: string, i: number) => (
          <div
            key={i}
            style={{
              display: "flex",
              minHeight: 27,
              background: i === marked ? "var(--surface-strong)" : undefined,
            }}
          >
            <span
              style={{
                width: 66,
                flexShrink: 0,
                textAlign: "right",
                paddingRight: 18,
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                lineHeight: "27px",
                color: "var(--muted-soft)",
                userSelect: "none",
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 15,
                lineHeight: "27px",
                whiteSpace: "pre",
                /* A comment file: the ink is reserved for the one line that is
                   a command, so the eye lands on it without a colour. */
                color: i === marked ? "var(--ink)" : "var(--body)",
              }}
            >
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- The window -----------------------------------------------------------

export function GitHubView({ frame, animate }: { frame: Frame; animate: boolean }) {
  const entries = ordered(frame.page);
  /* The in-page breadcrumb, read off the address the frame is on rather than
     kept as a second field beside it: two spellings of one path are two things
     that can disagree, and the address bar is the one the reader can check. */
  const crumbs =
    frame.view === "blob"
      ? FILE.path.split("/")
      : frame.page === "root"
        ? []
        : [frame.path.split("/").pop()!];

  const hoverIndex = frame.hover
    ? entries.slice(0, ROWS_DRAWN).findIndex((e) => e.name === frame.hover)
    : -1;

  const [px, py] =
    hoverIndex >= 0
      ? rowCentre(hoverIndex)
      : frame.hoverCrumb
        ? CRUMB_POINT
        : RESTING_POINT;

  return (
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        position: "relative",
        background: "var(--canvas)",
        overflow: "hidden",
      }}
    >
      <BrowserChrome path={frame.path} />
      <RepoHeader crumbHover={Boolean(frame.hoverCrumb)} />

      <div
        key={`${frame.view}-${frame.page}`}
        className={animate ? "gh-body gh-body--fade" : "gh-body"}
        style={{ padding: `${BODY_PAD}px ${PAD}px 0`, display: "flex", gap: PAD }}
      >
        <div style={{ width: frame.view === "blob" ? MAIN_W + PAD + SIDE_W : MAIN_W }}>
          <BranchBar crumbs={crumbs} crumbHover={Boolean(frame.hoverCrumb)} />
          <div style={{ height: BRANCH_GAP }} />
          {frame.view === "blob" ? (
            <Blob />
          ) : (
            <FileTable entries={entries} hover={frame.hover} />
          )}
        </div>

        {frame.view === "tree" && <About />}
      </div>

      {/*
        The pointer, moved by a transform rather than by `top`/`left`: it is the
        one thing on this canvas that moves every few seconds, and a transform
        is the only way to move it without the browser laying the window out
        again on every frame of the travel.
      */}
      <span
        className={animate ? "gh-pointer gh-pointer--travel" : "gh-pointer"}
        style={{ transform: `translate3d(${px}px, ${py}px, 0)` }}
      >
        <Pointer />
      </span>
    </div>
  );
}
