/**
 * The agent pods: eight small floating workstations around the desk, one agent
 * at each. They are dark until the Agents chapter lights them one by one, and
 * a thread of light runs from each lit pod to the monitor.
 *
 * One model, drawn eight times in a handful of draw calls. The model and its
 * node names are described in art/pod/build.py.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";

import podUrl from "@/assets/world/pod.glb?url";

import { find, loadModel, type Context } from "../kit";
import { POD_COUNT } from "../script";
import type { Channels } from "../timeline";

/** Where each pod floats, in the order they light up, and the agent's colour. */
const PODS: readonly { at: readonly [number, number, number]; tint: string }[] = [
  { at: [-2.55, 0.95, 0.3], tint: "--agent-violet" },
  { at: [2.6, 1.3, -0.1], tint: "--agent-orange" },
  { at: [-2.9, 2.5, -1.4], tint: "--agent-sky" },
  { at: [3.0, 2.8, -1.6], tint: "--agent-lime" },
  { at: [-1.35, 3.5, -2.2], tint: "--agent-rose" },
  { at: [1.5, 3.9, -2.4], tint: "--agent-teal" },
  { at: [0.05, 4.9, -2.9], tint: "--agent-lilac" },
  { at: [-3.9, 1.5, -2.3], tint: "--agent-sage" },
];

const SCREEN_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aLit;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLit;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vLit = aLit;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/* Lines of work scrolling up a terminal: bars in ink, and now and then one in
 * the colour of the stage the agent is in. */
const SCREEN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uInk;
  uniform vec3 uGround;
  uniform vec3 uStage[5];
  varying vec2 vUv;
  varying float vSeed;
  varying float vLit;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    float rows = 10.0;
    // A model's UVs run downward (the glTF convention), so rows count from the top.
    float y = vUv.y * rows + uTime * (0.35 + 0.4 * vSeed);
    float row = floor(y);
    float fy = fract(y);
    float h = hash(vec2(row, vSeed * 91.0));
    float indent = 0.08 + floor(hash(vec2(row, vSeed + 3.1)) * 3.0) * 0.07;
    float len = 0.18 + h * 0.56;
    float bar = step(0.3, fy) * step(fy, 0.68) * step(indent, vUv.x) * step(vUv.x, indent + len);
    float pick = hash(vec2(row, vSeed + 7.7));
    int stage = int(mod(floor(pick * 37.0), 5.0));
    vec3 tone = uInk * 0.5;
    if (pick > 0.7) {
      if (stage == 0) tone = uStage[0];
      else if (stage == 1) tone = uStage[1];
      else if (stage == 2) tone = uStage[2];
      else if (stage == 3) tone = uStage[3];
      else tone = uStage[4];
    }
    vec2 edge = min(vUv, 1.0 - vUv);
    float frame = smoothstep(0.0, 0.04, min(edge.x, edge.y));
    vec3 color = mix(uGround, tone, bar * frame);
    gl_FragColor = vec4(color * mix(0.04, 1.0, vLit), 1.0);
    #include <colorspace_fragment>
  }
