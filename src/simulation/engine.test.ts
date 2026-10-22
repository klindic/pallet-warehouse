import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TIMING } from './config';
import { DAY, Simulation } from './engine';
import { DOOR, HALL, PARCEL, PARKING, RACK, SITE, TRUCK, buildLayout, trailerPallet } from './layout';

const runDays = (sim: Simulation, days: number, step = 3600, check?: () => void) => {
  const end = sim.day + days; let guard = 0;
  while (sim.day < end && guard++ < 1_000_000) { sim.advance(step, true); check?.(); }
};
const AT_BAY = ['toBay', 'prep', 'service'];

describe('raspored parcele i hale', () => {
  it('daje 18 redova, 9 prolaza i 378 mjesta po razini', () => {
    for (const levels of [3, 4, 5]) {
      const layout = buildLayout(levels);
      expect(layout.rows).toHaveLength(18);
      expect(layout.aisles).toHaveLength(9);
      expect(layout.capacity).toBe(378 * levels);
    }
    expect(buildLayout(4).capacity).toBe(1512);
  });
  it('drži regale unutar hale i prolaze široke za protuteži viličar', () => {
    const layout = buildLayout(4);
    for (const row of layout.rows) { expect(row.x0).toBeGreaterThanOrEqual(HALL.x0); expect(row.x1).toBeLessThanOrEqual(HALL.x1); }
    for (const a of layout.aisles) expect(a.x1 - a.x0).toBeCloseTo(RACK.aisle);
    for (const s of layout.slots) { expect(s.z).toBeGreaterThan(RACK.z0); expect(s.z).toBeLessThan(HALL.z1); }
    expect(new Set(layout.slots.map(s => s.code)).size).toBe(layout.slots.length);
  });
  it('ne stavlja podna mjesta u vrata, a prikolica na rampi stoji ispred vrata', () => {
    const layout = buildLayout(4);
    expect(layout.staging.length).toBeGreaterThanOrEqual(40);
    for (const spot of layout.staging) expect(Math.abs(spot.x - DOOR.x)).toBeGreaterThan(DOOR.width / 2);
    const xs = Array.from({ length: TRUCK.capacity }, (_, i) => trailerPallet(i).x);
    expect(Math.min(...xs)).toBeLessThan(DOOR.x);
    expect(Math.max(...xs)).toBeGreaterThan(DOOR.x);
    for (const x of xs) { expect(x).toBeGreaterThan(PARCEL.x0); expect(x).toBeLessThan(PARCEL.x1); }
  });
  it('smješta parking za šlepere na parcelu i ostavlja barem 20 % zelenila', () => {
    for (const x of PARKING.stalls) { expect(x - PARKING.width / 2).toBeGreaterThan(HALL.x1); expect(x + PARKING.width / 2).toBeLessThan(PARCEL.x1); }
    expect(PARKING.cabZ + TRUCK.cabToKingpin - TRUCK.kingpinToFront + TRUCK.trailerLength).toBeLessThan(PARCEL.z1);
    expect(SITE.greenArea / SITE.parcelArea).toBeGreaterThanOrEqual(0.2);
  });
});

