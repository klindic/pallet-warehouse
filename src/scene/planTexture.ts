import { APRON, BAYS, CHARGING, DOORS, ENTRY_GATE, EXIT_GATE, HALL, LANE, OFFICE, PARCEL, RACK, STREET, TRUCK, type Layout } from '../simulation/layout';

export const PLAN_BOUNDS = { x0: -30, x1: 80, z0: -22, z1: 58 } as const;
export const PLAN_SCALE = 20; // px po metru

const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';

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

  // Okolica: trava sa zrnatošću, ulica, nogostup.
  rect(B.x0, B.z0, B.x1, B.z1, '#8cab67');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) { ctx.fillStyle = rnd() > 0.5 ? 'rgba(60,90,40,.12)' : 'rgba(210,230,160,.10)'; ctx.fillRect(rnd() * ctx.canvas.width, rnd() * ctx.canvas.height, 3 + rnd() * 5, 3 + rnd() * 5); }
  rect(B.x0, STREET.z0, B.x1, STREET.z1, '#3d4246');
  rect(B.x0, STREET.z0 - 2.2, B.x1, STREET.z0, '#b9b6ad');
  line([[B.x0, STREET.z1 - 0.15], [B.x1, STREET.z1 - 0.15]], '#d9d6cc', 0.3);
  line([[B.x0, STREET.z0 + 0.15], [B.x1, STREET.z0 + 0.15]], '#d9d6cc', 0.3);
  line([[B.x0, (STREET.z0 + STREET.z1) / 2], [B.x1, (STREET.z0 + STREET.z1) / 2]], '#e9e4d4', 0.15, [3, 3]);
  text('ULICA', -18, STREET.lane - 0.2, 1.6, 'rgba(255,255,255,.55)', 600);
  arrow(-24, STREET.lane, Math.PI, 1.2, 'rgba(255,255,255,.5)'); arrow(-24, STREET.far, 0, 1.2, 'rgba(255,255,255,.5)');

  // Parcela: dvorište od asfalta, zelenilo uz rubove, pod hale.
  rect(PARCEL.x0, PARCEL.z0, PARCEL.x1, HALL.z0, '#50565b');
  rect(EXIT_GATE.x0, STREET.z1, EXIT_GATE.x1, PARCEL.z0 + 0.01, '#50565b');
  rect(PARCEL.x0, HALL.z0, HALL.x0, PARCEL.z1, '#9dbf73');
  rect(HALL.x1, HALL.z0, PARCEL.x1, PARCEL.z1, '#9dbf73');
  rect(HALL.x0, HALL.z1, HALL.x1, PARCEL.z1, '#9dbf73');
  rect(HALL.x0, HALL.z0, HALL.x1, HALL.z1, '#d6d7d1');
  for (let i = 0; i < 2500; i++) { ctx.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.06)'; ctx.fillRect(X(PARCEL.x0) + rnd() * 50 * S, Y(HALL.z0) + rnd() * 18 * S, 2 + rnd() * 4, 2 + rnd() * 4); }
  outline(PARCEL.x0, PARCEL.z0, PARCEL.x1, PARCEL.z1, 'rgba(255,255,255,.65)', 0.12, [0.6, 0.4]);

  // Pojas za viličar: žuto-crne kose crte.
  ctx.save(); ctx.beginPath(); ctx.rect(X(HALL.x0), Y(APRON.z1), (HALL.x1 - HALL.x0) * S, (APRON.z1 - APRON.z0) * S); ctx.clip();
  ctx.strokeStyle = 'rgba(242,183,5,.28)'; ctx.lineWidth = 0.35 * S;
  for (let x = HALL.x0 - 8; x < HALL.x1 + 8; x += 1.4) { ctx.beginPath(); ctx.moveTo(X(x), Y(APRON.z0)); ctx.lineTo(X(x + 6), Y(APRON.z1)); ctx.stroke(); }
  ctx.restore();
  line([[HALL.x0, APRON.z0], [HALL.x1, APRON.z0]], '#f2b705', 0.15);
  text('ZONA VILIČARA · PJEŠACI ZABRANJENO', 26.5, APRON.z0 + 0.65, 0.75, 'rgba(255,240,200,.75)', 600);

  // Trake: rampe (sjeverno), obilazni trak (južno), strelice smjera prema zapadu.
  line([[ENTRY_GATE.x, -1], [ENTRY_GATE.x, LANE.bay]], 'rgba(255,255,255,.18)', 3.4);
  line([[EXIT_GATE.x, -1], [EXIT_GATE.x, LANE.bay]], 'rgba(255,255,255,.18)', 3.4);
  line([[EXIT_GATE.x, LANE.bay - 1.7], [ENTRY_GATE.x, LANE.bay - 1.7]], 'rgba(255,255,255,.55)', 0.12, [1.2, 1]);
  for (const x of [12, 22, 32, 41]) arrow(x, LANE.bypass, Math.PI, 0.9, 'rgba(255,255,255,.75)');
  arrow(ENTRY_GATE.x, 2.5, Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  arrow(EXIT_GATE.x, 2.5, -Math.PI / 2, 1.0, 'rgba(255,255,255,.8)');
  text('ULAZ', ENTRY_GATE.x, 0.9, 1.15, '#ffffff');
  text('IZLAZ', EXIT_GATE.x, 0.9, 1.15, '#ffffff');
  text('OBILAZNI TRAK', 32, LANE.bypass - 1.6, 0.8, 'rgba(255,255,255,.6)', 600);
  BAYS.forEach((b, i) => {
    const x0 = b.stopX - 0.3, x1 = b.stopX + TRUCK.cabToKingpin - TRUCK.kingpinToFront + TRUCK.trailerLength + 0.4;
    outline(x0, LANE.bay - 1.65, x1, LANE.bay + 1.65, '#f2b705', 0.16);
    line([[b.stopX - 0.4, LANE.bay - 1.65], [b.stopX - 0.4, LANE.bay + 1.65]], '#ffffff', 0.35);
    text(`RAMPA ${i + 1}`, (x0 + x1) / 2 + 1.5, LANE.bay - 2.35, 1.0, '#f2b705');
  });
  // Ograda s vratima nacrtana kao rub; 3D ograda dolazi iz scene.

  // Hala: otisci regala, prolazi, oznake redova, međuskladište, ured, punjač.
  for (const row of layout.rows) {
    rect(row.x0, RACK.z0, row.x1, RACK.z0 + RACK.bays * RACK.bayLength, '#b9bbb5');
    text(`R${String(row.index + 1).padStart(2, '0')}`, (row.x0 + row.x1) / 2, RACK.z0 - 0.45, 0.62, '#4b5357', 700);
  }
  for (const a of layout.aisles) {
    line([[a.x0 + 0.1, RACK.z0], [a.x0 + 0.1, RACK.z0 + RACK.bays * RACK.bayLength]], '#e2b31b', 0.08);
    line([[a.x1 - 0.1, RACK.z0], [a.x1 - 0.1, RACK.z0 + RACK.bays * RACK.bayLength]], '#e2b31b', 0.08);
    text(`PROLAZ ${a.index + 1}`, a.cx, RACK.z0 + 1.4, 0.7, '#7b8286', 700, -Math.PI / 2);
  }
  line([[HALL.x0 + 0.3, LANE.corridor], [HALL.x1 - 0.3, LANE.corridor]], 'rgba(120,128,132,.5)', 0.08, [0.8, 0.6]);
  for (const x of [11, 27, 31]) { arrow(x, LANE.corridor + 0.9, 0, 0.5, 'rgba(110,118,122,.55)'); arrow(x + 2, LANE.corridor - 0.9, Math.PI, 0.5, 'rgba(110,118,122,.55)'); }
  for (const s of layout.staging) outline(s.x - 0.42, s.z - 0.62, s.x + 0.42, s.z + 0.62, '#e2b31b', 0.05);
  text('PRIJEM / OTPREMA · MEĐUSKLADIŠTE', 10.5, 20.4, 0.62, '#6d7478', 700);
  for (const d of DOORS) {
    rect(d.x - d.width / 2, HALL.z0 - 0.02, d.x + d.width / 2, HALL.z0 + 1.8, 'rgba(242,183,5,.18)');
    for (let i = 0; i < 6; i++) rect(d.x - d.width / 2 + i * 0.75, HALL.z0 - 0.4, d.x - d.width / 2 + i * 0.75 + 0.375, HALL.z0 + 0.02, i % 2 ? '#1d2427' : '#f2b705');
  }
  rect(CHARGING.x0 + 0.15, CHARGING.z0 + 0.3, CHARGING.x1 - 0.15, CHARGING.z1 - 0.3, '#c9d8dd');
  outline(CHARGING.x0 + 0.15, CHARGING.z0 + 0.3, CHARGING.x1 - 0.15, CHARGING.z1 - 0.3, '#3d78b8', 0.07);
  text('PUNJAČ', (CHARGING.x0 + CHARGING.x1) / 2, CHARGING.z1 - 0.8, 0.6, '#3d78b8', 700);
  rect(OFFICE.x0, OFFICE.z0, OFFICE.x1, OFFICE.z1, '#b4b6af');

  // Kote i strane svijeta.
  const dim = (x0: number, z0: number, x1: number, z1: number, label: string, vertical = false) => {
    line([[x0, z0], [x1, z1]], 'rgba(30,40,40,.55)', 0.07);
    const tick = vertical ? [[-0.4, 0], [0.4, 0]] : [[0, -0.4], [0, 0.4]];
    for (const [px, pz] of [[x0, z0], [x1, z1]]) line([[px + tick[0][0], pz + tick[0][1]], [px + tick[1][0], pz + tick[1][1]]], 'rgba(30,40,40,.55)', 0.07);
    text(label, (x0 + x1) / 2 + (vertical ? -0.9 : 0), (z0 + z1) / 2 + (vertical ? 0 : 0.8), 1.0, 'rgba(25,35,35,.75)', 700, vertical ? -Math.PI / 2 : 0);
  };
  dim(PARCEL.x0, PARCEL.z1 + 1.6, PARCEL.x1, PARCEL.z1 + 1.6, 'PARCELA 50 m');
  dim(PARCEL.x0 - 1.6, PARCEL.z0, PARCEL.x0 - 1.6, PARCEL.z1, '40 m', true);
  dim(HALL.x0, HALL.z1 - 0.9, HALL.x1, HALL.z1 - 0.9, 'HALA 40 × 20 m');
  text('2.000 m²', PARCEL.x1 + 4.5, PARCEL.z1 - 1.2, 1.3, 'rgba(25,35,35,.75)', 700);
  ctx.save(); ctx.translate(X(PARCEL.x1 + 6), Y(PARCEL.z1 + 6)); ctx.fillStyle = 'rgba(25,35,35,.7)'; ctx.beginPath(); ctx.moveTo(0, -1.6 * S); ctx.lineTo(0.7 * S, 0.8 * S); ctx.lineTo(0, 0.3 * S); ctx.lineTo(-0.7 * S, 0.8 * S); ctx.closePath(); ctx.fill(); ctx.restore();
  text('S', PARCEL.x1 + 6, PARCEL.z1 + 8.4, 1.2, 'rgba(25,35,35,.75)');
}