`;

export interface Pods {
  group: Group;
  /** World positions of the pods, for labels drawn by the page. */
  positions: Vector3[];
  /** `shift` is the camera's lens shift: it tells which side the page's copy is on. */
  update(ch: Channels, reveal: number, time: number, camera: Camera, shift: number): void;
}

export async function createPods(ctx: Context, glow: Texture, hub: Vector3): Promise<Pods> {
  const gltf = await loadModel(podUrl);
  gltf.scene.updateMatrixWorld(true);
  const group = new Group();
  const count = Math.min(POD_COUNT, PODS.length);
  const calm = ctx.tier.calm;

  const base = find<Mesh>(gltf.scene, "Base");
  const agent = find<Mesh>(gltf.scene, "Agent");
  const screen = find<Mesh>(gltf.scene, "Screen");
  const eyeNodes = [find<Mesh>(gltf.scene, "AgentEyeL"), find<Mesh>(gltf.scene, "AgentEyeR")];
  const lantern = find<Object3D>(gltf.scene, "LanternGlow");

  const atlas = (base.material as MeshStandardMaterial).map;
  const baked = () => new MeshBasicMaterial({ map: atlas, toneMapped: false });

  const baseMesh = new InstancedMesh(base.geometry, baked(), count);
  const agentMesh = new InstancedMesh(agent.geometry, baked(), count);
  const eyeMaterial = new MeshBasicMaterial({ color: ctx.token("--agent-eye"), toneMapped: false });
  const eyeMeshes = eyeNodes.map((eye) => new InstancedMesh(eye.geometry, eyeMaterial, count));

  const screenGeometry = screen.geometry.clone();
  const seeds = new Float32Array(count);
  const lits = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = (i * 0.618 + 0.21) % 1;
  const litAttribute = new InstancedBufferAttribute(lits, 1);
  litAttribute.setUsage(DynamicDrawUsage);
  screenGeometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  screenGeometry.setAttribute("aLit", litAttribute);
  const screenMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uInk: { value: ctx.token("--ink") },
      uGround: { value: ctx.token("--app-bg") },
      uStage: {
        value: ["--stage-thinking", "--stage-grep", "--stage-read", "--stage-edit", "--stage-done"].map((name) =>
          ctx.token(name),
        ),
      },
    },
    vertexShader: SCREEN_VERTEX,
    fragmentShader: SCREEN_FRAGMENT,
  });
  const screenMesh = new InstancedMesh(screenGeometry, screenMaterial, count);

  const instanced = [
    { mesh: baseMesh, local: base.matrixWorld.clone() },
    { mesh: agentMesh, local: agent.matrixWorld.clone() },
    { mesh: screenMesh, local: screen.matrixWorld.clone() },
    ...eyeMeshes.map((mesh, i) => ({ mesh, local: eyeNodes[i].matrixWorld.clone() })),
  ];
  for (const { mesh } of instanced) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // The instances are spread over the whole scene; one box around the first
    // would cull all of them the moment it left the frame.
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Each pod turns its open side toward the middle of the room, in front of the desk.
  const lookAt = new Vector3(0, 1.3, 7);
  const rest = PODS.slice(0, count).map(({ at }) => {
    const position = new Vector3(at[0], at[1], at[2]);
    const yaw = Math.atan2(lookAt.x - position.x, lookAt.z - position.z);
    return { position, yaw };
  });

  const tints = PODS.slice(0, count).map(({ tint }) => ctx.token(tint));
  const lanternLocal = new Vector3().setFromMatrixPosition(lantern.matrixWorld);

  // Lantern glows and the packets travelling along the threads: one draw call.
  const sparkCount = count * 2;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkColors = new Float32Array(sparkCount * 3);
  const sparkGeometry = new BufferGeometry();
  const sparkPositionAttribute = new BufferAttribute(sparkPositions, 3);
  const sparkColorAttribute = new BufferAttribute(sparkColors, 3);
  sparkPositionAttribute.setUsage(DynamicDrawUsage);
  sparkColorAttribute.setUsage(DynamicDrawUsage);
  sparkGeometry.setAttribute("position", sparkPositionAttribute);
  sparkGeometry.setAttribute("color", sparkColorAttribute);
  const sparks = new Points(
    sparkGeometry,
    new PointsMaterial({
      map: glow,
      size: 0.55,
      sizeAttenuation: true,
      vertexColors: true,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sparks.frustumCulled = false;
  sparks.renderOrder = 2;
  group.add(sparks);

  // The threads: one fine line from each pod's terminal to the monitor.
  const threadColor = ctx.token("--world-lamp");
  const threads = rest.map(({ position }) => {
    const from = position.clone().add(new Vector3(0, 0.55, 0));
    const mid = from.clone().lerp(hub, 0.5);
    mid.y += 0.9 + from.distanceTo(hub) * 0.12;
    const curve = new QuadraticBezierCurve3(from, mid, hub);
    const geometry = new BufferGeometry().setFromPoints(curve.getPoints(40));
    const material = new LineBasicMaterial({
      color: threadColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const line = new Line(geometry, material);
    line.frustumCulled = false;
    group.add(line);
    return { curve, material };
  });

  const matrix = new Matrix4();
  const podMatrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const size = new Vector3(1, 1, 1);
  const position = new Vector3();
  const point = new Vector3();
  const color = new Color();
  const lampColor = ctx.token("--world-lamp");
  const positions = rest.map(({ position: p }) => p.clone());

  return {
    group,
    positions,

    update(ch, reveal, time, camera, shift) {
      screenMaterial.uniforms.uTime.value = calm ? 0 : time;
      const shown = Math.min(1, reveal);
      // The subject is shifted away from the copy: left of centre means the copy is on the right.
      const copySide = Math.max(-1, Math.min(1, -shift * 2.6));
      for (let i = 0; i < count; i++) {
        // A pod that would stand behind the page's copy shrinks away instead.
        point.copy(rest[i].position).project(camera);
        const behind = Math.min(1, Math.max(0, (point.x * Math.sign(copySide) - 0.22) / 0.4)) * Math.abs(copySide);
        const lit = Math.min(1, Math.max(0, ch.pods - i)) * shown * (1 - behind);
        // An unlit pod is not there at all: it arrives with its light.
        const level = Math.min(1, lit * (1 + 0.2 * ch.dawn)) * (1 - 0.6 * ch.wire);
        const grown = lit <= 0 ? 0 : 0.7 + 0.3 * (1 - (1 - lit) * (1 - lit));

        const bob = calm ? 0 : Math.sin(time * 0.55 + i * 1.7) * 0.06;
        position.copy(rest[i].position);
        position.y += bob;
        positions[i].copy(position);
        quaternion.setFromAxisAngle(up, rest[i].yaw + (calm ? 0 : Math.sin(time * 0.21 + i) * 0.05));
        podMatrix.compose(position, quaternion, size.setScalar(grown));
        for (const { mesh, local } of instanced) {
          matrix.multiplyMatrices(podMatrix, local);
          mesh.setMatrixAt(i, matrix);
        }

        baseMesh.setColorAt(i, color.setScalar(level));
        agentMesh.setColorAt(i, color.copy(tints[i]).multiplyScalar(level));
        lits[i] = lit * (1 - 0.6 * ch.wire);

        // The lantern.
        point.copy(lanternLocal).applyMatrix4(podMatrix);
        sparkPositions.set([point.x, point.y, point.z], i * 3);
        color.copy(lampColor).multiplyScalar(0.7 * lit * (1 - 0.7 * ch.dawn));
        sparkColors.set([color.r, color.g, color.b], i * 3);

        // A packet of work on its way to the desk.
        const along = calm ? 0.5 : (time * 0.16 + i * 0.37) % 1;
        threads[i].curve.getPoint(along, point);
        sparkPositions.set([point.x, point.y, point.z], (count + i) * 3);
        const fade = Math.sin(Math.PI * along);
        color.copy(lampColor).multiplyScalar(0.5 * lit * fade);
        sparkColors.set([color.r, color.g, color.b], (count + i) * 3);

        threads[i].material.opacity = 0.3 * lit;
        threads[i].material.visible = lit > 0.01;
      }
      for (const { mesh } of instanced) mesh.instanceMatrix.needsUpdate = true;
      if (baseMesh.instanceColor) baseMesh.instanceColor.needsUpdate = true;
      if (agentMesh.instanceColor) agentMesh.instanceColor.needsUpdate = true;
      litAttribute.needsUpdate = true;
      sparkPositionAttribute.needsUpdate = true;
      sparkColorAttribute.needsUpdate = true;
    },
  };
}
