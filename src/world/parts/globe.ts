/**
 * The globe by the window. A real one would be a printed ball on a stand; the
 * stand is modelled and baked with the room (art/room/zone_window.py), and the
 * ball is drawn here, because it turns and because it carries a light for
 * every place where somebody who starred the project says they live.
 *
 * The land comes from the site's own one-bit land mask (src/data/land-mask.ts,
 * Natural Earth, public domain); the places come from the page
 * (src/data/stargazers.json, grouped by place: a pin stands for a city or a
 * country, never for a person).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  Points,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  type PerspectiveCamera,
  type Ray,
} from "three";

import { LAND_LAT_CELLS, LAND_LON_CELLS, LAND_MASK_BASE64 } from "@/data/land-mask";

import { type Context } from "../kit";
import type { Channels } from "../timeline";

/** What the page hands over: where the pins go and what each is called. */
export interface GlobeData {
  /** Latitude, longitude, how many people, for each place: a flat list of triples. */
  pins: readonly number[];
  /** The name of each place, in the same order. */
  labels: readonly string[];
}

const GLOBE_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GLOBE_FRAGMENT = /* glsl */ `
  uniform sampler2D tLand;
  uniform vec3 uOcean;
  uniform vec3 uLand;
  uniform vec3 uLine;
  uniform vec3 uLamp;
  uniform vec3 uSun;
  uniform vec3 uToLamp;
  uniform vec3 uToSun;
  uniform vec3 uEye;
  uniform float uDawn;
  uniform float uGain;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  const float PI = 3.141592653589793;
  void main() {
    vec3 p = normalize(vLocal);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.x, p.z);
    // The mask's first row is the north, its first column 180 degrees west.
    float land = smoothstep(0.38, 0.62, texture2D(tLand, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI)).r);

    // A line every thirty degrees, as on a printed globe; none over the poles' pinch.
    vec2 grid = vec2(degrees(lon), degrees(lat)) / 30.0;
    vec2 near = abs(fract(grid - 0.5) - 0.5) / max(fwidth(grid), vec2(1e-4));
    float line = (1.0 - min(min(near.x, near.y), 1.0)) * smoothstep(1.52, 1.3, abs(lat));

    vec3 paint = mix(uOcean, uLand, land);
    paint = mix(paint, uLine, line * (0.4 - 0.25 * land));

    vec3 n = normalize(vNormal);
    vec3 v = normalize(uEye - vWorld);
    // Night: the small spot above it and the room's dim air. Morning: the sun
    // through the window behind it, and a bright room.
    vec3 night = uLamp * (0.2 + 1.1 * max(dot(n, uToLamp), 0.0));
    vec3 morning = uSun * (0.42 + 1.0 * max(dot(n, uToSun), 0.0));
    vec3 light = mix(night, morning, uDawn);
    // The ocean is lacquered, the land is not.
    vec3 toLight = normalize(mix(uToLamp, uToSun, uDawn));
    float sheen = pow(max(dot(n, normalize(v + toLight)), 0.0), 60.0) * 0.3 * (1.0 - land);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.1;
    gl_FragColor = vec4((paint * light + sheen * mix(uLamp, uSun, uDawn) + rim * uLine) * uGain, 1.0);
    #include <colorspace_fragment>
  }
`;

const PIN_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uProject;
  uniform float uHover;
  attribute float aIndex;
  varying float vLevel;
  void main() {
    vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
    float hovered = 1.0 - step(0.5, abs(uHover - aIndex));
    float size = aSize * (1.0 + 0.9 * hovered) * uProject / max(0.1, -view.z);
    vLevel = 0.78 + 0.22 * sin(uTime * (0.8 + aSeed * 1.4) + aSeed * 60.0) + hovered;
    gl_PointSize = max(size, 2.0) * uPixelRatio;
    gl_Position = projectionMatrix * view;
  }
