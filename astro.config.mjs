// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Sitemap and canonical URLs are built from this. The domain GitHub Pages
  // actually serves is `public/CNAME`, which moves separately: see
  // docs/deploy.md, "Moving to dodaios.ai".
  site: "https://dodaios.ai",
  integrations: [react(), sitemap()],

  // The stylesheet travels inside the page instead of beside it.
  //
  // As two linked files (26 kB compressed together) it was two more round
  // requests before anything could be painted. Lighthouse on a simulated phone
  // connection put the first paint at 1.51 s with the links and at 1.36 s with
  // the rules inline (2026-11-10, same build otherwise). The cost is that a
  // second route sends them again; most visits here read one page.
  build: { inlineStylesheets: "always" },

  // ONE dev server for this site, at a fixed address: http://127.0.0.1:4399.
  //
  // Astro's default is to take the next free port when 4321 is busy, so a
  // second start quietly moves the site somewhere else. That is how a desk ends
  // up with a row of tabs on 4399, 4999, 4321+n, each frozen at whatever the
  // source looked like when it was opened, and no way to tell which one is
  // live. `strictPort` turns that silent move into a loud failure: the start
  // refuses rather than lands somewhere nobody was told about.
  //
  // Start it as the background instance (`npm run dev`) and it is shared: a
  // second start prints "already running" and exits. See CLAUDE.md.
  server: { port: 4399, host: "127.0.0.1" },

  vite: {
    plugins: [tailwindcss(), pinDevReactRuntime()],
    // `three` reaches the browser through ONE island that is imported at
    // runtime: <TurningMark client:media="(min-width: 1024px)" /> in
    // Install.astro. Vite's cold-start scan never walks that edge, so the
    // dependency is absent from the pre-bundle. The browser's first request for
    // it then kicks off an on-demand optimize run, and Vite answers 504 while
    // that runs. `astro-island` retries three times, gives up, and the mark
    // stays dead with nothing on screen to say so -- the same silent shape as
    // the jsx-dev-runtime failure documented above.
    //
    // Naming it here puts `three` in the pre-bundle at startup, so the wait
    // costs one cold start instead of a broken island. A production build is
    // unaffected: it walks the full import graph either way.
    optimizeDeps: { include: ["three"] },
    // Fail loudly instead of relocating the site (see `server` above).
    server: { strictPort: true },
  },
});

/**
 * Keep the dev server's pre-bundled React on its DEVELOPMENT build.
 *
 * Astro's background dev server can come up with NODE_ENV unset. Vite's
 * dependency pre-bundler then folds `process.env.NODE_ENV` to "production" and
 * bundles React through its production entry — where `react/jsx-dev-runtime`
 * deliberately exports `jsxDEV` as undefined. Our own source is still
 * transformed with the development JSX runtime, so every island throws
 * `_jsxDEV is not a function` the moment it hydrates.
 *
 * The failure is quiet in the worst way: server-rendered markup stays on
 * screen, so a section looks present and is simply dead. A demo whose size is
 * computed after mount (the window starts hidden until a ResizeObserver
 * reports a scale) renders as an empty well instead — no error in sight
 * unless you open the console.
 *
 * Setting the define is what actually holds. Assigning `process.env.NODE_ENV`
 * alone survives the first optimize pass and is lost the next time Vite
 * re-bundles after a new import appears, which is exactly when a page is being
 * built out and nobody is watching the console.
 *
 * `command === "serve"` scopes all of it to the dev server; a production build
 * never reaches this branch.
 */
function pinDevReactRuntime() {
  return {
    name: "dodaios:pin-dev-react-runtime",
    /** @param {unknown} _config @param {{ command: string }} environment */
    config(_config, { command }) {
      if (command !== "serve") return;
      if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";
      const define = { "process.env.NODE_ENV": JSON.stringify("development") };
      return {
        optimizeDeps: {
          esbuildOptions: { define },
          rollupOptions: { define },
        },
      };
    },
  };
}
