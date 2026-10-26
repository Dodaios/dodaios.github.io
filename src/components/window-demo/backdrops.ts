import plugins from "@/assets/demo-backgrounds/plugins.webp";
import skills from "@/assets/demo-backgrounds/skills.webp";
import clis from "@/assets/demo-backgrounds/clis.webp";
import agents from "@/assets/demo-backgrounds/agents.webp";
import openSource from "@/assets/demo-backgrounds/open-source.webp";
// "Code by talking" opens the feature run right under the hero, so it shares
// the hero's own painting at the well's size instead of a sixth image.
import talk from "@/assets/hero/stage-backdrop-well.webp";

/** Distinct paintings; all window geometry still belongs to DemoStage. */
export const DEMO_BACKDROPS = { talk, plugins, skills, clis, agents, "open-source": openSource };
export type DemoBackdrop = keyof typeof DEMO_BACKDROPS;
