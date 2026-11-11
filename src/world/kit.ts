/**
 * Small tools every part of the world shares: colours from the page's own
 * tokens, loaders, and frame-rate independent smoothing.
 *
 * NOTHING IN HERE, OR IN ANY PART, MAY TOUCH `window` OR `document`. The scene
 * runs in a worker wherever the browser allows it (src/world/link.ts), and a
 * worker has neither. What the scene needs from the page is handed to it.
 */
import { Color, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace, Texture, type Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** How much the device is asked to draw. Decided once, at start. */
export interface Tier {
  /** A phone or a small tablet: half-size textures, fewer particles. */
  small: boolean;
  /** Upper bound for the canvas's pixel ratio. */
  maxPixelRatio: number;
  /** No travel, no idle motion (prefers-reduced-motion). */
  calm: boolean;
}

/** Everything a part needs to build itself. */
export interface Context {
  tier: Tier;
  /** Largest anisotropy the GPU offers, already capped. */
  anisotropy: number;
  token: (name: string) => Color;
}

/**
 * The names of every token the scene uses. The page reads their values from
 * its stylesheet and hands them over (src/world/link.ts), so the tokens stay
 * the single source of truth (docs/design.md): no part names a colour itself.
 */
export const TOKEN_NAMES = [
  "--canvas",
  "--ink",
  "--muted",
  "--accent",
  "--success",
  "--error",
  "--surface-card",
  "--surface-strong",
  "--hairline",
  "--hairline-strong",
  "--app-bg",
  "--world-accent",
  "--tui-claude",
  "--tui-codex",
  "--tui-gemini",
  "--tui-opencode",
  "--world-gold",
  "--world-lamp",
  "--world-screen",
  "--world-dawn",
  "--world-sky",
  "--world-cloth",
  "--world-face",
  "--world-star",
  "--agent-violet",
  "--agent-sage",
  "--agent-orange",
  "--agent-sky",
  "--agent-rose",
  "--agent-lime",
  "--agent-lilac",
  "--agent-teal",
  "--agent-eye",
  "--stage-thinking",
  "--stage-grep",
  "--stage-read",
  "--stage-edit",
  "--stage-done",
] as const;

export type Tokens = Record<string, string>;

/** A colour by its token name, from the values the page handed over. */
export function tokenLookup(tokens: Tokens): (name: string) => Color {
  return (name) => {
    const value = tokens[name];
    if (!value) throw new Error(`the page did not hand over the token ${name}`);
    return new Color(value);
  };
}

/**
 * The app's two typefaces, for text drawn in the scene (labels, terminals).
 * A worker has its own font set, so they are loaded here and not by the page.
 * Without them the drawing falls back to the system's fonts.
 */
export async function loadFonts(faces: readonly { family: string; url: string; weight: string }[]): Promise<void> {
  const set = (globalThis as unknown as { fonts?: { add(face: FontFace): void } }).fonts;
  if (!set || typeof FontFace === "undefined") return;
  await Promise.all(
    faces.map(async ({ family, url, weight }) => {
      try {
        const face = new FontFace(family, `url(${url})`, { weight });
        await face.load();
        set.add(face);
      } catch {
        // The system's font draws the text instead.
      }
    }),
  );
}

/** A 2D canvas to draw a texture on, in a worker or on the page. */
export function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export type Pen = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let gltfLoader: GLTFLoader | null = null;

export function loadModel(url: string): Promise<GLTF> {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader.loadAsync(url);
}

async function decode(url: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // Low priority: the scene is never what the page is waiting for.
      const response = await fetch(url, { priority: "low" } as RequestInit);
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const blob = await response.blob();
      // Decoded off the main thread, which is the point of this branch.
      return await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    } catch {
      // Fall through to the element: an older Safari rejects the options bag.
    }
  }
  if (typeof Image === "undefined") throw new Error(`could not decode ${url}`);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/**
 * A colour texture laid out for a model's own UVs (the glTF convention: no
 * vertical flip).
 */
export async function loadTexture(url: string, ctx: Context): Promise<Texture> {
  const texture = new Texture(await decode(url));
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = ctx.anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Exponential approach that does not depend on the frame rate. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function find<T extends Object3D>(root: Object3D, name: string): T {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`the model has no node named ${name}`);
  return found as T;
}

/** Give the browser a turn, so a long setup never becomes one long task. */
export function breathe(): Promise<void> {
  return new Promise((resolve) => {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (scheduler?.yield) void scheduler.yield().then(resolve);
    else setTimeout(resolve, 0);
  });
}

/** A repeatable random stream, so the scene is the same on every visit. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
