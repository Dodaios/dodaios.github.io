/**
 * The marks' sprite sheet for the 3D world: every mark of src/components/logos
 * in one SVG, in a grid of square cells, white on nothing. The orbit rings
 * draw it into their texture (src/world/parts/rings.ts).
 *
 * Built once, at build time, from the same components the rest of the site
 * uses, so a mark is never drawn twice. The licences and the rule that the
 * marks only identify their services are in docs/LOGOS.md.
 */
import type { APIRoute } from "astro";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { marks } from "@/components/logos/marks";
import { MARK_SHEET_CELL, MARK_SHEET_COLUMNS } from "@/world/marks";

export const GET: APIRoute = () => {
  const rows = Math.ceil(marks.length / MARK_SHEET_COLUMNS);
  const width = MARK_SHEET_COLUMNS * MARK_SHEET_CELL;
  const height = rows * MARK_SHEET_CELL;
  const cells = marks
    .map(({ Mark, rem }, i) => {
      // `rem` is the mark's optical size in the logo strip; keep its proportions here.
      const size = Math.round(MARK_SHEET_CELL * 0.2 * rem);
      const x = (i % MARK_SHEET_COLUMNS) * MARK_SHEET_CELL + (MARK_SHEET_CELL - size) / 2;
      const y = Math.floor(i / MARK_SHEET_COLUMNS) * MARK_SHEET_CELL + (MARK_SHEET_CELL - size) / 2;
      const inner = renderToStaticMarkup(createElement(Mark, {}));
      return `<svg x="${x}" y="${y}" width="${size}" height="${size}" overflow="hidden">${inner}</svg>`;
    })
    .join("");
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="white">${cells}</svg>`;
  return new Response(body, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
};
