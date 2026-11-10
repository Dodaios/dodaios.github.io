# Assets copied from the app

Everything in this folder is the app's own file, copied unchanged so the hero's
clone of the app (`src/components/demo/app/`) draws what the app draws. See
`docs/hero.md` § "The window is a clone of the app".

| Files | From (in the app repository) |
| --- | --- |
| `gigi-sheet.png`, `pets/*.png` | `dodaios/ui/pets/builtin/<pet>/sheet.png` — four of the app's built-in pets |
| `claude-color.svg`, `gemini.svg`, `openai.svg`, `claude.svg` | `dodaios/ui/web/frontend/src/assets/providers/` |
| `plugins/*.svg` | `dodaios/ui/web/frontend/src/assets/brands/` |
| the three `.woff2` files | the app's bundled Inter and JetBrains Mono (SIL OFL 1.1) |

The provider and plugin marks belong to their owners. They are used **solely to
identify the service a row, a picker or a thread connects to** — nominative
use — and never to imply that the owner endorses, sponsors or is affiliated
with this project. The licence and source of each mark are recorded in the
app's own `LOGOS.md` beside the original file; the rule they follow here is the
one in `src/assets/brands/LOGOS.md`. If you own a mark and want it removed,
open an issue and it will be taken out.
