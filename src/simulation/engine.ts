import { CLIENTS, CLIENT_WEIGHTS, TIMING } from './config';
import { BAY, CLOSE_ZONE, DOOR, ENTRY_GATE, EXIT_GATE, LANE, PARK, PARKING, QUEUE, STREET, TRAVEL_H, TRUCK, buildLayout, route, trailerPallet, type Layout } from './layout';
import { angleDelta, angleTo, headingAt, pointAt, polyline, roundedPath, segmentAt } from './path';
import { Rng } from './rng';
import type {
  Appointment, DayRecord, DayStats, ForkAction, Forklift, LogEntry, Pallet, Place, Punctuality, RequestRecord,
  Shipment, SimulationConfig, Slot, StagingSpot, TaskKind, Totals, Truck, TruckKind, Vec2,
} from './types';

export const DAY = 86400;
export const START_DATE = Date.UTC(2027, 0, 4); // ponedjeljak
export const WEEKDAYS = ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'];
const MONTHS = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];
const ON_TIME = 15 * 60; // šleper je "na redu" 15 min prije dogovorenog termina
const PREPICK_AHEAD = 90 * 60; // roba se izvlači na pod do 90 min prije dolaska šlepera za odvoz
const TURN_AWAY = 3 * 3600; // istovar bez mjesta vraća se nakon 3 h čekanja

