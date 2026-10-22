import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CLIENTS } from '../simulation/config';
import type { Simulation } from '../simulation/engine';
import { CHARGING, DOOR, ENTRY_GATE, EXIT_GATE, HALL, OFFICE, PALLET, PARCEL, PARKING, RACK, TRUCK, trailerLocal } from '../simulation/layout';
import { angleDelta } from '../simulation/path';
import type { Pallet } from '../simulation/types';
import { box, cylinder, material, yaw } from './geometry';
import { createForklift, createTruck, sharedMaterials, type ForkliftView, type TruckView } from './models';
import { PLAN_BOUNDS, PLAN_SCALE, drawPlan } from './planTexture';

export type CameraView = 'overview' | 'hall' | 'bay' | 'parking' | 'forklift' | 'plan';
export interface WarehouseScene {
  update(sim: Simulation, simDt: number): void;
  /** Prozirnost limenih zidova (0–1) i je li krov vidljiv. */
  setHall(opacity: number, roof: boolean): void;
  render(): void;
  focus(view: CameraView): void;
  resize(): void;
  dispose(): void;
}

const VIEWS: Record<Exclude<CameraView, 'forklift'>, { alpha: number; beta: number; radius: number; target: [number, number, number] }> = {
  overview: { alpha: -Math.PI / 2 - 0.42, beta: 0.96, radius: 106, target: [46, 0, 24] },
  hall: { alpha: -Math.PI / 2 + 0.3, beta: 0.72, radius: 58, target: [35, 2, 43] },
  bay: { alpha: -Math.PI / 2 - 0.55, beta: 1.0, radius: 36, target: [29, 1, 24] },
  parking: { alpha: -0.35, beta: 0.98, radius: 46, target: [75, 1, 38] },
  plan: { alpha: -Math.PI / 2, beta: 0.001, radius: 108, target: [45, 0, 27] },
};
const MAX_PALLETS = 2100;

