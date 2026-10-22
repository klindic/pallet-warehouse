import { CLIENTS, COSTS, DEFAULT_CONFIG, SPEEDS } from './simulation/config';
import { PARKING, SITE, buildLayout } from './simulation/layout';

export const icons = {
  play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3.4"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m5 5 9 7-9 7ZM18 5v14" /></svg>',
  month: '<svg viewBox="0 0 24 24"><path d="m3 5 8 7-8 7Zm9 0 8 7-8 7Z" /></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>',
  export: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>',
};

const mark = `<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="6" width="13" height="11" rx="1.5"/><rect x="22" y="6" width="13" height="11" rx="1.5" class="alt"/><rect x="5" y="20" width="30" height="9" rx="1.5"/><path d="M5 31h30M8 31v4M20 31v4M32 31v4" class="base"/></svg>`;

const num = (id: string, value: number, min: number, max: number, step: number) =>
  `<input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}" required/>`;

export const DEFAULT_SPEED = 2;
const price = (v: number) => `${v.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const n0 = (v: number) => v.toLocaleString('hr-HR', { maximumFractionDigits: 0 });

export function mountUI(root: HTMLElement) {
  const d = DEFAULT_CONFIG;
  const places = buildLayout(d.rackLevels).capacity;
  root.innerHTML = `
  <header class="app-header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="PaletLab početna">${mark}<span class="brand-word">palet<span>lab</span><small>SKLADIŠTE ZELENJAK · SISAK</small></span></a>
    <div class="header-meta"><span class="meta-chip" id="site-chip">${n0(SITE.parcelArea)} m² parcela · ${n0(SITE.hallArea)} m² hala · ${n0(places)} mjesta</span><span class="phase-badge" id="phase-badge" data-phase="closed"><i></i><span>Zatvoreno</span></span></div>
  </header>
  <main class="page">
    <section class="page-heading">
      <div><span class="eyebrow">Simulacija posla · dan po dan</span><h1>Paletno skladište na Zelenjaku</h1>
      <p>Šleperi dolaze na istovar i utovar u dogovorenim terminima. Rampa je jedna, pa tko dođe ranije ili čeka red stoji na parkingu, a tko kasni propušta red. Viličar slaže palete po regalima, a zarada dolazi od skladištenja i manipulacije.</p></div>
    </section>

    <div class="layout">
      <section class="scene-panel area-scene" aria-label="3D prikaz parcele, hale, rampe i parkinga">
        <div class="viewport">
          <canvas id="scene" aria-label="3D prikaz skladišta; povuci za okretanje, kotačić ili dva prsta za približavanje"></canvas>
          <div id="scene-loading" class="scene-loading"><span class="loader"></span> Gradim parcelu i halu…</div>
          <div class="scene-toolbar">
            <span class="scene-label"><i></i> PRIKAZ UŽIVO</span>
            <div class="camera-group" role="group" aria-label="Kamera">
              <button data-camera="overview" class="selected">Pregled</button><button data-camera="hall">Hala</button><button data-camera="bay">Rampa</button><button data-camera="parking">Parking</button><button data-camera="forklift">Viličar</button><button data-camera="plan">Tlocrt</button>
              <button id="fullscreen" title="Puni zaslon" aria-label="Puni zaslon">${icons.expand}</button>
            </div>
          </div>
        </div>
        <div class="hud">
          <div class="hud-card time"><span class="hud-label" id="hud-date">pon, 4. 1. 2027.</span><strong id="hud-clock">06:30</strong><span class="hud-sub" id="hud-workday">1. radni dan</span></div>
          <div class="hud-card stock"><span class="hud-label">Popunjeno</span><strong><span id="hud-stock">0</span><small> / <span id="hud-capacity">${n0(places)}</span></small></strong><span class="meter"><i id="hud-meter"></i></span><span class="hud-sub" id="hud-pct">0 %</span></div>
          <div class="hud-card money"><span class="hud-label">Danas zarađuje</span><strong id="hud-today">0 €</strong><span class="hud-sub" id="hud-rate">${price(d.pricePerPalletDay)} × paleta</span></div>
        </div>
        <div class="deck">
          <div class="transport" role="group" aria-label="Vrijeme simulacije">
            <button id="play" class="button primary">${icons.pause}<span>Pauziraj</span></button>
            <div class="stepper" role="group" aria-label="Brzina vremena">
              <button id="slower" aria-label="Sporije">${icons.minus}</button>
              <output id="speed-output" aria-live="polite">${SPEEDS[DEFAULT_SPEED].label}</output>
              <button id="faster" aria-label="Brže">${icons.plus}</button>
            </div>
            <button id="next-day" class="button square" title="Preskoči na sljedeći radni dan" aria-label="Preskoči na sljedeći radni dan">${icons.next}</button>
            <button id="next-month" class="button square" title="Preskoči mjesec dana" aria-label="Preskoči mjesec dana">${icons.month}</button>
            <button id="reset" class="button square" title="Kreni ispočetka s istim postavkama" aria-label="Kreni ispočetka">${icons.reset}</button>
          </div>
          <div class="view-controls">
            <label for="walls">Zidovi</label>
            <input id="walls" type="range" min="0" max="100" step="5" value="45"/>
            <output id="walls-output">45 %</output>
            <label class="toggle"><input id="roof" type="checkbox"/><span>Krov</span></label>
          </div>
        </div>
        <div class="scene-footer">
          <span class="activity" id="activity">Viličar čeka prvi šleper.</span>
          <span class="legend"><span><i class="dot in"></i>istovar</span><span><i class="dot out"></i>utovar</span>${CLIENTS.slice(0, 4).map(c => `<span class="swatch" style="--c:${c.color}" title="${c.code} · ${c.name}"></span>`).join('')}<span class="legend-more">boja = klijent</span></span>
        </div>
      </section>

      <article class="card earnings area-earn" aria-labelledby="earn-title">
        <div class="card-heading"><div><span class="eyebrow">Zarada</span><h2 id="earn-title">Koliko donosi popunjenost</h2></div><div class="earn-actions"><span class="price-chip" id="price-chip">${price(d.pricePerPalletDay)} / paleta / dan</span><button id="export" class="button ghost">${icons.export}<span>CSV po danima</span></button></div></div>
        <div class="tiles">
          <div class="tile"><span>Danas</span><strong id="k-today">0 €</strong><small id="k-today-sub">0 paleta na skladištu</small></div>
          <div class="tile"><span id="k-month-label">Ovaj mjesec</span><strong id="k-month">0 €</strong><small id="k-month-sub">—</small></div>
          <div class="tile"><span>Ukupno prihod</span><strong id="k-total">0 €</strong><small id="k-total-sub">—</small></div>
          <div class="tile net"><span>Nakon troškova</span><strong id="k-net">0 €</strong><small id="k-net-sub">—</small></div>
        </div>
        <p class="projection" id="projection">Projekcija se računa nakon prvog tjedna rada.</p>
        <div class="charts">
          <figure><figcaption><span>Prihod po danu</span><span class="key"><i class="k-rev"></i>prihod <i class="k-cap"></i>puno <i class="k-cost"></i>trošak/dan</span></figcaption><div id="chart-daily" class="chart"></div></figure>
          <figure><figcaption><span>Ukupno do danas</span><span class="key"><i class="k-rev"></i>prihod <i class="k-cost"></i>troškovi</span></figcaption><div id="chart-cum" class="chart"></div></figure>
        </div>
      </article>

      <article class="card schedule area-sched" aria-labelledby="sched-title">
        <div class="card-heading"><div><span class="eyebrow">Dispečer</span><h2 id="sched-title">Raspored danas</h2></div><span class="sched-summary" id="sched-summary">—</span></div>
        <div id="gantt" class="gantt"></div>
        <div class="table-wrap"><table class="appointments"><thead><tr><th>Termin</th><th>Šleper</th><th>Klijent</th><th class="num">Pal.</th><th>Stanje</th></tr></thead><tbody id="appointments"></tbody></table></div>
        <div class="log-title">Dnevnik</div>
        <ol id="log" class="log"></ol>
      </article>

      <aside class="card control-panel area-settings" aria-labelledby="settings-title">
        <div class="card-heading"><div><span class="eyebrow">Postavke</span><h2 id="settings-title">Pretpostavke posla</h2></div></div>
        <label class="field-label" id="ramp-label">Rast potražnje</label>
        <div class="segmented" role="group" aria-labelledby="ramp-label"><button data-ramp="slow">Spor</button><button data-ramp="normal" class="selected">Normalan</button><button data-ramp="fast">Brz</button></div>
        <p id="ramp-help" class="field-help">Puna potražnja nakon ~120 radnih dana (oko 6 mjeseci).</p>
        <div class="field-row"><label for="price">Cijena po paleti <small>€ po danu skladištenja</small></label>${num('price', d.pricePerPalletDay, 0.05, 20, 0.05)}</div>
        <div class="field-row"><label for="handling">Manipulacija <small>€ po paleti na ulazu i na izlazu</small></label>${num('handling', d.handlingFee, 0.5, 50, 0.5)}</div>
        <div class="field-row"><label for="peak">Upiti za dovoz <small>šlepera dnevno kad posao procvjeta</small></label>${num('peak', d.peakDemand, 0.5, 20, 0.1)}</div>
        <div class="field-row"><label for="pmin">Palete po šleperu <small>najmanje – najviše (max 32)</small></label><span class="pair">${num('pmin', d.palletsMin, 1, 32, 1)}<b>–</b>${num('pmax', d.palletsMax, 1, 32, 1)}</span></div>
        <div class="field-row"><label for="dmin">Dana na skladištu <small>najmanje – najviše</small></label><span class="pair">${num('dmin', d.dwellMin, 1, 90, 1)}<b>–</b>${num('dmax', d.dwellMax, 1, 90, 1)}</span></div>
        <div class="field-row"><label for="levels">Razine regala <small id="levels-help">${n0(places)} paletnih mjesta</small></label><select id="levels"><option value="3">3</option><option value="4" selected>4</option><option value="5">5</option></select></div>
        <div class="field-row"><label for="forklifts">Viličari</label><select id="forklifts"><option value="1" selected>1</option><option value="2">2</option></select></div>
        <details class="advanced"><summary>Troškovi i radno vrijeme <span aria-hidden="true">+</span></summary><div class="advanced-content">
          <div class="field-row"><label for="wage">Plaća skladištara <small>trošak firme; 1.600 € neto ≈ 2.730 €</small></label>${num('wage', COSTS.wage, 0, 50000, 10)}</div>
          <div class="field-row"><label for="leasing">Leasing viličara <small>mjesečna rata</small></label>${num('leasing', COSTS.leasing, 0, 10000, 10)}</div>
          <div class="field-row"><label for="other">Ostali troškovi <small>struja, voda, osiguranje, knjigovođa</small></label>${num('other', COSTS.other, 0, 50000, 10)}</div>
          <div class="field-row"><label for="workdays">Radni dani</label><select id="workdays"><option value="5" selected>pon–pet</option><option value="6">pon–sub</option></select></div>
          <div class="field-row"><label for="start">Početak rada</label><select id="start"><option value="6">06:00</option><option value="7" selected>07:00</option><option value="8">08:00</option></select></div>
          <div class="field-row"><label for="hours">Radno vrijeme</label><select id="hours"><option value="8" selected>8 h</option><option value="10">10 h</option><option value="12">12 h</option></select></div>
          <div class="field-row"><label for="early">Poranili <small>% šlepera 30–150 min ranije, čekaju na parkingu</small></label>${num('early', d.earlyChance * 100, 0, 60, 1)}</div>
          <div class="field-row"><label for="late">Kasne <small>% šlepera 20–90 min kasnije, propuštaju red</small></label>${num('late', d.lateChance * 100, 0, 60, 1)}</div>
          <div class="field-row"><label for="noshow">Ne dođu <small>% dogovorenih termina</small></label>${num('noshow', d.noShowChance * 100, 0, 30, 1)}</div>
          <div class="field-row"><label for="seed">Sjeme <small>isti broj = isti tijek posla</small></label>${num('seed', d.seed, 0, 4294967295, 1)}</div>
        </div></details>
        <button id="apply" class="button apply" disabled>Primijeni i kreni ispočetka</button>
        <p id="config-hint" class="field-help">Radi se ${d.workHours} h dnevno, od ${d.workStartHour}:00, s jednom rampom i parkingom za ${PARKING.stalls.length} šlepera. Noći i vikendi se preskaču, a skladištenje se naplaćuje svaki kalendarski dan.</p>
      </aside>

      <article class="card ops area-ops" aria-labelledby="ops-title">
        <div class="card-heading"><div><span class="eyebrow">Operativa</span><h2 id="ops-title">Kako teče posao</h2></div></div>
        <table class="metrics"><tbody id="ops-body"></tbody></table>
      </article>
      <article class="card site area-site" aria-labelledby="site-title">
        <div class="card-heading"><div><span class="eyebrow">Parcela i hala</span><h2 id="site-title">Raspored za brzi promet paleta</h2></div></div>
        <div id="site-facts" class="facts"></div>
      </article>
    </div>
    <footer class="app-footer"><span>PALETLAB · procjena za tri ortaka, ne ponuda izvođača</span><span>Vremena i cijene su pretpostavke koje možeš mijenjati.</span></footer>
    <div id="toast" class="toast" role="status" hidden></div>
  </main>`;
}
