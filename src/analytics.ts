import { CLIENTS } from './simulation/config';
import { DAY, clockLabel, dateLabel, dateOf, durationLabel, longDate, type Simulation } from './simulation/engine';
import { DOOR, HALL, PARCEL, PARKING, RACK, SITE } from './simulation/layout';
import type { DayRecord, Truck } from './simulation/types';

const euro0 = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euro2 = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 1 });
export const eur = (v: number) => euro0.format(Math.round(v));
const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
const MONTHS_SHORT = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const PHASES = { work: 'U radu', overtime: 'Prekovremeno', closed: 'Zatvoreno' } as const;

export function renderHud(sim: Simulation) {
  const day = sim.day, stock = sim.stock, cap = sim.capacity;
  $('hud-date').textContent = dateLabel(day);
  $('hud-clock').textContent = clockLabel(sim.time);
  $('hud-workday').textContent = sim.isWorkday(day) ? `${Math.max(1, sim.workday)}. radni dan` : 'vikend';
  $('hud-stock').textContent = n0.format(stock);
  $('hud-capacity').textContent = n0.format(cap);
  const pct = Math.min(1, stock / cap);
  ($('hud-meter') as HTMLElement).style.width = `${pct * 100}%`;
  $('hud-meter').dataset.level = pct > 0.92 ? 'full' : pct > 0.6 ? 'busy' : 'ok';
  $('hud-pct').textContent = `${n0.format(pct * 100)} %${sim.stagingCount ? ` · pod ${sim.stagingCount}` : ''}`;
  $('hud-today').textContent = eur(sim.liveRevenueToday());
  $('hud-rate').textContent = `${euro2.format(sim.config.pricePerPalletDay)} × paleta`;
  const phase = sim.phase();
  const badge = $('phase-badge');
  badge.dataset.phase = phase;
  badge.querySelector('span')!.textContent = PHASES[phase];
  const busy = sim.forklifts.map((f, i) => `${sim.forklifts.length > 1 ? `Viličar ${i + 1}` : 'Viličar'}: ${f.task}`);
  const parked = sim.stalls.filter(Boolean).length;
  if (parked) busy.push(`parking ${parked}/${PARKING.stalls.length}`);
  $('activity').textContent = busy.join(' · ');
}

function monthKey(day: number) { const d = dateOf(day); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }

export function renderEarnings(sim: Simulation) {
  const h = sim.history, t = sim.totals, cfg = sim.config;
  const today = sim.liveRevenueToday();
  $('k-today').textContent = eur(today);
  $('k-today-sub').textContent = `${n0.format(sim.stock)} paleta × ${euro2.format(cfg.pricePerPalletDay)} + manipulacija ${eur(sim.today.handling)}`;
  const mk = monthKey(sim.day);
  const monthDays = h.filter(d => monthKey(d.day) === mk);
  const month = monthDays.reduce((a, d) => a + d.revenue, 0) + today;
  const m = dateOf(sim.day);
  $('k-month-label').textContent = `${MONTHS[m.getUTCMonth()][0].toUpperCase()}${MONTHS[m.getUTCMonth()].slice(1)} ${m.getUTCFullYear()}.`;
  $('k-month').textContent = eur(month);
  $('k-month-sub').textContent = `${monthDays.length + 1}. dan u mjesecu`;
  $('k-total').textContent = eur(t.revenue + today);
  $('k-total-sub').textContent = `${h.length + 1} dana od ${longDate(0)}`;
  const net = t.revenue - t.cost;
  $('k-net').textContent = eur(net);
  $('k-net').dataset.sign = net >= 0 ? 'plus' : 'minus';
  $('k-net-sub').textContent = `troškovi ${eur(t.cost)} (${eur(cfg.monthlyCosts)}/mj)`;
  $('price-chip').textContent = `${euro2.format(cfg.pricePerPalletDay)} / paleta / dan`;
  const last = h.slice(-30);
  if (last.length >= 7) {
    const avg = last.reduce((a, d) => a + d.revenue, 0) / last.length;
    const occ = last.reduce((a, d) => a + d.occupancy, 0) / last.length;
    const handling = last.reduce((a, d) => a + d.handling, 0) / last.length;
    const perMonth = avg * 30.4, monthlyNet = perMonth - cfg.monthlyCosts;
    $('projection').innerHTML = `Zadnjih ${last.length} dana: prosječno <b>${eur(avg)}</b> dnevno uz ${n0.format(occ * 100)} % popunjenosti, što je oko <b>${eur(perMonth)}</b> mjesečno i <b>${eur(perMonth * 12)}</b> godišnje. Od toga je manipulacija ${eur(handling * 30.4)} mjesečno. Nakon troškova ostaje <b class="${monthlyNet >= 0 ? 'plus' : 'minus'}">${eur(monthlyNet)}</b> mjesečno. Samo skladištenje punog skladišta donosilo bi ${eur(sim.capacity * cfg.pricePerPalletDay)} dnevno.`;
  } else $('projection').textContent = 'Projekcija se računa nakon prvog tjedna rada.';
  drawDaily(sim);
  drawCumulative(sim);
}

