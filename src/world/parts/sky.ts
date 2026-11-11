/**
 * Everything in the air: the far stars, the dust in the lamp light, the
 * stargazers' lights above the desk, and the rings of sound around the mascot
 * when it listens.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type Color,
  type PerspectiveCamera,
} from "three";

import { seeded, type Context } from "../kit";
import type { Channels } from "../timeline";

const POINT_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  /* Window height in CSS px times the projection's vertical scale, halved:
     multiplies a size in metres into a size in px at depth 1. */
  uniform float uProject;
  uniform float uAttenuate;
  uniform vec3 uDrift;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  uniform vec3 uLamp;
  uniform float uLampReach;
  varying float vLevel;
  void main() {
    vec3 p = position;
    // Drifting points wrap inside their box, so the air never runs out.
    if (uBoxSize.x > 0.0) {
      p = uBoxMin + mod(p - uBoxMin + uDrift * uTime * (0.5 + aSeed), uBoxSize);
      p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.06;
    }
    vec4 world = modelMatrix * vec4(p, 1.0);
    vec4 view = viewMatrix * world;
    float twinkle = 0.72 + 0.28 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 90.0);
    // Dust is only seen where the lamp's light is: the falloff is steep on purpose.
    float away = distance(world.xyz, uLamp) / max(uLampReach, 0.0001);
    float lamp = uLampReach > 0.0 ? 1.6 * exp(-away * away) : 1.0;
    vLevel = twinkle * lamp;
    float size = aSize * (uAttenuate > 0.5 ? uProject / max(0.1, -view.z) : 1.0);
    // A point smaller than a pixel flickers; hold the size and lower the light instead.
    float held = max(size, 1.2);
    vLevel *= (size * size) / (held * held);
    gl_PointSize = held * uPixelRatio;
    gl_Position = projectionMatrix * view;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  varying float vLevel;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    gl_FragColor = vec4(uColor * (a * vLevel * uLevel), 1.0);
    #include <colorspace_fragment>
  }