/** Dvostrešni krov kao prizma: sljeme ide po osi z. */
function gableRoof(scene: Scene, w: number, d: number, h: number) {
  const x = w / 2, z = d / 2;
  const positions = [-x, 0, -z, x, 0, -z, 0, h, -z, -x, 0, z, x, 0, z, 0, h, z];
  const indices = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh('roof', scene);
  Object.assign(new VertexData(), { positions, indices, normals }).applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

/** Gradi jedinični kvadar s tankim instancama (jedan poziv crtanja za mnogo istih dijelova). */
function instanced(scene: Scene, name: string, mat: StandardMaterial, parts: { p: [number, number, number]; s: [number, number, number] }[]) {
  const mesh = CreateBox(name, { size: 1 }, scene);
  mesh.material = mat;
  const buf = new Float32Array(parts.length * 16);
  parts.forEach(({ p, s }, i) => buf.set([s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, p[0], p[1], p[2], 1], i * 16));
  mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
  mesh.isPickable = false;
  return mesh;
}

export function createWarehouseScene(canvas: HTMLCanvasElement, sim: Simulation): WarehouseScene {
  const engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
  // Crta se u gustoći ekrana (mobitel 2–3×), najviše 2×, da slika bude oštra, a GPU ne crta 9× više piksela.
  engine.setHardwareScalingLevel(1 / Math.min(Math.max(1, window.devicePixelRatio || 1), 2));
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#dfe6e4ff');
  scene.ambientColor = new Color3(0.3, 0.32, 0.32);
  scene.skipPointerMovePicking = true;
  const layout = sim.layout;
  const H = layout.hallHeight;

  const camera = new ArcRotateCamera('camera', VIEWS.overview.alpha, VIEWS.overview.beta, VIEWS.overview.radius, new Vector3(...VIEWS.overview.target), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 240; camera.upperBetaLimit = 1.42; camera.lowerBetaLimit = 0.001;
  camera.wheelPrecision = 9; camera.pinchPrecision = 30; camera.panningSensibility = 40; camera.minZ = 0.3; camera.maxZ = 900;
  camera.inertia = 0.82;

  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.62; sky.groundColor = Color3.FromHexString('#8c9a8f');
  const sun = new DirectionalLight('sun', new Vector3(-0.42, -1, 0.5).normalize(), scene);
  sun.intensity = 0.95;
  sun.position = new Vector3(45, 0, 27).subtract(sun.direction.scale(140));
  sun.autoUpdateExtends = false; sun.autoCalcShadowZBounds = false;
  sun.orthoLeft = -72; sun.orthoRight = 72; sun.orthoTop = 62; sun.orthoBottom = -62; sun.shadowMinZ = 30; sun.shadowMaxZ = 280;
  const shadow = new ShadowGenerator(4096, sun);
  shadow.usePercentageCloserFiltering = true; shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM; shadow.darkness = 0.42; shadow.bias = 0.0008;

  const m = sharedMaterials(scene);
  const mats = {
    grass: material(scene, 'grass', '#6f8b52'), concrete: material(scene, 'concrete', '#c9cbc5'),     steel: material(scene, 'frame-steel', '#3f4f5c'), upright: material(scene, 'upright', '#2f6db3', 1, 0.2), beam: material(scene, 'beam', '#e2702a', 1, 0.2),
    fence: material(scene, 'fence', '#355246'), mesh: material(scene, 'fence-mesh', '#355246', 0.28), wood: material(scene, 'pallet-wood', '#b98d55'),
    load: material(scene, 'pallet-load', '#ffffff', 1, 0.12), office: material(scene, 'office', '#f1f2ee'), window: material(scene, 'window', '#3b5664', 0.9, 0.5),
    trunk: material(scene, 'trunk', '#6b5038'), crown: material(scene, 'crown', '#4f7d3c'), house: material(scene, 'house', '#e9e1d2'), roof: material(scene, 'roof', '#a2513b'),
    protector: material(scene, 'protector', '#f0b40a'),
  };
  mats.roof.backFaceCulling = false;

  // Tlo i tlocrt parcele.
  const outer = CreateGround('outer-ground', { width: 560, height: 560 }, scene);
  outer.position.set(45, -0.03, 27); outer.material = mats.grass; outer.receiveShadows = true; outer.isPickable = false;
  const B = PLAN_BOUNDS;
  const planTex = new DynamicTexture('plan', { width: (B.x1 - B.x0) * PLAN_SCALE, height: (B.z1 - B.z0) * PLAN_SCALE }, scene, true);
  planTex.anisotropicFilteringLevel = 8;
  const paintPlan = () => { drawPlan(planTex.getContext() as unknown as CanvasRenderingContext2D, layout); planTex.update(true); };
  paintPlan();
  document.fonts?.ready.then(() => { if (!scene.isDisposed) paintPlan(); });
  const planMat = material(scene, 'plan', '#ffffff', 1, 0.02);
  planMat.diffuseTexture = planTex;
  const plan = CreateGround('plan', { width: B.x1 - B.x0, height: B.z1 - B.z0 }, scene);
  plan.position.set((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2); plan.material = planMat; plan.receiveShadows = true; plan.isPickable = false;

  // Ograda s ulazom i izlazom.
  const posts: { p: [number, number, number]; s: [number, number, number] }[] = [];
  const panels: typeof posts = [];
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) posts.push({ p: [x0 + (x1 - x0) * i / n, 0.9, z0 + (z1 - z0) * i / n], s: [0.07, 1.8, 0.07] });
    panels.push({ p: [(x0 + x1) / 2, 0.95, (z0 + z1) / 2], s: [Math.abs(x1 - x0) || 0.03, 1.7, Math.abs(z1 - z0) || 0.03] });
  };
  fence(EXIT_GATE.x1, 0, ENTRY_GATE.x0, 0); fence(ENTRY_GATE.x1, 0, PARCEL.x1, 0); fence(PARCEL.x0, 0, EXIT_GATE.x0, 0);
  fence(PARCEL.x0, 0, PARCEL.x0, PARCEL.z1); fence(PARCEL.x1, 0, PARCEL.x1, PARCEL.z1); fence(PARCEL.x0, PARCEL.z1, PARCEL.x1, PARCEL.z1);
  instanced(scene, 'fence-posts', mats.fence, posts);
  instanced(scene, 'fence-mesh', mats.mesh, panels);
  for (const x of [EXIT_GATE.x0, EXIT_GATE.x1, ENTRY_GATE.x0, ENTRY_GATE.x1]) box(scene, 'gate-pillar', [0.3, 2.1, 0.3], [x, 1.05, 0], mats.protector);

  // Hala: betonski parapet, zidovi i krov od limenih panela s rebrima. Prozirnost se mijenja klizačem.
  const plinth = 1.1, ridge = 1.2;
  const sheet = new DynamicTexture('sheet-metal', { width: 256, height: 32 }, scene, true);
  {
    const c = sheet.getContext() as unknown as CanvasRenderingContext2D;
    // Ravni dio lima je prozirniji od rebara, pa i poluprozirni zid čita kao lim, a ne kao staklo.
    c.clearRect(0, 0, 256, 32);
    c.fillStyle = 'rgba(160,168,174,.7)'; c.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 4; i++) {
      const x = i * 64;
      c.fillStyle = '#d9dee0'; c.fillRect(x + 3, 0, 6, 32);   // bok rebra na svjetlu
      c.fillStyle = '#f3f5f6'; c.fillRect(x + 9, 0, 12, 32);  // tjeme rebra
      c.fillStyle = '#7f888e'; c.fillRect(x + 21, 0, 6, 32);  // bok rebra u sjeni
      c.fillStyle = 'rgba(160,169,174,.85)'; c.fillRect(x + 27, 0, 3, 32);
    }
    c.fillStyle = '#5a6469'; c.fillRect(0, 0, 3, 32);         // spoj panela (širina 1 m)
    sheet.hasAlpha = true;
    sheet.update(true);
  }
  const wallMat = material(scene, 'wall-sheet', '#ffffff', 1, 0.3); wallMat.diffuseTexture = sheet;
  const roofMat = material(scene, 'roof-sheet', '#a3abb0', 1, 0.25); roofMat.diffuseTexture = sheet;
  const gableMat = material(scene, 'gable-sheet', '#c4cacd', 1, 0.3);
  const trimMat = material(scene, 'trim', '#3a4348', 1, 0.2);
  const sheetMeshes: Mesh[] = [], roofMeshes: Mesh[] = [];
  const sheetBox = (size: [number, number, number], pos: [number, number, number], mat: StandardMaterial) => {
    const [sx, sy, sz] = size;
    const u = (len: number) => new Vector4(0, 0, len, 1);
    const mesh = CreateBox('sheet-panel', { width: sx, height: sy, depth: sz, faceUV: [u(sx), u(sx), u(sz), u(sz), u(sx), u(sx)] }, scene);
    mesh.position.set(...pos); mesh.material = mat; mesh.isPickable = false;
    return mesh;
  };
  const wallParts: { p: [number, number, number]; s: [number, number, number] }[] = [];
  const wall = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = H) => {
    const sx = Math.max(Math.abs(x1 - x0), 0.25), sz = Math.max(Math.abs(z1 - z0), 0.25);
    if (y0 < plinth) wallParts.push({ p: [(x0 + x1) / 2, (y0 + Math.min(plinth, y1)) / 2, (z0 + z1) / 2], s: [sx, Math.min(plinth, y1) - y0, sz] });
    if (y1 > plinth) sheetMeshes.push(sheetBox([sx, y1 - Math.max(plinth, y0), sz], [(x0 + x1) / 2, (Math.max(plinth, y0) + y1) / 2, (z0 + z1) / 2], wallMat));
  };
  wall(HALL.x0, HALL.z1, HALL.x1, HALL.z1); wall(HALL.x0, HALL.z0, HALL.x0, HALL.z1); wall(HALL.x1, HALL.z0, HALL.x1, HALL.z1);
  const door0 = DOOR.x - DOOR.width / 2, door1 = DOOR.x + DOOR.width / 2;
  wall(HALL.x0, HALL.z0, door0, HALL.z0); wall(door0, HALL.z0, door1, HALL.z0, 4.6, H); wall(door1, HALL.z0, HALL.x1, HALL.z0);
  instanced(scene, 'hall-plinth', mats.concrete, wallParts).receiveShadows = true;
  const halfSpan = (HALL.z1 - HALL.z0) / 2, slope = Math.atan2(ridge, halfSpan);
  for (const side of [-1, 1]) {
    const roof = sheetBox([HALL.x1 - HALL.x0 + 0.6, 0.12, Math.hypot(halfSpan, ridge) + 0.35], [(HALL.x0 + HALL.x1) / 2, H + ridge / 2 + 0.06, HALL.z0 + halfSpan * (side < 0 ? 0.5 : 1.5)], roofMat);
    roof.rotation.x = side * slope;
    roofMeshes.push(roof);
  }
  for (const x of [HALL.x0, HALL.x1]) {
    const gable = gableRoof(scene, HALL.z1 - HALL.z0, 0.2, ridge);
    gable.rotation.y = Math.PI / 2; gable.position.set(x, H, (HALL.z0 + HALL.z1) / 2); gable.material = gableMat;
    sheetMeshes.push(gable);
  }
  const frames: typeof wallParts = [];
  for (let x: number = HALL.x0; x <= HALL.x1 + 0.01; x += 5) {
    for (const z of [HALL.z0, HALL.z1]) frames.push({ p: [x, H / 2, z], s: [0.32, H, 0.32] });
    frames.push({ p: [x, H - 0.3, (HALL.z0 + HALL.z1) / 2], s: [0.22, 0.45, HALL.z1 - HALL.z0] });
  }
  for (const z of [HALL.z0, HALL.z1]) frames.push({ p: [(HALL.x0 + HALL.x1) / 2, H - 0.1, z], s: [HALL.x1 - HALL.x0, 0.18, 0.18] });
  frames.push({ p: [(HALL.x0 + HALL.x1) / 2, H + ridge - 0.2, (HALL.z0 + HALL.z1) / 2], s: [HALL.x1 - HALL.x0, 0.18, 0.18] });
  // Vodoravne fuge sendvič panela svakih 1 m: oštre na svakoj udaljenosti, za razliku od teksture.
  const jointMat = material(scene, 'panel-joint', '#4b555b', 1, 0.2);
  const joints: typeof wallParts = [];
  for (let y = plinth + 1; y < H - 0.5; y += 1) {
    for (const z of [HALL.z0 - 0.03, HALL.z1 + 0.03]) {
      let x0: number = HALL.x0;
      const spans: [number, number][] = [];
      if (z < HALL.z0 && y <= 4.6) { spans.push([x0, door0]); x0 = door1; }
      spans.push([x0, HALL.x1]);
      for (const [a, b] of spans) joints.push({ p: [(a + b) / 2, y, z], s: [b - a, 0.06, 0.06] });
    }
    for (const x of [HALL.x0 - 0.03, HALL.x1 + 0.03]) joints.push({ p: [x, y, (HALL.z0 + HALL.z1) / 2], s: [0.06, 0.06, HALL.z1 - HALL.z0] });
  }
  sheetMeshes.push(instanced(scene, 'panel-joints', jointMat, joints));
  // Antracit opšav: rub krova i okviri vrata.
  for (const z of [HALL.z0, HALL.z1]) sheetMeshes.push(sheetBox([HALL.x1 - HALL.x0 + 0.4, 0.45, 0.22], [(HALL.x0 + HALL.x1) / 2, H - 0.2, z], trimMat));
  for (const x of [HALL.x0, HALL.x1]) sheetMeshes.push(sheetBox([0.22, 0.45, HALL.z1 - HALL.z0 + 0.4], [x, H - 0.2, (HALL.z0 + HALL.z1) / 2], trimMat));
  for (const sx of [-1, 1]) sheetMeshes.push(sheetBox([0.22, 4.6, 0.3], [DOOR.x + sx * (DOOR.width / 2 + 0.11), 2.3, HALL.z0], trimMat));
  const frameMesh = instanced(scene, 'hall-frames', mats.steel, frames);
  shadow.addShadowCaster(frameMesh);
  function setHall(opacity: number, roof: boolean) {
    const a = Math.max(0, Math.min(1, opacity));
    const solid = a >= 0.98;
    for (const mat of [wallMat, roofMat, gableMat]) { mat.alpha = solid ? 1 : a; mat.backFaceCulling = solid; }
    for (const mat of [wallMat, roofMat]) mat.useAlphaFromDiffuseTexture = !solid;
    trimMat.alpha = solid ? 1 : Math.min(1, a * 2.4);
    jointMat.alpha = solid ? 1 : Math.min(0.9, a * 2.2);
    for (const mesh of sheetMeshes) mesh.setEnabled(a > 0.02);
    for (const mesh of roofMeshes) mesh.setEnabled(roof && a > 0.02);
  }
  setHall(0.2, true);
  box(scene, 'door-header', [DOOR.width + 0.3, 0.6, 0.35], [DOOR.x, 4.85, HALL.z0], mats.steel);
  for (const s of [-1, 1]) cylinder(scene, 'bollard', 1.1, 0.22, [DOOR.x + s * (DOOR.width / 2 + 0.35), 0.55, HALL.z0 - 0.45], mats.protector, undefined, 12);
  // Natpis na pročelju.
  const signTex = new DynamicTexture('sign', { width: 1024, height: 128 }, scene, true);
  const paintSign = () => {
    const c = signTex.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#1d2427'; c.fillRect(0, 0, 1024, 128);
    c.fillStyle = '#f2b705'; c.fillRect(0, 112, 1024, 16);
    c.fillStyle = '#ffffff'; c.font = '700 74px "Barlow Condensed", "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SKLADIŠTE ZELENJAK', 512, 60); signTex.update(true);
  };
  paintSign(); document.fonts?.ready.then(() => { if (!scene.isDisposed) paintSign(); });
  const signMat = material(scene, 'sign', '#ffffff'); signMat.diffuseTexture = signTex; signMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
  const sign = CreatePlane('sign', { width: 14, height: 1.75 }, scene);
  sign.position.set(DOOR.x, H - 1.2, HALL.z0 - 0.2); sign.material = signMat;

  // Znak parkinga za šlepere koji čekaju termin.
  const pTex = new DynamicTexture('parking-sign', { width: 128, height: 160 }, scene, true);
  {
    const c = pTex.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#1f5fa8'; c.fillRect(0, 0, 128, 160); c.strokeStyle = '#ffffff'; c.lineWidth = 6; c.strokeRect(6, 6, 116, 148);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 92px "Barlow Condensed", "Arial Narrow", sans-serif'; c.fillText('P', 64, 66);
    c.font = '700 24px "Barlow Condensed", "Arial Narrow", sans-serif'; c.fillText('ČEKANJE', 64, 132);
    pTex.update(true);
  }
  const pMat = material(scene, 'parking-sign', '#ffffff'); pMat.diffuseTexture = pTex; pMat.emissiveColor = new Color3(0.2, 0.2, 0.2); pMat.backFaceCulling = false;
  const pX = PARKING.stalls[PARKING.stalls.length - 1] + PARKING.width / 2 + 1.2;
  cylinder(scene, 'parking-post', 2.6, 0.08, [pX, 1.3, PARKING.cabZ - 0.6], m.steel, undefined, 8);
  const pSign = CreatePlane('parking-sign', { width: 0.8, height: 1 }, scene);
  pSign.position.set(pX, 2.9, PARKING.cabZ - 0.64); pSign.material = pMat;

  // Regali: plavi stupovi, narančaste grede, žuti štitnici na čelu reda.
  const uprights: typeof wallParts = [], beams: typeof wallParts = [], guards: typeof wallParts = [];
  const rackTop = layout.levels * RACK.levelPitch - 0.1;
  for (const row of layout.rows) {
    for (let b = 0; b <= RACK.bays; b++) for (const x of [row.x0 + 0.05, row.x1 - 0.05]) uprights.push({ p: [x, rackTop / 2, RACK.z0 + b * RACK.bayLength], s: [0.09, rackTop, 0.09] });
    for (let b = 0; b < RACK.bays; b++) for (let l = 1; l < layout.levels; l++) for (const x of [row.x0 + 0.05, row.x1 - 0.05])
      beams.push({ p: [x, l * RACK.levelPitch - 0.07, RACK.z0 + (b + 0.5) * RACK.bayLength], s: [0.07, 0.13, RACK.bayLength] });
    guards.push({ p: [(row.x0 + row.x1) / 2, 0.2, RACK.z0 - 0.12], s: [row.x1 - row.x0 + 0.1, 0.4, 0.14] });
  }
  for (const mesh of [instanced(scene, 'uprights', mats.upright, uprights), instanced(scene, 'beams', mats.beam, beams), instanced(scene, 'rack-guards', mats.protector, guards)]) shadow.addShadowCaster(mesh);

  // Ured s WC-om i punjač viličara u istočnom pojasu hale.
  box(scene, 'office', [OFFICE.x1 - OFFICE.x0 - 0.1, 2.9, OFFICE.z1 - OFFICE.z0], [(OFFICE.x0 + OFFICE.x1) / 2, 1.45, (OFFICE.z0 + OFFICE.z1) / 2], mats.office);
  box(scene, 'office-window', [0.05, 1.0, 4.2], [OFFICE.x0 - 0.01, 1.7, (OFFICE.z0 + OFFICE.z1) / 2 - 0.5], mats.window);
  box(scene, 'office-door', [0.05, 2.1, 0.9], [OFFICE.x0 - 0.01, 1.05, OFFICE.z0 + 0.8], m.dark);
  box(scene, 'charger', [0.5, 1.4, 0.4], [CHARGING.x1 - 0.35, 0.7, (CHARGING.z0 + CHARGING.z1) / 2], m.dark);

  // Okolni kvart: obiteljske kuće i drveće (Zeleni brijeg je pretežito stambeni kraj).
  const trunks: typeof wallParts = [], crowns: { p: [number, number, number]; s: number }[] = [];
  const tree = (x: number, z: number, s = 1) => { trunks.push({ p: [x, 1.1 * s, z], s: [0.3 * s, 2.2 * s, 0.3 * s] }); crowns.push({ p: [x, 3.3 * s, z], s: 3.2 * s }); };
  // Drvored u zelenom pojasu uz ulicu i uz zapadni rub parcele.
  for (let x = 16; x <= 74; x += 7.25) { tree(x, 5, 0.95); tree(x + 3.6, 13, 0.85); }
  for (const z of [34, 41, 48, 55]) tree(2.5, z, 0.85);
  for (const [x, z, s] of [[-10, 12, 1.2], [-8, 44, 1.1], [100, 4, 1.3], [98, 26, 1], [12, 66, 1.2], [36, 64, 1.1], [64, 66, 1.3], [-14, 62, 1.2], [104, 48, 1], [-20, 26, 1.1], [86, 66, 1.1]]) tree(x, z, s);
  instanced(scene, 'trunks', mats.trunk, trunks);
  const crownMesh = CreateIcoSphere('crown', { radius: 0.5, subdivisions: 2 }, scene);
  crownMesh.material = mats.crown; crownMesh.isPickable = false;
  const cbuf = new Float32Array(crowns.length * 16);
  crowns.forEach(({ p, s }, i) => cbuf.set([s, 0, 0, 0, 0, s * 0.9, 0, 0, 0, 0, s, 0, p[0], p[1], p[2], 1], i * 16));
  crownMesh.thinInstanceSetBuffer('matrix', cbuf, 16, true); crownMesh.thinInstanceRefreshBoundingInfo(false);
  shadow.addShadowCaster(crownMesh);
  for (const [x, z, w, d] of [[-19, 6, 9, 11], [-20, 34, 10, 9], [-18, 56, 9, 9], [107, 14, 9, 10], [108, 38, 10, 9], [106, 60, 9, 9], [20, 69, 10, 8], [50, 70, 9, 9], [78, 69, 10, 8]]) {
    const house = box(scene, 'house', [w, 5.6, d], [x, 2.8, z], mats.house);
    const roof = gableRoof(scene, w + 0.8, d + 0.8, w * 0.32);
    roof.position.set(x, 5.6, z); roof.material = mats.roof;
    shadow.addShadowCaster(house); shadow.addShadowCaster(roof);
  }

  // Palete: drvena podloga i roba (boja klijenta) kao tanke instance.
  const base = CreateBox('pallet-base', { size: 1 }, scene); base.material = mats.wood;
  const load = CreateBox('pallet-load', { size: 1 }, scene); load.material = mats.load;
  const baseBuf = new Float32Array(MAX_PALLETS * 16), loadBuf = new Float32Array(MAX_PALLETS * 16), colorBuf = new Float32Array(MAX_PALLETS * 4);
  base.thinInstanceSetBuffer('matrix', baseBuf, 16, false);
  load.thinInstanceSetBuffer('matrix', loadBuf, 16, false);
  load.thinInstanceSetBuffer('color', colorBuf, 4, false);
  // Barem jedna instanca od prvog kadra, inače materijal ne uključi boju po instanci.
  for (const mesh of [base, load]) { mesh.alwaysSelectAsActiveMesh = true; mesh.isPickable = false; mesh.thinInstanceCount = 1; shadow.addShadowCaster(mesh); }
  const clientRgb = CLIENTS.map(c => Color3.FromHexString(c.color));
  let count = 0;
  const putPallet = (p: Pallet, cx: number, by: number, cz: number, theta: number) => {
    if (count >= MAX_PALLETS) return;
    const c = Math.cos(theta), s = Math.sin(theta), o = count * 16;
    const h = p.height;
    baseBuf.set([PALLET.width * c, 0, -PALLET.width * s, 0, 0, PALLET.base, 0, 0, PALLET.length * s, 0, PALLET.length * c, 0, cx, by + PALLET.base / 2, cz, 1], o);
    loadBuf.set([0.76 * c, 0, -0.76 * s, 0, 0, h, 0, 0, 1.14 * s, 0, 1.14 * c, 0, cx, by + PALLET.base + h / 2, cz, 1], o);
    const rgb = clientRgb[p.client], k = 1 + p.tint;
    colorBuf.set([Math.min(1, rgb.r * k), Math.min(1, rgb.g * k), Math.min(1, rgb.b * k), 1], count * 4);
    count++;
  };

  const forklifts: ForkliftView[] = sim.forklifts.map(() => createForklift(scene, m, shadow));
  const trucks = new Map<number, TruckView>();
  let view: CameraView = 'overview';
  let disposed = false;

  function update(s: Simulation, simDt: number) {
    count = 0;
    for (const slot of s.layout.slots) if (slot.pallet) putPallet(slot.pallet, slot.x, slot.y, slot.z, Math.PI / 2);
    for (const spot of s.layout.staging) if (spot.pallet) putPallet(spot.pallet, spot.x, 0, spot.z, 0);

    const smooth = simDt > 1.5 ? 1 : 1 - Math.exp(-Math.max(0, simDt) * 7);
    s.forklifts.forEach((f, i) => {
      const v = forklifts[i];
      v.heading += angleDelta(v.heading, f.heading) * smooth;
      v.root.position.set(f.x, 0, f.z);
      v.root.rotation.y = yaw(v.heading);
      v.carriage.position.y = f.forkH;
      v.innerMast.position.y = Math.max(0, f.forkH - 1.45);
      if (f.carrying) putPallet(f.carrying, f.x + Math.cos(v.heading) * 0.6, f.forkH + 0.05, f.z + Math.sin(v.heading) * 0.6, yaw(v.heading));
    });

    const live = new Set<number>();
    for (const t of s.trucks) {
      if (t.state === 'scheduled' || t.state === 'gone' || t.state === 'noshow') continue;
      live.add(t.id);
      let tv = trucks.get(t.id);
      if (!tv) { tv = createTruck(scene, m, t.color, shadow); trucks.set(t.id, tv); }
      const fx = Math.cos(t.heading), fz = Math.sin(t.heading);
      tv.tractor.position.set(t.x, 0, t.z);
      tv.tractor.rotation.y = yaw(t.heading);
      const kx = t.x - fx * TRUCK.cabToKingpin, kz = t.z - fz * TRUCK.cabToKingpin;
      // Poluprikolica se vuče za svornjak: os prikolice slijedi tegljač kao u stvarnosti.
      let dx: number, dz: number;
      if (!tv.axle || Math.abs(Math.hypot(kx - tv.axle.x, kz - tv.axle.z) - TRUCK.axle) > 3) { dx = fx; dz = fz; }
      else {
        dx = kx - tv.axle.x; dz = kz - tv.axle.z;
        const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
        if (t.state === 'prep' || t.state === 'service' || t.state === 'closing' || t.state === 'parked' || t.state === 'street') { dx += (fx - dx) * 0.2; dz += (fz - dz) * 0.2; const n2 = Math.hypot(dx, dz) || 1; dx /= n2; dz /= n2; }
      }
      tv.axle = { x: kx - dx * TRUCK.axle, z: kz - dz * TRUCK.axle };
      tv.trailer.position.set(kx, 0, kz);
      tv.trailer.rotation.y = Math.atan2(dx, dz);
      const open = Math.min(1, Math.max(0, t.curtain));
      const len = TRUCK.trailerLength - 0.1;
      tv.curtain.setEnabled(open < 0.98);
      tv.curtain.scaling.z = Math.max(0.04, 1 - open);
      tv.curtain.position.z = TRUCK.kingpinToFront - 0.05 - len * (1 - open) / 2 - 0.02;
      const rx = dz, rz = -dx;
      t.trailer.forEach((p, i) => {
        if (!p) return;
        const l = trailerLocal(i);
        putPallet(p, kx + dx * l.along + rx * l.across, TRUCK.deck + 0.01, kz + dz * l.along + rz * l.across, Math.atan2(rx, rz));
      });
    }
    for (const [id, tv] of trucks) if (!live.has(id)) { tv.dispose(); trucks.delete(id); }

    if (count === 0) { baseBuf.fill(0, 0, 16); loadBuf.fill(0, 0, 16); }
    base.thinInstanceCount = Math.max(1, count); load.thinInstanceCount = Math.max(1, count);
    base.thinInstanceBufferUpdated('matrix'); load.thinInstanceBufferUpdated('matrix'); load.thinInstanceBufferUpdated('color');

    if (view === 'forklift' && s.forklifts[0]) {
      const f = s.forklifts[0];
      const target = new Vector3(f.x, 1.4, f.z);
      camera.setTarget(Vector3.Lerp(camera.target, target, 0.12), false, false, true);
    }
  }

  // Na uskom (uspravnom) ekranu kamera se odmiče da cijela parcela stane u kadar.
  const fit = () => Math.min(1.75, Math.max(1, 1.15 / (engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()))));

  function focus(next: CameraView) {
    view = next;
    if (next === 'forklift') {
      const f = sim.forklifts[0];
      camera.setTarget(new Vector3(f?.x ?? DOOR.x, 1.4, f?.z ?? 40), false, false, true);
      camera.alpha = -Math.PI / 2 + 0.25; camera.beta = 0.62; camera.radius = 19 * fit();
      return;
    }
    const v = VIEWS[next];
    camera.setTarget(new Vector3(...v.target), false, false, true);
    camera.alpha = v.alpha; camera.beta = v.beta; camera.radius = v.radius * fit();
  }

  return {
    update, focus, setHall,
    render: () => { if (!disposed) scene.render(); },
    resize: () => engine.resize(),
    dispose: () => { disposed = true; for (const tv of trucks.values()) tv.dispose(); scene.dispose(); engine.dispose(); },
  };
}