type Pt = [number, number];
const pathOf = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

function axisDays(h: DayRecord[], x: (i: number) => number, height: number) {
  if (!h.length) return '';
  const out: string[] = [];
  let lastLabel = -1e9;
  h.forEach((d, i) => {
    const date = dateOf(d.day);
    if (date.getUTCDate() !== 1 && i !== 0) return;
    const px = x(i);
    if (px - lastLabel < 34) return;
    lastLabel = px;
    out.push(`<line class="tick" x1="${px}" x2="${px}" y1="${height - 22}" y2="${height - 18}"/><text x="${px}" y="${height - 6}" text-anchor="middle">${MONTHS_SHORT[date.getUTCMonth()]}</text>`);
  });
  return out.join('');
}

// SVG se crta u stvarnoj širini spremnika da tekst ostane čitljiv i na mobitelu.
const widthOf = (id: string) => Math.max(260, Math.round($(id).clientWidth || 560));

function drawDaily(sim: Simulation) {
  const h = sim.history, w = widthOf('chart-daily'), height = w < 420 ? 150 : 170, left = 46, right = 10, top = 10, bottom = 24;
  const cap = sim.capacity * sim.config.pricePerPalletDay;
  const costDay = sim.config.monthlyCosts * 12 / 365;
  const maxRev = Math.max(cap, costDay, ...h.map(d => d.revenue)) * 1.08;
  const n = Math.max(h.length, 30);
  const x = (i: number) => left + (i / Math.max(1, n - 1)) * (w - left - right);
  const y = (v: number) => height - bottom - (v / maxRev) * (height - top - bottom);
  const grid = [0, 0.5, 1].map(f => { const v = maxRev / 1.08 * f; return `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${n0.format(v)} €</text>`; }).join('');
  let body = '';
  if (h.length) {
    const pts: Pt[] = h.map((d, i) => [x(i), y(d.revenue)]);
    body = `<path class="area" d="${pathOf(pts)}L${x(h.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="rev" d="${pathOf(pts)}"/><circle class="end" cx="${x(h.length - 1)}" cy="${y(h[h.length - 1].revenue)}" r="3.2"/>`;
  }
  $('chart-daily').innerHTML = `<svg viewBox="0 0 ${w} ${height}" role="img" aria-label="Prihod po danu">${grid}<line class="cap" x1="${left}" x2="${w - right}" y1="${y(cap)}" y2="${y(cap)}"/><line class="cost" x1="${left}" x2="${w - right}" y1="${y(costDay)}" y2="${y(costDay)}"/>${body}${axisDays(h, x, height)}</svg>`;
}

