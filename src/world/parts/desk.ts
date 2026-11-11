/**
 * The set: a floating piece of a room with the desk, the monitor and the empty
 * chair. It is drawn unlit. Its light was computed ahead of time in Blender and
 * stored in two pairs of textures, night and morning, which this part blends.
 *
 * The model, its node names and its bake are described in art/desk/build.py.
 */
import {
  AdditiveBlending,
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
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
  type Texture,
} from "three";

import deskUrl from "@/assets/world/desk.glb?url";
import edgesUrl from "@/assets/world/desk-edges.bin?url";
import farDawn from "@/assets/world/desk-far-dawn.webp?url";
import farDawnSmall from "@/assets/world/desk-far-dawn-1k.webp?url";
import farNight from "@/assets/world/desk-far-night.webp?url";
import farNightSmall from "@/assets/world/desk-far-night-1k.webp?url";
import nearDawn from "@/assets/world/desk-near-dawn.webp?url";
import nearDawnSmall from "@/assets/world/desk-near-dawn-1k.webp?url";
import nearNight from "@/assets/world/desk-near-night.webp?url";
import nearNightSmall from "@/assets/world/desk-near-night-1k.webp?url";
import screenUrl from "@/assets/world/screen.webp?url";

import { find, loadModel, loadTexture, makeCanvas, type Context, type Pen } from "../kit";
import type { Channels } from "../timeline";

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
  varying float vAlong;
  varying float vFacing;
  void main() {
    // Brightest at the shade, gone at the desk; soft toward the cone's silhouette.
    float a = pow(vAlong, 1.6) * pow(vFacing, 1.4) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

export interface Desk {
  group: Group;
  /** Centre of the monitor's screen, world space. */
  screenCenter: Vector3;
  /** Width and height of the screen quad, metres. */
  screenSize: { width: number; height: number };
  /** Where the mascot sits; carries its rotation. */
  mascotAnchor: Object3D;
  lampBulb: Vector3;
  /** Fetch the morning textures. Until they arrive the set stays in night. */
  loadDawn(): Promise<void>;
  /** Fetch the wireframe. Until it arrives the set shows none. */
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

export async function createDesk(ctx: Context, glow: Texture): Promise<Desk> {
  const small = ctx.tier.small;
  const [gltf, nearTexture, farTexture, screenTexture] = await Promise.all([
    loadModel(deskUrl),
    loadTexture(small ? nearNightSmall : nearNight, ctx),
    loadTexture(small ? farNightSmall : farNight, ctx),
    loadTexture(screenUrl, ctx),
  ]);

  const group = new Group();
  group.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  const bakedMaterial = (texture: Texture) =>
    new ShaderMaterial({
      uniforms: {
        tNight: { value: texture },
        tDawn: { value: texture },
        uDawn: { value: 0 },
        uGain: { value: 0 },
      },
      vertexShader: BAKED_VERTEX,
      fragmentShader: BAKED_FRAGMENT,
    });

  const near = find<Mesh>(gltf.scene, "Near");
  const far = find<Mesh>(gltf.scene, "Far");
  const nearMaterial = bakedMaterial(nearTexture);
  const farMaterial = bakedMaterial(farTexture);
  near.material = nearMaterial;
  far.material = farMaterial;

  const screen = find<Mesh>(gltf.scene, "Screen");
  const screenMaterial = new MeshBasicMaterial({ map: screenTexture, toneMapped: false });
  screen.material = screenMaterial;
  const screenBox = new Box3().setFromObject(screen);
  const screenCenter = screenBox.getCenter(new Vector3());
  const screenExtent = screenBox.getSize(new Vector3());

  const mascotAnchor = find<Object3D>(gltf.scene, "MascotAnchor");
  const lampBulb = new Vector3();
  const lampPool = new Vector3();
  find<Object3D>(gltf.scene, "LampBulb").getWorldPosition(lampBulb);
  find<Object3D>(gltf.scene, "LampPool").getWorldPosition(lampPool);

  // The lamp itself: a glow at the bulb and a faint cone of lit air under it.
  const lampColor = ctx.token("--world-lamp");
  const bulbGlow = new Sprite(
    new SpriteMaterial({ map: glow, color: lampColor, blending: AdditiveBlending, depthWrite: false, transparent: true }),
  );
  bulbGlow.position.copy(lampBulb);
  bulbGlow.scale.setScalar(0.42);
  group.add(bulbGlow);

  const drop = lampBulb.distanceTo(lampPool);
  const coneGeometry = new ConeGeometry(drop * 0.52, drop, 40, 1, true);
  // Apex at the origin, opening along -Y, so it can be aimed with lookAt.
  coneGeometry.translate(0, -drop / 2, 0);
  coneGeometry.rotateX(-Math.PI / 2);
  const coneMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: lampColor }, uStrength: { value: 0 } },
    vertexShader: CONE_VERTEX,
    fragmentShader: CONE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const cone = new Mesh(coneGeometry, coneMaterial);
  cone.position.copy(lampBulb);
  cone.lookAt(lampPool);
  cone.renderOrder = 2;
  group.add(cone);

  // A breath of light in front of the monitor, so the screen reads as lit glass.
  const screenGlow = new Sprite(
    new SpriteMaterial({
      map: glow,
      color: ctx.token("--world-screen"),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  screenGlow.position.copy(screenCenter).add(new Vector3(0, 0, 0.02));
  screenGlow.scale.set(screenExtent.x * 2.1, screenExtent.y * 2.6, 1);
  screenGlow.renderOrder = 1;
  group.add(screenGlow);

  let edges: LineSegments | null = null;
  const edgeMaterial = new LineBasicMaterial({
    color: ctx.token("--ink"),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  let dawnRequested = false;
  let edgesRequested = false;

  return {
    group,
    screenCenter,
    screenSize: { width: screenExtent.x, height: screenExtent.y },
    mascotAnchor,
    lampBulb,

    async loadDawn() {
      if (dawnRequested) return;
      dawnRequested = true;
      const [nearMorning, farMorning] = await Promise.all([
        loadTexture(small ? nearDawnSmall : nearDawn, ctx),
        loadTexture(small ? farDawnSmall : farDawn, ctx),
      ]);
      nearMaterial.uniforms.tDawn.value = nearMorning;
      farMaterial.uniforms.tDawn.value = farMorning;
    },

    async loadEdges() {
      if (edgesRequested) return;
      edgesRequested = true;
      const response = await fetch(edgesUrl, { priority: "low" } as RequestInit);
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
      const flicker = reveal >= 1 ? 1 : reveal < 0.18 ? 0 : reveal < 0.3 ? 0.55 : reveal < 0.38 ? 0.12 : Math.min(1, 0.6 + (reveal - 0.38) * 0.9);
      const dawnReady = nearMaterial.uniforms.tDawn.value !== nearMaterial.uniforms.tNight.value;
      const dawn = dawnReady ? ch.dawn : 0;
      const dim = 1 - 0.72 * ch.wire;
      const gain = flicker * dim;
      nearMaterial.uniforms.uGain.value = gain;
      farMaterial.uniforms.uGain.value = gain;
      nearMaterial.uniforms.uDawn.value = dawn;
      farMaterial.uniforms.uDawn.value = dawn;

      // The screen wakes a moment before the lamp.
      const awake = Math.min(1, reveal / 0.16);
      screenMaterial.color.setScalar(awake * dim * (0.92 + 0.02 * Math.sin(time * 1.7)));
      (screenGlow.material as SpriteMaterial).opacity = 0.1 * awake * dim * (1 - 0.6 * dawn) * (1 - ch.dock);

      const lamp = flicker * (1 - dawn) * dim;
      (bulbGlow.material as SpriteMaterial).opacity = 0.85 * lamp * (1 - 0.8 * ch.dock);
      coneMaterial.uniforms.uStrength.value = 0.16 * lamp * (1 - ch.dock);
      cone.visible = lamp > 0.01;

      if (edges) {
        edges.visible = ch.wire > 0.01;
        edgeMaterial.opacity = 0.55 * ch.wire;
      }
    },
  };
}