describe('simulacija poslovanja', () => {
  it('je ponovljiva za isti seed', () => {
    const a = new Simulation(DEFAULT_CONFIG), b = new Simulation(DEFAULT_CONFIG);
    runDays(a, 40); runDays(b, 40);
    expect(a.history.map(d => [d.stock, d.trucksIn, d.trucksOut, d.revenue])).toEqual(b.history.map(d => [d.stock, d.trucksIn, d.trucksOut, d.revenue]));
  });

  it('naplaćuje skladištenje svaki kalendarski dan i manipulaciju po paleti', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, pricePerPalletDay: 1.5, handlingFee: 2 });
    runDays(sim, 40);
    for (const d of sim.history) {
      expect(d.storage).toBeCloseTo(d.stock * 1.5);
      expect(d.handling).toBeCloseTo((d.palletsIn + d.palletsOut) * 2);
      expect(d.revenue).toBeCloseTo(d.storage + d.handling);
    }
    expect(sim.totals.handling).toBeGreaterThan(0);
    expect(sim.history.map(d => d.day)).toEqual(sim.history.map((_, i) => i));
  });

  it('istovaruje i utovaruje samo jedan šleper, a ostali čekaju na parkingu', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, rampDays: 20 });
    let maxParked = 0, sawParked = false;
    runDays(sim, 60, 60, () => {
      const atBay = sim.trucks.filter(t => AT_BAY.includes(t.state) || (t.state === 'closing' && !t.atZone));
      expect(atBay.length).toBeLessThanOrEqual(1);
      if (atBay.length) expect(atBay[0].id).toBe(sim.bayTruck);
      const parked = sim.trucks.filter(t => t.state === 'parked');
      maxParked = Math.max(maxParked, parked.length);
      if (parked.length) sawParked = true;
      for (const t of parked) expect(sim.stalls[t.stall]).toBe(t.id);
    });
    expect(maxParked).toBeLessThanOrEqual(PARKING.stalls.length);
    expect(sawParked).toBe(true);
    expect(sim.totals.early).toBeGreaterThan(0);
    expect(sim.totals.late).toBeGreaterThan(0);
  });

  it('ne gubi palete i ne stavlja dvije na isto mjesto, ni s dva viličara', () => {
    for (const forklifts of [1, 2]) {
      const sim = new Simulation({ ...DEFAULT_CONFIG, forklifts, rampDays: 30 });
      let i = 0;
      runDays(sim, 90, 3600, () => {
        if (i++ % 6) return;
        expect(sim.layout.slots.filter(s => s.pallet).length).toBe(sim.rackCount);
        expect(sim.layout.staging.filter(s => s.pallet).length).toBe(sim.stagingCount);
        expect(sim.rackCount).toBeLessThanOrEqual(sim.capacity);
        const ids = sim.layout.slots.filter(s => s.pallet).map(s => s.pallet!.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
      expect(sim.totals.palletsIn - sim.totals.palletsOut).toBe(sim.stock + sim.forklifts.filter(f => f.carrying).length);
      // Svaka pošiljka čiji je rok prošao ili je odvezena ili je ovaj tjedan dogovorena za odvoz.
      const overdue = [...sim.shipments.values()].filter(s => s.status !== 'pickup' && s.dueDay < sim.day - 7);
      expect(overdue).toHaveLength(0);
    }
  });

  it('posao raste prema punom skladištu, viličar radi oko 7 h i svi šleperi odlaze', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    runDays(sim, 280);
    const early = sim.history.slice(0, 20), late = sim.history.slice(-60);
    const avg = (rows: typeof early, f: (d: typeof early[number]) => number) => rows.reduce((a, d) => a + f(d), 0) / rows.length;
    expect(avg(early, d => d.occupancy)).toBeLessThan(0.35);
    expect(avg(late, d => d.occupancy)).toBeGreaterThan(0.7);
    const work = late.filter(d => d.workday);
    expect(avg(work, d => d.busy) / 3600).toBeGreaterThan(6.2);
    expect(avg(work, d => d.busy) / 3600).toBeLessThan(7.6);
    expect(avg(work, d => d.breaks)).toBeGreaterThanOrEqual(TIMING.lunch);
    expect(avg(work, d => d.overtime) / 3600).toBeLessThan(0.3);
    // Nijedan šleper ne ostaje zaglavljen na parceli.
    const stuck = sim.trucks.filter(t => !['gone', 'scheduled', 'noshow'].includes(t.state) && sim.time - t.arrivedAt > DAY);
    expect(stuck).toHaveLength(0);
  });

  it('odvozi robu tek na dogovoreni dan ili kasnije', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, rampDays: 20, peakDemand: 4 });
    const seen = new Map<number, number>();
    runDays(sim, 60, 3600, () => {
      for (const t of sim.trucks) if (t.kind === 'out' && t.state === 'service' && !seen.has(t.shipmentId)) {
        const s = sim.shipments.get(t.shipmentId);
        if (s) { expect(sim.day).toBeGreaterThanOrEqual(s.dueDay); seen.set(t.shipmentId, sim.day); }
      }
    });
    expect(seen.size).toBeGreaterThan(20);
  });
});
