import * as React from "react";
import {
  ELEV_3D,
  ELEV_RANGE,
  YAW_3D,
  YAW_RANGE,
  barHeight,
  buildGrid,
  camera,
  computeStats,
  dayMs,
  easeInOutCubic,
  lerp,
  mixRGB,
  monthLabels,
  project,
  riseAt,
  smoothstep,
  type Cam,
  type ContributionDay,
  type RGB,
} from "./model";
import { trackProgress } from "@/lib/scrollSpan";

/**
 * Commit Skyline — a year of commits as a heat map that folds up into an
 * isometric skyline, and back down again.
 *
 * It is one scene, not two charts. Every day is a box on a grid; the flat view
 * is that grid seen straight down, the 3D view is the same grid seen from the
 * corner. Switching views swings one camera between the two while each week's
 * bars rise (or settle) in a wave from the oldest week to the newest. The 3D
 * view rises out of the flat one the first time it scrolls into sight.
 *
 * IN A PINNED SECTION THE SCROLL DRIVES IT. Inside a `[data-scroll-span]`
 * track whose `[data-viewport]` is sticky, the morph is a function of how far
 * the reader is through the pause (see `SCRUB`): the calendar holds, the
 * skyline rises week by week, then the camera turns once round it. Scrolling
 * back runs it backwards, standing still stands it still. Where the section
 * does not pin — narrow, short or reduced motion — it falls back to the
 * one-time rise above. The toggle still works in both; in a pinned section it
 * holds until the reader next scrolls.
 *
 * IT IS LIVE. The built year is the first paint; the browser then asks GitHub
 * for the commits since the last stored day and adds them, and asks again
 * every few minutes while the tab is visible (see `topUp`).
 *
 * Hover or tap a day for its count, arrow keys walk the grid, hover a legend
 * swatch to isolate that level, and in 3D drag to orbit (double-click resets).
 *
 * ADAPTED, NOT COPIED AS IS. The source was a community component the
 * maintainer supplied on 2026-10-19 (see model.ts). For this site:
 *
 *   colour   ink and paper only. The five levels are the site's own tokens,
 *            read from `:root` at runtime so this file names no hex value —
 *            the empty floor, then `--hairline-strong`, `--muted-soft`,
 *            `--body` and `--ink`. No green, no palettes, no light theme: the
 *            site has one dark ground (docs/design.md).
 *   depth    no shadow on the tooltip; this system has none (check-style).
 *   type     figures at weight 400, like every display figure on the page.
 *   data     real only. No generated sample year; an empty `data` draws an
 *            empty year rather than an invented one.
 */

type View = "2d" | "3d";

export interface CommitSkylineProps {
  /** One entry per day, `YYYY-MM-DD`. */
  data: ContributionDay[];
  /** Last day shown. Defaults to the latest date in `data`. */
  endDate?: string;
  /** Uncontrolled starting view. */
  defaultView?: View;
  /** Morph length, ms. */
  duration?: number;
  locale?: string;
  /** `owner/name`. With it the year is topped up live from GitHub and the caption names it. */
  repo?: string;
  /** When `data` was read, ISO. Named in the caption until a live read replaces it. */
  readAt?: string;
}

/**
 * How the pinned span is spent, as fractions of it.
 *
 *   0 → hold       the calendar, flat, so the reader sees what is about to rise
 *   hold → rise    the skyline rises, oldest week first
 *   rise → 1       the camera turns a little and closes in on the weeks that
 *                  have commits, so the finished skyline fills the frame
 *                  instead of sharing it with the empty months before it
 *
 * `follow` is how quickly the picture catches the scroll position, per second:
 * a wheel moves in steps, and a picture that jumps with each one reads as
 * broken rather than driven.
 */
const SCRUB = { hold: 0.1, rise: 0.58, yawFrom: -0.3, yawTo: 0.08, elevDip: -0.08, follow: 9 };

/** Minutes between live reads while the tab is visible. */
const LIVE_EVERY_MIN = 5;
/** Pages of a hundred a live read may take before it gives up and keeps the build. */
const LIVE_MAX_PAGES = 5;

const nextLink = (link: string | null) => /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;

/**
 * The commits on `main` since `fromDay`, counted per UTC day of their committer
 * date — the same rule scripts/fetch-commit-activity.mjs counts the build by,
 * so the two join without a seam. `null` when GitHub cannot be asked or there
 * is more to catch up on than a visit should fetch; the build then stands.
 */
async function topUp(repo: string, fromDay: string, signal: AbortSignal): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  let url: string | null =
    `https://api.github.com/repos/${repo}/commits?sha=main&per_page=100&since=${fromDay}T00:00:00Z`;
  for (let page = 0; url; page++) {
    if (page >= LIVE_MAX_PAGES) return null;
    const res: Response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, signal });
    if (!res.ok) return null;
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return null;
    for (const c of list) {
      const when = c?.commit?.committer?.date;
      if (typeof when !== "string") continue;
      const day = when.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    url = nextLink(res.headers.get("link"));
  }
  return counts;
}

const UNIT = "commit";
const PLURAL = "commits";
const LEVEL_TOKENS = ["--hairline-strong", "--muted-soft", "--body", "--ink"];
const FG_FALLBACK: RGB = [247, 247, 244];
const BG_FALLBACK: RGB = [6, 6, 5];

const MUTED = "var(--muted)";
const INK = "var(--ink)";
const LINE = "var(--hairline)";

// Any CSS colour → sRGB, by letting the browser paint it.
let probe: CanvasRenderingContext2D | null = null;
const toRGB = (color: string, fallback: RGB): RGB => {
  if (!color) return fallback;
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "rgba(0,0,0,0)";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  if (d[3] < 8) return fallback;
  return [d[0], d[1], d[2]];
};

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const rgbString = (r: number, g: number, b: number) =>
  "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";

