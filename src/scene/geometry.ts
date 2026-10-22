import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';

export type V3 = [number, number, number];

export function material(scene: Scene, name: string, hex: string, alpha = 1, specular = 0.06) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(specular, specular, specular);
  m.alpha = alpha;
  if (alpha < 1) m.backFaceCulling = false;
  return m;
}

export function box(scene: Scene, name: string, size: V3, pos: V3, mat: StandardMaterial, parent?: TransformNode) {
  const mesh = CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.material = mat;
  if (parent) mesh.parent = parent;
  return mesh;
}

export function cylinder(scene: Scene, name: string, height: number, diameter: number, pos: V3, mat: StandardMaterial, parent?: TransformNode, tessellation = 16) {
  const mesh = CreateCylinder(name, { height, diameter, tessellation }, scene);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.material = mat;
  if (parent) mesh.parent = parent;
  return mesh;
}

/** Kotač: valjak položen po osi x. */
export function wheel(scene: Scene, diameter: number, width: number, pos: V3, mat: StandardMaterial, parent: TransformNode) {
  const w = cylinder(scene, 'wheel', width, diameter, pos, mat, parent, 14);
  w.rotation.z = Math.PI / 2;
  return w;
}

/** Babylonov y-kut za smjer (dx, dz) u tlocrtu; lokalna os +z gleda u smjer kretanja. */
export const yaw = (heading: number) => Math.atan2(Math.cos(heading), Math.sin(heading));
