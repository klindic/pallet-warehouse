import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { TRUCK } from '../simulation/layout';
import { box, cylinder, material, wheel } from './geometry';

export interface Shared {
  tyre: StandardMaterial; steel: StandardMaterial; dark: StandardMaterial; glass: StandardMaterial; chrome: StandardMaterial;
  yellow: StandardMaterial; black: StandardMaterial; orange: StandardMaterial; light: StandardMaterial; skin: StandardMaterial; vest: StandardMaterial;
}

export function sharedMaterials(scene: Scene): Shared {
  return {
    tyre: material(scene, 'tyre', '#202326'), steel: material(scene, 'chassis', '#3b4146'), dark: material(scene, 'dark', '#2a3034'),
    glass: material(scene, 'glass', '#22323b', 0.85, 0.5), chrome: material(scene, 'chrome', '#b9c0c4', 1, 0.4),
    yellow: material(scene, 'forklift-yellow', '#f0b40a', 1, 0.15), black: material(scene, 'black', '#17191b'),
    orange: material(scene, 'beacon', '#ff8a1f'), light: material(scene, 'headlight', '#fff6d8'),
    skin: material(scene, 'skin', '#d7a47f'), vest: material(scene, 'vest', '#e7f03a'),
  };
}

const CAB_COLORS = ['#b8202f', '#1f4e8c', '#eeeeea', '#2d6a4f', '#d9731e', '#3a3f45'];
const CURTAIN_COLORS = ['#d9dde0', '#244f86', '#e6e1d6', '#aebbc4', '#d9dde0', '#7d1f26'];

export interface TruckView {
  tractor: TransformNode; trailer: TransformNode; curtain: Mesh; curtainLeft: Mesh;
  axle: { x: number; z: number } | null; dispose(): void;
}

export function createTruck(scene: Scene, m: Shared, color: number, shadow: ShadowGenerator): TruckView {
  const cab = material(scene, 'cab', CAB_COLORS[color % CAB_COLORS.length], 1, 0.25);
  const cloth = material(scene, 'curtain', CURTAIN_COLORS[color % CURTAIN_COLORS.length], 1, 0.04);
  const tractor = new TransformNode('tractor', scene);
  // Tegljač: ishodište je prednji rub kabine na tlu, lokalna os +z gleda naprijed.
  box(scene, 'chassis', [2.2, 0.38, 6.1], [0, 0.82, -3.05], m.steel, tractor);
  box(scene, 'cab', [2.48, 2.55, 2.25], [0, 2.32, -1.18], cab, tractor);
  box(scene, 'cab-roof', [2.4, 0.55, 1.7], [0, 3.86, -1.35], cab, tractor);
  box(scene, 'windscreen', [2.25, 1.05, 0.06], [0, 2.82, -0.04], m.glass, tractor);
  for (const s of [-1, 1]) box(scene, 'side-window', [0.05, 0.75, 0.9], [s * 1.245, 2.95, -0.62], m.glass, tractor);
  box(scene, 'grille', [2.1, 0.75, 0.05], [0, 1.65, -0.03], m.dark, tractor);
  box(scene, 'bumper', [2.5, 0.42, 0.28], [0, 0.72, -0.12], m.dark, tractor);
  for (const s of [-1, 1]) box(scene, 'headlight', [0.42, 0.16, 0.04], [s * 0.88, 0.95, 0.03], m.light, tractor);
  box(scene, 'tank', [0.55, 0.55, 1.4], [-1.05, 0.9, -3.0], m.chrome, tractor);
  box(scene, 'fifth-wheel', [1.6, 0.12, 1.2], [0, 1.08, -TRUCK.cabToKingpin], m.dark, tractor);
  for (const z of [-0.95, -4.35, -5.45]) for (const s of [-1, 1]) wheel(scene, 1.02, 0.42, [s * 1.02, 0.51, z], m.tyre, tractor);

  // Poluprikolica s ceradom: ishodište je kraljevski svornjak, prikolica ide unatrag do -12 m.
  const trailer = new TransformNode('trailer', scene);
  const len = TRUCK.trailerLength, front = TRUCK.kingpinToFront, mid = front - len / 2, w = TRUCK.width;
  box(scene, 'deck', [w, 0.18, len], [0, TRUCK.deck - 0.09, mid], m.steel, trailer);
  box(scene, 'frame', [1.4, 0.4, len - 1], [0, 0.85, mid - 0.4], m.dark, trailer);
  box(scene, 'front-wall', [w, 2.75, 0.08], [0, TRUCK.deck + 1.375, front - 0.04], cloth, trailer);
  box(scene, 'rear-doors', [w, 2.75, 0.08], [0, TRUCK.deck + 1.375, front - len + 0.04], m.chrome, trailer);
  box(scene, 'roof', [w, 0.08, len], [0, TRUCK.deck + 2.79, mid], cloth, trailer);
  for (const s of [-1, 1]) box(scene, 'roof-rail', [0.06, 0.12, len], [s * (w / 2 - 0.03), TRUCK.deck + 2.7, mid], m.chrome, trailer);
  for (const z of [front - 0.1, mid, front - len + 0.1]) for (const s of [-1, 1]) box(scene, 'stake', [0.06, 2.75, 0.08], [s * (w / 2 - 0.03), TRUCK.deck + 1.375, z], m.chrome, trailer);
  const curtain = box(scene, 'curtain-right', [0.04, 2.7, len - 0.1], [w / 2 - 0.02, TRUCK.deck + 1.37, mid], cloth, trailer);
  const curtainLeft = box(scene, 'curtain-left', [0.04, 2.7, len - 0.1], [-w / 2 + 0.02, TRUCK.deck + 1.37, mid], cloth, trailer);
  for (const z of [-TRUCK.axle + 1.3, -TRUCK.axle, -TRUCK.axle - 1.3].map(v => v + 0)) for (const s of [-1, 1]) wheel(scene, 0.98, 0.5, [s * 1.0, 0.49, z], m.tyre, trailer);
  for (const s of [-1, 1]) box(scene, 'landing-leg', [0.12, 0.9, 0.12], [s * 0.7, 0.55, -0.6], m.dark, trailer);
  box(scene, 'tail-lights', [w, 0.14, 0.05], [0, 0.95, front - len - 0.01], material(scene, 'tail', '#b3241e'), trailer);

  const meshes = [...tractor.getChildMeshes(), ...trailer.getChildMeshes()];
  for (const mesh of meshes) { shadow.addShadowCaster(mesh); mesh.isPickable = false; }
  return {
    tractor, trailer, curtain, curtainLeft, axle: null,
    dispose() { for (const mesh of meshes) shadow.removeShadowCaster(mesh); tractor.dispose(false, false); trailer.dispose(false, false); cab.dispose(); cloth.dispose(); },
  };
}

