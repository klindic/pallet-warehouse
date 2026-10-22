import { CLIENTS, CLIENT_WEIGHTS, TIMING } from './config';
import { BAYS, DOORS, EXIT_GATE, ENTRY_GATE, LANE, QUEUE, STREET, TRAVEL_H, TRUCK, buildLayout, route, trailerPallet, type Layout } from './layout';
import { angleDelta, angleTo, headingAt, pointAt, polyline, roundedPath, segmentAt } from './path';
import { Rng } from './rng';
import type {
  Appointment, DayRecord, DayStats, ForkAction, Forklift, LogEntry, Pallet, Place, RequestRecord,
  Shipment, SimulationConfig, Slot, StagingSpot, Totals, Truck, TruckKind, Vec2,
} from './types';

export const DAY = 86400;
export const START_DATE = Date.UTC(2027, 0, 4); // ponedjeljak
export const WEEKDAYS = ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'];
const MONTHS = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];

const emptyStats = (): DayStats => ({ trucksIn: 0, trucksOut: 0, palletsIn: 0, palletsOut: 0, handling: 0, requests: 0, rejected: 0, lost: 0, busy: 0, overtime: 0, demand: 0 });
const emptyTotals = (): Totals => ({
  revenue: 0, storage: 0, handling: 0, cost: 0, trucksIn: 0, trucksOut: 0, palletsIn: 0, palletsOut: 0,
  requests: 0, rejected: 0, rejectedSpace: 0, rejectedTime: 0, lost: 0, overtime: 0, siteTime: 0, waitTime: 0,
  trucksDone: 0, busy: 0, workSeconds: 0, cycleTime: 0, cycles: 0, workdays: 0,
});