function drawCumulative(sim: Simulation) {
  const h = sim.history, w = widthOf('chart-cum'), height = w < 420 ? 150 : 170, left = 56, right = 10, top = 10, bottom = 24;
  const maxV = Math.max(1000, ...h.map(d => Math.max(d.cumRevenue, d.cumCost))) * 1.08;
  const n = Math.max(h.length, 30);
  const x = (i: number) => left + (i / Math.max(1, n - 1)) * (w - left - right);
  const y = (v: number) => height - bottom - (v / maxV) * (height - top - bottom);
  const grid = [0, 0.5, 1].map(f => { const v = maxV / 1.08 * f; return `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 10000 ? `${n0.format(v / 1000)} tis.` : n0.format(v)}</text>`; }).join('');
  let body = '';
  if (h.length) {
    const rev: Pt[] = h.map((d, i) => [x(i), y(d.cumRevenue)]), cost: Pt[] = h.map((d, i) => [x(i), y(d.cumCost)]);
    body = `<path class="cost-line" d="${pathOf(cost)}"/><path class="rev" d="${pathOf(rev)}"/>`;
    const cross = h.findIndex((d, i) => i > 0 && d.cumRevenue - d.cumCost >= 0 && h[i - 1].cumRevenue - h[i - 1].cumCost < 0);
    if (cross > 0) body += `<line class="marker" x1="${x(cross)}" x2="${x(cross)}" y1="${top}" y2="${height - bottom}"/><text class="marker-label" x="${x(cross) + 5}" y="${top + 10}">troškovi pokriveni ${dateLabel(h[cross].day, false)}</text>`;
    const lastD = h[h.length - 1];
    body += `<circle class="end" cx="${x(h.length - 1)}" cy="${y(lastD.cumRevenue)}" r="3.2"/>`;
  }
  $('chart-cum').innerHTML = `<svg viewBox="0 0 ${w} ${height}" role="img" aria-label="Kumulativni prihod i troškovi">${grid}${body}${axisDays(h, x, height)}</svg>`;
}

function truckStatus(sim: Simulation, t: Truck | undefined, planned: number): { text: string; tone: string } {
  if (!t) return { text: 'Otišao', tone: 'done' };
  const stall = `P${t.stall + 1}`;
  const turned = t.kind === 'in' && !t.serviceAt;
  switch (t.state) {
    case 'scheduled': return sim.time > planned + 15 * 60 ? { text: 'Kasni', tone: 'warn' } : { text: 'Najavljen', tone: 'idle' };
    case 'street': return { text: 'Stiže na parcelu', tone: 'move' };
    case 'toStall': return { text: `Vozi na parking ${stall}`, tone: 'move' };
    case 'parked': return planned - sim.time > 15 * 60
      ? { text: `Parking ${stall} · poranio, termin ${clockLabel(planned)}`, tone: 'idle' }
      : { text: `Parking ${stall} · čeka rampu ${durationLabel(sim.time - t.arrivedAt)}`, tone: sim.time > planned + 15 * 60 ? 'warn' : 'idle' };
    case 'toBay': return { text: t.servedEarly ? 'Na rampu, ubačen ranije' : 'Vozi na rampu', tone: 'move' };
    case 'prep': return { text: 'Rampa · otvara ceradu', tone: 'move' };
    case 'service': return t.kind === 'in'
      ? { text: `Rampa · istovar ${t.pallets - t.trailer.filter(Boolean).length}/${t.pallets}`, tone: 'in' }
      : { text: `Rampa · utovar ${t.loaded}/${t.pallets}`, tone: 'out' };
    case 'closing': return t.atZone ? { text: 'Zatvara ceradu', tone: 'move' } : { text: t.papers < 2 ? 'Rampa · papiri, CMR' : 'Rampa · izlazi', tone: 'move' };
    case 'toClose': return { text: 'Zatvara ceradu', tone: 'move' };
    case 'leaving': return turned ? { text: 'Vraćen, nema mjesta', tone: 'warn' } : { text: 'Odlazi', tone: 'move' };
    case 'gone': return turned ? { text: 'Vraćen, nema mjesta', tone: 'warn' } : { text: `Gotovo ${clockLabel(t.leftAt)}${t.servedEarly ? ' · ranije' : ''}`, tone: 'done' };
    case 'noshow': return { text: 'Nije došao', tone: 'warn' };
  }
}

