import { APRON, BAY, CHARGING, CLOSE_ZONE, DOOR, ENTRY_GATE, EXIT_GATE, HALL, LANE, OFFICE, PARCEL, PARKING, PAVED, RACK, SITE, STREET, TRUCK, type Layout } from '../simulation/layout';

export const PLAN_BOUNDS = { x0: -25, x1: 115, z0: -20, z1: 72 } as const;
export const PLAN_SCALE = 16; // px po metru

const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const TRUCK_LEN = TRUCK.cabToKingpin - TRUCK.kingpinToFront + TRUCK.trailerLength;

// Tlocrt parcele crta se na platno i postaje tekstura tla (asfalt, oznake, zone, natpisi).
export function drawPlan(ctx: CanvasRenderingContext2D, layout: Layout) {
  const S = PLAN_SCALE, B = PLAN_BOUNDS;
  const X = (x: number) => (x - B.x0) * S;
  const Y = (z: number) => (B.z1 - z) * S;
  const rect = (x0: number, z0: number, x1: number, z1: number, fill: string) => { ctx.fillStyle = fill; ctx.fillRect(X(x0), Y(z1), (x1 - x0) * S, (z1 - z0) * S); };
  const line = (pts: [number, number][], color: string, width: number, dash: number[] = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * S; ctx.setLineDash(dash.map(d => d * S)); ctx.beginPath();
    pts.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))); ctx.stroke(); ctx.setLineDash([]);
  };
  const outline = (x0: number, z0: number, x1: number, z1: number, color: string, width: number, dash: number[] = []) => line([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], color, width, dash);
  const text = (t: string, x: number, z: number, size: number, color: string, weight = 700, rotate = 0, align: CanvasTextAlign = 'center') => {
    ctx.save(); ctx.translate(X(x), Y(z)); ctx.rotate(rotate); ctx.fillStyle = color; ctx.font = `${weight} ${size * S}px ${DISPLAY}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(t, 0, 0); ctx.restore();
  };
  const arrow = (x: number, z: number, angle: number, size: number, color: string) => {
    ctx.save(); ctx.translate(X(x), Y(z)); ctx.rotate(-angle); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(size * S, 0); ctx.lineTo(-size * 0.6 * S, size * 0.55 * S); ctx.lineTo(-size * 0.25 * S, 0); ctx.lineTo(-size * 0.6 * S, -size * 0.55 * S); ctx.closePath(); ctx.fill(); ctx.restore();
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grain = (x0: number, z0: number, x1: number, z1: number, n: number, dark: string, light: string) => {
    for (let i = 0; i < n; i++) { ctx.fillStyle = rnd() > 0.5 ? dark : light; ctx.fillRect(X(x0) + rnd() * (x1 - x0) * S, Y(z1) + rnd() * (z1 - z0) * S, 2 + rnd() * 4, 2 + rnd() * 4); }
  };

  // Okolica: trava sa zrnatošću, ulica, nogostup.
  rect(B.x0, B.z0, B.x1, B.z1, '#8cab67');
  grain(B.x0, B.z0, B.x1, B.z1, 12000, 'rgba(60,90,40,.12)', 'rgba(210,230,160,.10)');
  rect(B.x0, STREET.z0, B.x1, STREET.z1, '#3d4246');
  rect(B.x0, STREET.z0 - 2.2, B.x1, STREET.z0, '#b9b6ad');
  line([[B.x0, STREET.z1 - 0.15], [B.x1, STREET.z1 - 0.15]], '#d9d6cc', 0.3);
  line([[B.x0, STREET.z0 + 0.15], [B.x1, STREET.z0 + 0.15]], '#d9d6cc', 0.3);
  line([[B.x0, (STREET.z0 + STREET.z1) / 2], [B.x1, (STREET.z0 + STREET.z1) / 2]], '#e9e4d4', 0.15, [3, 3]);
  text('ULICA', 40, STREET.far + 0.1, 1.6, 'rgba(255,255,255,.55)', 600);
  for (const x of [-15, 45, 104]) { arrow(x, STREET.lane, Math.PI, 1.2, 'rgba(255,255,255,.5)'); arrow(x + 6, STREET.far, 0, 1.2, 'rgba(255,255,255,.5)'); }

  // Parcela: zelenilo, asfalt samo gdje voze šleperi i viličar, pod hale.
  rect(PARCEL.x0, PARCEL.z0, PARCEL.x1, PARCEL.z1, '#9dbf73');
  grain(PARCEL.x0, PARCEL.z0, PARCEL.x1, PARCEL.z1, 2500, 'rgba(60,90,40,.10)', 'rgba(230,240,190,.12)');
  for (const r of PAVED) rect(r.x0, r.z0, r.x1, r.z1, '#50565b');
  rect(EXIT_GATE.x0, STREET.z1, EXIT_GATE.x1, PARCEL.z0 + 0.01, '#50565b');
  rect(ENTRY_GATE.x0, STREET.z1, ENTRY_GATE.x1, PARCEL.z0 + 0.01, '#50565b');
  for (const r of PAVED) grain(r.x0, r.z0, r.x1, r.z1, Math.round((r.x1 - r.x0) * (r.z1 - r.z0) * 1.5), 'rgba(0,0,0,.05)', 'rgba(255,255,255,.05)');
  rect(HALL.x0, HALL.z0, HALL.x1, HALL.z1, '#d6d7d1');
  outline(PARCEL.x0, PARCEL.z0, PARCEL.x1, PARCEL.z1, 'rgba(255,255,255,.65)', 0.12, [0.6, 0.4]);
  text(`ZELENILO ${Math.round(SITE.greenArea / SITE.parcelArea * 100)} %`, 45, 9, 1.3, 'rgba(40,70,30,.45)', 700);

  // Pojas za viličar ispred hale: žuto-crne kose crte.
  ctx.save(); ctx.beginPath(); ctx.rect(X(HALL.x0), Y(APRON.z1), (HALL.x1 - HALL.x0) * S, (APRON.z1 - APRON.z0) * S); ctx.clip();
  ctx.strokeStyle = 'rgba(242,183,5,.26)'; ctx.lineWidth = 0.35 * S;
  for (let x = HALL.x0 - 8; x < HALL.x1 + 8; x += 1.4) { ctx.beginPath(); ctx.moveTo(X(x), Y(APRON.z0)); ctx.lineTo(X(x + 6), Y(APRON.z1)); ctx.stroke(); }
  ctx.restore();
  line([[HALL.x0, APRON.z0], [HALL.x1, APRON.z0]], '#f2b705', 0.15);
  text('ZONA VILIČARA · PJEŠACI ZABRANJENO', 52, APRON.z0 + 0.7, 0.8, 'rgba(255,240,200,.75)', 600);

  // Vozne trake: ulaz s istoka, parking i okretište, rampa, izlaz na zapad.
  const lane = 'rgba(255,255,255,.16)';
  line([[ENTRY_GATE.x, -1], [ENTRY_GATE.x, LANE.bay]], lane, 3.4);
  line([[LANE.feeder, LANE.bay], [LANE.feeder, LANE.turn], [PARKING.stalls[0] - 2, LANE.turn]], lane, 3.2);
  line([[EXIT_GATE.x, -1], [EXIT_GATE.x, LANE.bay]], lane, 3.4);
  line([[EXIT_GATE.x, LANE.bay - 1.75], [ENTRY_GATE.x - 1.7, LANE.bay - 1.75]], 'rgba(255,255,255,.5)', 0.12, [1.2, 1]);
  arrow(ENTRY_GATE.x, 3, Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  arrow(ENTRY_GATE.x, 13, Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  arrow(LANE.feeder, 40, Math.PI / 2, 1.0, 'rgba(255,255,255,.75)');
  arrow(78, LANE.turn, Math.PI, 1.0, 'rgba(255,255,255,.75)');
  for (const x of [52, 62, 72]) arrow(x, LANE.bay, Math.PI, 0.9, 'rgba(255,255,255,.7)');
  arrow(EXIT_GATE.x, 13, -Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  arrow(EXIT_GATE.x, 3, -Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  text('ULAZ', ENTRY_GATE.x, 0.9, 1.15, '#ffffff');
  text('IZLAZ', EXIT_GATE.x, 0.9, 1.15, '#ffffff');

  // Jedna rampa uz vrata hale i zona za zatvaranje cerade prema izlazu.
  const bx0 = BAY.stopX - 0.3, bx1 = BAY.stopX + TRUCK_LEN + 0.4;
  rect(bx0, LANE.bay - 1.65, bx1, LANE.bay + 1.65, 'rgba(242,183,5,.10)');
  outline(bx0, LANE.bay - 1.65, bx1, LANE.bay + 1.65, '#f2b705', 0.18);
  line([[BAY.stopX - 0.4, LANE.bay - 1.65], [BAY.stopX - 0.4, LANE.bay + 1.65]], '#ffffff', 0.35);
  text('RAMPA · ISTOVAR I UTOVAR', (bx0 + bx1) / 2 + 1, LANE.bay - 2.45, 1.0, '#f2b705');
  const cx0 = CLOSE_ZONE.stopX - 0.3, cx1 = CLOSE_ZONE.stopX + TRUCK_LEN + 0.2;
  outline(cx0, LANE.bay - 1.6, cx1, LANE.bay + 1.6, 'rgba(255,255,255,.7)', 0.12, [0.7, 0.5]);
  text('ZATVARANJE CERADE', (cx0 + cx1) / 2 + 1.2, LANE.bay - 2.45, 0.85, 'rgba(255,255,255,.75)', 700);

  // Parking za šlepere koji čekaju svoj termin.
  const pz0 = PARKING.cabZ - 0.3, pz1 = PARKING.cabZ + TRUCK_LEN + 0.3;
  PARKING.stalls.forEach((sx, i) => {
    outline(sx - PARKING.width / 2, pz0, sx + PARKING.width / 2, pz1, '#ffffff', 0.14);
    text(`P${i + 1}`, sx, pz1 - 2.2, 1.6, 'rgba(255,255,255,.85)');
    arrow(sx, pz0 + 2.4, -Math.PI / 2, 0.7, 'rgba(255,255,255,.55)');
  });
  text('PARKING ZA ČEKANJE', (PARKING.stalls[0] + PARKING.stalls[PARKING.stalls.length - 1]) / 2, pz0 - 1.3, 0.95, 'rgba(255,255,255,.8)');

  // Hala: otisci regala, prolazi, oznake redova, međuskladište, ured, punjač.
  for (const row of layout.rows) {
    rect(row.x0, RACK.z0, row.x1, RACK.z0 + RACK.bays * RACK.bayLength, '#b9bbb5');
    text(`R${String(row.index + 1).padStart(2, '0')}`, (row.x0 + row.x1) / 2, RACK.z0 - 0.45, 0.55, '#4b5357', 700);
  }
  for (const a of layout.aisles) {
    line([[a.x0 + 0.1, RACK.z0], [a.x0 + 0.1, RACK.z0 + RACK.bays * RACK.bayLength]], '#e2b31b', 0.08);
    line([[a.x1 - 0.1, RACK.z0], [a.x1 - 0.1, RACK.z0 + RACK.bays * RACK.bayLength]], '#e2b31b', 0.08);
    text(`PROLAZ ${a.index + 1}`, a.cx, RACK.z0 + 1.6, 0.7, '#7b8286', 700, -Math.PI / 2);
  }
  line([[HALL.x0 + 0.3, LANE.corridor], [HALL.x1 - 0.3, LANE.corridor]], 'rgba(120,128,132,.5)', 0.08, [0.8, 0.6]);
  for (const x of [14, 46]) { arrow(x, LANE.corridor + 0.9, 0, 0.5, 'rgba(110,118,122,.55)'); arrow(x + 2, LANE.corridor - 0.9, Math.PI, 0.5, 'rgba(110,118,122,.55)'); }
  for (const s of layout.staging) outline(s.x - 0.42, s.z - 0.62, s.x + 0.42, s.z + 0.62, '#e2b31b', 0.05);
  text('PRIJEM / OTPREMA · POD UZ VRATA', 18, HALL.z0 + 2.6, 0.6, '#6d7478', 700);
  rect(DOOR.x - DOOR.width / 2, HALL.z0 - 0.02, DOOR.x + DOOR.width / 2, HALL.z0 + 1.8, 'rgba(242,183,5,.18)');
  for (let i = 0; i < 7; i++) rect(DOOR.x - DOOR.width / 2 + i * 0.715, HALL.z0 - 0.4, DOOR.x - DOOR.width / 2 + i * 0.715 + 0.36, HALL.z0 + 0.02, i % 2 ? '#1d2427' : '#f2b705');
  rect(CHARGING.x0 + 0.15, CHARGING.z0 + 0.3, CHARGING.x1 - 0.15, CHARGING.z1 - 0.3, '#c9d8dd');
  outline(CHARGING.x0 + 0.15, CHARGING.z0 + 0.3, CHARGING.x1 - 0.15, CHARGING.z1 - 0.3, '#3d78b8', 0.07);
  text('PUNJAČ', (CHARGING.x0 + CHARGING.x1) / 2, CHARGING.z1 - 0.8, 0.6, '#3d78b8', 700);
  rect(OFFICE.x0, OFFICE.z0, OFFICE.x1, OFFICE.z1, '#b4b6af');

  // Kote i strane svijeta.
  const dim = (x0: number, z0: number, x1: number, z1: number, label: string, vertical = false) => {
    line([[x0, z0], [x1, z1]], 'rgba(30,40,40,.55)', 0.08);
    const tick = vertical ? [[-0.5, 0], [0.5, 0]] : [[0, -0.5], [0, 0.5]];
    for (const [px, pz] of [[x0, z0], [x1, z1]]) line([[px + tick[0][0], pz + tick[0][1]], [px + tick[1][0], pz + tick[1][1]]], 'rgba(30,40,40,.55)', 0.08);
    text(label, (x0 + x1) / 2 + (vertical ? -1.1 : 0), (z0 + z1) / 2 + (vertical ? 0 : 1.0), 1.25, 'rgba(25,35,35,.75)', 700, vertical ? -Math.PI / 2 : 0);
  };
  const m2 = (v: number) => v.toLocaleString('hr-HR');
  dim(PARCEL.x0, PARCEL.z1 + 2, PARCEL.x1, PARCEL.z1 + 2, `PARCELA ${PARCEL.x1 - PARCEL.x0} m`);
  dim(PARCEL.x0 - 2, PARCEL.z0, PARCEL.x0 - 2, PARCEL.z1, `${PARCEL.z1 - PARCEL.z0} m`, true);
  dim(HALL.x0, HALL.z1 - 0.6, HALL.x1, HALL.z1 - 0.6, `HALA ${HALL.x1 - HALL.x0} × ${HALL.z1 - HALL.z0} m`);
  text(`${m2(SITE.parcelArea)} m²`, PARCEL.x1 + 6, PARCEL.z1 - 1.5, 1.6, 'rgba(25,35,35,.75)', 700);
  ctx.save(); ctx.translate(X(PARCEL.x1 + 8), Y(PARCEL.z1 + 7)); ctx.fillStyle = 'rgba(25,35,35,.7)'; ctx.beginPath(); ctx.moveTo(0, -1.8 * S); ctx.lineTo(0.8 * S, 0.9 * S); ctx.lineTo(0, 0.35 * S); ctx.lineTo(-0.8 * S, 0.9 * S); ctx.closePath(); ctx.fill(); ctx.restore();
  text('S', PARCEL.x1 + 8, PARCEL.z1 + 9.7, 1.4, 'rgba(25,35,35,.75)');
}
