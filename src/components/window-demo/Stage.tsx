/**
 * The demo stage — the machinery every feature card's demo shares.
 *
 * One well, one window, one fixed canvas scaled to fit. The four feature
 * sections (plugins, skills, CLIs, Agents) differ only in what is drawn inside the
 * canvas; everything about how it is sized, clipped, framed and handed over to
 * the visitor lives here, once.
 *
 * That is not tidiness. The scaler below carries a guard against a feedback
 * loop that is invisible until it fires (see useFitScale), and three copies of
 * a subtle guard is two copies that will lose it.
 *
 * See docs/feature-section.md.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { DEMO_BACKDROPS, type DemoBackdrop } from "./backdrops";

/** True when the visitor asked their system for less motion. Read on mount,
 *  not during render: reading it during render would differ between the
 *  server-rendered HTML and the first client render. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Scale a fixed canvas to fit the stage.
 *
 * The hero scales by width alone; its stage owns its aspect ratio and may grow
 * as tall as it likes. A feature card's height is already fixed by `16/9`, so a
 * width-only scale would push the window through the card's bottom edge. Fit
 * both axes and the window is always whole.
 */
export function useFitScale(
  ref: RefObject<HTMLDivElement | null>,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = (width: number, height: number) => {
      if (width <= 0) return;
      const byWidth = width / canvasWidth;
      // The width is always definite — the column is. The height only is while
      // the stage has an aspect ratio (narrow) or the card's 16/9 gives it one
      // (wide). Fall back to the width if it ever is not, because a height read
      // from the content is a height the window itself decided: scale feeds
      // size feeds scale, and the mockup runs away to full size.
      const byHeight = height > 0 ? height / canvasHeight : byWidth;
      // Never above 1:1. A mockup enlarged past its design size looks soft.
      setScale(Math.min(1, byWidth, byHeight));
    };

    const box = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    // Match ResizeObserver's content box on the first measurement. Counting
    // padding here enlarged the first frame and could inflate its grid row.
    measure(
      box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth),
      box.height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth),
    );

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) measure(rect.width, rect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, canvasWidth, canvasHeight]);

  return scale;
}

/**
 * Autoplay through a looping script, and hand it over for good at the first
 * touch. A demo that keeps moving under someone's hand is worse than one that
 * never moved.
 *
 * `durations` is read per frame rather than taken as a constant, so a script
 * can hold its most interesting beat longer than its transitions.
 */
export function useFrameScript(
  durations: number[],
  paused: boolean,
): { index: number; tookOver: boolean; takeOver: () => void } {
  const [index, setIndex] = useState(0);
  const [tookOver, setTookOver] = useState(false);

  const takeOver = useCallback(() => setTookOver(true), []);

  const hold = durations[index] ?? 2500;
  useEffect(() => {
    if (tookOver || paused || durations.length < 2) return;
    const timer = window.setTimeout(
      () => setIndex((i) => (i + 1) % durations.length),
      hold,
    );
    return () => window.clearTimeout(timer);
  }, [index, hold, tookOver, paused, durations.length]);

  return { index, tookOver, takeOver };
}

/** Character interval for a typed sentence — the CLIs composer's instruction. */
export const TYPE_MS = 34;

/** A search box types a word, not a sentence, and six characters at sentence
 *  speed are over before the eye finds them. */
export const SEARCH_TYPE_MS = 58;

/**
 * Reveal a string one character at a time, and report how many are visible.
 *
 * A demo that fills its search box in one paint reads as a recording. Typing
 * the word is the whole difference between watching a video of an app and
 * watching someone use one, and it costs a fifth of a second.
 *
 * `active` is what the caller ticks on — entering the beat that types. The
 * count resets every time the run changes, so a looping script types the word
 * again on each pass, and it holds at full length for as long as the same run
 * stays active, which is what lets three consecutive frames share one query
 * without retyping it.
 *
 * The run is compared during render, not only inside the effect. An effect runs
 * after the paint, so a reset that lives only there shows the finished word for
 * one frame before clearing it — a flash at exactly the moment the eye is
 * looking at the box.
 *
 * Reduced motion gets the finished string: the point of the beat is that a
 * person typed it, and the finished sentence carries that just as well.
 */