export function dateOf(day: number) { return new Date(START_DATE + day * DAY * 1000); }
export function dateLabel(day: number, withWeekday = true) {
  const d = dateOf(day);
  return `${withWeekday ? WEEKDAYS[day % 7] + ', ' : ''}${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}.`;
}
export function longDate(day: number) { const d = dateOf(day); return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}.`; }
export function clockLabel(time: number) {
  const s = ((time % DAY) + DAY) % DAY;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
}

type Builder = { acts: ForkAction[]; heading: number; place: Place; atFace: boolean };

export class Simulation {
  readonly config: SimulationConfig;
  readonly layout: Layout;
  time = 0;
  trucks: Truck[] = [];
  forklifts: Forklift[] = [];
  shipments = new Map<number, Shipment>();
  appointments: Appointment[] = [];
  requests: RequestRecord[] = [];
  history: DayRecord[] = [];
  log: LogEntry[] = [];
  today: DayStats = emptyStats();
  totals: Totals = emptyTotals();
  cycleEstimate = 85;
  plannedDay = -1;
  rackCount = 0;
  stagingCount = 0;
  reservedSlots = 0;
  reservedStaging = 0;
  entered = 0;
  private billedDay = 0;
  private workdayIndex = 0;
  private rng: Rng;
  private ids = { truck: 1, shipment: 1, pallet: 1 };
  private yardBusy = 0;
  private bays = [0, 0];

  constructor(config: SimulationConfig) {
    this.config = { ...config };
    this.layout = buildLayout(this.config.rackLevels);
    this.rng = new Rng(this.config.seed);
    for (let i = 0; i < this.config.forklifts; i++) {
      const p = this.parkPoint(i);
      this.forklifts.push({ id: i, x: p.x, z: p.z, heading: Math.PI / 2, forkH: TRAVEL_H, carrying: null, actions: [], place: { kind: 'park', index: i }, atFace: false, task: 'Na punjaču', taskStart: 0, idleSince: 0, busyToday: 0, busyTotal: 0 });
    }
  }

  get capacity() { return this.layout.capacity; }
  get stock() { return this.rackCount + this.stagingCount; }
  get day() { return Math.floor(this.time / DAY); }
  isWorkday(day: number) { return day % 7 < this.config.workdaysPerWeek; }
  workStart(day: number) { return day * DAY + this.config.workStartHour * 3600; }
  workEnd(day: number) { return this.workStart(day) + this.config.workHours * 3600; }
  planTime(day: number) { return this.workStart(day) - 1800; }
  get workday() { return this.workdayIndex; }
  demandAt(workday: number) {
    const f = Math.min(1, Math.max(0, workday / Math.max(1, this.config.rampDays)));
    return this.config.startDemand + (this.config.peakDemand - this.config.startDemand) * f * f * (3 - 2 * f);
  }
  phase(): 'work' | 'overtime' | 'closed' {
    const d = this.day;
    if (!this.isWorkday(d) || this.time < this.workStart(d)) return this.activeTrucks() ? 'overtime' : 'closed';
    if (this.time < this.workEnd(d)) return 'work';
    return this.dayDone(d) ? 'closed' : 'overtime';
  }

  advance(seconds: number, fast = false) {
    let remaining = seconds, guard = 0;
    while (remaining > 1e-9 && guard++ < 1_000_000) {
      const today = this.day;
      if (this.dayDone(today)) { this.jumpTo(this.nextWake(today)); continue; }
      for (const f of this.forklifts) if (!f.actions.length) this.assign(f);
      const step = this.idle() ? Math.min(remaining, Math.max(0.01, this.nextEvent() - this.time)) : Math.min(remaining, fast ? 1 : 0.5);
      this.tick(step);
      remaining -= step;
    }
  }

  /** Preskače do idućeg jutra (ili kraja dana) bez animacije. */
  skipToNextDay() {
    const start = this.day;
    let guard = 0;
    while (this.day === start && guard++ < 400) this.advance(600, true);
  }

  private tick(dt: number) {
    const today = this.day;
    if (this.plannedDay < today && this.isWorkday(today) && this.time >= this.planTime(today)) this.plan(today);
    for (const t of this.trucks) this.updateTruck(t, dt);
    for (const f of this.forklifts) this.updateForklift(f, dt);
    if (this.plannedDay === today && this.time >= this.workEnd(today)) this.today.overtime += dt;
    this.time += dt;
    while (this.billedDay < this.day) this.bill(this.billedDay++);
  }

  private jumpTo(target: number) {
    while (this.billedDay < Math.floor(target / DAY)) this.bill(this.billedDay++);
    this.time = Math.max(this.time, target);
    for (const f of this.forklifts) f.task = 'Na punjaču';
  }

  private activeTrucks() { return this.trucks.some(t => t.state !== 'scheduled' && t.state !== 'gone'); }
  private forkliftsBusy() { return this.forklifts.some(f => f.actions.length > 0); }

  dayDone(today: number) {
    if (this.activeTrucks() || this.forkliftsBusy()) return false;
    if (!this.isWorkday(today)) return true;
    if (this.plannedDay < today) return this.time < this.planTime(today);
    return this.time >= this.workEnd(today) && this.trucks.every(t => t.state === 'gone');
  }

  private nextWake(today: number) {
    if (this.isWorkday(today) && this.plannedDay < today && this.time < this.planTime(today)) return this.planTime(today);
    let d = today + 1;
    while (!this.isWorkday(d)) d++;
    return this.planTime(d);
  }

  private idle() {
    if (this.forkliftsBusy() || this.yardBusy) return false;
    return this.trucks.every(t => (t.state === 'scheduled' && t.arrival > this.time) || t.state === 'gone' || (t.state === 'prep' && t.timer > 0) || (t.state === 'service' && !this.serviceDone(t))
      || (t.state === 'closing' && t.timer > 0) || (t.state === 'queue' && t.x <= this.queueTarget(t) + 0.01 && !this.canEnter(t)));
  }

  private nextEvent() {
    const d = this.day;
    let next = (d + 1) * DAY;
    const consider = (t: number) => { if (t > this.time && t < next) next = t; };
    if (this.plannedDay < d && this.isWorkday(d)) consider(this.planTime(d));
    consider(this.workStart(d)); consider(this.workEnd(d));
    for (const t of this.trucks) {
      if (t.state === 'scheduled') consider(t.arrival);
      else if (t.state === 'prep' || t.state === 'closing') consider(this.time + t.timer);
      else if (t.state === 'queue') consider(t.queuedAt + 3 * 3600);
    }
    for (const f of this.forklifts) if (!f.actions.length && f.place.kind !== 'park') consider(f.idleSince + 45);
    return next;
  }

  // ---------- Planiranje dana: mi dogovaramo termine dovoza i odvoza ----------
  private plan(day: number) {
    this.plannedDay = day;
    const w = this.workdayIndex++;
    const cfg = this.config;
    this.trucks = this.trucks.filter(t => t.state !== 'gone');
    this.appointments = [];
    this.requests = [];
    const lambda = this.demandAt(w);
    this.today.demand = lambda;
    const ws = this.workStart(day), we = this.workEnd(day);
    const forklifts = Math.max(1, cfg.forklifts);
    const due = [...this.shipments.values()].filter(s => s.status === 'stored' && s.dueDay <= day).sort((a, b) => a.dueDay - b.dueDay || a.id - b.id);
    const n = this.rng.poisson(lambda * this.rng.range(0.85, 1.15));
    const requests = Array.from({ length: n }, () => ({ client: this.rng.weighted(CLIENT_WEIGHTS), pallets: this.rng.int(cfg.palletsMin, cfg.palletsMax), dwell: this.rng.int(cfg.dwellMin, cfg.dwellMax) }));
    let free = ws + TIMING.entryEstimate + TIMING.prep;
    let stock = this.stock - due.reduce((a, s) => a + s.count, 0);
    const slotFor = (pallets: number) => {
      const planned = Math.max(ws, Math.round((free - TIMING.entryEstimate - TIMING.prep) / 300) * 300);
      const start = Math.max(planned + TIMING.entryEstimate + TIMING.prep, free);
      return { planned, end: start + pallets * this.cycleEstimate / forklifts };
    };
    for (const s of due) {
      const slot = slotFor(s.count);
      free = slot.end;
      s.status = 'pickup';
      this.createTruck('out', s, slot.planned, slot.end + TIMING.close, day);
    }
    let accepted = 0, rejected = 0;
    for (const r of requests) {
      this.today.requests++; this.totals.requests++;
      const slot = slotFor(r.pallets);
      const reason: RequestRecord['reason'] = stock + r.pallets > this.capacity ? 'mjesto' : slot.end > we + 15 * 60 ? 'termin' : '';
      this.requests.push({ ...r, accepted: !reason, reason });
      if (reason) {
        rejected++;
        this.rejectRequest(r.pallets * r.dwell * cfg.pricePerPalletDay, reason);
        continue;
      }
      accepted++;
      free = slot.end;
      stock += r.pallets;
      const shipment = this.createShipment(r.client, r.pallets, r.dwell, day);
      this.createTruck('in', shipment, slot.planned, slot.end + TIMING.close, day);
    }
    this.pushLog(`Raspored: ${due.length} utovara, ${accepted} istovara${rejected ? ` · odbijeno ${rejected}` : ''}`, rejected ? 'warn' : 'info');
  }

  private rejectRequest(lost: number, reason: 'mjesto' | 'termin') {
    this.today.rejected++; this.totals.rejected++;
    this.today.lost += lost; this.totals.lost += lost;
    if (reason === 'mjesto') this.totals.rejectedSpace++; else this.totals.rejectedTime++;
  }

  private nextWorkday(day: number) { let d = day; while (!this.isWorkday(d)) d++; return d; }

  private createShipment(client: number, count: number, dwell: number, day: number): Shipment {
    const id = this.ids.shipment++;
    const height = this.rng.range(1.0, 1.55), tint = this.rng.range(-0.12, 0.12);
    const shipment: Shipment = { id, client, pallets: [], count, dwell, bookedDay: day, arrivalDay: day, dueDay: this.nextWorkday(day + dwell), height, tint, status: 'booked', inTruck: 0, outTruck: 0 };
    this.shipments.set(id, shipment);
    return shipment;
  }

  private createTruck(kind: TruckKind, s: Shipment, planned: number, estEnd: number, day: number) {
    const id = this.ids.truck++;
    let arrival = planned + Math.max(-600, Math.min(900, this.rng.normal() * 360));
    if (this.rng.next() < this.config.lateChance) arrival += this.rng.range(1500, 4500);
    arrival = Math.max(arrival, this.workStart(day) - 900);
    const truck: Truck = {
      id, kind, shipmentId: s.id, client: s.client, pallets: s.count, planned, arrival, state: 'scheduled', bay: -1,
      x: 140, z: STREET.lane, heading: Math.PI, speed: 0, pathPts: null, pathCum: null, pathLen: 0, s: 0, releaseAt: 0,
      timer: 0, trailer: Array(TRUCK.capacity).fill(null), claimed: Array(TRUCK.capacity).fill(false), pending: 0, loaded: 0,
      queuedAt: 0, enteredAt: 0, atBayAt: 0, serviceAt: 0, leftAt: 0, color: this.rng.int(0, 5), curtain: 0,
    };
    if (kind === 'in') {
      s.inTruck = id;
      for (let i = 0; i < s.count; i++) {
        const pallet: Pallet = { id: this.ids.pallet++, shipmentId: s.id, client: s.client, height: s.height * this.rng.range(0.9, 1.06), tint: s.tint + this.rng.range(-0.04, 0.04), loc: { kind: 'truck', truck, index: i }, claimed: false };
        s.pallets.push(pallet);
        truck.trailer[i] = pallet;
      }
    } else s.outTruck = id;
    this.trucks.push(truck);
    this.appointments.push({ truckId: id, kind, client: s.client, pallets: s.count, planned, estEnd });
  }

  // ---------- Šleperi ----------
  private queueOrder() { return this.trucks.filter(t => t.state === 'queue').sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id); }
  private queueTarget(t: Truck) { return QUEUE.x + Math.max(0, this.queueOrder().indexOf(t)) * QUEUE.gap; }

  /** Slobodna mjesta za palete koje još nisu stigle s kamiona u dvorištu. */
  freeCapacity() {
    let free = this.capacity - this.rackCount - this.reservedSlots + this.layout.staging.length - this.stagingCount - this.reservedStaging;
    for (const t of this.trucks) if (t.kind === 'in' && (t.state === 'entering' || t.state === 'prep' || t.state === 'service')) free -= t.trailer.filter((p, i) => p && !t.claimed[i]).length;
    return free;
  }

  private canEnter(t: Truck) {
    if (this.yardBusy || this.time < this.workStart(this.day) || (this.bays[0] && this.bays[1])) return false;
    const free = this.freeCapacity();
    const eligible = this.queueOrder().find(u => u.x <= this.queueTarget(u) + 0.5 && (u.kind === 'out' || u.pallets <= free));
    return eligible === t;
  }

  private setPath(t: Truck, points: Vec2[], radius: number) {
    const path = roundedPath(points, radius);
    t.pathPts = path.pts; t.pathCum = path.cum; t.pathLen = path.len; t.s = 0;
    const exitIndex = path.pts.findIndex(p => p.x < EXIT_GATE.x0 - 1 && p.z < 0);
    t.releaseAt = exitIndex >= 0 ? path.cum[exitIndex] : path.len;
  }

  private enterYard(t: Truck) {
    const bay = this.bays[0] ? 1 : 0;
    const lane = STREET.lane, gx = ENTRY_GATE.x;
    const points: Vec2[] = bay === 1
      ? [{ x: t.x, z: lane }, { x: gx, z: lane }, { x: gx, z: LANE.bay }, { x: BAYS[1].stopX, z: LANE.bay }]
      : this.bays[1]
        ? [{ x: t.x, z: lane }, { x: gx, z: lane }, { x: gx, z: LANE.bypass }, { x: 24, z: LANE.bypass }, { x: 18, z: LANE.bay }, { x: BAYS[0].stopX, z: LANE.bay }]
        : [{ x: t.x, z: lane }, { x: gx, z: lane }, { x: gx, z: LANE.bay }, { x: BAYS[0].stopX, z: LANE.bay }];
    this.setPath(t, points, 6);
    t.state = 'entering'; t.bay = bay; t.enteredAt = this.time; t.speed = Math.min(t.speed, 2);
    this.bays[bay] = t.id; this.yardBusy = t.id; this.entered++;
    this.totals.waitTime += this.time - t.queuedAt;
  }

  private leaveYard(t: Truck) {
    const x0 = BAYS[t.bay].stopX, lane = STREET.lane, gx = EXIT_GATE.x;
    const points: Vec2[] = t.bay === 1 && this.bays[0]
      ? [{ x: x0, z: LANE.bay }, { x: x0 - 2, z: LANE.bay }, { x: x0 - 7.5, z: LANE.bypass }, { x: gx, z: LANE.bypass }, { x: gx, z: lane }, { x: -95, z: lane }]
      : [{ x: x0, z: LANE.bay }, { x: gx, z: LANE.bay }, { x: gx, z: lane }, { x: -95, z: lane }];
    this.setPath(t, points, 4.5);
    this.bays[t.bay] = 0;
    t.state = 'leaving'; t.curtain = 0; t.speed = 0; this.yardBusy = t.id;
    this.pushLog(`#${t.id} odlazi s rampe ${t.bay + 1} · ${Math.round((this.time - t.queuedAt) / 60)} min na parceli`, t.kind);
  }

  private turnAway(t: Truck) {
    const s = this.shipments.get(t.shipmentId);
    if (s) { for (const p of s.pallets) p.loc = { kind: 'gone' }; this.shipments.delete(s.id); }
    t.trailer.fill(null);
    this.setPath(t, [{ x: t.x, z: STREET.lane }, { x: -95, z: STREET.lane }], 4);
    t.state = 'leaving'; t.bay = -1; t.releaseAt = Infinity;
    this.rejectRequest(t.pallets * (s?.dwell ?? 0) * this.config.pricePerPalletDay, 'mjesto');
    this.pushLog(`#${t.id} vraćen s ulaza: nema mjesta za ${t.pallets} paleta`, 'warn');
  }

  private drive(t: Truck, dt: number) {
    if (!t.pathPts || !t.pathCum) return;
    const path = { pts: t.pathPts, cum: t.pathCum, len: t.pathLen };
    const p = pointAt(path, t.s);
    const vmax = p.z < -0.5 && (p.x < EXIT_GATE.x0 - 4 || p.x > ENTRY_GATE.x1 + 4) ? TIMING.truckStreet : TIMING.truckYard;
    const brake = t.state === 'entering' ? Math.sqrt(2 * TIMING.truckAccel * Math.max(0, t.pathLen - t.s)) + 0.3 : Infinity;
    t.speed = Math.min(vmax, brake, t.speed + TIMING.truckAccel * dt);
    t.s = Math.min(t.pathLen, t.s + t.speed * dt);
    const q = pointAt(path, t.s);
    t.x = q.x; t.z = q.z; t.heading = headingAt(path, Math.min(t.s, t.pathLen - 0.01));
    if (t.state === 'leaving' && this.yardBusy === t.id && t.s >= t.releaseAt) this.yardBusy = 0;
    if (t.s < t.pathLen - 1e-6) return;
    if (t.state === 'entering') {
      t.state = 'prep'; t.timer = TIMING.prep; t.atBayAt = this.time; t.speed = 0; this.yardBusy = 0;
      this.pushLog(`#${t.id} na rampi ${t.bay + 1} · ${t.kind === 'in' ? 'istovar' : 'utovar'} ${t.pallets} pal.`, t.kind);
    } else {
      t.state = 'gone'; t.leftAt = this.time; t.pathPts = null; t.pathCum = null;
      if (this.yardBusy === t.id) this.yardBusy = 0;
      if (t.bay >= 0) { this.totals.siteTime += t.leftAt - t.queuedAt; this.totals.trucksDone++; }
    }
  }

  private updateTruck(t: Truck, dt: number) {
    switch (t.state) {
      case 'scheduled':
        if (this.time >= t.arrival) {
          t.state = 'queue'; t.queuedAt = this.time; t.x = Math.max(140, ...this.trucks.filter(u => u.state === 'queue' && u !== t).map(u => u.x + QUEUE.gap)); t.speed = TIMING.truckStreet;
          const late = this.time - t.planned > 20 * 60;
          this.pushLog(`#${t.id} stigao${late ? ` s kašnjenjem ${Math.round((this.time - t.planned) / 60)} min` : ''} · ${t.kind === 'in' ? 'istovar' : 'utovar'} ${CLIENTS[t.client].code}`, late ? 'warn' : t.kind);
        }
        break;
      case 'queue': {
        const target = this.queueTarget(t);
        if (t.x > target + 0.01) {
          const v = Math.min(TIMING.truckStreet, Math.sqrt(2 * TIMING.truckAccel * (t.x - target)) + 0.4);
          t.x = Math.max(target, t.x - v * dt); t.speed = v;
        } else {
          t.speed = 0;
          if (this.canEnter(t)) this.enterYard(t);
          else if (t.kind === 'in' && this.time - t.queuedAt > 3 * 3600 && t.pallets > this.freeCapacity()) this.turnAway(t);
        }
        break;
      }
      case 'entering': case 'leaving': this.drive(t, dt); break;
      case 'prep':
        t.timer -= dt; t.curtain = Math.min(1, 1 - t.timer / TIMING.prep);
        if (t.timer <= 0) { t.state = 'service'; t.serviceAt = this.time; t.curtain = 1; }
        break;
      case 'service': {
        if (this.serviceDone(t)) {
          t.state = 'closing'; t.timer = TIMING.close;
          if (t.kind === 'in') { this.today.trucksIn++; this.totals.trucksIn++; }
          else {
            this.today.trucksOut++; this.totals.trucksOut++;
            const s = this.shipments.get(t.shipmentId);
            if (s) { s.status = 'gone'; for (const p of s.pallets) p.loc = { kind: 'gone' }; this.shipments.delete(s.id); }
          }
        }
        break;
      }
      case 'closing':
        t.timer -= dt; t.curtain = Math.max(0, t.timer / TIMING.close);
        if (t.timer <= 0 && !this.yardBusy) this.leaveYard(t);
        break;
    }
  }

  private serviceDone(t: Truck) { return t.pending === 0 && (t.kind === 'in' ? t.trailer.every(p => !p) : t.loaded >= t.pallets); }

  // ---------- Viličar ----------
  private parkPoint(i: number) { return [{ x: 43.25, z: 26.4 }, { x: 43.25, z: 29.6 }][i] ?? { x: 43.25, z: 26.4 }; }

  private updateForklift(f: Forklift, dt: number) {
    if (!f.actions.length) this.assign(f);
    let rem = dt;
    const working = f.task.startsWith('Istovar') || f.task.startsWith('Utovar') || f.task.startsWith('Premještanje');
    while (rem > 1e-9 && f.actions.length) {
      const a = f.actions[0];
      if (a.kind === 'fork' && a.h0 === undefined) { a.h0 = f.forkH; a.dur = Math.max(0.6, Math.abs(a.h1 - a.h0) / TIMING.lift); }
      if (a.kind === 'turn' && !a.from) { a.from = { x: f.x, z: f.z }; a.h0 = f.heading; }
      const use = Math.min(rem, a.dur - a.t);
      a.t += use; rem -= use;
      if (working) { f.busyToday += use; f.busyTotal += use; this.today.busy += use / this.forklifts.length; }
      this.pose(f, a);
      if (a.t >= a.dur - 1e-9) {
        f.actions.shift();
        if (a.kind === 'hold') a.done?.();
        if (!f.actions.length) this.finishTask(f);
      }
    }
  }

  private pose(f: Forklift, a: ForkAction) {
    const k = a.dur > 0 ? Math.min(1, a.t / a.dur) : 1;
    if (a.kind === 'move') {
      const path = { pts: a.pts, cum: a.cum, len: a.len };
      const d = a.len * k;
      const p = pointAt(path, d);
      const i = Math.min(segmentAt(path, d), a.pts.length - 2);
      f.x = p.x; f.z = p.z;
      f.heading = angleTo(a.pts[i], a.pts[i + 1]) + (a.rev[i] ? Math.PI : 0);
    } else if (a.kind === 'turn' && a.from && a.h0 !== undefined) {
      const e = k * k * (3 - 2 * k);
      f.x = a.from.x + (a.to.x - a.from.x) * e; f.z = a.from.z + (a.to.z - a.from.z) * e;
      f.heading = a.h0 + angleDelta(a.h0, a.h1) * e;
    } else if (a.kind === 'fork' && a.h0 !== undefined) f.forkH = a.h0 + (a.h1 - a.h0) * k;
  }

  private finishTask(f: Forklift) {
    if (f.task.startsWith('Istovar') || f.task.startsWith('Utovar')) {
      const cycle = this.time - f.taskStart;
      this.cycleEstimate = this.cycleEstimate * 0.93 + cycle * 0.07;
      this.totals.cycleTime += cycle; this.totals.cycles++;
    }
    f.task = f.place.kind === 'park' ? 'Na punjaču' : 'Čeka posao';
    f.idleSince = this.time;
  }

  private builder(f: Forklift): Builder { return { acts: [], heading: f.heading, place: f.place, atFace: f.atFace }; }

  private goTo(b: Builder, to: Place, loaded: boolean) {
    const pts = route(b.place, to, this.layout);
    if (b.atFace) {
      const h1 = pts.length > 1 ? angleTo(pts[0], pts[1]) : b.heading;
      b.acts.push({ kind: 'turn', to: pts[0], h1, dur: TIMING.turn, t: 0 });
      b.heading = h1; b.atFace = false;
    }
    const path = polyline(pts);
    if (path.pts.length > 1 && path.len > 1e-6) {
      const rev: boolean[] = [];
      let h = b.heading;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const dir = angleTo(path.pts[i], path.pts[i + 1]);
        const r = i === 0 && Math.cos(angleDelta(h, dir)) < -0.3;
        rev.push(r); h = r ? dir + Math.PI : dir;
      }
      const dur = path.len / (loaded ? TIMING.speedLoaded : TIMING.speedEmpty) + (path.pts.length - 2) * TIMING.corner;
      b.acts.push({ kind: 'move', pts: path.pts, cum: path.cum, len: path.len, rev, dur, t: 0 });
      b.heading = h;
    }
    b.place = to;
    if (to.kind === 'slot') {
      const h1 = to.slot.into === 1 ? 0 : Math.PI;
      b.acts.push({ kind: 'turn', to: { x: to.slot.face, z: to.slot.z }, h1, dur: TIMING.turn, t: 0 });
      b.heading = h1; b.atFace = true;
    }
  }
  private fork(b: Builder, h: number) { b.acts.push({ kind: 'fork', h1: h, dur: 0, t: 0 }); }
  private hold(b: Builder, dur: number, done: () => void) { b.acts.push({ kind: 'hold', dur, t: 0, done }); }
  private commit(f: Forklift, b: Builder, task: string) { f.actions = b.acts; f.place = b.place; f.atFace = b.atFace; f.task = task; f.taskStart = this.time; }

  private chooseSlot(s: Shipment, near = -1): Slot | null {
    const cfg = this.config;
    const span = Math.max(1, cfg.dwellMax - cfg.dwellMin);
    // Kratki boravak ide bliže vratima i niže, dugi dublje i više.
    const q = Math.min(1, Math.max(0, (s.dwell - cfg.dwellMin) / span)) * 0.85;
    const costs = this.layout.costs;
    const target = costs[Math.floor(q * (costs.length - 1))];
    let best: Slot | null = null, bestScore = Infinity;
    for (const slot of this.layout.slots) {
      if (slot.pallet || slot.reserved) continue;
      const score = Math.abs(slot.cost - target) + (near >= 0 ? Math.abs(slot.aisle - near) * 1.5 : 0) + slot.index * 1e-6;
      if (score < bestScore) { bestScore = score; best = slot; }
    }
    return best;
  }

  private lastAisle(s: Shipment) {
    for (let i = s.pallets.length - 1; i >= 0; i--) { const loc = s.pallets[i].loc; if (loc.kind === 'slot') return loc.slot.aisle; }
    return -1;
  }

  private assign(f: Forklift) {
    const service = this.trucks.filter(t => t.state === 'service').sort((a, b) => a.serviceAt - b.serviceAt || a.id - b.id);
    for (const t of service) {
      if (t.kind === 'in') {
        const door = DOORS[t.bay].x;
        let idx = -1, bestD = Infinity;
        t.trailer.forEach((p, i) => { if (p && !t.claimed[i]) { const d = Math.abs(trailerPallet(t.bay, i).x - door); if (d < bestD) { bestD = d; idx = i; } } });
        if (idx < 0) continue;
        const pallet = t.trailer[idx]!;
        const s = this.shipments.get(pallet.shipmentId)!;
        const slot = this.chooseSlot(s, this.lastAisle(s));
        const spot = slot ? null : this.layout.staging.find(x => !x.pallet && !x.reserved) ?? null;
        if (!slot && !spot) continue;
        if (slot) { slot.reserved = true; this.reservedSlots++; } else { spot!.reserved = true; this.reservedStaging++; }
        t.claimed[idx] = true; t.pending++;
        this.planUnload(f, t, idx, slot, spot);
        return;
      }
      const s = this.shipments.get(t.shipmentId);
      if (!s) continue;
      let pallet: Pallet | null = null, bestCost = Infinity;
      for (const p of s.pallets) {
        if (p.claimed) continue;
        const cost = p.loc.kind === 'slot' ? p.loc.slot.cost : p.loc.kind === 'staging' ? 0 : Infinity;
        if (cost < bestCost) { bestCost = cost; pallet = p; }
      }
      const idx = t.trailer.findIndex((p, i) => !p && !t.claimed[i]);
      if (!pallet || idx < 0) continue;
      pallet.claimed = true; t.claimed[idx] = true; t.pending++;
      this.planLoad(f, t, idx, pallet);
      return;
    }
    const staged = this.layout.staging.find(x => x.pallet && !x.pallet.claimed);
    if (staged) {
      const s = this.shipments.get(staged.pallet!.shipmentId);
      const slot = s ? this.chooseSlot(s, this.lastAisle(s)) : null;
      if (slot) { staged.pallet!.claimed = true; slot.reserved = true; this.reservedSlots++; this.planRelocate(f, staged, slot); return; }
    }
    if (f.place.kind !== 'park' && this.time - f.idleSince >= 45) {
      const b = this.builder(f);
      this.goTo(b, { kind: 'park', index: f.id }, false);
      this.commit(f, b, 'Vožnja na punjač');
    }
  }

  private takeFrom(f: Forklift, pallet: Pallet) {
    const loc = pallet.loc;
    if (loc.kind === 'slot') { loc.slot.pallet = null; this.rackCount--; }
    if (loc.kind === 'staging') { loc.spot.pallet = null; this.stagingCount--; }
    pallet.loc = { kind: 'fork', forklift: f.id };
    f.carrying = pallet;
  }

  private store(f: Forklift, pallet: Pallet, target: Slot | StagingSpot, isSlot: boolean) {
    target.pallet = pallet; target.reserved = false;
    if (isSlot) this.reservedSlots--; else this.reservedStaging--;
    pallet.loc = isSlot ? { kind: 'slot', slot: target as Slot } : { kind: 'staging', spot: target as StagingSpot };
    if (isSlot) this.rackCount++; else this.stagingCount++;
    f.carrying = null;
  }

  private planUnload(f: Forklift, t: Truck, idx: number, slot: Slot | null, spot: StagingSpot | null) {
    const b = this.builder(f);
    this.goTo(b, { kind: 'truck', x: trailerPallet(t.bay, idx).x }, false);
    this.fork(b, TRUCK.deck);
    this.hold(b, TIMING.pick, () => {
      const pallet = t.trailer[idx]!;
      t.trailer[idx] = null; t.claimed[idx] = false; t.pending--;
      pallet.loc = { kind: 'fork', forklift: f.id }; f.carrying = pallet;
      this.today.palletsIn++; this.totals.palletsIn++;
      this.today.handling += this.config.handlingFee;
    });
    this.fork(b, TRAVEL_H);
    const target = slot ?? spot!;
    this.goTo(b, slot ? { kind: 'slot', slot } : { kind: 'staging', spot: spot! }, true);
    this.fork(b, slot ? slot.y + 0.05 : 0.05);
    this.hold(b, TIMING.place, () => {
      const pallet = f.carrying!;
      this.store(f, pallet, target, !!slot);
      const s = this.shipments.get(pallet.shipmentId);
      if (s && s.status === 'booked' && s.pallets.every(p => p.loc.kind === 'slot' || p.loc.kind === 'staging')) s.status = 'stored';
    });
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Istovar · ${BAYS[t.bay].name} → ${slot ? slot.code : 'međuskladište'}`);
  }

  private planLoad(f: Forklift, t: Truck, idx: number, pallet: Pallet) {
    const b = this.builder(f);
    const loc = pallet.loc;
    const from = loc.kind === 'slot' ? loc.slot.code : 'međuskladište';
    if (loc.kind === 'slot') { this.goTo(b, { kind: 'slot', slot: loc.slot }, false); this.fork(b, loc.slot.y + 0.05); }
    else if (loc.kind === 'staging') { this.goTo(b, { kind: 'staging', spot: loc.spot }, false); this.fork(b, 0.05); }
    this.hold(b, TIMING.pick, () => this.takeFrom(f, pallet));
    this.fork(b, TRAVEL_H);
    this.goTo(b, { kind: 'truck', x: trailerPallet(t.bay, idx).x }, true);
    this.fork(b, TRUCK.deck + 0.05);
    this.hold(b, TIMING.place, () => {
      t.trailer[idx] = pallet; t.claimed[idx] = false; t.pending--; t.loaded++;
      pallet.loc = { kind: 'truck', truck: t, index: idx }; pallet.claimed = false; f.carrying = null;
      this.today.palletsOut++; this.totals.palletsOut++;
      this.today.handling += this.config.handlingFee;
    });
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Utovar · ${from} → ${BAYS[t.bay].name}`);
  }

  private planRelocate(f: Forklift, spot: StagingSpot, slot: Slot) {
    const b = this.builder(f);
    const pallet = spot.pallet!;
    this.goTo(b, { kind: 'staging', spot }, false);
    this.fork(b, 0.05);
    this.hold(b, TIMING.pick, () => this.takeFrom(f, pallet));
    this.fork(b, TRAVEL_H);
    this.goTo(b, { kind: 'slot', slot }, true);
    this.fork(b, slot.y + 0.05);
    this.hold(b, TIMING.place, () => { this.store(f, pallet, slot, true); pallet.claimed = false; });
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Premještanje · međuskladište → ${slot.code}`);
  }

  // ---------- Obračun ----------
  private bill(day: number) {
    const cfg = this.config;
    const stock = this.stock;
    const storage = stock * cfg.pricePerPalletDay;
    const handling = this.today.handling;
    const revenue = storage + handling;
    const cost = cfg.monthlyCosts * 12 / 365;
    const workday = this.isWorkday(day);
    const t = this.totals;
    t.revenue += revenue; t.storage += storage; t.handling += handling; t.cost += cost;
    t.overtime += this.today.overtime; t.busy += this.today.busy;
    if (workday) { t.workdays++; t.workSeconds += cfg.workHours * 3600; }
    this.history.push({ ...this.today, day, workday, stock, occupancy: stock / this.capacity, storage, revenue, cost, cumRevenue: t.revenue, cumCost: t.cost });
    this.today = emptyStats();
    for (const f of this.forklifts) f.busyToday = 0;
  }

  private pushLog(text: string, tone: LogEntry['tone']) {
    this.log.push({ time: this.time, text, tone });
    if (this.log.length > 80) this.log.shift();
  }

  /** Procjena današnje zarade od skladištenja prema trenutnoj popunjenosti. */
  liveRevenueToday() { return this.stock * this.config.pricePerPalletDay + this.today.handling; }
}
