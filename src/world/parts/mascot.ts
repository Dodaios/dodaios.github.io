/**
 * The mascot: the hooded figure from the logo, sitting on the desk beside the
 * monitor. It is the one thing in the scene that is lit at run time, so that
 * it can move: it breathes, blinks, follows the pointer with its eyes, hops
 * when it is pressed and leans in when it listens.
 *
 * The model and its node names are described in art/mascot/build.py.
 */
import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";

import mascotUrl from "@/assets/world/mascot.glb?url";

import { damp, find, loadModel, type Context } from "../kit";
import type { Channels } from "../timeline";

export interface Mascot {
  group: Group;
  /** An unseen ball around the figure: what the pointer is tested against. */
  hit: Mesh;
  /** A point at the figure's face, world space. */
  face: Vector3;
  /** A small jump, for when it is pressed. */
  poke(): void;
  /** Lean in and widen the eyes while the visitor holds the talk button. */
  setListening(on: boolean): void;
  update(input: {
    dt: number;
    time: number;
    ch: Channels;
    reveal: number;
    /** Pointer in clip space, -1..1; (0, 0) when it has never moved. */
    pointer: { x: number; y: number };
    camera: PerspectiveCamera;
  }): void;
}

export async function createMascot(
  ctx: Context,
  anchor: Object3D,
  lampBulb: Vector3,
  screenCenter: Vector3,
): Promise<Mascot> {
  const gltf = await loadModel(mascotUrl);
  const calm = ctx.tier.calm;

  const group = new Group();
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(group.position);
  const restYaw = Math.atan2(anchor.matrixWorld.elements[8], anchor.matrixWorld.elements[10]);

  // `turn` carries the look-around, `body` the breath and the jump.
  const turn = new Group();
  const body = new Group();
  turn.rotation.y = restYaw;
  group.add(turn);
  turn.add(body);
  body.add(gltf.scene);

  const cloth = find<Mesh>(gltf.scene, "Body");
  const cape = find<Mesh>(gltf.scene, "Cape");
  const face = find<Mesh>(gltf.scene, "Face");
  const eyes = [find<Mesh>(gltf.scene, "EyeL"), find<Mesh>(gltf.scene, "EyeR")];

  const clothMaterial = cloth.material as MeshStandardMaterial;
  clothMaterial.roughness = 0.86;
  clothMaterial.metalness = 0;
  if (!clothMaterial.map) clothMaterial.color.copy(ctx.token("--world-cloth"));
  cape.material = clothMaterial;
  face.material = new MeshBasicMaterial({ color: ctx.token("--world-face") });
  const eyeMaterial = new MeshBasicMaterial({ color: ctx.token("--ink"), toneMapped: false });
  const eyeRest = eyes.map((eye) => {
    eye.material = eyeMaterial;
    return { position: eye.position.clone(), scale: eye.scale.clone() };
  });
  const capeRest = cape.rotation.clone();

  // The light that falls on it: the lamp, the monitor, a rim, and the morning.
  const lamp = new PointLight(ctx.token("--world-lamp"), 0, 0, 2);
  lamp.position.copy(lampBulb);
  const monitor = new PointLight(ctx.token("--world-screen"), 0, 0, 2);
  monitor.position.copy(screenCenter).add(new Vector3(0, 0, 0.25));
  // Two lights from behind: the figure is nearly black in a nearly black room,
  // and it is the bright edge that draws it, as the white line does in the logo.
  const rim = new DirectionalLight(ctx.token("--world-sky"), 0);
  rim.position.copy(group.position).add(new Vector3(1.6, 1.3, -1.9));
  rim.target.position.copy(group.position);
  const rimLeft = new DirectionalLight(ctx.token("--world-lamp"), 0);
  rimLeft.position.copy(group.position).add(new Vector3(-1.9, 1.1, -1.2));
  rimLeft.target.position.copy(group.position);
  const sun = new DirectionalLight(ctx.token("--world-dawn"), 0);
  sun.position.set(-3, 3.2, 4);
  sun.target.position.copy(group.position);
  const fill = new HemisphereLight(ctx.token("--world-sky"), ctx.token("--canvas"), 0);
  // The lights are placed in world coordinates. `group` stands at the anchor
  // and is never turned, so one child moved back by that offset puts them there.
  const lights = new Group();
  lights.position.copy(group.position).negate();
  lights.add(lamp, monitor, rim, rim.target, rimLeft, rimLeft.target, sun, sun.target, fill);
  group.add(lights);

  const hit = new Mesh(new SphereGeometry(0.2, 12, 10), new MeshBasicMaterial({ visible: false }));
  hit.position.set(0, 0.17, 0);
  group.add(hit);

  const facePoint = new Vector3();
  const toCamera = new Vector3();
  let yaw = 0;
  let gazeX = 0;
  let gazeY = 0;
  let lean = 0;
  let listening = false;
  let hop = -1;
  let blinkAt = 2.4;
  let blink = -1;

  return {
    group,
    hit,
    face: facePoint,

    poke() {
      if (hop < 0) hop = 0;
    },

    setListening(on) {
      listening = on;
    },

    update({ dt, time, ch, reveal, pointer, camera }) {
      const dawn = ch.dawn;
      const lit = reveal >= 1 ? 1 : Math.max(0, (reveal - 0.3) / 0.7);
      lamp.intensity = 9 * lit * (1 - dawn);
      monitor.intensity = 1.6 * Math.min(1, reveal / 0.2);
      rim.intensity = 5 * lit * (1 - 0.5 * dawn);
      rimLeft.intensity = 3.2 * lit * (1 - dawn);
      sun.intensity = 3.2 * dawn;
      fill.intensity = 0.9 * lit + 1.6 * dawn;

      // Look toward whoever is looking at it, and a little after the pointer.
      toCamera.copy(camera.position).sub(group.position);
      const wanted = Math.atan2(toCamera.x, toCamera.z) - restYaw;
      const wrapped = Math.atan2(Math.sin(wanted), Math.cos(wanted));
      const limit = 0.55;
      const targetYaw = Math.max(-limit, Math.min(limit, wrapped)) * 0.7 + pointer.x * 0.16;
      yaw = damp(yaw, targetYaw, 3.2, dt);
      turn.rotation.y = restYaw + yaw;

      gazeX = damp(gazeX, pointer.x, 6, dt);
      gazeY = damp(gazeY, pointer.y, 6, dt);

      const attentive = listening ? 1 : ch.voice * 0.35;
      lean = damp(lean, attentive, 5, dt);
      turn.rotation.x = 0.1 * lean;

      // Breath, and the jump on top of it.
      const breath = calm ? 0 : Math.sin(time * 1.9) * 0.012 * (1 + lean * 0.8);
      let lift = 0;
      let squash = 0;
      if (hop >= 0) {
        hop += dt / 0.42;
        if (hop >= 1) hop = -1;
        else {
          lift = Math.sin(Math.PI * hop) * 0.075;
          squash = Math.sin(Math.PI * 2 * hop) * 0.1;
        }
      }
      body.position.y = lift;
      body.scale.set(1 - breath * 0.5 - squash * 0.5, 1 + breath + squash, 1 - breath * 0.5 - squash * 0.5);

      if (!calm) cape.rotation.z = capeRest.z + Math.sin(time * 0.9) * 0.035 + lift * 1.2;

      // Eyes: they open with the scene, blink now and then, widen when it listens.
      if (blink < 0 && time > blinkAt && !calm) blink = 0;
      let lid = 1;
      if (blink >= 0) {
        blink += dt / 0.16;
        if (blink >= 1) {
          blink = -1;
          blinkAt = time + 2.2 + ((time * 7.3) % 3.4);
        } else lid = Math.abs(Math.cos(Math.PI * blink));
      }
      const open = Math.min(1, Math.max(0, (reveal - 0.45) / 0.2));
      const wide = 1 + 0.14 * lean + (hop >= 0 ? 0.1 : 0);
      eyes.forEach((eye, i) => {
        const rest = eyeRest[i];
        eye.position.set(rest.position.x + gazeX * 0.0065, rest.position.y + gazeY * 0.005, rest.position.z);
        eye.scale.set(rest.scale.x * wide, rest.scale.y * wide * Math.max(0.06, lid * open), rest.scale.z);
      });

      facePoint.copy(group.position);
      facePoint.y += 0.19;
    },
  };
}
