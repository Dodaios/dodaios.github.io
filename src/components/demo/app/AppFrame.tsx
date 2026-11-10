import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import appCss from "./app.css?inline";
import interUrl from "@/assets/app/inter-latin-wght-normal.woff2?url";
import mono400Url from "@/assets/app/jetbrains-mono-latin-400-normal.woff2?url";
import mono500Url from "@/assets/app/jetbrains-mono-latin-500-normal.woff2?url";

/**
 * A document of its own for the app clone.
 *
 * The clone is styled by the app's compiled stylesheet (app.css, synced by
 * scripts/sync-app-ui.mjs). That sheet styles `html`, `body`, `:root` and
 * `.dark` and carries Tailwind's reset — none of which may touch this site.
 * An iframe gives it a real document of its own: the app's rules apply
 * exactly as they do in the app, and this page's rules cannot reach in.
 *
 * The iframe is empty (no src, no network request); the clone is rendered
 * into its body with a React portal, so it stays part of this island — one
 * state, one set of event handlers.
 *
 * The two font families are the app's own, declared here because the app
 * ships them as @font-face rules with paths into its own build.
 */
const FONTS = `
@font-face{font-family:"Inter Variable";font-style:normal;font-display:block;font-weight:100 900;src:url(${interUrl}) format("woff2-variations")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-display:block;font-weight:400;src:url(${mono400Url}) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-display:block;font-weight:500;src:url(${mono500Url}) format("woff2")}
html,body{height:100%;overflow:hidden}
`;

export function AppFrame({
  width,
  height,
  onInteract,
  children,
}: {
  width: number;
  height: number;
  /** Called whenever the visitor presses, types or scrolls inside the window. */
  onInteract?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!doctype html><html class="dark" lang="en"><head><meta charset="utf-8"><style>${FONTS}</style><style>${appCss}</style></head><body></body></html>`,
    );
    doc.close();
    setBody(doc.body);
  }, []);

  // The frame is a document of its own, so its events never reach the page:
  // the stage has to be told from in here that someone took the window over.
  const interact = useRef(onInteract);
  interact.current = onInteract;
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || !body) return;
    const notify = () => interact.current?.();
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((name) => doc.addEventListener(name, notify, { passive: true }));
    return () => events.forEach((name) => doc.removeEventListener(name, notify));
  }, [body]);

  return (
    <>
      <iframe
        ref={ref}
        title="Dodaios"
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: "block", width, height, border: 0, background: "transparent" }}
      />
      {body && createPortal(children, body)}
    </>
  );
}