const pointInQuad = (p: Float32Array, o: number, x: number, y: number): boolean => {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const ax = p[o + k * 2];
    const ay = p[o + k * 2 + 1];
    const bx = p[o + ((k + 1) % 4) * 2];
    const by = p[o + ((k + 1) % 4) * 2 + 1];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
};

const quadPath = (ctx: CanvasRenderingContext2D, p: Float32Array, o: number, r: number) => {
  if (r < 0.3) {
    ctx.moveTo(p[o], p[o + 1]);
    ctx.lineTo(p[o + 2], p[o + 3]);
    ctx.lineTo(p[o + 4], p[o + 5]);
    ctx.lineTo(p[o + 6], p[o + 7]);
    ctx.closePath();
    return;
  }
  ctx.moveTo((p[o + 6] + p[o]) / 2, (p[o + 7] + p[o + 1]) / 2);
  for (let k = 0; k < 4; k++) {
    const b = (k + 1) % 4;
    ctx.arcTo(p[o + k * 2], p[o + k * 2 + 1], p[o + b * 2], p[o + b * 2 + 1], r);
  }
  ctx.closePath();
};

const GridIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
    <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
    <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" fill="currentColor" />
    <rect x="9" y="9" width="5.5" height="5.5" rx="1" fill="currentColor" />
  </svg>
);

const CubeIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M8 1.2 14.2 4.6v6.8L8 14.8 1.8 11.4V4.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M1.8 4.6 8 8l6.2-3.4M8 8v6.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