export function useTypewriter(
  text: string,
  active: boolean,
  reducedMotion: boolean,
  speedMs: number = TYPE_MS,
): number {
  const run = active ? text : "";
  const [state, setState] = useState<{ run: string; typed: number }>({
    run,
    typed: 0,
  });

  useEffect(() => {
    if (!active) return;
    if (reducedMotion) {
      setState({ run, typed: text.length });
      return;
    }
    setState({ run, typed: 0 });
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setState({ run, typed: i });
      if (i >= text.length) window.clearInterval(id);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [run, text, active, reducedMotion, speedMs]);

  return state.run === run ? state.typed : 0;
}

export interface DemoStageProps {
  /** The canvas the children are drawn on. Every measurement inside them is in
   *  design pixels against this box, and nothing inside reacts to the
   *  viewport — that is the whole point of the technique. */
  canvasWidth: number;
  canvasHeight: number;
  /** Each section supplies its own painting from the shared brand collection. */
  backdrop: DemoBackdrop;
  /** What a screen reader is told instead of the stage, which is aria-hidden. */
  description: string;
  /** Called on the first pointer press anywhere in the stage. */
  onTakeOver?: () => void;
  /**
   * The well's own shape, for a demo whose window is not a feature card's.
   *
   * The default is the feature cards' well: a 7/6 box beside the copy, going
   * full-height once the split has room. A demo that spans the whole content
   * column has neither of those facts — a 7/6 well around a 16/10 window is a
   * third of a screen of backdrop above and below it — so it hands its own
   * shape in. The prop takes classes rather than a boolean because the next
   * such demo will want a third shape, and a boolean would then be two.
   */
  wellShape?: string;
  children: ReactNode;
}

/**
 * The well and the window.
 *
 * The window's own frame sits OUTSIDE the transform, so its 1px border and 8px
 * radius stay exactly that at any scale. Everything inside is design pixels and
 * scales; a window's chrome does not.
 */
export function DemoStage({
  canvasWidth,
  canvasHeight,
  backdrop,
  description,
  onTakeOver,
  wellShape = "aspect-[7/6] lg:aspect-auto lg:h-full",
  children,
}: DemoStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(stageRef, canvasWidth, canvasHeight);
  const wellBackdrop = DEMO_BACKDROPS[backdrop];

  return (
    <div className="h-full min-h-0 w-full min-w-0">
      {/*
        The recessed well. Its 24px of padding is what keeps the window off its
        edge — the second of the two nested radii that carry the depth in this
        system, since it has no shadows.

        aria-hidden, because a screen reader should get the sentence below, not
        a table of fictional rows.
      */}
      <div
        ref={stageRef}
        data-demo-stage={backdrop}
        aria-hidden="true"
        /*
         * Take over on the CLICK, not on the press.
         *
         * This is a capture-phase handler on the whole stage, and it sets
         * state. On `mousedown` — a discrete event React flushes
         * synchronously — that re-render lands between the press and the
         * child's own bubble-phase handler, and the child's handler is lost.
         * A row that opens on press then did nothing at all, while a button
         * two lines above it worked, which is a maddening thing to debug.
         *
         * Every interactive element inside already calls takeOver itself, so
         * this only has to catch a press on dead space.
         */
        className={`relative grid min-h-0 w-full min-w-0 place-items-center overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-canvas p-6 ${wellShape}`}
      >
        {/*
          Each section has a distinct painting in the same visual family.

          The well used to be flat `bg-canvas`. A window is never as tall as the
          box it is centred in — the list is short on a filtered frame, and the
          canvas is sized for the tallest one either way — so that flat floor
          read as a hole punched in the card rather than as a background. The
          painting turns the leftover into the reason the window is there.

          The shared collection gives Plugins, Skills, CLIs, Agents and Open
          Source separate images. The Hero keeps its original painting.

          Lazy, because all of these sit below the fold; `alt=""` and the
          well's own `aria-hidden` keep it out of the accessibility tree.

          Three widths on offer. On a phone the well is the column inside
          the container's 24px of padding a side, and it is never wider than
          the content column, so a phone takes the 768px copy and a desktop
          the master it always had.
        */}
        <img
          src={wellBackdrop.master.src}
          srcSet={wellBackdrop.srcSet}
          sizes="(min-width: 1024px) 1280px, calc(100vw - 48px)" // layout-allow: tells the browser how wide the well is drawn so it can pick a file; it sets no width
          alt=""
          width={wellBackdrop.master.width}
          height={wellBackdrop.master.height}
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <div
          data-demo-window={backdrop}
          data-canvas-width={canvasWidth}
          data-canvas-height={canvasHeight}
          className="relative overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-card"
          style={{
            width: canvasWidth * scale,
            height: canvasHeight * scale,
            // Nothing to show until the observer has measured; drawing at
            // scale 0 would flash a collapsed window on first paint.
            visibility: scale > 0 ? "visible" : "hidden",
          }}
        >
          <div
            style={{
              width: canvasWidth,
              height: canvasHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {/*
              The window's contents exist only once it has a size.

              Until the observer has measured, the window is hidden, so the
              server's copy of the contents was never seen: it was a third of
              the page's HTML (180 kB across the five demos) that every visitor
              downloaded, parsed and laid out for nothing, and that React then
              walked a second time to hydrate. The scale is 0 on the server and
              on the first client render alike, so both produce the same empty
              window and hydration has nothing to disagree about.
            */}
            {scale > 0 ? children : null}
          </div>
        </div>
      </div>

      <p className="sr-only">{description}</p>
    </div>
  );
}
