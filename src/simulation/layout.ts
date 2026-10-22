import type { Aisle, Place, Row, Slot, StagingSpot, Vec2 } from './types';

// Tlocrt u metrima: x raste prema istoku, z prema sjeveru. Ulica je južno od parcele (z < 0).
export const PARCEL = { x0: 0, x1: 90, z0: 0, z1: 58 } as const;          // 90 × 58 m = 5.220 m²
export const HALL = { x0: 5, x1: 65, z0: 30, z1: 57 } as const;            // 60 × 27 m = 1.620 m²
export const STREET = { z0: -9, z1: 0, lane: -2.25, far: -6.75 } as const;
export const ENTRY_GATE = { x0: 81, x1: 89, x: 85 } as const;              // ulaz s istoka
export const EXIT_GATE = { x0: 1, x1: 10, x: 5.5 } as const;               // izlaz na zapad
export const LANE = { bay: 21.5, yard: 25.8, corridor: 34.6, feeder: 86.5, turn: 55.5 } as const;
export const APRON = { z0: 23.2, z1: 30 } as const;                        // pojas za viličar ispred hale
export const RACK = { z0: 37.5, bays: 7, bayLength: 2.7, depth: 1.1, flue: 0.1, aisle: 3.8, levelPitch: 1.7, perBay: 3, aisles: 9 } as const;
export const PALLET = { length: 1.2, width: 0.8, base: 0.144 } as const;
export const TRUCK = { cabToKingpin: 3.9, kingpinToFront: 1.6, trailerLength: 13.6, width: 2.55, deck: 1.2, rows: 16, capacity: 32, axle: 10.6 } as const;
// Jedna rampa: šleper stoji paralelno s halom, kabinom prema zapadu, a otvorena cerada gleda u vrata.
export const BAY = { stopX: 25.9 } as const;
// Zona za zatvaranje cerade i papire kod izlaza: šleper oslobodi rampu čim je utovar gotov.
export const CLOSE_ZONE = { stopX: 9.5 } as const;
export const DOOR = { x: BAY.stopX + TRUCK.cabToKingpin - TRUCK.kingpinToFront + TRUCK.trailerLength / 2, width: 5 } as const;
// Parking za šlepere koji čekaju red: četiri prolazna mjesta uz istočni zid hale, kabinom prema jugu.
export const PARKING = { stalls: [68, 72, 76, 80], width: 4, cabZ: 34 } as const;
export const OFFICE = { x0: 59.8, x1: 65, z0: 49, z1: 57 } as const;
export const CHARGING = { x0: 59.8, x1: 65, z0: 38.5, z1: 46 } as const;
export const PARK: Vec2[] = [{ x: 62.4, z: 40.4 }, { x: 62.4, z: 44 }];
export const QUEUE = { x: 96, gap: 18 } as const;
export const STAGING = { z: 31.05, stand: 31.68 } as const;
export const FORK_STAND_Z = LANE.bay + TRUCK.width / 2 + 0.08;
export const TRAVEL_H = 0.25;

export interface Layout {
  levels: number; capacity: number; perLevel: number; hallHeight: number;
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
    slots.push({
      index: slots.length, code: `R${String(row.index + 1).padStart(2, '0')}-${bay + 1}-${level}${'ABC'[pos]}`,
      row: row.index, bay, pos, level, aisle: row.aisle, face: row.face, into: row.into,
      x: row.face + row.into * PALLET.length / 2, z, y: level * RACK.levelPitch,
      cost: Math.abs(DOOR.x - aisle.cx) + (z - LANE.corridor) + 2.2 * level, pallet: null, reserved: false,
    });
  }
  // Podna mjesta za prijem i otpremu u jednom redu uz pročelje, lijevo i desno od vrata.
  const staging: StagingSpot[] = [];
  const free: [number, number][] = [[HALL.x0 + 0.4, DOOR.x - DOOR.width / 2 - 0.4], [DOOR.x + DOOR.width / 2 + 0.4, HALL.x1 - 0.4]];
  for (const [a, b] of free) {
    const n = Math.floor((b - a) / 0.9);
    for (let i = 0; i < n; i++) staging.push({ index: staging.length, x: a + 0.45 + i * 0.9, z: STAGING.z, pallet: null, reserved: false });
  }
  const costs = slots.map(s => s.cost).sort((a, b) => a - b);
  return { levels, capacity: slots.length, perLevel: slots.length / levels, hallHeight: Math.round((levels * RACK.levelPitch + 2) * 10) / 10, rows, aisles, slots, staging, costs };
}

export const kingpinX = () => BAY.stopX + TRUCK.cabToKingpin;

// 16 redova po 2 palete poprijeko; indeks 0 je sjeverna (bliža) strana prvog reda iza kabine.
export function trailerLocal(index: number) {
  const row = index >> 1;
  return { along: TRUCK.kingpinToFront - 0.7 - 0.8 * row, across: index % 2 === 0 ? 0.6 : -0.6 };
}
export function trailerPallet(index: number): Vec2 {
  const local = trailerLocal(index);
  return { x: kingpinX() - local.along, z: LANE.bay + local.across };
}

// Točke od mjesta do središnjeg hodnika ispred regala (z = LANE.corridor).
function anchor(place: Place, layout: Layout): Vec2[] {
  switch (place.kind) {
    case 'truck': return [{ x: place.x, z: FORK_STAND_Z }, { x: place.x, z: LANE.yard }, { x: DOOR.x, z: LANE.yard }, { x: DOOR.x, z: LANE.corridor }];
    case 'slot': { const cx = layout.aisles[place.slot.aisle].cx; return [{ x: cx, z: place.slot.z }, { x: cx, z: LANE.corridor }]; }
    case 'staging': return [{ x: place.spot.x, z: STAGING.stand }, { x: place.spot.x, z: LANE.corridor }];
    case 'park': { const p = PARK[place.index]; return [{ x: p.x, z: p.z }, { x: p.x, z: LANE.corridor }]; }
  }
}

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

// Asfalt samo gdje voze šleperi i viličar; ostatak parcele je zelenilo (GUP traži najmanje 20 %).
export const PAVED = [
  { x0: PARCEL.x0, x1: PARCEL.x1, z0: 18, z1: HALL.z0 },        // traka rampe i pojas viličara
  { x0: 79, x1: PARCEL.x1, z0: PARCEL.z0, z1: 18 },              // ulazna traka
  { x0: HALL.x1, x1: PARCEL.x1, z0: HALL.z0, z1: PARCEL.z1 },    // parking i okretište
  { x0: PARCEL.x0, x1: 11, z0: PARCEL.z0, z1: 18 },              // izlazna traka
] as const;

const area = (r: { x0: number; x1: number; z0: number; z1: number }) => (r.x1 - r.x0) * (r.z1 - r.z0);
export const SITE = {
  parcelArea: area(PARCEL),
  hallArea: area(HALL),
  pavedArea: PAVED.reduce((a, r) => a + area(r), 0),
  get greenArea() { return this.parcelArea - this.hallArea - this.pavedArea; },
} as const;
