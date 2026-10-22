import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { DAY, Simulation } from './engine';
import { BAYS, DOORS, HALL, PARCEL, RACK, buildLayout, trailerPallet } from './layout';

const runDays = (sim: Simulation, days: number) => { const end = sim.day + days; let guard = 0; while (sim.day < end && guard++ < 100000) sim.advance(3600, true); };

describe('raspored parcele i hale', () => {
  it('daje 12 redova, 6 prolaza i 180 mjesta po razini', () => {
    for (const levels of [3, 4, 5]) {
      const layout = buildLayout(levels);
      expect(layout.rows).toHaveLength(12);
      expect(layout.aisles).toHaveLength(6);
      expect(layout.capacity).toBe(180 * levels);
    }
  });
  it('drži regale unutar hale i prolaze široke za protuteži viličar', () => {
    const layout = buildLayout(4);
    for (const row of layout.rows) { expect(row.x0).toBeGreaterThanOrEqual(HALL.x0); expect(row.x1).toBeLessThanOrEqual(HALL.x1); }
    for (const a of layout.aisles) expect(a.x1 - a.x0).toBeCloseTo(RACK.aisle);
    for (const s of layout.slots) { expect(s.z).toBeGreaterThan(RACK.z0); expect(s.z).toBeLessThan(HALL.z1); }
    expect(new Set(layout.slots.map(s => s.code)).size).toBe(layout.slots.length);
  });
  it('ne stavlja podna mjesta međuskladišta u vrata', () => {
    const layout = buildLayout(4);
    expect(layout.staging.length).toBeGreaterThanOrEqual(25);
    for (const spot of layout.staging) for (const d of DOORS) expect(Math.abs(spot.x - d.x)).toBeGreaterThan(d.width / 2);
  });
  it('postavlja palete na prikolici unutar parcele i ispred vrata', () => {
    for (let bay = 0; bay < BAYS.length; bay++) for (let i = 0; i < 32; i++) {
      const p = trailerPallet(bay, i);
      expect(p.x).toBeGreaterThan(PARCEL.x0); expect(p.x).toBeLessThan(PARCEL.x1);
    }
  });
});

describe('simulacija poslovanja', () => {
  it('je ponovljiva za isti seed', () => {
    const a = new Simulation(DEFAULT_CONFIG), b = new Simulation(DEFAULT_CONFIG);
    runDays(a, 40); runDays(b, 40);
    expect(a.history.map(d => [d.stock, d.trucksIn, d.trucksOut, d.revenue])).toEqual(b.history.map(d => [d.stock, d.trucksIn, d.trucksOut, d.revenue]));
  });

  it('naplaćuje svaki kalendarski dan prema popunjenim mjestima', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, pricePerPalletDay: 1.5, handlingFee: 0 });
    runDays(sim, 30);
    for (const d of sim.history) expect(d.revenue).toBeCloseTo(d.stock * 1.5);
    expect(sim.history.map(d => d.day)).toEqual(sim.history.map((_, i) => i));
  });

  it('ne gubi palete i ne stavlja dvije na isto mjesto', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, rampDays: 30, peakDemand: 6 });
    for (let i = 0; i < 90 * 24; i++) {
      sim.advance(3600, true);
      if (i % 6 !== 0) continue;
      const inRack = sim.layout.slots.filter(s => s.pallet).length;
      const staged = sim.layout.staging.filter(s => s.pallet).length;
      expect(inRack).toBe(sim.rackCount);
      expect(staged).toBe(sim.stagingCount);
      expect(sim.stock).toBeLessThanOrEqual(sim.capacity + sim.layout.staging.length);
      const ids = sim.layout.slots.filter(s => s.pallet).map(s => s.pallet!.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(sim.totals.palletsIn - sim.totals.palletsOut).toBe(sim.stock + sim.forklifts.filter(f => f.carrying).length);
  });

  it('posao raste prema punom skladištu i svi kamioni odlaze', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    runDays(sim, 250);
    const early = sim.history.slice(0, 20), late = sim.history.slice(-30);
    const avg = (rows: typeof early) => rows.reduce((a, d) => a + d.occupancy, 0) / rows.length;
    expect(avg(early)).toBeLessThan(0.35);
    expect(avg(late)).toBeGreaterThan(0.7);
    expect(sim.totals.trucksIn).toBeGreaterThan(200);
    expect(sim.totals.trucksOut).toBeGreaterThan(150);
    // Nijedan dan ne završava s kamionom zaglavljenim na parceli.
    const stuck = sim.trucks.filter(t => t.state !== 'gone' && t.state !== 'scheduled' && sim.time - t.queuedAt > DAY);
    expect(stuck).toHaveLength(0);
  });

  it('odvozi robu tek na dogovoreni dan ili kasnije', () => {
    const sim = new Simulation({ ...DEFAULT_CONFIG, rampDays: 20, peakDemand: 3 });
    const seen = new Map<number, number>();
    for (let i = 0; i < 60 * 24; i++) {
      sim.advance(3600, true);
      for (const t of sim.trucks) if (t.kind === 'out' && t.state === 'service' && !seen.has(t.shipmentId)) {
        const s = sim.shipments.get(t.shipmentId);
        if (s) { expect(sim.day).toBeGreaterThanOrEqual(s.dueDay); seen.set(t.shipmentId, sim.day); }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});
