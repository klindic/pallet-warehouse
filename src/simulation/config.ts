import type { DemandPreset, SimulationConfig } from './types';

// Mjesečni troškovi bez rate kredita: plaća je samo za skladištara (1.600 € neto u Sisku, stopa poreza 21,6 %).
export const COSTS = { wage: 2730, leasing: 700, other: 900 } as const;

export const DEFAULT_CONFIG: SimulationConfig = {
  seed: 2027, rackLevels: 4, forklifts: 1,
  pricePerPalletDay: 0.5, handlingFee: 0, monthlyCosts: COSTS.wage + COSTS.leasing + COSTS.other,
  rampDays: 120, startDemand: 0.5, peakDemand: 4.2,
  palletsMin: 16, palletsMax: 32, dwellMin: 2, dwellMax: 20,
  workStartHour: 7, workHours: 8, workdaysPerWeek: 5, lateChance: 0.12,
};

export const DEMAND: Record<DemandPreset, { label: string; days: number }> = {
  slow: { label: 'Spor', days: 200 },
  normal: { label: 'Normalan', days: 120 },
  fast: { label: 'Brz', days: 60 },
};

// Izmišljeni klijenti po vrsti robe; boja je boja robe na paleti u 3D prikazu.
export const CLIENTS = [
  { code: 'A', name: 'Agro', color: '#6c9a3c' },
  { code: 'B', name: 'Građevinski materijal', color: '#b0703c' },
  { code: 'C', name: 'Pića', color: '#c4483a' },
  { code: 'D', name: 'Namještaj', color: '#8d7a5c' },
  { code: 'E', name: 'Elektronika', color: '#3d78b8' },
  { code: 'F', name: 'Tekstil', color: '#8c5fa8' },
  { code: 'G', name: 'Auto dijelovi', color: '#56636e' },
  { code: 'H', name: 'Ambalaža', color: '#d2a23a' },
] as const;
export const CLIENT_WEIGHTS = [0.19, 0.16, 0.14, 0.1, 0.11, 0.09, 0.11, 0.1] as const;

// Vremena su procjene za protuteži viličar i bočni istovar šlepera s ceradom.
export const TIMING = {
  prep: 240,          // otvaranje cerade, papiri
  close: 180,         // zatvaranje cerade, CMR i potpis
  pick: 7, place: 7,  // fino pozicioniranje vilica
  turn: 3.5, corner: 0.8,
  speedEmpty: 2.6, speedLoaded: 2.0, lift: 0.45,
  truckYard: 3.2, truckStreet: 9, truckAccel: 0.9,
  entryEstimate: 75,
} as const;

// Brzina = sekunde simulacije po sekundi stvarnog vremena; noći i vikendi se preskaču.
export const SPEEDS = [
  { value: 60, label: '1 min/s' },
  { value: 300, label: '5 min/s' },
  { value: 900, label: '15 min/s' },
  { value: 3600, label: '1 h/s' },
  { value: 14400, label: '4 h/s' },
  { value: 57600, label: '2 dana/s' },
  { value: 144000, label: '1 tjedan/s' },
] as const;
