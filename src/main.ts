import './styles.css';
import { exportCSV, renderEarnings, renderHud, renderOps, renderSchedule, renderSite } from './analytics';
import { createWarehouseScene, type CameraView, type WarehouseScene } from './scene/createScene';
import { DEFAULT_CONFIG, DEMAND, SPEEDS } from './simulation/config';
import { Simulation } from './simulation/engine';
import type { DemandPreset, SimulationConfig } from './simulation/types';
import { icons, mountUI } from './ui';

mountUI(document.getElementById('app')!);
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let config: SimulationConfig = { ...DEFAULT_CONFIG };
let sim = new Simulation(config);
let scene: WarehouseScene | null = null;
let playing = true, speedIndex = 2, ramp: DemandPreset = 'normal', camera: CameraView = 'overview';
let lastFrame = performance.now(), lastUI = 0, lastBoards = 0;
let toastTimer: ReturnType<typeof setTimeout>;

function toast(message: string) { el('toast').textContent = message; el('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el('toast').hidden = true), 3200); }
function updatePlayback() { el('play').innerHTML = `${playing ? icons.pause : icons.play}<span>${playing ? 'Pauziraj' : 'Pokreni'}</span>`; }

function createView() {
  scene?.dispose();
  scene = createWarehouseScene(el<HTMLCanvasElement>('scene'), sim);
  scene.focus(camera);
  scene.update(sim, 0);
  el('scene-loading').hidden = true;
}

function renderBoards() { renderEarnings(sim); renderSchedule(sim); renderOps(sim); }
function renderAll() { renderHud(sim); renderBoards(); }

function restart(next: SimulationConfig) {
  config = { ...next };
  sim = new Simulation(config);
  createView();
  renderSite(sim); renderAll();
  lastFrame = performance.now();
}

function readConfig(): SimulationConfig | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.control-panel input[type=number]'));
  for (const input of inputs) if (!input.checkValidity()) { input.reportValidity(); toast('Provjeri označenu vrijednost.'); return null; }
  const v = (id: string) => Number(el<HTMLInputElement>(id).value);
  const pmin = Math.min(v('pmin'), v('pmax')), pmax = Math.max(v('pmin'), v('pmax'));
  const dmin = Math.min(v('dmin'), v('dmax')), dmax = Math.max(v('dmin'), v('dmax'));
  return {
    ...config, seed: v('seed'), pricePerPalletDay: v('price'), peakDemand: v('peak'), palletsMin: pmin, palletsMax: Math.min(32, pmax),
    dwellMin: dmin, dwellMax: dmax, rackLevels: v('levels'), forklifts: v('forklifts'), monthlyCosts: v('costs'), handlingFee: v('handling'),
    workdaysPerWeek: v('workdays'), workStartHour: v('start'), workHours: v('hours'), lateChance: v('late') / 100, rampDays: DEMAND[ramp].days,
  };
}

function markDirty() { el<HTMLButtonElement>('apply').disabled = false; el('config-hint').textContent = 'Klikni gumb da simulacija krene ispočetka s novim postavkama.'; }

el('apply').addEventListener('click', () => {
  const next = readConfig(); if (!next) return;
  restart(next);
  el<HTMLButtonElement>('apply').disabled = true;
  el('config-hint').textContent = 'Promjene vrijede za novu simulaciju.';
  toast('Nova simulacija je krenula od prvog radnog dana.');
});
document.querySelectorAll<HTMLButtonElement>('[data-ramp]').forEach(button => button.addEventListener('click', () => {
  ramp = button.dataset.ramp as DemandPreset;
  document.querySelectorAll('[data-ramp]').forEach(b => b.classList.toggle('selected', b === button));
  const days = DEMAND[ramp].days;
  el('ramp-help').textContent = `Puna potražnja nakon ~${days} radnih dana (oko ${Math.round(days / 21)} mjeseci).`;
  markDirty();
}));
document.querySelectorAll('.control-panel input, .control-panel select').forEach(input => { if ((input as HTMLElement).id !== 'speed') input.addEventListener('input', markDirty); });
el('levels').addEventListener('input', () => { el('levels-help').textContent = `${180 * Number(el<HTMLSelectElement>('levels').value)} paletnih mjesta`; });

el('speed').addEventListener('input', () => { speedIndex = Number(el<HTMLInputElement>('speed').value); el('speed-output').textContent = SPEEDS[speedIndex].label; });
el('play').addEventListener('click', () => { playing = !playing; lastFrame = performance.now(); updatePlayback(); });
el('reset').addEventListener('click', () => { restart(config); toast('Ispočetka, s istim postavkama i istim tijekom posla.'); });
el('next-day').addEventListener('click', () => { sim.skipToNextDay(); scene?.update(sim, 999); renderAll(); toast('Preskočeno na sljedeći radni dan.'); });
el('next-month').addEventListener('click', () => {
  const target = sim.day + 30;
  let guard = 0;
  while (sim.day < target && guard++ < 60) sim.skipToNextDay();
  scene?.update(sim, 999); renderAll();
  toast(`Preskočeno mjesec dana. Popunjenost: ${Math.round(sim.stock / sim.capacity * 100)} %.`);
});
el('export').addEventListener('click', () => { if (!sim.history.length) { toast('CSV ima podatke nakon prvog odrađenog dana.'); return; } exportCSV(sim); toast('CSV s prihodom i prometom po danima je spreman.'); });
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.addEventListener('click', () => {
  camera = button.dataset.camera as CameraView;
  scene?.focus(camera);
  document.querySelectorAll('[data-camera]').forEach(b => b.classList.toggle('selected', b === button));
}));
el('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.scene-panel')!.requestFullscreen(); }
  catch { toast('Puni zaslon nije dostupan u ovom pregledniku.'); }
});
document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); });
window.addEventListener('resize', () => scene?.resize());
new ResizeObserver(() => scene?.resize()).observe(document.querySelector('.scene-panel')!);
document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); el('play').click(); } });

function frame(now: number) {
  // Skrivena kartica ne preskače dane: najviše četvrt sekunde po kadru.
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.25));
  lastFrame = now;
  let simDt = 0;
  if (playing && !document.hidden) {
    const before = sim.time;
    const speed = SPEEDS[speedIndex].value;
    sim.advance(dt * speed, speed >= 14400);
    simDt = sim.time - before;
  }
  scene?.update(sim, simDt);
  scene?.render();
  if (now - lastUI > 120) { renderHud(sim); lastUI = now; }
  if (now - lastBoards > 450) { renderBoards(); lastBoards = now; }
  requestAnimationFrame(frame);
}

try {
  createView(); renderSite(sim); renderAll(); updatePlayback();
} catch (error) {
  playing = false;
  el('scene-loading').innerHTML = '<div class="error-box">3D prikaz se nije uspio pokrenuti. Provjeri podršku za WebGL i osvježi stranicu. Brojke ispod i dalje rade.</div>';
  console.error(error);
}
requestAnimationFrame(frame);

// Samo za čitanje, za provjeru u pregledniku.
Object.defineProperty(window, 'paletLab', { value: { sim: () => sim }, writable: false });
