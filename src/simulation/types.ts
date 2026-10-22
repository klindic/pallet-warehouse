export interface Vec2 { x: number; z: number }

export type DemandPreset = 'slow' | 'normal' | 'fast';
export type TruckKind = 'in' | 'out';
export type TruckState = 'scheduled' | 'queue' | 'entering' | 'prep' | 'service' | 'closing' | 'leaving' | 'gone';

export interface SimulationConfig {
  seed: number;
  rackLevels: number;          // razine regala (3–5)
  forklifts: number;           // broj viličara (1–2)
  pricePerPalletDay: number;   // € po paleti po kalendarskom danu
  handlingFee: number;         // € po paleti na ulazu i na izlazu
  monthlyCosts: number;        // € mjesečno (kredit, plaće, struja, leasing…)
  rampDays: number;            // radnih dana do pune potražnje
  startDemand: number;         // prosječno kamiona za istovar po radnom danu na početku
  peakDemand: number;          // prosječno kamiona za istovar po radnom danu kad posao procvjeta
  palletsMin: number; palletsMax: number;
  dwellMin: number; dwellMax: number;  // kalendarski dani skladištenja
  workStartHour: number; workHours: number; workdaysPerWeek: number;
  lateChance: number;          // udio kamiona koji kasne 25–75 min
}

export type PalletLoc =
  | { kind: 'truck'; truck: Truck; index: number }
  | { kind: 'fork'; forklift: number }
  | { kind: 'slot'; slot: Slot }
  | { kind: 'staging'; spot: StagingSpot }
  | { kind: 'gone' };

export interface Pallet { id: number; shipmentId: number; client: number; height: number; tint: number; loc: PalletLoc; claimed: boolean }

export interface Row { index: number; x0: number; x1: number; face: number; into: 1 | -1; aisle: number }
export interface Aisle { index: number; x0: number; x1: number; cx: number }
export interface Slot {
  index: number; code: string; row: number; bay: number; pos: number; level: number; aisle: number;
  face: number; into: 1 | -1; x: number; z: number; y: number; cost: number;
  pallet: Pallet | null; reserved: boolean;
}
export interface StagingSpot { index: number; x: number; z: number; pallet: Pallet | null; reserved: boolean }

export interface Shipment {
  id: number; client: number; pallets: Pallet[]; count: number; dwell: number;
  bookedDay: number; arrivalDay: number; dueDay: number; height: number; tint: number;
  status: 'booked' | 'stored' | 'pickup' | 'gone';
  inTruck: number; outTruck: number;
}

export interface Truck {
  id: number; kind: TruckKind; shipmentId: number; client: number; pallets: number;
  planned: number; arrival: number; state: TruckState; bay: number;
  x: number; z: number; heading: number; speed: number;
  pathPts: Vec2[] | null; pathCum: number[] | null; pathLen: number; s: number; releaseAt: number;
  timer: number; trailer: (Pallet | null)[]; claimed: boolean[]; pending: number; loaded: number;
  queuedAt: number; enteredAt: number; atBayAt: number; serviceAt: number; leftAt: number;
  color: number; curtain: number;
}

export type ForkAction =
  | { kind: 'move'; pts: Vec2[]; cum: number[]; len: number; rev: boolean[]; dur: number; t: number }
  | { kind: 'turn'; to: Vec2; h1: number; dur: number; t: number; from?: Vec2; h0?: number }
  | { kind: 'fork'; h1: number; dur: number; t: number; h0?: number }
  | { kind: 'hold'; dur: number; t: number; done?: () => void };

export type Place =
  | { kind: 'truck'; x: number }
  | { kind: 'slot'; slot: Slot }
  | { kind: 'staging'; spot: StagingSpot }
  | { kind: 'park'; index: number };

export interface Forklift {
  id: number; x: number; z: number; heading: number; forkH: number;
  carrying: Pallet | null; actions: ForkAction[]; place: Place; atFace: boolean;
  task: string; taskStart: number; idleSince: number; busyToday: number; busyTotal: number;
}

export interface Appointment { truckId: number; kind: TruckKind; client: number; pallets: number; planned: number; estEnd: number }
export interface RequestRecord { client: number; pallets: number; dwell: number; accepted: boolean; reason: '' | 'mjesto' | 'termin' }
export interface LogEntry { time: number; text: string; tone: 'in' | 'out' | 'warn' | 'info' }

export interface DayStats {
  trucksIn: number; trucksOut: number; palletsIn: number; palletsOut: number; handling: number;
  requests: number; rejected: number; lost: number; busy: number; overtime: number; demand: number;
}

export interface DayRecord extends DayStats {
  day: number; workday: boolean; stock: number; occupancy: number; storage: number;
  revenue: number; cost: number; cumRevenue: number; cumCost: number;
}

export interface Totals {
  revenue: number; storage: number; handling: number; cost: number;
  trucksIn: number; trucksOut: number; palletsIn: number; palletsOut: number;
  requests: number; rejected: number; rejectedSpace: number; rejectedTime: number; lost: number;
  overtime: number; siteTime: number; waitTime: number; trucksDone: number;
  busy: number; workSeconds: number; cycleTime: number; cycles: number; workdays: number;
}
