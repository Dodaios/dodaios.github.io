/**
 * The room: the whole set, in zones. Each zone is one model with its own baked
 * light in two states, night and morning, which this part blends. The room is
 * drawn unlit: the light was computed ahead of time in Blender (art/room).
 *
 * A zone's model carries three kinds of things:
 *   Zone_*            the furniture, one mesh per atlas (material `Bake_<atlas>`)
 *   Screen*, Wall_*,  flat quads the scene draws on at run time: the app, the
 *   Text_*            terminals, and every piece of text in the room
 *   anchors           empties the other parts read positions from
 *
 * The first two zones (the shell and the desk) are what the first screen needs;
 * the others arrive while the visitor is still at the desk.
 */
import {
  AdditiveBlending,
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";

import { loadModel, loadTexture, makeCanvas, type Context, type Pen } from "../kit";
import { AGENT_COUNT, HOLO_CENTER } from "../script";
import type { Channels } from "../timeline";

/** Every shipped file of the room, by its name (scripts/build-world-assets.mjs writes them). */
const FILES = import.meta.glob<string>("../../assets/world/room-*", { query: "?url", import: "default", eager: true });
const SCREEN_FILES = import.meta.glob<string>("../../assets/world/screen.webp", {
  query: "?url",
  import: "default",
  eager: true,
});

function file(name: string): string | null {
  for (const [path, url] of Object.entries(FILES)) if (path.endsWith(`/${name}`)) return url;
  return null;
}

export type ZoneName = "shell" | "desk" | "right" | "lounge" | "window" | "corner";

/** The order the tour visits them in. */
export const ZONES: readonly ZoneName[] = ["shell", "desk", "right", "lounge", "window", "corner"];

const BAKED_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BAKED_FRAGMENT = /* glsl */ `
  uniform sampler2D tNight;
  uniform sampler2D tDawn;
  uniform float uDawn;
  uniform float uGain;
  varying vec2 vUv;
  void main() {
    vec3 night = texture2D(tNight, vUv).rgb;
    vec3 dawn = texture2D(tDawn, vUv).rgb;
    gl_FragColor = vec4(mix(night, dawn, uDawn) * uGain, 1.0);
    #include <colorspace_fragment>
  }
`;

const CONE_VERTEX = /* glsl */ `
  varying float vAlong;
  varying float vFacing;
  void main() {
    vAlong = uv.y;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-view.xyz)));
    gl_Position = projectionMatrix * view;
  }
`;

const CONE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uPower;
  varying float vAlong;
  varying float vFacing;
  void main() {
    // Brightest at the source, gone at the far end; soft toward the silhouette.
    float a = pow(vAlong, uPower) * pow(vFacing, 1.4) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

/* What is outside the window: black at night, a low warm sky in the morning. */
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uNight;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform float uDawn;
  varying vec2 vUv;
  void main() {
    vec3 morning = mix(uHorizon, uZenith, smoothstep(0.1, 0.95, vUv.y));
    gl_FragColor = vec4(mix(uNight, morning, uDawn), 1.0);
    #include <colorspace_fragment>
  }
`;

export interface Anchor {
  position: Vector3;
  /** Turn about the vertical axis, radians. */
  yaw: number;
}

export interface Room {
  group: Group;
  /** The main monitor's screen: where the app lands. Set once the desk is in. */
  screen: { center: Vector3; width: number; height: number };
  /** Every quad that has arrived so far, by name. */
  quads: Map<string, Mesh>;
  anchors: Map<string, Anchor>;
  /** Bring a zone in. Resolves when it is in the scene; safe to call twice. */
  loadZone(name: ZoneName): Promise<void>;
  /** Fetch the morning's textures for every zone that is in. */
  loadDawn(): Promise<void>;
  loadEdges(): Promise<void>;
  update(ch: Channels, reveal: number, time: number): void;
}

/** A soft round glow, shared by every light in the scene that needs one. */
export function glowTexture(): Texture {
  const size = 96;
  const canvas = makeCanvas(size, size);
  const g = canvas.getContext("2d") as Pen;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

interface Atlas {
  material: ShaderMaterial;
  zone: ZoneName;
  name: string;
  dawnLoaded: boolean;
}

export function createRoom(ctx: Context, glow: Texture): Room {
  const small = ctx.tier.small;
  const group = new Group();
  const quads = new Map<string, Mesh>();
  const anchors = new Map<string, Anchor>();
  const atlases: Atlas[] = [];
  const loading = new Map<ZoneName, Promise<void>>();
  const screen = { center: new Vector3(0, 1.16, -2.38), width: 0.7536, height: 0.42 };

  /* A quad nobody has drawn on yet: dark glass, so nothing flashes white. */
  const blank = new MeshBasicMaterial({ color: ctx.token("--canvas") });
  const unseen = new MeshBasicMaterial({ visible: false });

  const textureFor = async (atlas: string, state: "night" | "dawn"): Promise<Texture | null> => {
    const url = (small && file(`room-${atlas}-${state}-1k.webp`)) || file(`room-${atlas}-${state}.webp`);
    if (!url) return null;
    return loadTexture(url, ctx);
  };

  /* ---- What the scene adds on top of the baked picture ------------------ */

  const lampColor = ctx.token("--world-lamp");
  const sprite = (color = lampColor) =>
    new Sprite(
      new SpriteMaterial({ map: glow, color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
    );
  const cone = (length: number, radius: number, power: number, color = lampColor) => {
    const geometry = new ConeGeometry(radius, length, 40, 1, true);
    // Apex at the origin, opening along +Z, so it can be aimed with lookAt.
    geometry.translate(0, -length / 2, 0);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: { uColor: { value: color }, uStrength: { value: 0 }, uPower: { value: power } },
      vertexShader: CONE_VERTEX,
      fragmentShader: CONE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.visible = false;
    return mesh;
  };

  // The desk lamp: a glow at the bulb and a faint cone of lit air under it.
  const bulbGlow = sprite();
  bulbGlow.scale.setScalar(0.36);
  let lampCone: Mesh | null = null;
  // A breath of light in front of the monitor, so the screen reads as lit glass.
  const screenGlow = sprite(ctx.token("--world-screen"));
  screenGlow.renderOrder = 1;
  // The gold wordmark's bloom.
  const wordmarkGlow = sprite(ctx.token("--world-gold"));
  wordmarkGlow.scale.set(2.6, 1.0, 1);
  // The hologram's beam: light rising from the table's lens.
  const beam = cone(1.1, 0.5, 1.2, ctx.token("--world-accent"));
  group.add(bulbGlow, screenGlow, wordmarkGlow, beam);

  // Outside the window. Far enough out that the stars' lights stand in front of it.
  const skyMaterial = new ShaderMaterial({
    uniforms: {
      uNight: { value: ctx.token("--canvas") },
      uHorizon: { value: ctx.token("--world-dawn") },
      uZenith: { value: ctx.token("--world-sky") },
      uDawn: { value: 0 },
    },
    vertexShader: BAKED_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
  });
  const sky = new Mesh(new PlaneGeometry(60, 30), skyMaterial);
  sky.position.set(-34, 6, 0);
  sky.rotation.y = -Math.PI / 2;
  sky.frustumCulled = false;
  group.add(sky);

  let edges: LineSegments | null = null;
  const edgeMaterial = new LineBasicMaterial({
    color: ctx.token("--ink"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  let edgesRequested = false;

  /* ---- Bringing a zone in ----------------------------------------------- */

  const adopt = async (name: ZoneName): Promise<void> => {
    const url = file(`room-${name}.glb`);
    if (!url) throw new Error(`the room has no zone called ${name}`);
    const gltf = await loadModel(url);
    gltf.scene.updateMatrixWorld(true);

    // Nothing of a zone is on record before all of it has arrived: a zone whose
    // light failed to load must not leave quads behind that answer a press.
    const meshes: Mesh[] = [];
    const foundAnchors: [string, Anchor][] = [];
    const foundQuads: Mesh[] = [];
    const made: Atlas[] = [];
    gltf.scene.traverse((node: Object3D) => {
      if ((node as Mesh).isMesh) meshes.push(node as Mesh);
      else if (!node.children.length && node !== gltf.scene && node.name) {
        const position = node.getWorldPosition(new Vector3());
        const m = node.matrixWorld.elements;
        foundAnchors.push([node.name, { position, yaw: Math.atan2(m[8], m[10]) }]);
      }
    });

    const pending: Promise<void>[] = [];
    for (const mesh of meshes) {
      if (mesh.name.startsWith("Zone_")) {
        const atlasName = ((mesh.material as Material).name || `Bake_${name}`).replace(/^Bake_/, "");
        let atlas = atlases.find((entry) => entry.name === atlasName);
        if (!atlas) {
          const material = new ShaderMaterial({
            uniforms: { tNight: { value: null }, tDawn: { value: null }, uDawn: { value: 0 }, uGain: { value: 0 } },
            vertexShader: BAKED_VERTEX,
            fragmentShader: BAKED_FRAGMENT,
          });
          atlas = { material, zone: name, name: atlasName, dawnLoaded: false };
          atlases.push(atlas);
          made.push(atlas);
          const entry = atlas;
          pending.push(
            textureFor(atlasName, "night").then((texture) => {
              if (!texture) throw new Error(`the room has no night texture for ${atlasName}`);
              entry.material.uniforms.tNight.value = texture;
              entry.material.uniforms.tDawn.value = texture;
            }),
          );
        }
        mesh.material = atlas.material;
      } else {
        // A quad. Text printed on a baked surface stays unseen until it is drawn.
        const surface = (mesh.material as Material).name === "Quad_surface";
        mesh.material = surface ? unseen : blank;
        mesh.userData.surface = surface;
        foundQuads.push(mesh);
      }
    }
    try {
      await Promise.all(pending);
    } catch (error) {
      for (const atlas of made) atlases.splice(atlases.indexOf(atlas), 1);
      throw error;
    }
    for (const [key, anchor] of foundAnchors) anchors.set(key, anchor);
    for (const mesh of foundQuads) quads.set(mesh.name, mesh);
    group.add(gltf.scene);

    if (name === "desk") {
      const monitor = quads.get("Screen");
      if (monitor) {
        const box = new Box3().setFromObject(monitor);
        box.getCenter(screen.center);
        const extent = box.getSize(new Vector3());
        screen.width = extent.x;
        screen.height = extent.y;
        const url = Object.values(SCREEN_FILES)[0];
        if (url) {
          const texture = await loadTexture(url, ctx);
          monitor.material = new MeshBasicMaterial({ map: texture, toneMapped: false });
          monitor.userData.picture = true;
        }
        screenGlow.position.copy(screen.center).add(new Vector3(0, 0, 0.02));
        screenGlow.scale.set(screen.width * 2.1, screen.height * 2.6, 1);
      }
      const bulb = anchors.get("LampBulb");
      const pool = anchors.get("LampPool");
      if (bulb && pool) {
        bulbGlow.position.copy(bulb.position);
        const drop = bulb.position.distanceTo(pool.position);
        lampCone = cone(drop, drop * 0.5, 1.6);
        lampCone.position.copy(bulb.position);
        lampCone.lookAt(pool.position);
        group.add(lampCone);
      }
      const wordmark = anchors.get("Wordmark");
      if (wordmark) wordmarkGlow.position.copy(wordmark.position).add(new Vector3(0, 0, 0.12));
    }
    if (name === "lounge") {
      const holo = anchors.get("HoloCenter")?.position ?? new Vector3(...HOLO_CENTER);
      beam.position.set(holo.x, holo.y - 0.74, holo.z);
      beam.lookAt(holo.x, holo.y + 1, holo.z);
    }
  };

  return {
    group,
    screen,
    quads,
    anchors,

    loadZone(name) {
      let job = loading.get(name);
      if (!job) {
        // A failure is not kept: the next call tries again.
        job = adopt(name).catch((error: unknown) => {
          loading.delete(name);
          throw error;
        });
        loading.set(name, job);
      }
      return job;
    },

    async loadDawn() {
      await Promise.all(
        atlases
          .filter((atlas) => !atlas.dawnLoaded)
          .map(async (atlas) => {
            atlas.dawnLoaded = true;
            const texture = await textureFor(atlas.name, "dawn");
            if (texture) atlas.material.uniforms.tDawn.value = texture;
          }),
      );
    },

    async loadEdges() {
      if (edgesRequested) return;
      edgesRequested = true;
      const url = file("room-edges.bin");
      if (!url) return;
      const response = await fetch(url, { priority: "low" } as RequestInit);
      if (!response.ok) return;
      // Pairs of points, packed by scripts/build-world-assets.mjs: four floats
      // (the size of one step, then the offset per axis), then 16-bit triples.
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 16 + 12) return;
      const [step, ox, oy, oz] = new Float32Array(buffer, 0, 4);
      const packed = new Uint16Array(buffer, 16);
      const points = new Float32Array(packed.length);
      for (let i = 0; i < packed.length; i += 3) {
        points[i] = ox + packed[i] * step;
        points[i + 1] = oy + packed[i + 1] * step;
        points[i + 2] = oz + packed[i + 2] * step;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(points, 3));
      edges = new LineSegments(geometry, edgeMaterial);
      edges.renderOrder = 3;
      group.add(edges);
    },

    update(ch, reveal, time) {
      // The lamp does not fade up: it catches, like a real one.
      const flicker =
        reveal >= 1 ? 1 : reveal < 0.18 ? 0 : reveal < 0.3 ? 0.55 : reveal < 0.38 ? 0.12 : Math.min(1, 0.6 + (reveal - 0.38) * 0.9);
      const dim = 1 - 0.74 * ch.wire;
      const awake = Math.min(1, ch.agents / AGENT_COUNT);
      // Morning comes to the whole room at once, sky included, or not yet at all.
      const dawnReady = atlases.every((atlas) => atlas.material.uniforms.tDawn.value !== atlas.material.uniforms.tNight.value);
      const dawn = dawnReady ? ch.dawn : 0;
      // The screens' and the beam's faint pulse is idle motion.
      const beat = ctx.tier.calm ? 0 : time;
      for (const atlas of atlases) {
        // The agents wall is baked with its six screens on; until they wake it
        // stands in the half dark, and the morning lights it either way.
        const zoneGain = atlas.zone === "right" ? Math.min(1, 0.4 + 0.6 * awake + 0.6 * dawn) : 1;
        atlas.material.uniforms.uGain.value = flicker * dim * zoneGain;
        atlas.material.uniforms.uDawn.value = dawn;
      }
      skyMaterial.uniforms.uDawn.value = dawn;

      const monitor = quads.get("Screen");
      if (monitor?.userData.picture) {
        // The screen wakes a moment before the lamp.
        const on = Math.min(1, reveal / 0.16);
        (monitor.material as MeshBasicMaterial).color.setScalar(on * dim * (0.94 + 0.02 * Math.sin(beat * 1.7)));
        (screenGlow.material as SpriteMaterial).opacity = 0.08 * on * dim * (1 - 0.6 * dawn) * (1 - ch.dock);
      }

      const lamp = flicker * (1 - dawn) * dim;
      (bulbGlow.material as SpriteMaterial).opacity = 0.8 * lamp * (1 - 0.8 * ch.dock);
      if (lampCone) {
        (lampCone.material as ShaderMaterial).uniforms.uStrength.value = 0.14 * lamp * (1 - ch.dock);
        lampCone.visible = lamp > 0.01;
      }
      (wordmarkGlow.material as SpriteMaterial).opacity = 0.16 * flicker * dim * (1 - 0.7 * dawn);

      const holo = ch.rings * dim;
      (beam.material as ShaderMaterial).uniforms.uStrength.value = 0.2 * holo * (0.9 + 0.1 * Math.sin(beat * 2.3));
      beam.visible = holo > 0.01;

      if (edges) {
        edges.visible = ch.wire > 0.01;
        edgeMaterial.opacity = 0.5 * ch.wire;
      }
    },
  };
}
