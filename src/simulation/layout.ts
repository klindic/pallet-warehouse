import type { Aisle, Place, Row, Slot, StagingSpot, Vec2 } from './types';

// Tlocrt u metrima: x raste prema istoku, z prema sjeveru. Ulica je južno od parcele (z < 0).
export const PARCEL = { x0: 0, x1: 50, z0: 0, z1: 40 } as const;          // 50 × 40 m = 2.000 m²
export const HALL = { x0: 5, x1: 45, z0: 18, z1: 38 } as const;            // 40 × 20 m = 800 m²
export const STREET = { z0: -9, z1: 0, lane: -2.25, far: -6.75 } as const;
export const ENTRY_GATE = { x0: 41.5, x1: 49.5, x: 45.5 } as const;        // ulaz s istoka
export const EXIT_GATE = { x0: 0.5, x1: 8.5, x: 4.5 } as const;            // izlaz na zapad
export const LANE = { bypass: 5, bay: 10.5, yard: 14.5, corridor: 21.8 } as const;
export const APRON = { z0: 12, z1: 18 } as const;                          // pojas za viličar ispred hale
export const RACK = { z0: 24, bays: 5, bayLength: 2.7, depth: 1.1, flue: 0.1, aisle: 3.8, levelPitch: 1.7, perBay: 3, aisles: 6 } as const;
export const PALLET = { length: 1.2, width: 0.8, base: 0.144 } as const;
export const TRUCK = { cabToKingpin: 3.9, kingpinToFront: 1.6, trailerLength: 13.6, width: 2.55, deck: 1.2, rows: 16, capacity: 32, axle: 10.6 } as const;
// Šleper stoji paralelno s halom, kabinom prema zapadu; cerada na sjevernoj strani gleda prema vratima.
export const BAYS = [{ name: 'Rampa 1', stopX: 9.5 }, { name: 'Rampa 2', stopX: 28.5 }] as const;
export const DOORS = BAYS.map(b => ({ x: b.stopX + TRUCK.cabToKingpin - TRUCK.kingpinToFront + TRUCK.trailerLength / 2, width: 4.5 }));
export const OFFICE = { x0: 41.5, x1: 45, z0: 31, z1: 38 } as const;
export const CHARGING = { x0: 41.5, x1: 45, z0: 24, z1: 31 } as const;
export const PARK: Vec2[] = [{ x: 43.25, z: 26.4 }, { x: 43.25, z: 29.6 }];
export const QUEUE = { x: 55, gap: 18 } as const;
export const STAGING = { z: 19.05, stand: 19.68 } as const;
export const FORK_STAND_Z = LANE.bay + TRUCK.width / 2 + 0.08;
export const TRAVEL_H = 0.25;

export interface Layout {
  levels: number; capacity: number; hallHeight: number;
  rows: Row[]; aisles: Aisle[]; slots: Slot[]; staging: StagingSpot[]; costs: number[];
}

export function buildLayout(levels: number): Layout {
  const rows: Row[] = [], aisles: Aisle[] = [];
  let x: number = HALL.x0;
  rows.push({ index: 0, x0: x, x1: x + RACK.depth, face: x + RACK.depth, into: -1, aisle: 0 });
  x += RACK.depth;
  for (let a = 0; a < RACK.aisles; a++) {
    aisles.push({ index: a, x0: x, x1: x + RACK.aisle, cx: x + RACK.aisle / 2 });
    x += RACK.aisle;
    rows.push({ index: rows.length, x0: x, x1: x + RACK.depth, face: x, into: 1, aisle: a });
    x += RACK.depth;
    if (a < RACK.aisles - 1) {
      x += RACK.flue;
      rows.push({ index: rows.length, x0: x, x1: x + RACK.depth, face: x + RACK.depth, into: -1, aisle: a + 1 });
      x += RACK.depth;
    }
  }
  const slots: Slot[] = [];
  const gap = (RACK.bayLength - RACK.perBay * PALLET.width) / (RACK.perBay + 1);
  for (const row of rows) for (let bay = 0; bay < RACK.bays; bay++) for (let level = 0; level < levels; level++) for (let pos = 0; pos < RACK.perBay; pos++) {
    const z = RACK.z0 + bay * RACK.bayLength + gap * (pos + 1) + PALLET.width * (pos + 0.5);
    const aisle = aisles[row.aisle];
    const door = Math.min(...DOORS.map(d => Math.abs(d.x - aisle.cx)));
    slots.push({
      index: slots.length, code: `R${String(row.index + 1).padStart(2, '0')}-${bay + 1}-${level}${'ABC'[pos]}`,
      row: row.index, bay, pos, level, aisle: row.aisle, face: row.face, into: row.into,
      x: row.face + row.into * PALLET.length / 2, z, y: level * RACK.levelPitch,
      cost: door + (z - LANE.corridor) + 2.2 * level, pallet: null, reserved: false,
    });
  }
  const staging: StagingSpot[] = [];
  const free: [number, number][] = [[HALL.x0 + 0.4, DOORS[0].x - DOORS[0].width / 2 - 0.4], [DOORS[0].x + DOORS[0].width / 2 + 0.4, DOORS[1].x - DOORS[1].width / 2 - 0.4], [DOORS[1].x + DOORS[1].width / 2 + 0.4, HALL.x1 - 0.3]];
  for (const [a, b] of free) {
    const n = Math.floor((b - a) / 0.9);
    for (let i = 0; i < n; i++) staging.push({ index: staging.length, x: a + 0.45 + i * 0.9, z: STAGING.z, pallet: null, reserved: false });
  }
  const costs = slots.map(s => s.cost).sort((a, b) => a - b);
  return { levels, capacity: slots.length, hallHeight: Math.round((levels * RACK.levelPitch + 2) * 10) / 10, rows, aisles, slots, staging, costs };
}