export function renderSchedule(sim: Simulation) {
  const apps = [...sim.appointments].sort((a, b) => a.planned - b.planned);
  const byId = new Map(sim.trucks.map(t => [t.id, t]));
  const req = sim.requests, rej = req.filter(r => !r.accepted);
  const dayLabel = sim.plannedDay >= 0 ? dateLabel(sim.plannedDay) : '—';
  $('sched-summary').textContent = apps.length
    ? `${dayLabel} · ${apps.length} termina${rej.length ? ` · odbijeno ${rej.length} (${rej.filter(r => r.reason === 'mjesto').length ? 'nema mjesta' : 'nema termina'})` : ''}`
    : `${dayLabel} · nema najavljenih šlepera`;
  // Gantt: dogovoreni termin (obrub), čekanje na parkingu (svijetla traka) i rampa do odlaska (puna traka).
  const day = sim.plannedDay;
  const t0 = day * DAY + (sim.config.workStartHour - 0.5) * 3600;
  let t1 = sim.workEnd(Math.max(0, day)) + 1800;
  for (const a of apps) { t1 = Math.max(t1, a.estEnd + 900); const tr = byId.get(a.truckId); if (tr?.leftAt) t1 = Math.max(t1, tr.leftAt + 600); }
  const w = widthOf('gantt'), rowH = 17, left = 82, right = 8, top = 18;
  const height = top + Math.max(1, apps.length) * rowH + 8;
  const x = (t: number) => left + (Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0) * (w - left - right);
  const hours: string[] = [];
  for (let hh = Math.ceil(t0 / 3600); hh * 3600 <= t1; hh++) hours.push(`<line class="grid" x1="${x(hh * 3600)}" x2="${x(hh * 3600)}" y1="${top - 4}" y2="${height - 6}"/><text x="${x(hh * 3600)}" y="${top - 7}" text-anchor="middle">${String(hh % 24).padStart(2, '0')}</text>`);
  const rows = apps.map((a, i) => {
    const tr = byId.get(a.truckId), yy = top + i * rowH;
    const bar = (cls: string, from: number, to: number) => `<rect class="bar ${cls}" x="${x(from)}" y="${yy + 3}" width="${Math.max(1.5, x(to) - x(from))}" height="${rowH - 6}" rx="2"/>`;
    let actual = '';
    if (tr && tr.arrivedAt && tr.state !== 'scheduled' && tr.state !== 'noshow') {
      actual += bar('wait', tr.arrivedAt, tr.calledAt || sim.time);
      if (tr.calledAt) actual += bar(a.kind, tr.calledAt, tr.state === 'gone' ? tr.leftAt : sim.time);
    }
    return `<text class="row-label" x="4" y="${yy + rowH / 2 + 3}">${clockLabel(a.planned)} #${a.truckId}</text><rect class="slot ${a.kind}" x="${x(a.planned)}" y="${yy + 1.5}" width="${Math.max(2, x(a.estEnd) - x(a.planned))}" height="${rowH - 3}" rx="3"/>${actual}`;
  }).join('');
  const now = sim.day === day && sim.time >= t0 && sim.time <= t1 ? `<line class="now" x1="${x(sim.time)}" x2="${x(sim.time)}" y1="${top - 4}" y2="${height - 4}"/>` : '';
  $('gantt').innerHTML = apps.length ? `<svg viewBox="0 0 ${w} ${height}" role="img" aria-label="Raspored termina danas">${hours.join('')}${rows}${now}</svg>` : '<p class="empty">Danas nema dogovorenih dovoza ni odvoza. Na početku posla to je normalno.</p>';
  $('appointments').innerHTML = apps.map(a => {
    const tr = byId.get(a.truckId), st = truckStatus(sim, tr, a.planned), c = CLIENTS[a.client];
    return `<tr><td class="mono">${clockLabel(a.planned)}</td><td><span class="kind ${a.kind}">${a.kind === 'in' ? 'Istovar' : 'Utovar'}</span> #${a.truckId}</td><td><span class="swatch" style="--c:${c.color}"></span>${c.code}<span class="client-name"> · ${esc(c.name)}</span></td><td class="num">${a.pallets}</td><td><span class="state ${st.tone}">${esc(st.text)}</span></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">Nema termina.</td></tr>';
  $('log').innerHTML = sim.log.slice(-8).reverse().map(l => `<li class="${l.tone}"><span class="mono">${dateLabel(Math.floor(l.time / DAY), false).slice(0, -6)} ${clockLabel(l.time)}</span>${esc(l.text)}</li>`).join('');
}

export function renderOps(sim: Simulation) {
  const t = sim.totals, today = sim.today;
  const min = (s: number) => `${n0.format(s / 60)} min`;
  const hours = (s: number) => `${n1.format(s / 3600)} h`;
  // Prosjek zadnjih 60 radnih dana, da početak posla ne povlači brojku dolje.
  const recent = sim.history.filter(d => d.workday).slice(-60);
  const avgBusy = recent.length ? recent.reduce((a, d) => a + d.busy, 0) / recent.length : 0;
  const avgBreaks = recent.length ? recent.reduce((a, d) => a + d.breaks, 0) / recent.length : 0;
  const rows: [string, string][] = [
    ['Šleperi ukupno', `${n0.format(t.trucksIn)} istovara · ${n0.format(t.trucksOut)} utovara`],
    ['Palete ukupno', `${n0.format(t.palletsIn)} ulaz · ${n0.format(t.palletsOut)} izlaz`],
    ['Viličar radi danas', `${hours(today.busy)} od ${sim.config.workHours} h`],
    ['Viličar radi, prosjek', recent.length ? `${hours(avgBusy)} dnevno (zadnjih ${recent.length} radnih dana)` : '—'],
    ['Pauze i gablec, prosjek', recent.length ? `${min(avgBreaks)} dnevno` : '—'],
    ['Ciklus viličara po paleti', t.cycles ? `${n0.format(t.cycleTime / t.cycles)} s` : '—'],
    ['Šleper na parceli, prosjek', t.trucksDone ? min(t.siteTime / t.trucksDone) : '—'],
    ['Čekanje na parkingu, prosjek', sim.entered ? min(t.waitTime / sim.entered) : '—'],
    ['Poranili / kasnili / nisu došli', `${n0.format(t.early)} / ${n0.format(t.late)} / ${n0.format(t.noShows)}`],
    ['Ubačeni ranije na slobodnu rampu', n0.format(t.servedEarly)],
    ['Prekovremeno ukupno', `${n1.format((t.overtime + today.overtime) / 3600)} h`],
    ['Zahtjevi za skladištenje', `${n0.format(t.requests)} · odbijeno ${n0.format(t.rejected)}`],
    ['Odbijeno zbog mjesta / termina', `${n0.format(t.rejectedSpace)} / ${n0.format(t.rejectedTime)}`],
    ['Izgubljeni prihod, procjena', eur(t.lost)],
    ['Potražnja danas', `${n1.format(today.demand || sim.demandAt(sim.workday))} upita za dovoz (prosjek)`],
  ];
  $('ops-body').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
}

export function renderSite(sim: Simulation) {
  const l = sim.layout, levels = l.levels;
  const green = SITE.greenArea;
  $('site-chip').textContent = `${n0.format(SITE.parcelArea)} m² parcela · ${n0.format(SITE.hallArea)} m² hala · ${n0.format(l.capacity)} mjesta`;
  $('levels-help').textContent = `${n0.format(l.capacity)} paletnih mjesta`;
  $('site-facts').innerHTML = `
    <dl>
      <div><dt>Parcela</dt><dd>${PARCEL.x1 - PARCEL.x0} × ${PARCEL.z1 - PARCEL.z0} m = ${n0.format(SITE.parcelArea)} m²</dd></div>
      <div><dt>Hala</dt><dd>${HALL.x1 - HALL.x0} × ${HALL.z1 - HALL.z0} m = ${n0.format(SITE.hallArea)} m², svijetla visina ~${n1.format(l.hallHeight)} m</dd></div>
      <div><dt>Regali</dt><dd>${l.rows.length} redova × ${RACK.bays} polja × ${RACK.perBay} palete × ${levels} razine = <b>${n0.format(l.capacity)} mjesta</b></dd></div>
      <div><dt>Prolazi</dt><dd>${l.aisles.length} × ${n1.format(RACK.aisle)} m za protuteži viličar, svi izlaze u hodnik uz vrata</dd></div>
      <div><dt>Rampa</dt><dd>jedna, za bočni istovar kroz vrata od ${DOOR.width} m: istovaruje se ili utovaruje uvijek samo jedan šleper</dd></div>
      <div><dt>Parking</dt><dd>${PARKING.stalls.length} mjesta za šlepere koji čekaju termin, uz istočni zid hale; vozač tu otvori ceradu dok čeka</dd></div>
      <div><dt>Promet</dt><dd>ulaz s istoka, izlaz na zapad, zona za zatvaranje cerade prema izlazu da rampa odmah bude slobodna</dd></div>
      <div><dt>Prijem i otprema</dt><dd>${l.staging.length} podnih mjesta uz vrata za brzi istovar i robu pripremljenu za odvoz</dd></div>
      <div><dt>Ostalo</dt><dd>ured s WC-om, punjač viličara, asfalt ${n0.format(SITE.pavedArea)} m², zelenilo ${n0.format(green)} m² (${n0.format(green / SITE.parcelArea * 100)} %)</dd></div>
    </dl>
    <p class="note"><b>Treba veća parcela.</b> Za oko 1.500 mjesta treba hala od ~1.600 m². Uz rampu, parking za ${PARKING.stalls.length} šlepera, okretište i najmanje 20 % zelenila iz GUP-a to je parcela od oko ${n0.format(SITE.parcelArea)} m². Tri parcele od ukupno ~3.000 m² nisu dovoljne.</p>`;
}

export function exportCSV(sim: Simulation) {
  const headers = ['dan', 'datum', 'radni_dan', 'palete_na_skladistu', 'popunjenost_%', 'prihod_skladistenje_eur', 'prihod_manipulacija_eur', 'prihod_eur', 'trosak_eur', 'kumulativ_prihod_eur', 'kumulativ_trosak_eur', 'sleperi_istovar', 'sleperi_utovar', 'palete_ulaz', 'palete_izlaz', 'zahtjevi', 'odbijeno', 'izgubljeno_eur', 'vilicar_rad_h', 'pauze_min', 'prekovremeno_h', 'poranili', 'kasnili', 'nisu_dosli', 'ubaceni_ranije', 'cekanje_parking_min', 'potraznja'];
  const rows = sim.history.map(d => [d.day + 1, dateLabel(d.day, false), d.workday ? 'da' : 'ne', d.stock, (d.occupancy * 100).toFixed(1), d.storage.toFixed(2), d.handling.toFixed(2), d.revenue.toFixed(2), d.cost.toFixed(2), d.cumRevenue.toFixed(2), d.cumCost.toFixed(2), d.trucksIn, d.trucksOut, d.palletsIn, d.palletsOut, d.requests, d.rejected, d.lost.toFixed(2), (d.busy / 3600).toFixed(2), (d.breaks / 60).toFixed(0), (d.overtime / 3600).toFixed(2), d.early, d.late, d.noShows, d.servedEarly, (d.parkingWait / 60).toFixed(0), d.demand.toFixed(2)]);
  const csv = '﻿' + [headers, ...rows].map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = `skladiste-zelenjak-seed-${sim.config.seed}-dan-${sim.history.length}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
