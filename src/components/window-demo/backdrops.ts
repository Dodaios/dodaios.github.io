import plugins from "@/assets/demo-backgrounds/plugins.webp";
import plugins768 from "@/assets/demo-backgrounds/plugins-768.webp";
import plugins1024 from "@/assets/demo-backgrounds/plugins-1024.webp";
import skills from "@/assets/demo-backgrounds/skills.webp";
import skills768 from "@/assets/demo-backgrounds/skills-768.webp";
import skills1024 from "@/assets/demo-backgrounds/skills-1024.webp";
import clis from "@/assets/demo-backgrounds/clis.webp";
import clis768 from "@/assets/demo-backgrounds/clis-768.webp";
import clis1024 from "@/assets/demo-backgrounds/clis-1024.webp";
import agents from "@/assets/demo-backgrounds/agents.webp";
import agents768 from "@/assets/demo-backgrounds/agents-768.webp";
import agents1024 from "@/assets/demo-backgrounds/agents-1024.webp";
import openSource from "@/assets/demo-backgrounds/open-source.webp";
import openSource768 from "@/assets/demo-backgrounds/open-source-768.webp";
import openSource1024 from "@/assets/demo-backgrounds/open-source-1024.webp";
// "Code by talking" opens the feature run right under the hero, so it shares
// the hero's own painting at the well's size instead of a sixth image.
import talk from "@/assets/hero/stage-backdrop-well.webp";
import talk768 from "@/assets/hero/stage-backdrop-well-768.webp";
import talk1024 from "@/assets/hero/stage-backdrop-well-1024.webp";

type Painting = typeof plugins;

/**
 * One painting at the widths the browser may choose from.
 *
 * The narrow copies are cut by `scripts/build-backdrop-variants.mjs`; a phone
 * takes the 768px one, which is a fifth of the master's bytes.
 */
export interface Backdrop {
  /** The full-size painting: the fallback `src` and the size the box reserves. */
  master: Painting;
  /** `srcset` over every width, narrowest first. */
  srcSet: string;
}

const offer = (master: Painting, ...narrower: Painting[]): Backdrop => ({
  master,
  srcSet: [...narrower, master].map((image) => `${image.src} ${image.width}w`).join(", "),
});

/** Distinct paintings; all window geometry still belongs to DemoStage. */
export const DEMO_BACKDROPS = {
  talk: offer(talk, talk768, talk1024),
  plugins: offer(plugins, plugins768, plugins1024),
  skills: offer(skills, skills768, skills1024),
  clis: offer(clis, clis768, clis1024),
  agents: offer(agents, agents768, agents1024),
  "open-source": offer(openSource, openSource768, openSource1024),
};
export type DemoBackdrop = keyof typeof DEMO_BACKDROPS;