export const doorFor = (x: number) => DOORS.reduce((best, d) => Math.abs(d.x - x) < Math.abs(best.x - x) ? d : best, DOORS[0]);
export const kingpinX = (bay: number) => BAYS[bay].stopX + TRUCK.cabToKingpin;

// 16 redova po 2 palete poprijeko; indeks 0 je sjeverna (bliža) strana prvog reda iza kabine.
export function trailerLocal(index: number) {
  const row = index >> 1;
  return { along: TRUCK.kingpinToFront - 0.7 - 0.8 * row, across: index % 2 === 0 ? 0.6 : -0.6 };
}
export function trailerPallet(bay: number, index: number): Vec2 {
  const local = trailerLocal(index);
  return { x: kingpinX(bay) - local.along, z: LANE.bay + local.across };
}

// Točke od mjesta do središnjeg hodnika ispred regala (z = LANE.corridor).
function anchor(place: Place, layout: Layout): Vec2[] {
  switch (place.kind) {
    case 'truck': { const door = doorFor(place.x); return [{ x: place.x, z: FORK_STAND_Z }, { x: place.x, z: LANE.yard }, { x: door.x, z: LANE.yard }, { x: door.x, z: LANE.corridor }]; }
    case 'slot': { const cx = layout.aisles[place.slot.aisle].cx; return [{ x: cx, z: place.slot.z }, { x: cx, z: LANE.corridor }]; }
    case 'staging': return [{ x: place.spot.x, z: STAGING.stand }, { x: place.spot.x, z: LANE.corridor }];
    case 'park': { const p = PARK[place.index]; return [{ x: p.x, z: p.z }, { x: p.x, z: LANE.corridor }]; }
  }
}

export function placePoint(place: Place, layout: Layout): Vec2 { return anchor(place, layout)[0]; }

export function route(from: Place, to: Place, layout: Layout): Vec2[] {
  if (from.kind === 'truck' && to.kind === 'truck') return [{ x: from.x, z: FORK_STAND_Z }, { x: from.x, z: LANE.yard }, { x: to.x, z: LANE.yard }, { x: to.x, z: FORK_STAND_Z }];
  if (from.kind === 'slot' && to.kind === 'slot' && from.slot.aisle === to.slot.aisle) {
    const cx = layout.aisles[from.slot.aisle].cx;
    return [{ x: cx, z: from.slot.z }, { x: cx, z: to.slot.z }];
  }
  return simplify([...anchor(from, layout), ...anchor(to, layout).reverse()]);
}

function simplify(points: Vec2[]) {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.z - p.z) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = last!;
      const cross = (b.x - a.x) * (p.z - b.z) - (b.z - a.z) * (p.x - b.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.z - a.z) * (p.z - b.z);
      if (Math.abs(cross) < 1e-6 && dot > 0) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

export const SITE = {
  parcelArea: (PARCEL.x1 - PARCEL.x0) * (PARCEL.z1 - PARCEL.z0),
  hallArea: (HALL.x1 - HALL.x0) * (HALL.z1 - HALL.z0),
  yardArea: (PARCEL.x1 - PARCEL.x0) * HALL.z0,
  get greenArea() { return this.parcelArea - this.hallArea - this.yardArea; },
} as const;
