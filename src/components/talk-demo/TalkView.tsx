/**
 * The "Code by talking" window — pure. Props in, markup out.
 *
 * The Agentic IDE with three panes and the voice bar under them. The panes are
 * the evidence: a sentence is spoken at the bottom, and the pane it named picks
 * the work up a beat later with a brief Dodaios wrote for it.
 *
 * Every measurement is a design pixel against the shared 1440 canvas.
 * See docs/feature-section.md.
 */

import {
  CANVAS_WIDTH,
  FEATURE_CANVAS_HEIGHT,
  HAIRLINE,
  RADIUS,
  STROKE,
  WindowChrome,
  WindowHeader,
} from "@/components/window-demo/chrome";
import { PANES, type Frame, type Pane, type PaneState, type PaneStatus } from "./frames";

export { CANVAS_WIDTH };
/** Same height as the other feature windows, so the cards read as views of
 *  one application. */
export const CANVAS_HEIGHT = FEATURE_CANVAS_HEIGHT;

const STATUS_LABEL: Record<PaneStatus, string> = {
  idle: "Idle",
  working: "Working",
  done: "Done",
};

const STATUS_COLOR: Record<PaneStatus, string> = {
  idle: "var(--muted-soft)",
  working: "var(--ink)",
  done: "var(--success)",
};

function MicIcon() {
  return (
    <svg width={34} height={34} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <rect x={9} y={3} width={6} height={11} rx={3} />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PaneView({
  pane,
  state,
  highlighted,
  wide,
}: {
  pane: Pane;
  state: PaneState;
  highlighted: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={highlighted ? "talk-pane talk-pane--hit" : "talk-pane"}
      style={{
        gridColumn: wide ? "1 / span 2" : undefined,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        border: `${HAIRLINE}px solid ${highlighted ? "var(--ink)" : "var(--hairline)"}`,
        borderRadius: RADIUS,
        background: "var(--canvas)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "16px 24px",
          borderBottom: `${HAIRLINE}px solid var(--hairline)`,
          background: "var(--canvas-soft)",
        }}
      >
        <span
          style={{
            padding: "4px 14px",
            borderRadius: 10,
            background: "var(--ink)",
            color: "var(--on-ink)",
            fontSize: 26,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
          }}
        >
          {pane.sign}
        </span>
        <span style={{ fontSize: 28, color: "var(--ink)", fontWeight: 500 }}>{pane.agent}</span>
        <span style={{ flex: 1 }} />
        <span
          className={state.status === "working" ? "talk-dot talk-dot--pulse" : "talk-dot"}
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            background: STATUS_COLOR[state.status],
          }}
        />
        <span style={{ fontSize: 26, color: "var(--muted)" }}>{STATUS_LABEL[state.status]}</span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "20px 24px",
          fontFamily: "var(--font-mono)",
          fontSize: 25,
          lineHeight: 1.5,
          color: "var(--body)",
          overflow: "hidden",
        }}
      >
        {state.brief ? (
          <div key={state.brief} className="talk-brief" style={{ color: "var(--ink)", marginBottom: 10 }}>
            <span style={{ color: "var(--muted)" }}>&gt; </span>
            {state.brief}
          </div>
        ) : (
          <div style={{ color: "var(--muted-soft)" }}>Waiting for work</div>
        )}
        {state.lines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: line.startsWith("FAILED")
                ? "var(--error)"
                : /\bpassed\b/.test(line) && !/failed/.test(line)
                  ? "var(--success)"
                  : undefined,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TalkView({
  frame,
  typed,
  animate,
}: {
  frame: Frame;
  /** How many characters of the spoken sentence are visible. */
  typed: number;
  animate: boolean;
}) {
  const sentence = frame.say ? frame.say.slice(0, typed) : "";
  const speaking = Boolean(frame.say) && typed < (frame.say?.length ?? 0);

  return (
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans)",
        background: "var(--card)",
      }}
    >
      <WindowChrome title="Dodaios · acme-notes" />

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 32, padding: "40px 48px" }}>
        <WindowHeader title="Agentic IDE" subtitle="3 agents · voice on" />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 24,
          }}
        >
          {PANES.map((pane, i) => (
            <PaneView
              key={pane.sign}
              pane={pane}
              state={frame.panes[pane.sign]}
              highlighted={animate && frame.delivered === pane.sign}
              wide={i === 2}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            height: 104,
            flexShrink: 0,
            padding: "0 28px",
            border: `${HAIRLINE}px solid var(--hairline-strong)`,
            borderRadius: 999,
            background: "var(--canvas-soft)",
          }}
        >
          <span
            className={speaking && animate ? "talk-mic talk-mic--live" : "talk-mic"}
            style={{
              width: 64,
              height: 64,
              flexShrink: 0,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: "var(--ink)",
              color: "var(--on-ink)",
            }}
          >
            <MicIcon />
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 34,
              color: sentence ? "var(--ink)" : "var(--muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {sentence ? `“${sentence}${speaking ? "" : "”"}` : "Listening…"}
          </span>
          {frame.delivered && !speaking && (
            <span
              key={frame.delivered}
              className="talk-receipt"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
                fontSize: 26,
                color: "var(--success)",
              }}
            >
              <TickIcon />
              Delivered to {frame.delivered}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