`;

const VOICE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOICE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float light = 0.0;
    for (int i = 0; i < 3; i++) {
      float phase = fract(uTime * mix(0.22, 0.6, uPulse) + float(i) / 3.0);
      float radius = 0.3 + phase * 0.68;
      float width = mix(0.004, 0.011, phase);
      float ring = 1.0 - smoothstep(0.0, width, abs(r - radius));
      light += ring * pow(1.0 - phase, 2.0);
    }
    float a = light * uLevel * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

interface PointsSpec {
  positions: Float32Array;
  sizes: Float32Array;
  color: Color;
  attenuate: boolean;
  drift?: Vector3;
  box?: { min: Vector3; size: Vector3 };
  lamp?: { at: Vector3; reach: number };
  seed: number;
}

function makePoints(spec: PointsSpec): Points<BufferGeometry, ShaderMaterial> {
  const count = spec.positions.length / 3;
  const random = seeded(spec.seed);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = random();
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(spec.positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new BufferAttribute(spec.sizes, 1));
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uProject: { value: 1 },
      uAttenuate: { value: spec.attenuate ? 1 : 0 },
      uDrift: { value: spec.drift ?? new Vector3() },
      uBoxMin: { value: spec.box?.min ?? new Vector3() },
      uBoxSize: { value: spec.box?.size ?? new Vector3() },
      uLamp: { value: spec.lamp?.at ?? new Vector3() },
      uLampReach: { value: spec.lamp?.reach ?? 0 },
      uColor: { value: spec.color },
      uLevel: { value: 0 },
    },
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export interface Sky {
  group: Group;
  update(input: {
    ch: Channels;
    reveal: number;
    time: number;
    camera: PerspectiveCamera;
    pixelRatio: number;
    viewportHeight: number;
    /** 0..1: how strongly the mascot is being spoken to right now. */
    listening: number;
    face: Vector3;
  }): void;
}

export function createSky(ctx: Context, lampBulb: Vector3, stargazers: number): Sky {
  const group = new Group();
  const small = ctx.tier.small;
  const calm = ctx.tier.calm;
  const random = seeded(20261111);

  // The far stars: a shell around everything, sizes in px.
  const farCount = small ? 420 : 900;
  const farPositions = new Float32Array(farCount * 3);
  const farSizes = new Float32Array(farCount);
  for (let i = 0; i < farCount; i++) {
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const flat = Math.sqrt(1 - u * u);
    const radius = 70 + random() * 20;
    farPositions.set([Math.cos(angle) * flat * radius, u * radius, Math.sin(angle) * flat * radius], i * 3);
    farSizes[i] = 1.2 + random() * random() * 2.4;
  }
  const far = makePoints({
    positions: farPositions,
    sizes: farSizes,
    color: ctx.token("--ink"),
    attenuate: false,
    seed: 11,
  });

  // The stargazers: one light for each person who starred the repository, in
  // a slow wheel in the night sky, seen through the room's window.
  const gazerCount = Math.max(1, Math.min(stargazers, 4000));
  const gazerPositions = new Float32Array(gazerCount * 3);
  const gazerSizes = new Float32Array(gazerCount);
  for (let i = 0; i < gazerCount; i++) {
    const radius = 0.7 + Math.sqrt(random()) * 3.9;
    const arm = Math.floor(random() * 3) * ((Math.PI * 2) / 3);
    const angle = arm + radius * 0.7 + (random() - 0.5) * 1.0;
    gazerPositions.set([Math.cos(angle) * radius, (random() - 0.5) * 0.7 * (1.3 - radius / 5), Math.sin(angle) * radius], i * 3);
    gazerSizes[i] = 0.035 + random() * 0.055;
  }
  const gazers = makePoints({
    positions: gazerPositions,
    sizes: gazerSizes,
    color: ctx.token("--world-star"),
    attenuate: true,
    seed: 23,
  });
  // The wheel stands upright outside the left wall, facing the window, and
  // turns about its own axis.
  const wheel = new Group();
  wheel.position.set(-13.5, 4.2, 0.5);
  wheel.rotation.set(0, 0, Math.PI / 2 - 0.3);
  const turning = new Group();
  turning.add(gazers);
  wheel.add(turning);

  // Dust: what makes the lamp's light visible as light.
  const dustCount = small ? 90 : 180;
  const boxMin = new Vector3(-1.7, 0.74, -2.7);
  const boxSize = new Vector3(2.4, 1.5, 1.5);
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSizes = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPositions.set(
      [boxMin.x + random() * boxSize.x, boxMin.y + random() * boxSize.y, boxMin.z + random() * boxSize.z],
      i * 3,
    );
    dustSizes[i] = 0.003 + random() * 0.005;
  }
  const dust = makePoints({
    positions: dustPositions,
    sizes: dustSizes,
    color: ctx.token("--world-lamp"),
    attenuate: true,
    drift: new Vector3(0.012, 0.03, 0.006),
    box: { min: boxMin, size: boxSize },
    lamp: { at: lampBulb, reach: 0.55 },
    seed: 37,
  });

  // The rings of sound: one plane behind the mascot, turned to the camera.
  const voiceMaterial = new ShaderMaterial({
    uniforms: {
      uColor: { value: ctx.token("--ink") },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: VOICE_VERTEX,
    fragmentShader: VOICE_FRAGMENT,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const voice = new Mesh(new PlaneGeometry(1.25, 1.25), voiceMaterial);
  voice.renderOrder = 1;
  voice.visible = false;

  group.add(far, wheel, dust, voice);
  const away = new Vector3();
  const layers = [far, gazers, dust];

  return {
    group,

    update({ ch, reveal, time, camera, pixelRatio, viewportHeight, listening, face }) {
      const now = calm ? 0 : time;
      const project = (viewportHeight * camera.projectionMatrix.elements[5]) / 2;
      for (const layer of layers) {
        layer.material.uniforms.uTime.value = now;
        layer.material.uniforms.uPixelRatio.value = pixelRatio;
        layer.material.uniforms.uProject.value = project;
      }
      const shown = Math.min(1, Math.max(0, (reveal - 0.2) / 0.8));
      far.material.uniforms.uLevel.value = shown * (0.34 + 0.5 * ch.stars) * (1 - 0.75 * ch.dawn);
      gazers.material.uniforms.uLevel.value = Math.max(ch.stars, 0.35 * shown) * (1 - 0.9 * ch.dawn);
      gazers.visible = shown > 0.003;
      dust.material.uniforms.uLevel.value = shown * 0.7 * (1 - 0.55 * ch.dawn) * (1 - ch.dock) * (1 - 0.7 * ch.wire);
      if (!calm) turning.rotation.y = time * 0.02;

      const level = listening * 0.5 * ch.voice * (1 - ch.dock);
      voice.visible = level > 0.004;
      if (voice.visible) {
        away.copy(face).sub(camera.position).normalize();
        voice.position.copy(face).addScaledVector(away, 0.22);
        voice.quaternion.copy(camera.quaternion);
        voiceMaterial.uniforms.uTime.value = now;
        voiceMaterial.uniforms.uLevel.value = level;
        voiceMaterial.uniforms.uPulse.value = listening;
      }
    },
  };
}