function Stat({
  label,
  value,
  unit,
  sub,
  size,
  align,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  size: number;
  align: "start" | "end" | "stack";
}) {
  if (align === "stack") {
    return (
      <div className="min-w-0">
        <div className="text-[13px] leading-tight" style={{ color: MUTED }}>
          {label}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span
            className="tabular-nums"
            style={{ color: INK, fontSize: size, lineHeight: 1, letterSpacing: "-0.02em", fontWeight: 400 }}
          >
            {value}
          </span>
          <span className="text-[14px]">{unit}</span>
        </div>
        <div className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>
          {sub}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[auto_auto] items-end gap-x-2" style={{ justifyContent: align }}>
      {align === "end" ? (
        <>
          <div className="text-right text-[13px] leading-tight" style={{ color: MUTED }}>
            {label}
          </div>
          <div />
        </>
      ) : (
        <div className="col-span-2 text-[13px] leading-tight" style={{ color: MUTED }}>
          {label}
        </div>
      )}
      <div
        className="text-right tabular-nums"
        style={{ color: INK, fontSize: size, lineHeight: 0.95, letterSpacing: "-0.02em", fontWeight: 400 }}
      >
        {value}
      </div>
      <div className="pb-[0.15em] leading-tight">
        <div className="text-[15px]">{unit}</div>
        <div className="whitespace-nowrap text-[13px]" style={{ color: MUTED }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

export default function CommitSkyline({
  data,
  endDate,
  defaultView = "3d",
  duration = 1300,
  locale = "en-GB",
  repo,
  readAt,
}: CommitSkylineProps) {
  const heightScale = 1;
  const orbit = true;
  const weekStart = 0;

  // The built year, then the same year with today's commits added by `topUp`.
  const [days, setDays] = React.useState(data);
  const [liveAt, setLiveAt] = React.useState<number | null>(null);

  const model = React.useMemo(() => {
    const dates = days.map((d) => dayMs(d.date)).filter(Number.isFinite);
    const end = endDate && liveAt === null ? dayMs(endDate) : dates.length ? Math.max(...dates) : dayMs(new Date());
    const grid = buildGrid(days, end, weekStart);
    return { ...grid, stats: computeStats(grid.cells), months: monthLabels(grid.cells, grid.weeks, locale) };
  }, [days, endDate, liveAt, locale]);

  React.useEffect(() => {
    if (!repo) return;
    const built = data.map((d) => d.date).sort();
    const fromDay = built.length ? built[built.length - 1] : new Date().toISOString().slice(0, 10);
    const ctl = new AbortController();
    let timer = 0;
    let lastRead = 0;
    const read = async () => {
      lastRead = Date.now();
      try {
        const fresh = await topUp(repo, fromDay, ctl.signal);
        if (!fresh) return;
        // Days before the last stored one are the build's; from it on, GitHub's.
        const next = data.filter((d) => d.date < fromDay);
        const today = dayMs(new Date().toISOString().slice(0, 10));
        for (let ms = dayMs(fromDay); ms <= today; ms += 86400000) {
          const date = new Date(ms).toISOString().slice(0, 10);
          next.push({ date, count: fresh.get(date) ?? 0 });
        }
        setDays(next);
        setLiveAt(Date.now());
      } catch {
        /* offline, rate-limited or aborted: the build stands */
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      const wait = Math.max(0, lastRead + LIVE_EVERY_MIN * 60000 - Date.now());
      timer = window.setTimeout(() => read().finally(schedule), wait);
    };
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [repo, data]);

  const [view, setView] = React.useState<View>(defaultView);
  const [scrub, setScrub] = React.useState(false);
  const [swatches, setSwatches] = React.useState<string[]>([]);
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState(-1);
  const [legendLevel, setLegendLevel] = React.useState(-1);
  const [announce, setAnnounce] = React.useState("");

  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  const engine = React.useRef<{
    kick: () => void;
    tipWidth: (w: number) => void;
    reload: () => void;
    manual: () => void;
  } | null>(null);

  const nf = React.useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const df = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }),
    [locale],
  );
  const dfy = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    [locale],
  );
  const dfl = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    [locale],
  );
  const tf = React.useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const noun = (n: number) => (n === 1 ? UNIT : PLURAL);
  const describe = (i: number) => {
    const c = model.cells[i];
    if (!c) return "";
    return (c.count ? nf.format(c.count) + " " + noun(c.count) : "No " + PLURAL) + " on " + dfl.format(dayMs(c.date));
  };

  // Everything the render loop reads, refreshed every render so the loop never closes over stale props.
  const cfg = React.useRef({
    model,
    duration,
    legendLevel,
    target: view === "3d" ? 1 : 0,
    setActive,
    setWidth,
    setSwatches,
    setAnnounce,
    setView,
    setScrub,
    describe,
  });
  cfg.current = {
    model,
    duration,
    legendLevel,
    target: view === "3d" ? 1 : 0,
    setActive,
    setWidth,
    setSwatches,
    setAnnounce,
    setView,
    setScrub,
    describe,
  };

  React.useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    if (!root || !stage || !canvas || !tip) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reduceMq.matches;

    // morph: t is linear time 0 (flat) → 1 (3D); the camera eases it, the bars wave it
    let t = 0;
    let target = 0;
    let entered = false;
    // orbit offsets, eased toward their goals
    let yaw = 0;
    let elev = 0;
    let yawGoal = 0;
    let elevGoal = 0;
    // layout
    let W = 0;
    let H2 = 0;
    let H3 = 0;
    let Hmax = 0;
    let lastH = -1;
    let dpr = 1;
    let gutter = 30;
    let labelW = 30;
    let font = "10px sans-serif";
    // colours: [empty, l1, l2, l3, l4] × rgb
    const col = new Float32Array(15);
    let fg: RGB = FG_FALLBACK;
    let bg: RGB = BG_FALLBACK;
    // cells
    let n = 0;
    let weeks = 0;
    let wk = new Float32Array(0);
    let dy = new Float32Array(0);
    let lv = new Uint8Array(0);
    let hgt = new Float32Array(0);
    let zs = new Float32Array(0);
    let hover = new Float32Array(0);
    let dim = new Float32Array(0);
    let polys = new Float32Array(0);
    let faces = new Uint8Array(0);
    let order: number[] = [];
    let months: { week: number; label: string }[] = [];
    let weekdayRows: { day: number; label: string }[] = [];
    // interaction
    let hovered = -1;
    let pinned = -1;
    let activeIdx = -1;
    let tipW = 0;
    let raf = 0;
    let last = 0;
    // scroll scrub: the pinned track this chart stands in, if it stands in one
    const track = root.closest<HTMLElement>("[data-scroll-span]");
    let scrubbing = false;
    let manual = false;
    let tGoal = 0;
    let ys = 0;
    let es = 0;
    let ysGoal = 0;
    let esGoal = 0;
    // close-in: 0 frames the whole year, 1 frames from `focusWeek` on
    let fz = 0;
    let fzGoal = 0;
    let focusWeek = 0;
    let sentView: View | null = null;

    const load = () => {
      const m = cfg.current.model;
      n = m.cells.length;
      weeks = m.weeks;
      wk = new Float32Array(n);
      dy = new Float32Array(n);
      lv = new Uint8Array(n);
      hgt = new Float32Array(n);
      zs = new Float32Array(n);
      hover = new Float32Array(n);
      dim = new Float32Array(n);
      polys = new Float32Array(n * 24);
      faces = new Uint8Array(n);
      order = Array.from({ length: n }, (_, i) => i);
      for (let i = 0; i < n; i++) {
        const c = m.cells[i];
        wk[i] = c.week;
        dy[i] = c.day;
        lv[i] = c.level;
        hgt[i] = barHeight(c.count, m.max, heightScale);
      }
      months = m.months;
      const firstActive = m.cells.findIndex((c) => c.count > 0);
      focusWeek = firstActive < 0 ? 0 : Math.max(0, m.cells[firstActive].week - 2);
      const wf = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
      weekdayRows = [];
      for (let d = 0; d < 7 && d < n; d++) {
        const dow = new Date(dayMs(m.cells[d].date)).getUTCDay();
        if (dow === 1 || dow === 3 || dow === 5) weekdayRows.push({ day: d, label: wf.format(dayMs(m.cells[d].date)) });
      }
    };

    // The site has one theme, so this runs once: the tokens are the palette.
    const theme = () => {
      fg = toRGB(token("--ink"), FG_FALLBACK);
      bg = toRGB(token("--canvas"), BG_FALLBACK);
      font = "400 10px " + (getComputedStyle(root).fontFamily || "sans-serif");
      const empty = mixRGB(bg, fg, 0.11);
      const all: RGB[] = [empty, ...LEVEL_TOKENS.map((name) => toRGB(token(name), fg))];
      for (let k = 0; k < 5; k++) for (let ch = 0; ch < 3; ch++) col[k * 3 + ch] = all[k][ch];
      ctx.font = font;
      labelW = Math.ceil(Math.max(20, ...weekdayRows.map((r) => ctx.measureText(r.label).width))) + 8;
      cfg.current.setSwatches(all.map((c) => rgbString(c[0], c[1], c[2])));
    };

    // Projected extent of the scene for camera e, with each bar at its full height or its current one.
    const extent = (cam: Cam, e: number, full: boolean, fromWeek = 0) => {
      const w = lerp(0.78, 0.9, e);
      const off = (1 - w) / 2;
      let minx = Infinity;
      let maxx = -Infinity;
      let miny = Infinity;
      let maxy = -Infinity;
      const add = (x: number, y: number, z: number) => {
        const p = project(cam, x, y, z);
        if (p[0] < minx) minx = p[0];
        if (p[0] > maxx) maxx = p[0];
        if (p[1] < miny) miny = p[1];
        if (p[1] > maxy) maxy = p[1];
      };
      for (let i = 0; i < n; i++) {
        if (wk[i] < fromWeek) continue;
        const x0 = wk[i] + off;
        const y0 = dy[i] + off;
        const z = full ? hgt[i] * e : zs[i];
        add(x0, y0, z);
        add(x0 + w, y0, z);
        add(x0, y0 + w, z);
        add(x0 + w, y0 + w, 0);
        add(x0, y0 + w, 0);
        add(x0 + w, y0, 0);
      }
      // room for the month labels that run along the front edge in 3D
      add(fromWeek, 7 + 1.5 * e, 0);
      add(weeks, 7 + 1.5 * e, 0);
      return { minx, maxx, miny, maxy };
    };

    const relayout = () => {
      const w = Math.round(stage.clientWidth);
      if (!w || !n) return;
      W = w;
      // Narrow stages give the weekday names' column to the grid instead; rows get too tight to label.
      gutter = W < 520 ? 0 : labelW;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (scrubbing) {
        // Pinned, the stage is whatever height the section leaves it, and both views are fitted into it.
        stage.style.height = "";
        H2 = H3 = Hmax = Math.max(160, Math.round(stage.clientHeight));
      } else {
        const b2 = extent(camera(0), 0, true);
        H2 = 20 + 4 + ((b2.maxy - b2.miny) / (b2.maxx - b2.minx)) * (W - gutter - 4);
        const b3 = extent(camera(1), 1, true);
        const natural = ((b3.maxy - b3.miny) / (b3.maxx - b3.minx)) * (W - 40) + 40;
        H3 = Math.max(Math.min(natural, W * 0.6, 520), Math.min(natural, 240));
        Hmax = Math.ceil(Math.max(H2, H3));
      }
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(Hmax * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = Hmax + "px";
      lastH = -1;
      cfg.current.setWidth(W);
      draw();
    };

    const draw = () => {
      if (!W || !n) return;
      const e = easeInOutCubic(t);
      const cam = camera(e, yaw + ys, elev + es);
      const Hc = lerp(H2, H3, e);
      if (!scrubbing && Math.abs(Hc - lastH) > 0.2) {
        stage.style.height = Hc.toFixed(1) + "px";
        lastH = Hc;
      }
      for (let i = 0; i < n; i++) zs[i] = riseAt(t, wk[i], weeks, dy[i]) * hgt[i];
      // Framing slides between the whole year and the active weeks; the bounds blend, so it never steps.
      let b = extent(cam, e, false);
      const k = fz * e;
      if (k > 0.001 && focusWeek > 0) {
        const f = extent(cam, e, false, focusWeek);
        b = {
          minx: lerp(b.minx, f.minx, k),
          maxx: lerp(b.maxx, f.maxx, k),
          miny: lerp(b.miny, f.miny, k),
          maxy: lerp(b.maxy, f.maxy, k),
        };
      }
      const pad = lerp(2, 20, e);
      const left = pad + gutter * (1 - e);
      const top = pad + 20 * (1 - e);
      const aw = W - left - pad;
      const ah = Hc - top - pad;
      const bw = Math.max(1e-6, b.maxx - b.minx);
      const bh = Math.max(1e-6, b.maxy - b.miny);
      const s = Math.min(aw / bw, ah / bh);
      const ox = left + (aw - bw * s) / 2 - b.minx * s;
      const oy = top + (ah - bh * s) / 2 - b.miny * s;
      const { cs, sn, se, ce } = cam;
      const px = (x: number, y: number) => ox + (x * cs - y * sn) * s;
      const py = (x: number, y: number, z: number) => oy + ((x * sn + y * cs) * se - z * ce) * s;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hmax);

      order.sort((a, c) => (wk[a] + 0.5) * sn + (dy[a] + 0.5) * cs - ((wk[c] + 0.5) * sn + (dy[c] + 0.5) * cs));

      const w = lerp(0.78, 0.9, e);
      const off = (1 - w) / 2;
      const radius = lerp(0.17, 0.03, e) * s;
      const outline = (1 - e) * 0.07;
      const lift = 0.7 * e;
      const ex = col[0];
      const ey = col[1];
      const ez = col[2];

      for (let k = 0; k < n; k++) {
        const i = order[k];
        const x0 = wk[i] + off;
        const y0 = dy[i] + off;
        const x1 = x0 + w;
        const y1 = y0 + w;
        const z = zs[i] + hover[i] * lift;
        const o = i * 24;
        // top
        polys[o] = px(x0, y0);
        polys[o + 1] = py(x0, y0, z);
        polys[o + 2] = px(x1, y0);
        polys[o + 3] = py(x1, y0, z);
        polys[o + 4] = px(x1, y1);
        polys[o + 5] = py(x1, y1, z);
        polys[o + 6] = px(x0, y1);
        polys[o + 7] = py(x0, y1, z);
        // +y face (left on screen)
        polys[o + 8] = px(x0, y1);
        polys[o + 9] = py(x0, y1, 0);
        polys[o + 10] = px(x1, y1);
        polys[o + 11] = py(x1, y1, 0);
        polys[o + 12] = polys[o + 4];
        polys[o + 13] = polys[o + 5];
        polys[o + 14] = polys[o + 6];
        polys[o + 15] = polys[o + 7];
        // +x face (right on screen)
        polys[o + 16] = px(x1, y0);
        polys[o + 17] = py(x1, y0, 0);
        polys[o + 18] = polys[o + 10];
        polys[o + 19] = polys[o + 11];
        polys[o + 20] = polys[o + 4];
        polys[o + 21] = polys[o + 5];
        polys[o + 22] = polys[o + 2];
        polys[o + 23] = polys[o + 3];

        const tall = z * ce * s;
        let f = 0;
        if (tall > 0.35 && w * cs * s > 0.35) f |= 1;
        if (tall > 0.35 && w * sn * s > 0.35) f |= 2;
        faces[i] = f;

        const L = lv[i] * 3;
        let r = col[L];
        let g = col[L + 1];
        let bl = col[L + 2];
        const d = dim[i];
        if (d > 0.002) {
          r += (ex - r) * 0.72 * d;
          g += (ey - g) * 0.72 * d;
          bl += (ez - bl) * 0.72 * d;
        }
        const hv = hover[i];
        if (hv > 0.002) {
          const m = 0.16 * hv;
          r += (fg[0] - r) * m;
          g += (fg[1] - g) * m;
          bl += (fg[2] - bl) * m;
        }
        if (f & 1) {
          ctx.beginPath();
          quadPath(ctx, polys, o + 8, 0);
          ctx.fillStyle = rgbString(r * 0.74, g * 0.74, bl * 0.74);
          ctx.fill();
        }
        if (f & 2) {
          ctx.beginPath();
          quadPath(ctx, polys, o + 16, 0);
          ctx.fillStyle = rgbString(r * 0.52, g * 0.52, bl * 0.52);
          ctx.fill();
        }
        ctx.beginPath();
        quadPath(ctx, polys, o, radius);
        ctx.fillStyle = rgbString(r, g, bl);
        ctx.fill();
        if (outline > 0.004) {
          ctx.strokeStyle = "rgba(" + fg[0] + "," + fg[1] + "," + fg[2] + "," + outline.toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (hv > 0.02) {
          ctx.strokeStyle = "rgba(" + fg[0] + "," + fg[1] + "," + fg[2] + "," + (0.85 * hv).toFixed(3) + ")";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Labels: along the top and left flat, along the front edge in 3D. They fade, never pop.
      const muted = mixRGB(bg, fg, 0.55);
      ctx.font = font;
      const a2 = 1 - smoothstep(0, 0.4, e);
      const a3 = smoothstep(0.62, 1, e);
      const mutedAt = (a: number) =>
        "rgba(" + Math.round(muted[0]) + "," + Math.round(muted[1]) + "," + Math.round(muted[2]) + "," + a.toFixed(3) + ")";
      if (a2 > 0.004) {
        ctx.fillStyle = mutedAt(a2);
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        let edge = -Infinity;
        for (const m of months) {
          const x = px(m.week + off, -0.3);
          const tw = ctx.measureText(m.label).width;
          if (x < edge || x + tw > W) continue;
          ctx.fillText(m.label, x, py(m.week + off, -0.3, 0) - 3);
          edge = x + tw + 6;
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        if (gutter > 0) for (const r of weekdayRows) ctx.fillText(r.label, px(0, r.day + 0.5) - 6, py(0, r.day + 0.5, 0));
      }
      if (a3 > 0.004) {
        ctx.fillStyle = mutedAt(a3);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        let edge = -Infinity;
        for (const m of months) {
          const x = px(m.week + 0.5, 7.3);
          if (x < edge || x + ctx.measureText(m.label).width > W) continue;
          ctx.fillText(m.label, x, py(m.week + 0.5, 7.3, 0) + 2);
          edge = x + ctx.measureText(m.label).width + 10;
        }
      }

      // Tooltip rides the active cell through morphs and orbits.
      if (activeIdx >= 0 && activeIdx < n) {
        const i = activeIdx;
        const z = zs[i] + hover[i] * lift;
        const tx = px(wk[i] + 0.5, dy[i] + 0.5);
        const ty = Math.min(
          py(wk[i] + off, dy[i] + off, z),
          py(wk[i] + off + w, dy[i] + off, z),
          py(wk[i] + off, dy[i] + off + w, z),
        );
        const half = tipW / 2;
        const cx = Math.min(W - half - 2, Math.max(half + 2, tx));
        tip.style.transform =
          "translate(" + (cx - half).toFixed(1) + "px," + (ty - 8).toFixed(1) + "px) translateY(-100%)";
        tip.style.setProperty("--arrow", (tx - cx + half).toFixed(1) + "px");
      }
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      let moving = false;

      if (scrubbing && !manual) {
        // Follow the scroll position, eased so a wheel's steps arrive as one motion.
        const kf = 1 - Math.exp(-dt * SCRUB.follow);
        const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
        t = near(t, tGoal) ? tGoal : t + (tGoal - t) * kf;
        ys = near(ys, ysGoal) ? ysGoal : ys + (ysGoal - ys) * kf;
        es = near(es, esGoal) ? esGoal : es + (esGoal - es) * kf;
        fz = near(fz, fzGoal) ? fzGoal : fz + (fzGoal - fz) * kf;
        if (t !== tGoal || ys !== ysGoal || es !== esGoal || fz !== fzGoal) moving = true;
      } else if (t !== target) {
        const step = reduced ? 1 : (dt * 1000) / Math.max(1, cfg.current.duration);
        t = target > t ? Math.min(target, t + step) : Math.max(target, t - step);
        moving = true;
      }

      const ko = reduced ? 1 : 1 - Math.exp(-dt * 12);
      yaw += (yawGoal - yaw) * ko;
      elev += (elevGoal - elev) * ko;
      if (Math.abs(yawGoal - yaw) > 1e-4 || Math.abs(elevGoal - elev) > 1e-4) moving = true;
      else {
        yaw = yawGoal;
        elev = elevGoal;
      }

      const kh = reduced ? 1 : 1 - Math.exp(-dt * 16);
      const kd = reduced ? 1 : 1 - Math.exp(-dt * 10);
      const leg = cfg.current.legendLevel;
      for (let i = 0; i < n; i++) {
        const hg = i === activeIdx ? 1 : 0;
        const dg = leg >= 0 && lv[i] !== leg ? 1 : 0;
        const h = hover[i];
        const d = dim[i];
        if (h !== hg) {
          hover[i] = Math.abs(hg - h) < 0.003 ? hg : h + (hg - h) * kh;
          moving = true;
        }
        if (d !== dg) {
          dim[i] = Math.abs(dg - d) < 0.003 ? dg : d + (dg - d) * kd;
          moving = true;
        }
      }

      draw();
      if (moving) raf = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    // The active day is the hovered one, else the pinned one (tap, click or keyboard).
    const refreshActive = () => {
      const next = hovered >= 0 ? hovered : pinned;
      if (next === activeIdx) return;
      activeIdx = next;
      cfg.current.setActive(next);
      kick();
    };

    const hit = (x: number, y: number): number => {
      for (let k = n - 1; k >= 0; k--) {
        const i = order[k];
        const o = i * 24;
        if (pointInQuad(polys, o, x, y)) return i;
        if (faces[i] & 1 && pointInQuad(polys, o + 8, x, y)) return i;
        if (faces[i] & 2 && pointInQuad(polys, o + 16, x, y)) return i;
      }
      return -1;
    };

    const local = (ev: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top] as const;
    };

    let drag: {
      id: number;
      x: number;
      y: number;
      yaw: number;
      elev: number;
      moved: boolean;
      orbit: boolean;
      mouse: boolean;
    } | null = null;

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const can = orbit && target === 1;
      drag = {
        id: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        yaw: yawGoal,
        elev: elevGoal,
        moved: false,
        orbit: can,
        mouse: ev.pointerType === "mouse",
      };
      if (can) {
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {
          /* capture is a nicety */
        }
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (drag && drag.orbit && ev.pointerId === drag.id) {
        const dx = ev.clientX - drag.x;
        const dyy = ev.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dyy) > 4) {
          drag.moved = true;
          yawGoal = Math.min(YAW_RANGE[1] - YAW_3D, Math.max(YAW_RANGE[0] - YAW_3D, drag.yaw + dx * 0.006));
          if (drag.mouse)
            elevGoal = Math.min(ELEV_RANGE[1] - ELEV_3D, Math.max(ELEV_RANGE[0] - ELEV_3D, drag.elev + dyy * 0.004));
          canvas.style.cursor = "grabbing";
          hovered = -1;
          refreshActive();
          kick();
          return;
        }
      }
      if (ev.pointerType !== "mouse") return;
      const [x, y] = local(ev);
      const i = hit(x, y);
      if (i !== hovered) {
        hovered = i;
        refreshActive();
      }
      canvas.style.cursor = orbit && target === 1 ? "grab" : i >= 0 ? "pointer" : "default";
    };

    const onUp = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const wasMoved = drag.moved;
      drag = null;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      canvas.style.cursor = orbit && target === 1 ? "grab" : "default";
      if (wasMoved) return;
      const [x, y] = local(ev);
      const i = hit(x, y);
      pinned = i === pinned ? -1 : i;
      if (ev.pointerType !== "mouse") hovered = -1;
      refreshActive();
    };

    const onCancel = () => {
      drag = null;
    };

    const onLeave = () => {
      if (drag) return;
      hovered = -1;
      refreshActive();
    };

    const onDbl = () => {
      yawGoal = 0;
      elevGoal = 0;
      kick();
    };

    const onKey = (ev: KeyboardEvent) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"];
      if (!keys.includes(ev.key) || !n) return;
      ev.preventDefault();
      if (ev.key === "Escape") {
        pinned = -1;
        hovered = -1;
        refreshActive();
        return;
      }
      let i = pinned >= 0 ? pinned : activeIdx >= 0 ? activeIdx : n - 1;
      if (pinned >= 0 || activeIdx >= 0) {
        if (ev.key === "ArrowLeft") i -= 7;
        if (ev.key === "ArrowRight") i += 7;
        if (ev.key === "ArrowUp") i -= 1;
        if (ev.key === "ArrowDown") i += 1;
        if (ev.key === "Home") i = 0;
        if (ev.key === "End") i = n - 1;
      }
      i = Math.max(0, Math.min(n - 1, i));
      pinned = i;
      hovered = -1;
      refreshActive();
      cfg.current.setAnnounce(cfg.current.describe(i));
    };

    const onBlur = () => {
      pinned = -1;
      refreshActive();
    };

    const setTarget = () => {
      const goal = cfg.current.target;
      if (!entered) return;
      if (goal !== target) {
        target = goal;
        if (goal === 0) {
          yawGoal = 0;
          elevGoal = 0;
        }
        canvas.style.cursor = orbit && target === 1 ? "grab" : "default";
        kick();
      }
    };

    /* Is the section pinned right now? The markup says it CAN pin; the guards in
     * its styles decide whether it does at this window size, and a static
     * viewport measures as no pin at all — the same reading trackProgress makes. */
    const pinnedNow = () => {
      const vp = track?.querySelector<HTMLElement>("[data-viewport]");
      return !!vp && getComputedStyle(vp).position === "sticky";
    };

    const onScroll = () => {
      if (!scrubbing || !track) return;
      const p = trackProgress(track);
      tGoal = Math.min(1, Math.max(0, (p - SCRUB.hold) / (SCRUB.rise - SCRUB.hold)));
      const turn = easeInOutCubic(Math.min(1, Math.max(0, (p - SCRUB.rise) / (1 - SCRUB.rise))));
      ysGoal = lerp(SCRUB.yawFrom, SCRUB.yawTo, turn);
      esGoal = SCRUB.elevDip * Math.sin(Math.PI * turn);
      fzGoal = turn;
      manual = false;
      const v: View = tGoal >= 0.5 ? "3d" : "2d";
      if (v !== sentView) {
        sentView = v;
        cfg.current.setView(v);
      }
      kick();
    };

    const mode = () => {
      const next = pinnedNow();
      if (next === scrubbing) return;
      scrubbing = next;
      sentView = null;
      cfg.current.setScrub(next);
      if (next) {
        entered = true;
        onScroll();
        // Arrive where the scroll already is, rather than animating there from flat.
        t = tGoal;
        ys = ysGoal;
        es = esGoal;
        fz = fzGoal;
      } else {
        ys = es = ysGoal = esGoal = fz = fzGoal = 0;
      }
      relayout();
    };

    load();
    theme();
    mode();
    relayout();

    // The 3D view rises out of the flat one the first time it is seen.
    const enter = () => {
      if (entered) return;
      entered = true;
      if (reduced) t = cfg.current.target;
      setTarget();
      draw();
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          enter();
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(stage);

    const ro = new ResizeObserver(() => {
      mode();
      if (Math.round(stage.clientWidth) !== W || (scrubbing && Math.abs(stage.clientHeight - Hmax) > 1)) relayout();
    });
    ro.observe(stage);
    const onResize = () => {
      mode();
      onScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    const onReduce = () => {
      reduced = reduceMq.matches;
      onResize();
      kick();
    };
    reduceMq.addEventListener("change", onReduce);

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("blur", onBlur);

    engine.current = {
      kick: () => {
        setTarget();
        kick();
      },
      tipWidth: (w: number) => {
        tipW = w;
        draw();
      },
      reload: () => {
        load();
        theme();
        if (activeIdx >= n) activeIdx = -1;
        if (pinned >= n) pinned = -1;
        if (hovered >= n) hovered = -1;
        relayout();
        kick();
      },
      manual: () => {
        manual = true;
        kick();
      },
    };

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      reduceMq.removeEventListener("change", onReduce);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("blur", onBlur);
      engine.current = null;
    };
    // The loop reads everything else through cfg; it is built once per mount,
    // and a live top-up swaps its data in through `reload` without restarting it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const firstModel = React.useRef(model);
  React.useEffect(() => {
    if (model !== firstModel.current) engine.current?.reload();
  }, [model]);

  React.useEffect(() => {
    engine.current?.kick();
  }, [view, legendLevel]);

  // The tooltip's width is needed to keep it inside the stage; measure it when its text changes.
  React.useLayoutEffect(() => {
    const tip = tipRef.current;
    if (tip && active >= 0) engine.current?.tipWidth(tip.offsetWidth);
  }, [active, model]);

  const { stats } = model;
  const range = (a: string | null, b: string | null, withYear = false) => {
    if (!a || !b) return "—";
    const f = withYear ? dfy : df;
    return f.format(dayMs(a)) + " – " + f.format(dayMs(b));
  };
  const is3d = view === "3d";
  // Pinned, the stats stay in their row: corners that come and go would move the section under the reader.
  const corners = width >= 560 && !scrub;
  const bigSize = Math.round(Math.max(30, Math.min(56, width * 0.058)));
  const statBlocks = [
    {
      label: "One year",
      value: nf.format(stats.total),
      unit: noun(stats.total),
      sub: range(stats.first, stats.last, true),
    },
    {
      label: "Busiest day",
      value: nf.format(stats.busiest.count),
      unit: noun(stats.busiest.count),
      sub: stats.busiest.date ? df.format(dayMs(stats.busiest.date)) : "—",
    },
    {
      label: "Longest streak",
      value: nf.format(stats.longest.days),
      unit: stats.longest.days === 1 ? "day" : "days",
      sub: range(stats.longest.start, stats.longest.end),
    },
    {
      label: "Current streak",
      value: nf.format(stats.current.days),
      unit: stats.current.days === 1 ? "day" : "days",
      sub: range(stats.current.start, stats.current.end),
    },
  ];
  const showRow = !(is3d && corners);
  const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
  const levelNames = ["No " + PLURAL, "Light", "Moderate", "Heavy", "Heaviest"];
  const hints = ["Hover a day for its commits · arrow keys to walk the year", "Drag to orbit · double-click to reset"];
  const hint = hints[is3d && orbit ? 1 : 0];

  return (
    <div ref={rootRef} className={"relative w-full" + (scrub ? " flex min-h-0 flex-1 flex-col" : "")} style={{ color: INK }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 text-[15px] leading-snug" style={{ color: "var(--body)" }}>
          <span className="tabular-nums" style={{ color: INK }}>
            {nf.format(stats.total)}
          </span>{" "}
          {noun(stats.total)} in the last year
        </p>
        <div
          role="group"
          aria-label="Chart view"
          className="relative inline-flex rounded-md border p-0.5"
          style={{ borderColor: "var(--hairline-strong)" }}
        >
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0.5 w-8 rounded transition-transform duration-500 motion-reduce:transition-none"
            style={{
              background: INK,
              transform: is3d ? "translateX(100%)" : "translateX(0)",
              transitionTimingFunction: ease,
            }}
          />
          {(["2d", "3d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              aria-label={v === "2d" ? "Flat heat map" : "3D skyline"}
              title={v === "2d" ? "Flat heat map" : "3D skyline"}
              onClick={() => {
                engine.current?.manual();
                setView(v);
              }}
              className="relative z-10 grid h-7 w-8 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 transition-colors duration-500 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
              style={{ color: view === v ? "var(--on-ink)" : MUTED, outlineColor: INK }}
            >
              {v === "2d" ? <GridIcon /> : <CubeIcon />}
            </button>
          ))}
        </div>
      </div>

      <div
        className={"relative rounded-lg border" + (scrub ? " flex min-h-0 flex-1 flex-col" : "")}
        style={{ borderColor: LINE, background: "var(--surface-card)" }}
      >
        <div className={"relative px-3 pt-3 sm:px-4 sm:pt-4" + (scrub ? " flex min-h-0 flex-1 flex-col" : "")}>
          {/* The inline height never changes, so React never re-applies it over the engine's.
              Pinned, `flex-1` (a zero basis) outranks it and the stage takes what the section leaves. */}
          <div
            ref={stageRef}
            className={
              "relative w-full overflow-hidden rounded-md outline-offset-4 has-[:focus-visible]:outline-2" +
              (scrub ? " min-h-0 flex-1" : "")
            }
            style={{ height: 150, outlineColor: INK }}
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="img"
              aria-label={
                nf.format(stats.total) +
                " " +
                noun(stats.total) +
                " between " +
                range(stats.first, stats.last, true) +
                ", shown as a " +
                (is3d ? "3D skyline" : "heat map") +
                ". Use the arrow keys to read individual days."
              }
              className="absolute top-0 left-0 block outline-none"
              style={{ touchAction: is3d && orbit ? "pan-y" : "auto" }}
            />

            {corners && (
              <>
                <div
                  aria-hidden={!is3d}
                  className="pointer-events-none absolute top-1 right-1 flex flex-col items-end gap-5 transition-[opacity,transform] motion-reduce:transition-none"
                  style={{
                    opacity: is3d ? 1 : 0,
                    transform: is3d ? "translateY(0)" : "translateY(-10px)",
                    transitionDuration: is3d ? "600ms" : "300ms",
                    transitionDelay: is3d ? Math.round(duration * 0.55) + "ms" : "0ms",
                    transitionTimingFunction: ease,
                  }}
                >
                  <Stat {...statBlocks[0]} size={bigSize} align="end" />
                  <Stat {...statBlocks[1]} size={bigSize} align="end" />
                </div>
                <div
                  aria-hidden={!is3d}
                  className="pointer-events-none absolute bottom-1 left-1 flex flex-col items-start gap-5 transition-[opacity,transform] motion-reduce:transition-none"
                  style={{
                    opacity: is3d ? 1 : 0,
                    transform: is3d ? "translateY(0)" : "translateY(10px)",
                    transitionDuration: is3d ? "600ms" : "300ms",
                    transitionDelay: is3d ? Math.round(duration * 0.65) + "ms" : "0ms",
                    transitionTimingFunction: ease,
                  }}
                >
                  <Stat {...statBlocks[2]} size={bigSize} align="start" />
                  <Stat {...statBlocks[3]} size={bigSize} align="start" />
                </div>
              </>
            )}
          </div>

          <div
            ref={tipRef}
            role="tooltip"
            aria-hidden={active < 0}
            className="pointer-events-none absolute top-3 left-3 z-20 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] leading-none transition-opacity duration-150 sm:top-4 sm:left-4 motion-reduce:transition-none"
            style={{ opacity: active >= 0 ? 1 : 0, background: INK, color: "var(--on-ink)" }}
          >
            {active >= 0 && model.cells[active] ? (
              <>
                <strong className="font-semibold">
                  {model.cells[active].count
                    ? nf.format(model.cells[active].count) + " " + noun(model.cells[active].count)
                    : "No " + PLURAL}
                </strong>
                <span className="opacity-75"> on {dfy.format(dayMs(model.cells[active].date))}</span>
              </>
            ) : (
              " "
            )}
            <span
              aria-hidden="true"
              className="absolute top-full h-0 w-0"
              style={{
                left: "var(--arrow, 50%)",
                marginLeft: -5,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "5px solid var(--ink)",
              }}
            />
          </div>
        </div>

        <div
          aria-hidden={!showRow}
          className="grid transition-[grid-template-rows,opacity] motion-reduce:transition-none"
          style={{
            gridTemplateRows: showRow ? "1fr" : "0fr",
            opacity: showRow ? 1 : 0,
            transitionDuration: duration + "ms",
            transitionTimingFunction: ease,
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-3 pt-4 pb-1 sm:px-4 md:grid-cols-4">
              {statBlocks.map((b) => (
                <Stat key={b.label} {...b} size={28} align="stack" />
              ))}
            </div>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 pt-3 pb-3 text-[12px] sm:px-4"
          style={{ color: MUTED }}
        >
          <span className="relative grid flex-1">
            {hints.map((h) => (
              <span
                key={h}
                aria-hidden={h !== hint}
                className="[grid-area:1/1] transition-opacity duration-500 motion-reduce:transition-none"
                style={{ opacity: h === hint ? 1 : 0 }}
              >
                {h}
              </span>
            ))}
          </span>
          <div className="flex items-center gap-1.5" onMouseLeave={() => setLegendLevel(-1)}>
            <span className="mr-0.5">Less</span>
            {swatches.map((c, i) => (
              <button
                key={i}
                type="button"
                aria-label={"Highlight " + levelNames[i].toLowerCase() + " days"}
                aria-pressed={legendLevel === i}
                title={levelNames[i]}
                onMouseEnter={() => setLegendLevel(i)}
                onFocus={() => setLegendLevel(i)}
                onBlur={() => setLegendLevel(-1)}
                onClick={() => setLegendLevel((l) => (l === i ? -1 : i))}
                className="h-[11px] w-[11px] cursor-pointer rounded-[2px] border p-0 transition-transform duration-500 hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                style={{ background: c, outlineColor: INK, borderColor: "var(--hairline)" }}
              />
            ))}
            <span className="ml-0.5">More</span>
          </div>
        </div>
      </div>

      {repo && (
        <p className="mt-2 mb-0" style={{ color: "var(--muted-soft)", fontSize: "var(--text-caption)" }}>
          Commits to the main branch of {repo},{" "}
          {liveAt !== null
            ? "counted live from GitHub at " + tf.format(liveAt)
            : readAt
              ? "read from GitHub on " + dfy.format(new Date(readAt))
              : "read from GitHub"}
          . Counts only — no names.
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