`;

const PIN_FRAGMENT = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uHalo;
  uniform float uLevel;
  varying float vLevel;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.42, 0.18, d);
    float halo = pow(max(0.0, 1.0 - d), 2.2);
    gl_FragColor = vec4((uCore * core + uHalo * halo * 0.7) * vLevel * uLevel, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface Globe {
  group: Group;
  update(input: { ch: Channels; reveal: number; time: number; camera: PerspectiveCamera; pixelRatio: number; viewportHeight: number }): void;
  /** The place under the ray, if a pin is close to where it meets the globe. */
  pick(ray: Ray): { label: string; index: number } | null;
  setHover(index: number): void;
}

/** One bit per cell, as one byte per cell: a texture the globe's shader can read. */
function landTexture(): DataTexture {
  const packed = Uint8Array.from(atob(LAND_MASK_BASE64), (c) => c.charCodeAt(0));
  const cells = new Uint8Array(LAND_LON_CELLS * LAND_LAT_CELLS);
  for (let i = 0; i < cells.length; i++) cells[i] = (packed[i >> 3] >> (i & 7)) & 1 ? 255 : 0;
  const texture = new DataTexture(cells, LAND_LON_CELLS, LAND_LAT_CELLS, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

const RAD = Math.PI / 180;
/** A point on the unit globe: longitude 0 faces +Z, east is toward +X, north is +Y. */
const onGlobe = (lat: number, lon: number, out: Vector3) =>
  out.set(Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD));

export function createGlobe(ctx: Context, center: Vector3, radius: number, data: GlobeData): Globe {
  const calm = ctx.tier.calm;
  const group = new Group();
  group.position.copy(center);
  // The axis leans 23.4 degrees toward +X, as the stand's meridian arc does.
  const tilt = new Group();
  tilt.rotation.z = -23.4 * RAD;
  const spin = new Group();
  // At rest the globe shows Europe and Africa to the room (+X).
  const START = (90 - 12) * RAD;
  spin.rotation.y = START;
  tilt.add(spin);
  group.add(tilt);

  const material = new ShaderMaterial({
    uniforms: {
      tLand: { value: landTexture() },
      uOcean: { value: ctx.token("--surface-card") },
      uLand: { value: ctx.token("--muted") },
      uLine: { value: ctx.token("--hairline-strong") },
      uLamp: { value: ctx.token("--world-lamp") },
      uSun: { value: ctx.token("--world-dawn") },
      // Toward the small spot in the ceiling, and toward the window's morning sun.
      uToLamp: { value: new Vector3(0.24, 0.96, 0.13).normalize() },
      uToSun: { value: new Vector3(-0.86, 0.4, 0.32).normalize() },
      uEye: { value: new Vector3() },
      uDawn: { value: 0 },
      uGain: { value: 0 },
    },
    vertexShader: GLOBE_VERTEX,
    fragmentShader: GLOBE_FRAGMENT,
  });
  const ball = new Mesh(new SphereGeometry(radius, ctx.tier.small ? 48 : 72, ctx.tier.small ? 32 : 48), material);
  spin.add(ball);

  // The pins: one light per place, a little larger where more people are.
  const count = Math.floor(data.pins.length / 3);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const indices = new Float32Array(count);
  const places: Vector3[] = [];
  const at = new Vector3();
  for (let i = 0; i < count; i++) {
    onGlobe(data.pins[i * 3], data.pins[i * 3 + 1], at);
    places.push(at.clone());
    positions.set([at.x * radius * 1.012, at.y * radius * 1.012, at.z * radius * 1.012], i * 3);
    sizes[i] = radius * (0.075 + 0.03 * Math.sqrt(Math.min(25, data.pins[i * 3 + 2])));
    seeds[i] = (i * 0.61803) % 1;
    indices[i] = i;
  }
  const pinGeometry = new BufferGeometry();
  pinGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  pinGeometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  pinGeometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  pinGeometry.setAttribute("aIndex", new BufferAttribute(indices, 1));
  const pinMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uProject: { value: 1 },
      uHover: { value: -1 },
      uCore: { value: ctx.token("--world-star") },
      uHalo: { value: ctx.token("--world-accent") },
      uLevel: { value: 0 },
    },
    vertexShader: PIN_VERTEX,
    fragmentShader: PIN_FRAGMENT,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const pins = new Points(pinGeometry, pinMaterial);
  pins.frustumCulled = false;
  pins.renderOrder = 1;
  spin.add(pins);

  const inverse = new Matrix4();
  const local = new Vector3();
  const toCenter = new Vector3();

  return {
    group,

    update({ ch, reveal, time, camera, pixelRatio, viewportHeight }) {
      // It turns slowly, and a little faster while it is the subject.
      if (!calm) spin.rotation.y = START + time * 0.09;
      const on = Math.min(1, reveal * 1.4);
      material.uniforms.uEye.value.copy(camera.position);
      material.uniforms.uDawn.value = ch.dawn;
      material.uniforms.uGain.value = on;
      pinMaterial.uniforms.uTime.value = calm ? 0 : time;
      pinMaterial.uniforms.uPixelRatio.value = pixelRatio;
      pinMaterial.uniforms.uProject.value = (viewportHeight * camera.projectionMatrix.elements[5]) / 2;
      pinMaterial.uniforms.uLevel.value = on * (0.55 + 0.45 * ch.globe) * (1 - 0.45 * ch.dawn);
    },

    pick(ray) {
      // Where the ray meets the ball, on the near side.
      toCenter.copy(center).sub(ray.origin);
      const along = toCenter.dot(ray.direction);
      const miss = toCenter.lengthSq() - along * along;
      if (along <= 0 || miss > radius * radius) return null;
      local.copy(ray.direction).multiplyScalar(along - Math.sqrt(radius * radius - miss)).add(ray.origin);
      spin.updateWorldMatrix(true, false);
      local.applyMatrix4(inverse.copy(spin.matrixWorld).invert()).normalize();
      let best = -1;
      // Within about four degrees of a pin.
      let nearest = Math.cos(4.2 * RAD);
      for (let i = 0; i < places.length; i++) {
        const close = places[i].dot(local);
        if (close > nearest) {
          nearest = close;
          best = i;
        }
      }
      return best < 0 ? null : { label: data.labels[best] ?? "", index: best };
    },

    setHover(index) {
      pinMaterial.uniforms.uHover.value = index;
    },
  };
}