const emptyStats = (): DayStats => ({ trucksIn: 0, trucksOut: 0, palletsIn: 0, palletsOut: 0, handling: 0, requests: 0, rejected: 0, lost: 0, busy: 0, overtime: 0, demand: 0, early: 0, late: 0, noShows: 0, servedEarly: 0, parkingWait: 0, breaks: 0 });
const emptyTotals = (): Totals => ({
  revenue: 0, storage: 0, handling: 0, cost: 0, trucksIn: 0, trucksOut: 0, palletsIn: 0, palletsOut: 0,
  requests: 0, rejected: 0, rejectedSpace: 0, rejectedTime: 0, lost: 0, overtime: 0, siteTime: 0, waitTime: 0,
  trucksDone: 0, busy: 0, workSeconds: 0, cycleTime: 0, cycles: 0, workdays: 0, early: 0, late: 0, noShows: 0, servedEarly: 0, breaks: 0,
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
export function durationLabel(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;
}

type Builder = { acts: ForkAction[]; heading: number; place: Place; atFace: boolean };
const AT_BAY = new Set(['toBay', 'prep', 'service']);

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
  /** Procjena vremena na rampi po paleti; uči se iz odrađenih šlepera. */
  bayPerPallet = 70;
  /** Ukupni rad viličara po paleti (s izvlačenjem, spremanjem s poda i vožnjom); uči se po danima. */
  workPerPallet = 80;
  plannedDay = -1;
  rackCount = 0;
  stagingCount = 0;
  reservedSlots = 0;
  reservedStaging = 0;
  entered = 0;
  /** id šlepera po parkirnom mjestu (0 = slobodno) */
  stalls: number[] = PARKING.stalls.map(() => 0);
  /** id šlepera koji je na rampi ili ide na nju */
  bayTruck = 0;
  private billedDay = 0;
  private workdayIndex = 0;
  private rng: Rng;
  private ids = { truck: 1, shipment: 1, pallet: 1 };
  private yardBusy = 0;

  constructor(config: SimulationConfig) {
    this.config = { ...config };
    this.layout = buildLayout(this.config.rackLevels);
    this.rng = new Rng(this.config.seed);
    for (let i = 0; i < this.config.forklifts; i++) {
      const p = PARK[i] ?? PARK[0];
      this.forklifts.push({
        id: i, x: p.x, z: p.z, heading: Math.PI / 2, forkH: TRAVEL_H, carrying: null, actions: [], place: { kind: 'park', index: i }, atFace: false,
        task: 'Na punjaču', taskKind: 'idle', taskStart: 0, idleSince: 0, breakUntil: 0, workedSinceBreak: 0, lunchDay: -1, busyToday: 0, busyTotal: 0,
      });
    }
  }

  get capacity() { return this.layout.capacity; }
  get stock() { return this.rackCount + this.stagingCount; }
  get day() { return Math.floor(this.time / DAY); }
  get workday() { return this.workdayIndex; }
  isWorkday(day: number) { return day % 7 < this.config.workdaysPerWeek; }
  workStart(day: number) { return day * DAY + this.config.workStartHour * 3600; }
  workEnd(day: number) { return this.workStart(day) + this.config.workHours * 3600; }
  planTime(day: number) { return this.workStart(day) - 1800; }
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
  /** Šleperi koji fizički čekaju red (parking i ulica). */
  waiting() { return this.trucks.filter(t => t.state === 'parked' || t.state === 'street' || t.state === 'toStall'); }
  freeStaging() { return this.layout.staging.length - this.stagingCount - this.reservedStaging; }
  /** Slobodna mjesta (regal + pod) umanjena za palete koje su još na šleperu na rampi. */
  freeCapacity() {
    let free = this.capacity - this.rackCount - this.reservedSlots + this.freeStaging();
    for (const t of this.trucks) if (t.kind === 'in' && AT_BAY.has(t.state)) free -= t.trailer.filter((p, i) => p && !t.claimed[i]).length;
    return free;
  }

  advance(seconds: number, fast = false) {
    let remaining = seconds, guard = 0;
    while (remaining > 1e-9 && guard++ < 1_000_000) {
      const today = this.day;
      if (this.dayDone(today)) { this.jumpTo(this.nextWake(today)); continue; }
      this.dispatch();
      for (const f of this.forklifts) if (!f.actions.length) this.assign(f);
      const step = this.idle() ? Math.min(remaining, Math.max(0.01, this.nextEvent() - this.time)) : Math.min(remaining, fast ? 1 : 0.5);
      this.tick(step);
      remaining -= step;
    }
  }

  /** Preskače do idućeg jutra bez animacije. */
  skipToNextDay() {
    const start = this.day;
    let guard = 0;
    while (this.day === start && guard++ < 400) this.advance(600, true);
  }

  private tick(dt: number) {
    const today = this.day;
    if (this.plannedDay < today && this.isWorkday(today) && this.time >= this.planTime(today)) this.plan(today);
    this.dispatch();
    for (const t of this.trucks) this.updateTruck(t, dt);
    for (const f of this.forklifts) this.updateForklift(f, dt);
    if (this.plannedDay === today && this.time >= this.workEnd(today)) this.today.overtime += dt;
    this.time += dt;
    while (this.billedDay < this.day) this.bill(this.billedDay++);
  }

  private jumpTo(target: number) {
    while (this.billedDay < Math.floor(target / DAY)) this.bill(this.billedDay++);
    this.time = Math.max(this.time, target);
    for (const f of this.forklifts) { f.task = 'Na punjaču'; f.taskKind = 'idle'; f.workedSinceBreak = 0; f.idleSince = this.time; }
  }

  private activeTrucks() { return this.trucks.some(t => t.state !== 'scheduled' && t.state !== 'gone' && t.state !== 'noshow'); }
  private forkliftsBusy() { return this.forklifts.some(f => f.actions.length > 0); }

  dayDone(today: number) {
    if (this.activeTrucks() || this.forkliftsBusy()) return false;
    if (!this.isWorkday(today)) return true;
    if (this.plannedDay < today) return this.time < this.planTime(today);
    return this.time >= this.workEnd(today) && this.trucks.every(t => t.state === 'gone' || t.state === 'noshow');
  }

  private nextWake(today: number) {
    if (this.isWorkday(today) && this.plannedDay < today && this.time < this.planTime(today)) return this.planTime(today);
    let d = today + 1;
    while (!this.isWorkday(d)) d++;
    return this.planTime(d);
  }

  private idle() {
    if (this.forkliftsBusy() || this.yardBusy) return false;
    return this.trucks.every(t => (t.state === 'scheduled' && t.arrival > this.time) || t.state === 'gone' || t.state === 'noshow' || t.state === 'parked'
      || (t.state === 'street' && t.x <= this.queueTarget(t) + 0.01)
      || (t.state === 'prep' && t.timer > 0) || (t.state === 'closing' && t.timer > 0 && (t.atZone || !this.zoneFree())) || (t.state === 'service' && !this.serviceDone(t)));
  }

  private nextEvent() {
    const d = this.day;
    let next = (d + 1) * DAY;
    // Događaj točno sada obradi se u kratkom koraku, inače bi idući korak preskočio do ponoći.
    const consider = (t: number) => { if (t >= this.time && t < next) next = t; };
    if (this.plannedDay < d && this.isWorkday(d)) consider(this.planTime(d));
    // Svi trenuci kad se nešto može promijeniti bez vanjskog događaja, da preskakanje ne ovisi o brzini.
    consider(this.workStart(d) - 300); consider(this.workStart(d)); consider(this.workEnd(d)); consider(this.workEnd(d) - TIMING.pretomorrow);
    consider(this.workStart(d) + TIMING.lunchAfter); consider(this.workStart(d) + TIMING.lunchLatest);
    for (const t of this.trucks) {
      if (t.state === 'scheduled') {
        consider(t.arrival);
        if (t.punctuality === 'noshow') consider(t.planned + 2 * 3600);
        if (t.kind === 'out') consider(t.planned - PREPICK_AHEAD);
      } else if (t.state === 'prep' || t.state === 'closing') consider(this.time + t.timer);
      else if (t.state === 'parked' || t.state === 'street') {
        consider(t.planned - ON_TIME);
        if (t.state === 'parked' && !t.opened) consider(this.time + t.timer);
        if (t.kind === 'in') consider(t.arrivedAt + TURN_AWAY);
      }
    }
    for (const t of this.trucks) if (t.state === 'scheduled') consider(t.planned - this.estimateBay(t) - 60);
    for (const f of this.forklifts) {
      if (f.breakUntil > this.time) consider(f.breakUntil);
      if (!f.actions.length && f.place.kind !== 'park') consider(f.idleSince + 45);
    }
    return next;
  }

  // ---------- Dispečer: termini se dogovaraju unaprijed, rampa je samo jedna ----------
  private plan(day: number) {
    this.plannedDay = day;
    const w = this.workdayIndex++;
    const cfg = this.config;
    this.trucks = this.trucks.filter(t => t.state !== 'gone' && t.state !== 'noshow');
    this.appointments = [];
    this.requests = [];
    const lambda = this.demandAt(w);
    this.today.demand = lambda;
    const ws = this.workStart(day), we = this.workEnd(day);
    let lunchDone = false;
    // Odvozi kojima je roba već izvučena na pod idu prvi, da oslobode pod uz vrata.
    const staged = (s: Shipment) => s.pallets.some(p => p.prepicked) ? 0 : 1;
    const due = [...this.shipments.values()].filter(s => s.status === 'stored' && s.dueDay <= day).sort((a, b) => staged(a) - staged(b) || a.dueDay - b.dueDay || a.id - b.id);
    const n = this.rng.poisson(lambda * this.rng.range(0.85, 1.15));
    const requests = Array.from({ length: n }, () => ({ client: this.rng.weighted(CLIENT_WEIGHTS), pallets: this.rng.int(cfg.palletsMin, cfg.palletsMax), dwell: this.rng.int(cfg.dwellMin, cfg.dwellMax) }));
    // Odvozi i dovozi se izmjenjuju: odvoz oslobodi mjesto, a viličar u međuvremenu sprema i priprema robu.
    const jobs: ({ kind: 'out'; s: Shipment } | { kind: 'in'; r: typeof requests[number] })[] = [];
    for (let i = 0; i < Math.max(due.length, requests.length); i++) {
      if (due[i]) jobs.push({ kind: 'out', s: due[i] });
      if (requests[i]) jobs.push({ kind: 'in', r: requests[i] });
    }
    let cursor = ws;
    let stock = this.stock - due.reduce((a, s) => a + s.count, 0);
    let outLeft = due.reduce((a, s) => a + this.estimateBay({ pallets: s.count }), 0);
    let accepted = 0, rejected = 0, deferred = 0;
    // Posla se dogovara za puno radno vrijeme: dio šlepera kasni ili ne dođe, a pauze se uklope u čekanja.
    const budget = cfg.workHours * 3600 * Math.max(1, cfg.forklifts);
    let work = due.reduce((a, s) => a + s.count, 0) * this.workPerPallet;
    for (const job of jobs) {
      const pallets = job.kind === 'out' ? job.s.count : job.r.pallets;
      const est = this.estimateBay({ pallets });
      let start = Math.ceil(cursor / 300) * 300;
      // Gablec ide između dva šlepera, prvi put kad je rampa slobodna nakon 11:00.
      if (!lunchDone && start >= ws + TIMING.lunchAfter) { start += TIMING.lunch; lunchDone = true; }
      const end = start + est;
      if (job.kind === 'out') {
        outLeft -= est;
        // Odvoz koji ne stane u radno vrijeme dogovara se za idući radni dan.
        if ((end > we - 900 || work > budget * 1.08) && cursor > ws) { job.s.dueDay = this.nextWorkday(day + 1); deferred++; stock += job.s.count; work -= job.s.count * this.workPerPallet; continue; }
        job.s.status = 'pickup';
        this.createTruck('out', job.s, start, end, day);
        cursor = end;
        continue;
      }
      const r = job.r;
      this.today.requests++; this.totals.requests++;
      // Dovoz se prima samo ako ima mjesta i ako poslije njega stanu i dogovoreni odvozi.
      const reason: RequestRecord['reason'] = stock + r.pallets > this.capacity ? 'mjesto' : end + outLeft > we - 600 || work + r.pallets * this.workPerPallet > budget ? 'termin' : '';
      this.requests.push({ ...r, accepted: !reason, reason });
      if (reason) { rejected++; this.rejectRequest(r.pallets * r.dwell * cfg.pricePerPalletDay + r.pallets * 2 * cfg.handlingFee, reason); continue; }
      accepted++;
      stock += r.pallets;
      work += r.pallets * this.workPerPallet;
      cursor = end;
      this.createTruck('in', this.createShipment(r.client, r.pallets, r.dwell, day), start, end, day);
    }
    this.pushLog(`Raspored: ${due.length - deferred} utovara, ${accepted} istovara${rejected ? ` · odbijeno ${rejected}` : ''}${deferred ? ` · ${deferred} odvoza pomaknuto na sutra` : ''}`, rejected || deferred ? 'warn' : 'info');
  }

  /** Vrijeme rampe: dolazak, (pola šlepera ceradu otvori već na parkingu), rad po paleti i odlazak u zonu za zatvaranje. */
  estimateBay(t: { pallets: number }) { return TIMING.maneuver + TIMING.prep / 2 + TIMING.papers + t.pallets * this.bayPerPallet / Math.max(1, this.config.forklifts * 0.8) + TIMING.bayBuffer; }
  zoneFree() { return !this.trucks.some(t => t.state === 'toClose' || (t.state === 'closing' && t.atZone)); }

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
    const cfg = this.config;
    const r = this.rng.next();
    let punctuality: Punctuality = 'ontime', arrival: number;
    if (r < cfg.noShowChance) { punctuality = 'noshow'; arrival = Infinity; }
    else if (r < cfg.noShowChance + cfg.earlyChance) { punctuality = 'early'; arrival = planned - this.rng.range(30, 150) * 60; }
    else if (r < cfg.noShowChance + cfg.earlyChance + cfg.lateChance) { punctuality = 'late'; arrival = planned + this.rng.range(20, 90) * 60; }
    else arrival = planned + Math.max(-600, Math.min(720, this.rng.normal() * 300));
    arrival = Math.max(arrival, this.planTime(day) + 60);
    const truck: Truck = {
      id, kind, shipmentId: s.id, client: s.client, pallets: s.count, planned, arrival, punctuality, state: 'scheduled', stall: -1,
      x: 170, z: STREET.lane, heading: Math.PI, speed: 0, pathPts: null, pathCum: null, pathLen: 0, s: 0, releaseAt: 0,
      timer: 0, trailer: Array(TRUCK.capacity).fill(null), claimed: Array(TRUCK.capacity).fill(false), pending: 0, loaded: 0,
      arrivedAt: 0, calledAt: 0, atBayAt: 0, serviceAt: 0, leftAt: 0, servedEarly: false, opened: false, atZone: false, papers: 0, color: this.rng.int(0, 5), curtain: 0,
    };
    if (kind === 'in') {
      s.inTruck = id;
      for (let i = 0; i < s.count; i++) {
        const pallet: Pallet = { id: this.ids.pallet++, shipmentId: s.id, client: s.client, height: s.height * this.rng.range(0.9, 1.06), tint: s.tint + this.rng.range(-0.04, 0.04), loc: { kind: 'truck', truck, index: i }, claimed: false, prepicked: false };
        s.pallets.push(pallet);
        truck.trailer[i] = pallet;
      }
    } else s.outTruck = id;
    this.trucks.push(truck);
    this.appointments.push({ truckId: id, kind, client: s.client, pallets: s.count, planned, estEnd });
  }

  /** Tko ide na rampu: najraniji dogovoreni termin među prisutnima; ako su svi poranili, ubaci ga samo ako stigne prije sljedećeg termina. */
  private pickForBay(): Truck | null {
    const front = this.streetOrder()[0];
    const space = this.freeCapacity();
    // Istovar ide na rampu samo ako za njegovu robu ima mjesta, inače bi blokirao rampu odvozima.
    const present = this.trucks.filter(t => (t.state === 'parked' || (t === front && t.x <= this.queueTarget(t) + 0.5)) && (t.kind === 'out' || t.pallets <= space))
      .sort((a, b) => a.planned - b.planned || a.id - b.id);
    if (!present.length) return null;
    const due = present.find(t => t.planned <= this.time + ON_TIME);
    if (due) return due;
    const c = present[0];
    const nextDue = Math.min(...this.trucks.filter(t => t !== c && (t.state === 'scheduled' || t.state === 'street' || t.state === 'parked' || t.state === 'toStall')).map(t => t.planned));
    if (nextDue - this.time >= this.estimateBay(c)) { c.servedEarly = true; return c; }
    return null;
  }

  private dispatch() {
    if (this.yardBusy || this.time < this.planTime(this.day)) return;
    const stuck = this.trucks.find(t => t.kind === 'in' && (t.state === 'parked' || t.state === 'street') && this.time - t.arrivedAt > TURN_AWAY && t.pallets > this.freeCapacity());
    if (stuck) { this.turnAway(stuck); return; }
    if (!this.bayTruck && this.time >= this.workStart(this.day) - 300) {
      const t = this.pickForBay();
      if (t) { this.callToBay(t); return; }
    }
    const front = this.streetOrder()[0];
    const free = this.stalls.findIndex(id => !id);
    if (front && free >= 0 && front.x <= this.queueTarget(front) + 0.5) this.streetToStall(front, free);
  }

  private streetOrder() { return this.trucks.filter(t => t.state === 'street').sort((a, b) => a.arrivedAt - b.arrivedAt || a.id - b.id); }
  private queueTarget(t: Truck) { return QUEUE.x + Math.max(0, this.streetOrder().indexOf(t)) * QUEUE.gap; }

  private setPath(t: Truck, points: Vec2[], radius: number) {
    const path = roundedPath(points, radius);
    t.pathPts = path.pts; t.pathCum = path.cum; t.pathLen = path.len; t.s = 0; t.speed = Math.min(t.speed, 2);
    const exitIndex = path.pts.findIndex(p => p.x < EXIT_GATE.x0 - 1 && p.z < 0);
    t.releaseAt = exitIndex >= 0 ? path.cum[exitIndex] : path.len;
  }

  private callToBay(t: Truck) {
    const late = this.trucks.find(u => u !== t && u.state === 'scheduled' && u.planned < t.planned && u.planned <= this.time);
    if (t.state === 'parked') {
      const sx = PARKING.stalls[t.stall];
      this.stalls[t.stall] = 0;
      this.setPath(t, [{ x: sx, z: PARKING.cabZ }, { x: sx, z: LANE.bay }, { x: BAY.stopX, z: LANE.bay }], 6);
    } else {
      this.setPath(t, [{ x: t.x, z: STREET.lane }, { x: ENTRY_GATE.x, z: STREET.lane }, { x: ENTRY_GATE.x, z: LANE.bay }, { x: BAY.stopX, z: LANE.bay }], 6);
    }
    t.state = 'toBay'; t.calledAt = this.time; this.bayTruck = t.id; this.yardBusy = t.id; this.entered++;
    const wait = this.time - t.arrivedAt;
    this.totals.waitTime += wait; this.today.parkingWait += wait;
    if (t.servedEarly && t.planned - this.time > ON_TIME) { this.today.servedEarly++; this.totals.servedEarly++; }
    this.pushLog(`#${t.id} na rampu${late ? ` umjesto #${late.id} koji kasni` : t.servedEarly && t.planned - this.time > ON_TIME ? ' ranije, rampa je slobodna' : ''}${wait > 600 ? ` · čekao ${durationLabel(wait)}` : ''}`, t.kind);
  }

  private streetToStall(t: Truck, k: number) {
    const sx = PARKING.stalls[k];
    this.setPath(t, [{ x: t.x, z: STREET.lane }, { x: LANE.feeder, z: STREET.lane }, { x: LANE.feeder, z: LANE.turn }, { x: sx, z: LANE.turn }, { x: sx, z: PARKING.cabZ }], 4.5);
    t.state = 'toStall'; t.stall = k; this.stalls[k] = t.id; this.yardBusy = t.id;
  }

  /** Šleper za istovar koji ni nakon 3 h čekanja nema mjesta vraća se s robom. */
  private turnAway(t: Truck) {
    if (t.state === 'parked') {
      const sx = PARKING.stalls[t.stall];
      this.stalls[t.stall] = 0;
      this.setPath(t, [{ x: sx, z: PARKING.cabZ }, { x: sx, z: 18.9 }, { x: EXIT_GATE.x, z: 18.9 }, { x: EXIT_GATE.x, z: STREET.lane }, { x: -95, z: STREET.lane }], 4.5);
      this.yardBusy = t.id;
    } else this.setPath(t, [{ x: t.x, z: STREET.lane }, { x: -95, z: STREET.lane }], 4);
    const s = this.shipments.get(t.shipmentId);
    if (s) { for (const p of s.pallets) p.loc = { kind: 'gone' }; this.shipments.delete(s.id); }
    t.trailer.fill(null);
    t.state = 'leaving'; t.calledAt = this.time;
    this.rejectRequest(t.pallets * (s?.dwell ?? 0) * this.config.pricePerPalletDay + t.pallets * 2 * this.config.handlingFee, 'mjesto');
    this.pushLog(`#${t.id} vraćen: ni nakon 3 h nema mjesta za ${t.pallets} paleta`, 'warn');
  }

  private leaveYard(t: Truck) {
    const x0 = t.atZone ? CLOSE_ZONE.stopX : BAY.stopX;
    this.setPath(t, [{ x: x0, z: LANE.bay }, { x: EXIT_GATE.x, z: LANE.bay }, { x: EXIT_GATE.x, z: STREET.lane }, { x: -95, z: STREET.lane }], 4.5);
    if (this.bayTruck === t.id) this.bayTruck = 0;
    t.state = 'leaving'; t.curtain = 0; t.speed = 0; this.yardBusy = t.id;
    this.pushLog(`#${t.id} odlazi · ${durationLabel(this.time - t.arrivedAt)} na parceli`, t.kind);
  }

  private drive(t: Truck, dt: number) {
    if (!t.pathPts || !t.pathCum) return;
    const path = { pts: t.pathPts, cum: t.pathCum, len: t.pathLen };
    const p = pointAt(path, t.s);
    const vmax = p.z < -0.5 && (p.x < EXIT_GATE.x0 - 4 || p.x > ENTRY_GATE.x1 + 4) ? TIMING.truckStreet : TIMING.truckYard;
    const brake = t.state !== 'leaving' ? Math.sqrt(2 * TIMING.truckAccel * Math.max(0, t.pathLen - t.s)) + 0.3 : Infinity;
    t.speed = Math.min(vmax, brake, t.speed + TIMING.truckAccel * dt);
    t.s = Math.min(t.pathLen, t.s + t.speed * dt);
    const q = pointAt(path, t.s);
    t.x = q.x; t.z = q.z; t.heading = headingAt(path, Math.min(t.s, t.pathLen - 0.01));
    if (t.state === 'leaving' && this.yardBusy === t.id && t.s >= t.releaseAt) this.yardBusy = 0;
    if (t.s < t.pathLen - 1e-6) return;
    t.speed = 0;
    if (t.state === 'toClose') {
      t.state = 'closing'; t.atZone = true; this.yardBusy = 0;
    } else if (t.state === 'toStall') {
      t.state = 'parked'; this.yardBusy = 0; t.timer = TIMING.prep;
      this.pushLog(`#${t.id} čeka na parkingu P${t.stall + 1}${t.planned - this.time > ON_TIME ? ` · termin u ${clockLabel(t.planned)}` : ''}`, 'info');
    } else if (t.state === 'toBay') {
      t.atBayAt = this.time; this.yardBusy = 0;
      if (t.opened) { t.state = 'service'; t.serviceAt = this.time; t.curtain = 1; }
      else { t.state = 'prep'; t.timer = TIMING.prep; }
    } else {
      t.state = 'gone'; t.leftAt = this.time; t.pathPts = null; t.pathCum = null;
      if (this.yardBusy === t.id) this.yardBusy = 0;
      this.totals.siteTime += t.leftAt - t.arrivedAt; this.totals.trucksDone++;
    }
  }

  private serviceDone(t: Truck) { return t.pending === 0 && (t.kind === 'in' ? t.trailer.every(p => !p) : t.loaded >= t.pallets); }

  private updateTruck(t: Truck, dt: number) {
    switch (t.state) {
      case 'scheduled':
        if (t.punctuality === 'noshow') { if (this.time >= t.planned + 2 * 3600) this.noShow(t); break; }
        if (this.time >= t.arrival) {
          t.state = 'street'; t.arrivedAt = this.time; t.speed = TIMING.truckStreet;
          t.x = Math.max(170, ...this.trucks.filter(u => u.state === 'street' && u !== t).map(u => u.x + QUEUE.gap));
          const diff = this.time - t.planned;
          if (diff < -ON_TIME) { this.today.early++; this.totals.early++; }
          if (diff > ON_TIME) { this.today.late++; this.totals.late++; }
          this.pushLog(`#${t.id} stigao${diff < -ON_TIME ? ` ${durationLabel(-diff)} ranije` : diff > ON_TIME ? ` s kašnjenjem ${durationLabel(diff)}` : ''} · ${t.kind === 'in' ? 'istovar' : 'utovar'} ${CLIENTS[t.client].code}, termin ${clockLabel(t.planned)}`, diff > ON_TIME ? 'warn' : t.kind);
        }
        break;
      case 'street': {
        const target = this.queueTarget(t);
        if (t.x > target + 0.01) {
          const v = Math.min(TIMING.truckStreet, Math.sqrt(2 * TIMING.truckAccel * (t.x - target)) + 0.4);
          t.x = Math.max(target, t.x - v * dt); t.speed = v; t.heading = Math.PI;
        } else t.speed = 0;
        break;
      }
      case 'toStall': case 'toBay': case 'toClose': case 'leaving': this.drive(t, dt); break;
      case 'parked':
        // Dok čeka red, vozač otvori ceradu i pripremi papire.
        if (!t.opened) { t.timer -= dt; t.curtain = Math.min(1, 1 - t.timer / TIMING.prep); if (t.timer <= 0) { t.opened = true; t.curtain = 1; } }
        break;
      case 'prep':
        t.timer -= dt; t.curtain = Math.min(1, 1 - t.timer / TIMING.prep);
        if (t.timer <= 0) { t.state = 'service'; t.serviceAt = this.time; t.curtain = 1; }
        break;
      case 'service':
        if (this.serviceDone(t)) {
          t.state = 'closing'; t.timer = TIMING.close;
          this.bayPerPallet = this.bayPerPallet * 0.9 + ((this.time - t.serviceAt) / Math.max(1, t.pallets)) * 0.1;
          if (t.kind === 'in') { this.today.trucksIn++; this.totals.trucksIn++; }
          else {
            this.today.trucksOut++; this.totals.trucksOut++;
            const s = this.shipments.get(t.shipmentId);
            if (s) { s.status = 'gone'; for (const p of s.pallets) p.loc = { kind: 'gone' }; this.shipments.delete(s.id); }
          }
        }
        break;
      case 'closing':
        // Gotov šleper se odmakne u zonu kod izlaza i tamo zatvara ceradu, da sljedeći odmah uđe na rampu.
        if (!t.atZone && t.papers === 2 && !this.yardBusy && this.zoneFree() && t.timer > 30) {
          this.setPath(t, [{ x: BAY.stopX, z: LANE.bay }, { x: CLOSE_ZONE.stopX, z: LANE.bay }], 4);
          t.state = 'toClose'; this.yardBusy = t.id; if (this.bayTruck === t.id) this.bayTruck = 0;
          break;
        }
        t.timer -= dt; t.curtain = Math.max(0, t.timer / TIMING.close);
        if (t.timer <= 0 && t.papers === 2 && !this.yardBusy) this.leaveYard(t);
        break;
    }
  }

  private noShow(t: Truck) {
    t.state = 'noshow';
    this.today.noShows++; this.totals.noShows++;
    const s = this.shipments.get(t.shipmentId);
    if (t.kind === 'in') {
      if (s) { for (const p of s.pallets) p.loc = { kind: 'gone' }; this.shipments.delete(s.id); }
      this.pushLog(`#${t.id} nije došao na istovar (termin ${clockLabel(t.planned)})`, 'warn');
    } else {
      if (s) { s.status = 'stored'; s.dueDay = this.nextWorkday(this.day + 1); for (const p of s.pallets) p.prepicked = false; }
      this.pushLog(`#${t.id} nije došao po robu (termin ${clockLabel(t.planned)}) · roba čeka novi termin`, 'warn');
    }
  }

  // ---------- Viličar ----------
  private updateForklift(f: Forklift, dt: number) {
    if (!f.actions.length && f.breakUntil <= this.time) this.assign(f);
    let rem = dt;
    const working = f.taskKind !== 'idle' && f.taskKind !== 'park' && f.taskKind !== 'break';
    while (rem > 1e-9 && f.actions.length) {
      const a = f.actions[0];
      if (a.kind === 'fork' && a.h0 === undefined) { a.h0 = f.forkH; a.dur = Math.max(0.6, Math.abs(a.h1 - a.h0) / TIMING.lift); }
      if (a.kind === 'turn' && !a.from) { a.from = { x: f.x, z: f.z }; a.h0 = f.heading; }
      const use = Math.min(rem, a.dur - a.t);
      a.t += use; rem -= use;
      if (working) { f.busyToday += use; f.busyTotal += use; f.workedSinceBreak += use; this.today.busy += use / this.forklifts.length; }
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
    if (f.taskKind === 'unload' || f.taskKind === 'load') {
      const cycle = this.time - f.taskStart;
      this.totals.cycleTime += cycle; this.totals.cycles++;
    }
    f.task = f.place.kind === 'park' ? 'Na punjaču' : 'Čeka posao';
    f.taskKind = 'idle';
    f.idleSince = this.time;
  }

  private startBreak(f: Forklift, lunch: boolean) {
    const dur = lunch ? TIMING.lunch : TIMING.shortBreak;
    f.breakUntil = this.time + dur; f.workedSinceBreak = 0; f.taskKind = 'break';
    f.task = lunch ? `Gablec do ${clockLabel(this.time + dur)}` : `Pauza 5 min (sjedne nakon ${durationLabel(TIMING.breakAfter)} rada)`;
    if (lunch) f.lunchDay = this.day;
    this.today.breaks += dur; this.totals.breaks += dur;
    if (lunch) this.pushLog(`Viličarist na gableku do ${clockLabel(this.time + dur)}`, 'info');
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
  private commit(f: Forklift, b: Builder, task: string, kind: TaskKind) {
    // Ako je stajao barem 5 minuta, to mu je bio odmor.
    if (kind !== 'park' && f.taskKind === 'idle' && this.time - f.idleSince >= TIMING.shortBreak) f.workedSinceBreak = 0;
    f.actions = b.acts; f.place = b.place; f.atFace = b.atFace; f.task = task; f.taskKind = kind; f.taskStart = this.time;
  }

  private chooseSlot(s: Shipment): Slot | null {
    const cfg = this.config;
    const span = Math.max(1, cfg.dwellMax - cfg.dwellMin);
    // Kratki boravak ide bliže vratima i niže, dugi dublje i više; pošiljka ostaje u istom prolazu.
    const q = Math.min(1, Math.max(0, (s.dwell - cfg.dwellMin) / span)) * 0.85;
    const costs = this.layout.costs;
    const target = costs[Math.floor(q * (costs.length - 1))];
    const near = this.lastAisle(s);
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

  /** Slobodno podno mjesto najbliže vratima. */
  private nearSpot(): StagingSpot | null {
    let best: StagingSpot | null = null;
    for (const s of this.layout.staging) if (!s.pallet && !s.reserved && (!best || Math.abs(s.x - DOOR.x) < Math.abs(best.x - DOOR.x))) best = s;
    return best;
  }

  /** Sljedeći šleper za odvoz koji je već tu ili dolazi uskoro, a roba mu još stoji u regalima. */
  private nextOutbound(): Shipment | null {
    const candidates = this.trucks.filter(t => t.kind === 'out' && (t.state === 'parked' || t.state === 'street' || t.state === 'toBay' || t.state === 'prep' || (t.state === 'scheduled' && t.punctuality !== 'noshow' && t.planned - this.time < PREPICK_AHEAD)))
      .sort((a, b) => a.planned - b.planned);
    const ready = (s: Shipment | undefined) => !!s && s.pallets.some(p => p.loc.kind === 'slot' && !p.claimed && !p.prepicked);
    for (const t of candidates) { const s = this.shipments.get(t.shipmentId); if (ready(s)) return s!; }
    // Pred kraj dana, kad nema drugog posla, izvlači se roba za prve sutrašnje odvoze.
    if (this.time < this.workEnd(this.day) - TIMING.pretomorrow || this.freeStaging() < 24) return null;
    const tomorrow = this.nextWorkday(this.day + 1);
    let best: Shipment | null = null;
    for (const s of this.shipments.values()) if (s.status === 'stored' && s.dueDay <= tomorrow && ready(s) && (!best || s.dueDay < best.dueDay || (s.dueDay === best.dueDay && s.id < best.id))) best = s;
    return best;
  }

  private assign(f: Forklift) {
    if (f.breakUntil > this.time) return;
    if (f.taskKind === 'break') { f.taskKind = 'idle'; f.task = 'Čeka posao'; f.idleSince = this.time; }
    const day = this.day, ws = this.workStart(day);
    // Gotov šleper ne odlazi bez papira: skladištar siđe s viličara, provjeri, potpiše i stavi pečat.
    const papers = this.trucks.find(t => t.state === 'closing' && t.papers === 0);
    if (papers) {
      papers.papers = 1;
      const b = this.builder(f);
      this.goTo(b, { kind: 'truck', x: trailerPallet(0).x - 0.5 }, false);
      this.hold(b, TIMING.papers, () => { papers.papers = 2; });
      this.commit(f, b, `Papiri za #${papers.id}: CMR, potpis i pečat`, 'papers');
      return;
    }
    const inService = this.trucks.find(t => t.state === 'service');
    // Pauze: gablec oko 11:30 kad nema šlepera u radu (najkasnije u 12:30), kratka pauza nakon ~2 h rada.
    if (this.plannedDay === day && f.lunchDay !== day && this.time >= ws + TIMING.lunchAfter && this.time < this.workEnd(day)
      && (!inService || this.time >= ws + TIMING.lunchLatest)) { this.startBreak(f, true); return; }
    if (f.workedSinceBreak >= TIMING.breakAfter && (!inService || f.workedSinceBreak >= TIMING.breakForce)) { this.startBreak(f, false); return; }

    if (inService) {
      const t = inService;
      if (t.kind === 'in') {
        let idx = -1, bestD = Infinity;
        t.trailer.forEach((p, i) => { if (p && !t.claimed[i]) { const d = Math.abs(trailerPallet(i).x - DOOR.x); if (d < bestD) { bestD = d; idx = i; } } });
        if (idx >= 0) {
          const pallet = t.trailer[idx]!;
          const s = this.shipments.get(pallet.shipmentId)!;
          // Kad netko čeka red, šleper se brzo istovari na pod uz vrata, a u regale se sprema poslije.
          const hurry = this.waiting().some(w => w.planned <= this.time) && this.freeStaging() > 6;
          const slot = hurry ? null : this.chooseSlot(s);
          const spot = slot ? null : this.nearSpot();
          if (slot || spot) {
            if (slot) { slot.reserved = true; this.reservedSlots++; } else { spot!.reserved = true; this.reservedStaging++; }
            t.claimed[idx] = true; t.pending++;
            this.planUnload(f, t, idx, slot, spot);
            return;
          }
        }
      } else {
        const s = this.shipments.get(t.shipmentId);
        if (s) {
          let pallet: Pallet | null = null, bestCost = Infinity;
          for (const p of s.pallets) {
            if (p.claimed) continue;
            const cost = p.loc.kind === 'staging' ? Math.abs(p.loc.spot.x - DOOR.x) * 0.1 : p.loc.kind === 'slot' ? p.loc.slot.cost + 100 : Infinity;
            if (cost < bestCost) { bestCost = cost; pallet = p; }
          }
          const idx = t.trailer.findIndex((p, i) => !p && !t.claimed[i]);
          if (pallet && idx >= 0) {
            pallet.claimed = true; t.claimed[idx] = true; t.pending++;
            this.planLoad(f, t, idx, pallet);
            return;
          }
        }
      }
    }
    // Između šlepera: spremi palete s poda u regale, pa unaprijed izvuci robu za sljedeći odvoz.
    // Nakon kraja radnog vremena ostaje samo posao oko šlepera; pod se sprema ujutro.
    const afterHours = this.plannedDay !== day || this.time >= this.workEnd(day);
    const staged = afterHours ? undefined : this.layout.staging.find(x => x.pallet && !x.pallet.claimed && !x.pallet.prepicked);
    if (staged) {
      const s = this.shipments.get(staged.pallet!.shipmentId);
      const slot = s ? this.chooseSlot(s) : null;
      if (slot) { staged.pallet!.claimed = true; slot.reserved = true; this.reservedSlots++; this.planRelocate(f, staged, slot); return; }
    }
    const out = !afterHours && this.freeStaging() > 12 ? this.nextOutbound() : null;
    if (out) {
      let pallet: Pallet | null = null;
      for (const p of out.pallets) if (p.loc.kind === 'slot' && !p.claimed && !p.prepicked && (!pallet || p.loc.slot.cost > (pallet.loc as { slot: Slot }).slot.cost)) pallet = p;
      const spot = this.nearSpot();
      if (pallet && spot) { pallet.claimed = true; spot.reserved = true; this.reservedStaging++; this.planPrepick(f, pallet, spot); return; }
    }
    if (f.place.kind !== 'park' && this.time - f.idleSince >= 45) {
      const b = this.builder(f);
      this.goTo(b, { kind: 'park', index: f.id }, false);
      this.commit(f, b, 'Vožnja na punjač', 'park');
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
    // Pošiljka je na skladištu kad su sve palete u regalu ili na podu (s dva viličara zadnja može biti i premještanje).
    const s = this.shipments.get(pallet.shipmentId);
    if (s && s.status === 'booked' && s.pallets.every(p => p.loc.kind === 'slot' || p.loc.kind === 'staging')) s.status = 'stored';
  }

  private planUnload(f: Forklift, t: Truck, idx: number, slot: Slot | null, spot: StagingSpot | null) {
    const b = this.builder(f);
    this.goTo(b, { kind: 'truck', x: trailerPallet(idx).x }, false);
    this.fork(b, TRUCK.deck);
    this.hold(b, TIMING.pick + TIMING.check, () => {
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
    this.hold(b, TIMING.place, () => this.store(f, f.carrying!, target, !!slot));
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Istovar → ${slot ? slot.code : 'pod uz vrata'}`, 'unload');
  }

  private planLoad(f: Forklift, t: Truck, idx: number, pallet: Pallet) {
    const b = this.builder(f);
    const loc = pallet.loc;
    const from = loc.kind === 'slot' ? loc.slot.code : 'pod uz vrata';
    if (loc.kind === 'slot') { this.goTo(b, { kind: 'slot', slot: loc.slot }, false); this.fork(b, loc.slot.y + 0.05); }
    else if (loc.kind === 'staging') { this.goTo(b, { kind: 'staging', spot: loc.spot }, false); this.fork(b, 0.05); }
    this.hold(b, TIMING.pick, () => this.takeFrom(f, pallet));
    this.fork(b, TRAVEL_H);
    this.goTo(b, { kind: 'truck', x: trailerPallet(idx).x }, true);
    this.fork(b, TRUCK.deck + 0.05);
    this.hold(b, TIMING.place + TIMING.check, () => {
      t.trailer[idx] = pallet; t.claimed[idx] = false; t.pending--; t.loaded++;
      pallet.loc = { kind: 'truck', truck: t, index: idx }; pallet.claimed = false; pallet.prepicked = false; f.carrying = null;
      this.today.palletsOut++; this.totals.palletsOut++;
      this.today.handling += this.config.handlingFee;
    });
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Utovar ${from} → rampa`, 'load');
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
    this.commit(f, b, `Spremanje s poda → ${slot.code}`, 'putaway');
  }

  private planPrepick(f: Forklift, pallet: Pallet, spot: StagingSpot) {
    const b = this.builder(f);
    const slot = (pallet.loc as { kind: 'slot'; slot: Slot }).slot;
    this.goTo(b, { kind: 'slot', slot }, false);
    this.fork(b, slot.y + 0.05);
    this.hold(b, TIMING.pick, () => this.takeFrom(f, pallet));
    this.fork(b, TRAVEL_H);
    this.goTo(b, { kind: 'staging', spot }, true);
    this.fork(b, 0.05);
    this.hold(b, TIMING.place, () => { this.store(f, pallet, spot, false); pallet.claimed = false; pallet.prepicked = true; });
    this.fork(b, TRAVEL_H);
    this.commit(f, b, `Priprema za odvoz ${slot.code} → pod`, 'prepick');
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
    const moves = this.today.palletsIn + this.today.palletsOut;
    if (workday && moves > 40) this.workPerPallet = this.workPerPallet * 0.85 + (this.today.busy * this.forklifts.length / moves) * 0.15;
    this.history.push({ ...this.today, day, workday, stock, occupancy: stock / this.capacity, storage, revenue, cost, cumRevenue: t.revenue, cumCost: t.cost });
    this.today = emptyStats();
    for (const f of this.forklifts) f.busyToday = 0;
  }

  private pushLog(text: string, tone: LogEntry['tone']) {
    this.log.push({ time: this.time, text, tone });
    if (this.log.length > 80) this.log.shift();
  }

  /** Procjena današnje zarade: skladištenje prema trenutnoj popunjenosti i dosad naplaćena manipulacija. */
  liveRevenueToday() { return this.stock * this.config.pricePerPalletDay + this.today.handling; }
}