export interface ForkliftView { root: TransformNode; carriage: TransformNode; innerMast: TransformNode; heading: number }

export function createForklift(scene: Scene, m: Shared, shadow: ShadowGenerator): ForkliftView {
  // Ishodište je čelo vilica (prednja ploča nosača) na tlu; vilice gledaju u +z.
  const root = new TransformNode('forklift', scene);
  box(scene, 'body', [1.12, 0.95, 1.95], [0, 0.78, -1.38], m.yellow, root);
  box(scene, 'counterweight', [1.16, 0.95, 0.55], [0, 0.72, -2.55], m.dark, root);
  box(scene, 'hood', [1.0, 0.25, 0.9], [0, 1.33, -1.95], m.yellow, root);
  box(scene, 'seat', [0.5, 0.45, 0.5], [0, 1.45, -1.55], m.black, root);
  for (const [x, z] of [[-0.5, -0.65], [0.5, -0.65], [-0.5, -2.1], [0.5, -2.1]]) box(scene, 'guard-post', [0.06, 1.0, 0.06], [x, 1.75, z], m.black, root);
  box(scene, 'guard-roof', [1.08, 0.06, 1.55], [0, 2.26, -1.38], m.black, root);
  box(scene, 'beacon', [0.16, 0.12, 0.16], [0, 2.36, -1.9], m.orange, root);
  cylinder(scene, 'driver', 0.65, 0.42, [0, 1.95, -1.55], m.vest, root, 10);
  const head = cylinder(scene, 'head', 0.26, 0.24, [0, 2.4, -1.55], m.skin, root, 10); head.scaling.y = 1.2;
  for (const [x, z, d] of [[-0.5, -0.62, 0.66], [0.5, -0.62, 0.66], [-0.48, -2.15, 0.52], [0.48, -2.15, 0.52]]) wheel(scene, d, 0.28, [x, d / 2, z], m.tyre, root);
  for (const s of [-1, 1]) box(scene, 'mast', [0.09, 2.3, 0.12], [s * 0.34, 1.2, -0.24], m.dark, root);
  const innerMast = new TransformNode('inner-mast', scene); innerMast.parent = root;
  for (const s of [-1, 1]) box(scene, 'inner-mast', [0.07, 2.2, 0.09], [s * 0.25, 1.15, -0.2], m.steel, innerMast);
  box(scene, 'mast-head', [0.66, 0.1, 0.12], [0, 2.28, -0.2], m.steel, innerMast);
  const carriage = new TransformNode('carriage', scene); carriage.parent = root;
  box(scene, 'carriage-plate', [0.92, 0.55, 0.06], [0, 0.32, -0.04], m.dark, carriage);
  box(scene, 'backrest', [0.92, 0.6, 0.03], [0, 0.9, -0.04], m.dark, carriage);
  for (const s of [-1, 1]) box(scene, 'tine', [0.12, 0.05, 1.15], [s * 0.26, 0.025, 0.575], m.steel, carriage);
  for (const mesh of root.getChildMeshes()) { shadow.addShadowCaster(mesh); mesh.isPickable = false; }
  return { root, carriage, innerMast, heading: Math.PI / 2 };
}
