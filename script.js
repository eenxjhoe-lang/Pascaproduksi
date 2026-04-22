/* ════════════════════════════════════════════════════════
   DOPK DASHBOARD v9 — script.js
   Kementerian Kelautan dan Perikanan · 2026
   ════════════════════════════════════════════════════════
   Konfigurasi : data.json
   Gaya tampilan: style.css
   Aset logo    : assets/
   ════════════════════════════════════════════════════════ */

// ════════════════════════════════════════
// LOAD CONFIG FROM data.json
// ════════════════════════════════════════
let CONFIG      = null;
let TARGETS     = [];
let PORT_NAMES  = [];
let PORT_COLORS = [];
let BULAN_ORDER = [];
let KOLOM       = {};

// ════════════════════════════════════════
// STORAGE KEYS — definisikan di atas agar tidak ReferenceError
// ════════════════════════════════════════
const LS_KEY      = 'dopk_v9_data';
const LS_API_KEY  = 'dopk_api_url';
const LS_INT_KEY  = 'dopk_refresh_min';

async function loadConfig() {
  try {
    const resp = await fetch('data.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    CONFIG = await resp.json();
    TARGETS     = CONFIG.pelabuhan.map(p => p.target);
    PORT_NAMES  = CONFIG.pelabuhan.map(p => p.nama);
    PORT_COLORS = CONFIG.pelabuhan.map(p => p.warna);
    BULAN_ORDER = CONFIG.bulan;
    KOLOM       = CONFIG.kolom_excel;
    // Inject logo from assets
    const logoEl = document.getElementById('sb-logo-img');
    if (logoEl && CONFIG.assets && CONFIG.assets.logo_kkp) logoEl.src = CONFIG.assets.logo_kkp;
    // Update year
    const yearEls = document.querySelectorAll('.sb-year, #sb-year-text');
    yearEls.forEach(el => { if (el) el.textContent = 'TAHUN ' + CONFIG.app.tahun; });
    // Patch port selects
    const portSel = document.getElementById('gs-port-select');
    if (portSel && PORT_NAMES.length) {
      portSel.innerHTML = PORT_NAMES.map((n,i) => `<option value="${i}">${n}</option>`).join('');
    }
  } catch(e) {
    console.warn('[DOPK] data.json tidak ditemukan — menggunakan konfigurasi bawaan.', e.message);
    TARGETS     = [500000000, 100000000, 100000000];
    PORT_NAMES  = ['PP. Sungai Kakap', 'PP. Sukabangun', 'PP. Kuala Jelai'];
    PORT_COLORS = ['#1a6fd4', '#0891b2', '#4f46e5'];
    BULAN_ORDER = ['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI',
                   'JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
    KOLOM = { no:0, bulan:1, kapal:3, pemilik:7, trip:13, produksi:14, nilai:17, ket:18 };
  }
}

// ════════════════════════════════════════
// LIVE FETCH — Google Apps Script API
// ════════════════════════════════════════
let _refreshTimer   = null;
let _lastFetchTime  = null;
let _fetchStatus    = 'idle'; // idle | loading | ok | error

// getApiUrl → lihat definisi lengkap di bagian API Config

function getRefreshInterval() {
  const menit = CONFIG && CONFIG.spreadsheet && CONFIG.spreadsheet.refresh_menit;
  return (typeof menit === 'number' && menit > 0 ? menit : 5) * 60 * 1000;
}

function isAutoFetch() {
  return CONFIG && CONFIG.spreadsheet && CONFIG.spreadsheet.auto_fetch !== false;
}

/**
 * Fetch data dari Google Apps Script Web App.
 * Dipanggil: saat halaman load, saat user klik refresh manual, atau auto-refresh.
 */
async function fetchFromSpreadsheet(showToastOnOk = true) {
  const url = getApiUrl();
  if (!url) return false; // belum dikonfigurasi

  setFetchStatus('loading');

  try {
    const resp = await fetch(url + '?action=data', {
      method: 'GET',
      cache:  'no-cache',
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);

    const result = await resp.json();

    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Format respons tidak valid');
    }

    // Ganti appData dengan data dari Sheets (source of truth)
    appData = result.data;
    _lastFetchTime = new Date();

    saveData(); // cache ke localStorage
    hideOnboarding();
    refreshAll();
    if (currentPage.startsWith('port-')) buildDetail(parseInt(currentPage.replace('port-','')));
    if (currentPage === 'compare')  buildComparison();
    if (currentPage === 'warnings') buildWarningsPage();
    if (currentPage === 'progress') buildProgressPage();
    if (currentPage === 'insights') buildInsightsPage();
    if (currentPage === 'export')   buildExportPreview();

    setFetchStatus('ok');
    updateStatusBar();

    if (showToastOnOk) {
      showToast('#059669', `✅ Data terbaru dimuat: ${result.total} baris dari ${result.summary.length} sheet`);
    }

    // Jadwal auto-refresh berikutnya
    scheduleRefresh();
    return true;

  } catch(err) {
    console.error('[DOPK] fetchFromSpreadsheet error:', err);
    setFetchStatus('error', err.message);
    updateStatusBar();
    showToast('#dc2626', `❌ Gagal mengambil data: ${err.message}`);
    scheduleRefresh(); // tetap coba lagi nanti
    return false;
  }
}

function scheduleRefresh() {
  clearTimeout(_refreshTimer);
  if (!isAutoFetch() || !getApiUrl()) return;
  _refreshTimer = setTimeout(() => fetchFromSpreadsheet(false), getRefreshInterval());
}

function setFetchStatus(status, errMsg) {
  _fetchStatus = status;
  const bar    = document.getElementById('live-status-bar');
  if (bar) {
    if (status === 'loading') {
      bar.innerHTML = '<span class="ls-dot ls-loading"></span><span>Memuat data terbaru dari Google Sheets…</span>';
      bar.style.display = 'flex';
    } else if (status === 'error') {
      bar.innerHTML = '<span class="ls-dot ls-error"></span><span>Gagal terhubung ke Sheets: ' + (errMsg||'') + '</span>'
        + '<button onclick="fetchFromSpreadsheet(true)" style="margin-left:auto;background:var(--red);color:#fff;border:none;padding:4px 10px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">Coba Lagi</button>';
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }
  // Langsung update live indicator — tidak ada override terpisah
  updateLiveIndicator();
}

function updateStatusBar() {
  const el = document.getElementById('live-last-update');
  if (!el) return;
  if (_lastFetchTime) {
    el.textContent = `🔄 Diperbarui: ${_lastFetchTime.toLocaleTimeString('id-ID')}`;
    el.style.display = 'block';
  }
}

/** Dipanggil dari tombol refresh manual di topbar */
function manualRefresh() {
  if (!getApiUrl()) {
    // Belum dikonfigurasi → buka modal setup, bukan tampilkan error
    openApiConfig();
    return;
  }
  // Animasi spinning pada tombol
  const btn = document.getElementById('btn-refresh');
  if (btn) btn.classList.add('spinning');
  fetchFromSpreadsheet(true).finally(() => {
    if (btn) btn.classList.remove('spinning');
  });
}

// ════════════════════════════════════════
// PERSISTENCE — localStorage
// ════════════════════════════════════════

function saveData() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(appData)); } catch(e) {}
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const d = JSON.parse(raw); if (Array.isArray(d) && d.length) { appData = d; return true; } }
  } catch(e) {}
  return false;
}

// ════════════════════════════════════════
// STATE — diisi oleh loadConfig() + Import
// ════════════════════════════════════════
// Data dimulai KOSONG — diisi Import atau localStorage
let appData = [];
const chartsMap = {};
let pendingRows = [];
let importMode = 'append'; // 'append' | 'replace'
let currentPage = 'overview';
const navIds = ['overview','port-0','port-1','port-2','warnings','progress','insights','compare','export'];

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
const fmtRp  = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtKg  = n => n.toLocaleString('id-ID') + ' kg';
const fmtPct = n => n.toFixed(2).replace('.',',') + '%';

function ketBadge(ket) {
  if (!ket) return '<span class="kb kb-other">-</span>';
  const u = ket.toUpperCase();
  if (u === 'LUNAS') return `<span class="kb kb-ok">${ket}</span>`;
  if (u.includes('KOREKSI')) return `<span class="kb kb-warn">${ket}</span>`;
  return `<span class="kb kb-other">${ket}</span>`;
}

// ════════════════════════════════════════
// STATS — Produksi rata-rata = Total Produksi / Total LPS (kapal masuk)
// ════════════════════════════════════════
function getStats(pi) {
  const rows = appData.filter(d => d.port === pi);
  const totalProd  = rows.reduce((s, r) => s + r.produksi, 0);
  const totalNilai = rows.reduce((s, r) => s + r.nilai, 0);  // Total PNBP pelabuhan ini
  const ships = [...new Set(rows.map(r => r.kapal))];
  const bulanMap = {};
  rows.forEach(r => {
    if (!bulanMap[r.bulan]) bulanMap[r.bulan] = { lps:0, prod:0, nilai:0, ships:new Set() };
    bulanMap[r.bulan].lps++;
    bulanMap[r.bulan].prod += r.produksi;
    bulanMap[r.bulan].nilai += r.nilai;
    bulanMap[r.bulan].ships.add(r.kapal);
  });
  Object.keys(bulanMap).forEach(b => bulanMap[b].ships = bulanMap[b].ships.size);
  const sortedBulans = Object.keys(bulanMap).sort((a,b) => BULAN_ORDER.indexOf(a) - BULAN_ORDER.indexOf(b));
  // Rata-rata produksi = total produksi / total LPS (jumlah kapal masuk / transaksi)
  const avg = rows.length ? Math.round(totalProd / rows.length) : 0;
  return { rows, totalProd, totalNilai, ships, bulanMap, sortedBulans,
           pct: TARGETS[pi] > 0 ? totalNilai / TARGETS[pi] * 100 : 0,
           lps: rows.length, avg };
}

// ════════════════════════════════════════
// EMPTY STATE
// ════════════════════════════════════════
function emptyStateHTML(portName) {
  return `<div class="empty-state">
    <div class="empty-icon">📭</div>
    <div class="empty-title">Belum Ada Data${portName ? ' — ' + portName : ''}</div>
    <div class="empty-sub">Silakan import file Excel DOPK (.xlsx) untuk mulai menampilkan data PNBP Pascaproduksi.</div>
    <button class="btn btn-primary" onclick="openImportModal()">📥 Import Data Sekarang</button>
  </div>`;
}

// ════════════════════════════════════════
// WARNINGS & INSIGHTS
// ════════════════════════════════════════
function getWarnings(pi) {
  const s = getStats(pi);
  const w = [];
  if (!s.rows.length) return w;
  if (s.pct < 25)  w.push({ level:'danger', text:`Capaian PNBP hanya ${fmtPct(s.pct)} — sangat di bawah target` });
  else if (s.pct < 50) w.push({ level:'warn', text:`Capaian PNBP ${fmtPct(s.pct)} — perlu akselerasi` });
  const zero = s.rows.filter(r => r.produksi === 0).length;
  if (zero) w.push({ level:'warn', text:`${zero} transaksi dengan produksi 0 kg` });
  const kor  = s.rows.filter(r => r.ket.toUpperCase().includes('KOREKSI')).length;
  if (kor)  w.push({ level:'warn', text:`${kor} data berstatus KOREKSI` });
  if (s.sortedBulans.length) {
    const proj = Math.round(s.totalNilai / s.sortedBulans.length * 12);
    if (proj < TARGETS[pi]) w.push({ level:'warn', text:`Proyeksi tahunan ${fmtRp(proj)} — di bawah target` });
  }
  return w;
}

function getInsights(pi) {
  const s = getStats(pi);
  if (!s.sortedBulans.length) return [];
  const ins = [];
  // Best month
  const bestB = s.sortedBulans.reduce((b,c) => s.bulanMap[c].prod > s.bulanMap[b].prod ? c : b);
  ins.push({ type:'info', icon:'🏆', title:'Bulan Terbaik', text:`${bestB} — ${s.bulanMap[bestB].prod.toLocaleString('id-ID')} kg` });
  // Trend
  if (s.sortedBulans.length >= 2) {
    const last = s.sortedBulans[s.sortedBulans.length-1];
    const prev = s.sortedBulans[s.sortedBulans.length-2];
    const d = s.bulanMap[last].prod - s.bulanMap[prev].prod;
    const dp = s.bulanMap[prev].prod ? Math.abs(d/s.bulanMap[prev].prod*100).toFixed(1) : 0;
    ins.push({ type:d>=0?'success':'warning', icon:d>=0?'📈':'📉', title:'Tren Produksi',
               text:`${d>=0?'Naik':'Turun'} ${dp}% dari ${prev} → ${last}` });
  }
  // Forecast
  const nm = s.sortedBulans.length;
  const proj = Math.round(s.totalNilai / nm * 12);
  const ok = proj >= TARGETS[pi];
  ins.push({ type:ok?'success':'danger', icon:'🔮', title:'Proyeksi Tahunan',
             text:`${fmtRp(proj)} — ${ok ? 'ON TRACK ✅' : 'DI BAWAH TARGET ⚠️'}` });
  // Anomaly
  const zc = s.rows.filter(r => r.produksi === 0).length;
  if (zc) ins.push({ type:'warning', icon:'⚠️', title:'Anomali Data', text:`${zc} transaksi dengan produksi 0 kg` });
  // Top ship
  const sp = {};
  s.rows.forEach(r => { sp[r.kapal] = (sp[r.kapal]||0) + r.produksi; });
  const top = Object.entries(sp).sort((a,b) => b[1]-a[1])[0];
  if (top) ins.push({ type:'info', icon:'🚢', title:'Kapal Terproduksi', text:`${top[0]} — ${top[1].toLocaleString('id-ID')} kg` });
  return ins;
}

function insightHTML(pi) {
  const ins = getInsights(pi);
  if (!ins.length) return '';
  return `<div class="section-title" style="margin-top:14px;margin-bottom:8px">💡 Insight Otomatis</div>
  <div class="insight-grid">${ins.map(i=>`
    <div class="insight-card ic-${i.type}">
      <div class="insight-icon">${i.icon}</div>
      <div><div class="insight-title">${i.title}</div><div class="insight-text">${i.text}</div></div>
    </div>`).join('')}</div>`;
}

function forecastHTML(pi) {
  const s = getStats(pi);
  if (!s.sortedBulans.length) return '';
  const nm = s.sortedBulans.length;
  const proj = Math.round(s.totalNilai / nm * 12);
  const bestM = Math.max(...s.sortedBulans.map(b => s.bulanMap[b].nilai));
  const optim = Math.round(bestM * 12);
  const ok = proj >= TARGETS[pi];
  const gap = TARGETS[pi] - proj;
  const remM = Math.max(12 - nm, 1);
  return `<div class="forecast-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="section-title" style="margin:0">🔮 Target vs Forecast</div>
      <span class="fc-badge ${ok?'fc-ok':'fc-no'}">${ok?'✅ On Track':'⚠️ Behind Target'}</span>
    </div>
    <div class="forecast-row">
      <span class="forecast-label">🎯 Target Tahunan</span>
      <div class="forecast-bar-wrap"><div class="forecast-bar" style="width:100%;background:var(--border2)"></div></div>
      <span class="forecast-val">${fmtRp(TARGETS[pi])}</span>
    </div>
    <div class="forecast-row">
      <span class="forecast-label">📊 Realisasi Saat Ini</span>
      <div class="forecast-bar-wrap"><div class="forecast-bar" style="width:${Math.min(s.pct,100).toFixed(1)}%;background:${PORT_COLORS[pi]}"></div></div>
      <span class="forecast-val">${fmtRp(s.totalNilai)}</span>
    </div>
    <div class="forecast-row">
      <span class="forecast-label">📉 Proyeksi Rata-rata</span>
      <div class="forecast-bar-wrap"><div class="forecast-bar id="fc-cons-${pi}"" style="width:${Math.min(proj/TARGETS[pi]*100,100).toFixed(1)}%;background:${ok?'var(--green)':'var(--amber)'}"></div></div>
      <span class="forecast-val" style="color:${ok?'var(--green)':'var(--amber)'}">${fmtRp(proj)}</span>
    </div>
    <div class="forecast-row">
      <span class="forecast-label">📈 Proyeksi Optimis</span>
      <div class="forecast-bar-wrap"><div class="forecast-bar" style="width:${Math.min(optim/TARGETS[pi]*100,100).toFixed(1)}%;background:var(--teal)"></div></div>
      <span class="forecast-val" style="color:var(--teal)">${fmtRp(optim)}</span>
    </div>
    ${gap > 0
      ? `<div style="margin-top:10px;padding:8px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;font-size:11px;color:#c2410c">
           ⚡ Perlu tambahan <strong>${fmtRp(gap)}</strong> lagi. Butuh ≈ <strong>${fmtRp(Math.round(gap/remM))}/bulan</strong> untuk ${remM} bulan ke depan.
         </div>`
      : `<div style="margin-top:10px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;font-size:11px;color:#065f46">
           🎉 Proyeksi menunjukkan target akan tercapai berdasarkan laju saat ini!
         </div>`}
  </div>`;
}

// ════════════════════════════════════════
// GLOBAL WARNINGS
// ════════════════════════════════════════
function renderGlobalWarnings() {
  // Strip "Peringatan Sistem — Perlu Perhatian" dihilangkan dari menu utama.
  // Detail peringatan tetap tersedia di halaman sidebar "⚠️ Peringatan Sistem".
  const el = document.getElementById('global-warnings'); if (!el) return;
  el.innerHTML = '';
}

// ════════════════════════════════════════
// TOTAL SUMMARY (3 Pelabuhan Gabungan)
// ════════════════════════════════════════
function getTotalStats() {
  // Total agregat 3 pelabuhan. Jumlah Kapal Unik = jumlah dari kapal unik tiap pelabuhan
  // (karena kapal yang sama di 2 pelabuhan berbeda dihitung sebagai 2 entitas operasional berbeda)
  const ps = [0,1,2].map(pi => getStats(pi));
  const totalNilai = ps.reduce((a,s) => a + s.totalNilai, 0);
  const totalProd  = ps.reduce((a,s) => a + s.totalProd, 0);
  const totalLps   = ps.reduce((a,s) => a + s.lps, 0);
  const totalShips = ps.reduce((a,s) => a + s.ships.length, 0);
  const avg        = totalLps ? Math.round(totalProd / totalLps) : 0;
  const totalTarget= TARGETS.reduce((a,b) => a+b, 0);
  const pct        = totalTarget ? totalNilai / totalTarget * 100 : 0;
  return { totalNilai, totalProd, totalLps, totalShips, avg, totalTarget, pct, ps };
}

function renderTotalSummary() {
  const el = document.getElementById('total-summary'); if (!el) return;
  const t = getTotalStats();
  if (!appData.length) { el.innerHTML = ''; return; }

  const pct = Math.min(t.pct, 100);

  el.innerHTML = `<div class="port-block" style="background:linear-gradient(135deg,#eff6ff 0%,#e8f0fb 100%);border:2px solid #bfdbfe;border-radius:12px;padding:18px 20px;margin-bottom:22px">
    <div class="port-block-head" style="margin-bottom:12px">
      <div style="width:4px;border-radius:2px;flex-shrink:0;height:44px;background:linear-gradient(180deg,#1a6fd4,#0891b2,#4f46e5)"></div>
      <div style="flex:1">
        <div class="port-eyebrow" style="color:#1e40af">Ringkasan Total</div>
        <div class="port-name" style="font-size:20px">📊 Jumlah 3 Pelabuhan Pascaproduksi</div>
        <div style="font-size:11px;color:#3a5070;margin-top:3px">Gabungan PP. Sungai Kakap + PP. Sukabangun + PP. Kuala Jelai</div>
      </div>
      <div style="display:flex;gap:6px">
        <span style="background:#1a6fd4;color:#fff;font-size:9px;font-weight:700;padding:4px 9px;border-radius:12px">PP. Sungai Kakap</span>
        <span style="background:#0891b2;color:#fff;font-size:9px;font-weight:700;padding:4px 9px;border-radius:12px">PP. Sukabangun</span>
        <span style="background:#4f46e5;color:#fff;font-size:9px;font-weight:700;padding:4px 9px;border-radius:12px">PP. Kuala Jelai</span>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card kc0"><div class="kpi-lbl">Total Realisasi PNBP</div><div class="kpi-val sm">${fmtRp(t.totalNilai)}</div><div class="kpi-sub">dari target ${fmtRp(t.totalTarget)}</div><div class="kpi-ico">💰</div></div>
      <div class="kpi-card kc1"><div class="kpi-lbl">Jumlah Produksi</div><div class="kpi-val">${t.totalProd.toLocaleString('id-ID')}</div><div class="kpi-sub">Kilogram (kg)</div><div class="kpi-ico">🐟</div></div>
      <div class="kpi-card kc2"><div class="kpi-lbl">Jumlah LPS Terbit</div><div class="kpi-val">${t.totalLps}</div><div class="kpi-sub">Lembar Perhitungan Sendiri</div><div class="kpi-ico">📋</div></div>
      <div class="kpi-card kc3"><div class="kpi-lbl">Jumlah Kapal Aktif</div><div class="kpi-val">${t.totalShips}</div><div class="kpi-sub">Unit (gabungan 3 pelabuhan)</div><div class="kpi-ico">🚢</div></div>
      <div class="kpi-card kc4"><div class="kpi-lbl">Prod. Rata-rata/Kapal</div><div class="kpi-val">${t.avg.toLocaleString('id-ID')}</div><div class="kpi-sub">kg per LPS (${t.totalLps} LPS)</div><div class="kpi-ico">📊</div></div>
      <div class="kpi-card kc5"><div class="kpi-lbl">Persentase Realisasi</div><div class="kpi-val">${fmtPct(t.pct)}</div><div class="kpi-sub">vs target tahunan gabungan</div><div class="kpi-ico">🎯</div></div>
    </div>
  </div>`;

  setTimeout(() => {
    const pf = document.getElementById('pfov-total');
    if (pf) pf.style.width = pct + '%';
  }, 150);
}

// ════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════
function renderOverview() {
  renderGlobalWarnings();
  renderTotalSummary();
  [0,1,2].forEach(pi => { renderOvBlock(pi); updateBadge(pi); });
  updateWarningBadge();
}

function renderOvBlock(pi) {
  const s = getStats(pi);
  const el = document.getElementById('ov-'+pi); if (!el) return;

  if (!s.rows.length) {
    el.innerHTML = `<div class="port-block">
      <div class="port-block-head">
        <div class="port-stripe" style="height:36px;background:${PORT_COLORS[pi]}"></div>
        <div>
          <div class="port-eyebrow">Pelabuhan Perikanan</div>
          <div class="port-name">${PORT_NAMES[pi]}</div>
        </div>
      </div>
      ${emptyStateHTML('')}
    </div>`;
    return;
  }

  const pct = Math.min(s.pct, 100);
  const wCls = s.pct < 25 ? 'warn-danger' : s.pct < 50 ? 'warn-amber' : s.pct >= 80 ? 'warn-green' : '';
  const wBadge = ''; // Badge KRITIS/LAMBAT dihilangkan dari menu utama
  const pfCls = s.pct >= 75 ? 'pf-green' : s.pct >= 40 ? `pf-${pi}` : 'pf-amber';
  const kur = TARGETS[pi] - s.totalNilai;

  // KPI: Total Realisasi PNBP = SUM nilai pelabuhan ini
  const kpis = [
    { l:'Total Realisasi PNBP',   v:fmtRp(s.totalNilai),               sub:`dari target ${fmtRp(TARGETS[pi])}`, ico:'💰', c:'kc0', extra:'' },
    { l:'Jumlah Produksi',         v:s.totalProd.toLocaleString('id-ID'), sub:'Kilogram (kg)',                     ico:'🐟', c:'kc1', extra:'' },
    { l:'Jumlah LPS Terbit',       v:s.lps,                              sub:'Lembar Perhitungan Sendiri',             ico:'📋', c:'kc2', extra:'' },
    { l:'Jumlah Kapal Unik',       v:s.ships.length,                     sub:'Unit Kapal Aktif',                  ico:'🚢', c:'kc3', extra:'' },
    { l:'Prod. Rata-rata/Kapal',   v:s.avg.toLocaleString('id-ID'),      sub:`kg per kapal masuk (${s.lps} LPS)`, ico:'📊', c:'kc4', extra:'' },
    { l:'Persentase Realisasi',    v:fmtPct(s.pct),                      sub:'vs target tahunan',                 ico:'🎯', c:`kc5 ${wCls}`, extra:wBadge },
  ].map(k => `<div class="kpi-card ${k.c}">
    <div class="kpi-lbl">${k.l}</div>
    <div class="kpi-val sm">${k.v}</div>
    <div class="kpi-sub">${k.sub}</div>
    <div class="kpi-ico">${k.ico}</div>${k.extra}
  </div>`).join('');

  el.innerHTML = `<div class="port-block">
    <div class="port-block-head">
      <div class="port-stripe" style="height:36px;background:${PORT_COLORS[pi]}"></div>
      <div><div class="port-eyebrow">Pelabuhan Perikanan</div><div class="port-name">${PORT_NAMES[pi]}</div></div>
    </div>
    <div class="kpi-grid">${kpis}</div>
  </div>`;

  setTimeout(() => {
    const pf = document.getElementById('pfov-'+pi);
    if (pf) pf.style.width = pct + '%';
  }, 200 + pi * 80);
}

function updateBadge(pi) {
  const el = document.getElementById('nb-'+pi); if (el) el.textContent = getStats(pi).lps;
}

// ════════════════════════════════════════
// DETAIL PAGE
// ════════════════════════════════════════
function buildDetail(pi) {
  const s = getStats(pi);
  const pg = document.getElementById('page-port-'+pi); if (!pg) return;

  if (!s.rows.length) {
    pg.innerHTML = `<div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="port-stripe" style="height:44px;width:4px;background:${PORT_COLORS[pi]};border-radius:2px"></div>
        <div><div class="port-eyebrow">Rincian Pelabuhan Perikanan</div>
          <div class="port-name" style="font-size:22px">${PORT_NAMES[pi]}</div></div>
      </div>
    </div>
    ${emptyStateHTML(PORT_NAMES[pi])}`;
    return;
  }

  const kur = TARGETS[pi] - s.totalNilai;
  const wCls = s.pct < 25 ? 'warn-danger' : s.pct < 50 ? 'warn-amber' : s.pct >= 80 ? 'warn-green' : '';
  const pfCls = s.pct >= 75 ? 'pf-green' : s.pct >= 40 ? `pf-${pi}` : 'pf-amber';
  const warns = getWarnings(pi);

  const monthRows = s.sortedBulans.map(b => {
    const m = s.bulanMap[b];
    const ma = m.ships ? Math.round(m.prod / m.ships) : 0;
    return `<tr>
      <td class="td-month">${b}</td>
      <td class="td-num">${m.lps}</td>
      <td class="td-num">${m.ships}</td>
      <td class="td-num">${m.prod.toLocaleString('id-ID')}</td>
      <td class="td-num">${fmtRp(m.nilai)}</td>
      <td class="td-num">${ma.toLocaleString('id-ID')}</td>
    </tr>`;
  }).join('');

  pg.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="port-stripe" style="height:44px;width:4px;background:${PORT_COLORS[pi]};border-radius:2px"></div>
        <div><div class="port-eyebrow">Rincian Pelabuhan Perikanan</div>
          <div class="port-name" style="font-size:22px">${PORT_NAMES[pi]}</div></div>
      </div>
    </div>
    ${warns.length ? `<div class="warning-strip" style="margin-bottom:14px">
      <div class="ws-icon">⚠️</div>
      <div class="ws-body"><div class="ws-title">Peringatan</div>
        <ul class="ws-list">${warns.map(w=>`<li>${w.text}</li>`).join('')}</ul></div>
    </div>` : ''}
    <div class="kpi-grid">
      <div class="kpi-card kc0"><div class="kpi-lbl">Total Realisasi PNBP</div><div class="kpi-val sm">${fmtRp(s.totalNilai)}</div><div class="kpi-sub">dari target ${fmtRp(TARGETS[pi])}</div><div class="kpi-ico">💰</div></div>
      <div class="kpi-card kc1"><div class="kpi-lbl">Jumlah Produksi</div><div class="kpi-val">${s.totalProd.toLocaleString('id-ID')}</div><div class="kpi-sub">Kilogram (kg)</div><div class="kpi-ico">🐟</div></div>
      <div class="kpi-card kc2"><div class="kpi-lbl">Jumlah LPS Terbit</div><div class="kpi-val">${s.lps}</div><div class="kpi-sub">Lembar Perhitungan Sendiri</div><div class="kpi-ico">📋</div></div>
      <div class="kpi-card kc3"><div class="kpi-lbl">Jumlah Kapal Unik</div><div class="kpi-val">${s.ships.length}</div><div class="kpi-sub">Unit Kapal Aktif</div><div class="kpi-ico">🚢</div></div>
      <div class="kpi-card kc4"><div class="kpi-lbl">Prod. Rata-rata/Kapal</div><div class="kpi-val">${s.avg.toLocaleString('id-ID')}</div><div class="kpi-sub">kg per kapal masuk</div><div class="kpi-ico">📊</div></div>
      <div class="kpi-card kc5 ${wCls}"><div class="kpi-lbl">Persentase Realisasi</div><div class="kpi-val">${fmtPct(s.pct)}</div><div class="kpi-sub">vs target tahunan</div><div class="kpi-ico">🎯</div></div>
    </div>
    <div class="prog-card" style="margin-bottom:14px">
      <div class="prog-top">
        <div class="prog-title">🎯 Progres Capaian PNBP — Target ${fmtRp(TARGETS[pi])}</div>
        <div class="prog-pct">${fmtPct(s.pct)}</div>
      </div>
      <div class="prog-track"><div class="prog-fill ${pfCls}" id="pfdt-${pi}" style="width:0%"></div></div>
      <div class="prog-labels">
        <span class="real">Realisasi: ${fmtRp(s.totalNilai)}</span>
        <span>${kur > 0 ? 'Kurang: ' + fmtRp(kur) : '✅ Target Tercapai'}</span>
      </div>
    </div>
    ${insightHTML(pi)}
    <div class="charts-grid" style="margin-top:14px">
      <div class="section-card">
        <div class="section-title">📦 Produksi per Bulan (kg)</div>
        <div class="chart-wrap"><canvas id="dcp-${pi}"></canvas></div>
      </div>
      <div class="section-card">
        <div class="section-title">💵 Nilai PNBP per Bulan (Rp)</div>
        <div class="chart-wrap"><canvas id="dcn-${pi}"></canvas></div>
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">📅 Rekapitulasi per Bulan</div>
      <table>
        <thead><tr><th>Bulan</th><th>Jml LPS</th><th>Jml Kapal</th><th>Produksi (kg)</th><th>Nilai PNBP (Rp)</th><th>Avg Prod/Kapal</th></tr></thead>
        <tbody>
          ${monthRows}
          <tr class="tr-total">
            <td class="td-month">TOTAL</td>
            <td class="td-num">${s.lps}</td>
            <td class="td-num">${s.ships.length}</td>
            <td class="td-num">${s.totalProd.toLocaleString('id-ID')}</td>
            <td class="td-num">${fmtRp(s.totalNilai)}</td>
            <td class="td-num">${s.avg.toLocaleString('id-ID')}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="section-card">
      <div class="section-title" style="justify-content:space-between">
        <span>🗒 Data Transaksi (${s.lps} LPS)</span>
        <button class="btn btn-outline" style="padding:5px 11px;font-size:11px" onclick="exportCSV(${pi})">📤 Export CSV</button>
      </div>
      <div class="filter-bar">
        <span class="fl-label">🔍</span>
        <input class="fl-input" type="text" id="fl-search-${pi}" placeholder="Cari kapal, pemilik..." oninput="applyFilter(${pi})">
        <select class="fl-select" id="fl-bulan-${pi}" onchange="applyFilter(${pi})">
          <option value="">Semua Bulan</option>
          ${BULAN_ORDER.map(b=>`<option value="${b}">${b}</option>`).join('')}
        </select>
        <select class="fl-select" id="fl-ket-${pi}" onchange="applyFilter(${pi})">
          <option value="">Semua Status</option>
          <option value="LUNAS">LUNAS</option>
          <option value="KOREKSI">KOREKSI</option>
        </select>
        <button class="btn btn-outline" style="padding:6px 12px;font-size:11px" onclick="clearFilter(${pi})">✕ Reset</button>
        <span class="fl-count" id="fl-count-${pi}">${s.lps} data</span>
      </div>
      <table>
        <thead><tr><th>No</th><th>Bulan</th><th>Nama Kapal</th><th>Pemilik</th><th>Trip</th><th>Produksi (kg)</th><th>Nilai PNBP (Rp)</th><th>Ket</th><th></th></tr></thead>
        <tbody id="tx-tbody-${pi}"></tbody>
      </table>
    </div>
    <div class="section-card">
      <div class="section-title">⚓ Daftar Kapal Aktif (${s.ships.length} Unit)</div>
      <div class="ships-wrap">${s.ships.map(sh=>`<div class="ship-chip">${sh}</div>`).join('')}</div>
    </div>`;

  setTimeout(() => {
    const pf = document.getElementById('pfdt-'+pi); if (pf) pf.style.width = Math.min(s.pct,100) + '%';
  }, 200);

  applyFilter(pi);

  // Charts
  const cc = [{b:'rgba(26,111,212,.15)',bo:'#1a6fd4'},{b:'rgba(8,145,178,.15)',bo:'#0891b2'},{b:'rgba(79,70,229,.15)',bo:'#4f46e5'}][pi];

  // Plugin: tampilkan angka di atas setiap batang
  const barValuePlugin = {
    id:'barValue',
    afterDatasetsDraw(chart) {
      const c = chart.ctx;
      const ds = chart.data.datasets[0];
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        const val = ds.data[i];
        if (val == null || val === 0) return;
        const fmt = chart.options._isCur
          ? (val >= 1e6 ? (val/1e6).toFixed(1)+' Jt' : (val/1000).toFixed(0)+'rb')
          : (val >= 1000 ? (val/1000).toFixed(1)+'t' : val.toLocaleString('id-ID'));
        c.save();
        c.font = '700 10px "Plus Jakarta Sans",sans-serif';
        c.fillStyle = cc.bo;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillText(fmt, bar.x, bar.y - 4);
        c.restore();
      });
    }
  };

  const mkBar = (id, labels, data, isCur) => {
    const ctx = document.getElementById(id); if (!ctx) return;
    if (chartsMap[id]) chartsMap[id].destroy();
    chartsMap[id] = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{ data, backgroundColor:cc.b, borderColor:cc.bo, borderWidth:2, borderRadius:6, borderSkipped:false, hoverBackgroundColor:cc.bo+'99' }] },
      options:{ responsive:true, maintainAspectRatio:false, _isCur:isCur, layout:{padding:{top:20}},
        plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#fff', borderColor:cc.bo, borderWidth:1, titleColor:'#0f1f35', bodyColor:'#3a5070', padding:10,
          callbacks:{ label:ctx => isCur ? fmtRp(ctx.raw) : fmtKg(ctx.raw) } } },
        scales:{ x:{ grid:{display:false}, ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:10,weight:'600'}}, border:{color:'#e2eaf3'} },
          y:{ grid:{color:'#f0f4f8'}, ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:10}, callback:v=>isCur?(v/1e6).toFixed(1)+'Jt':(v/1000).toFixed(0)+'t'}, border:{color:'#e2eaf3'} } } },
      plugins:[barValuePlugin]
    });
  };
  mkBar('dcp-'+pi, s.sortedBulans, s.sortedBulans.map(b=>s.bulanMap[b].prod), false);
  mkBar('dcn-'+pi, s.sortedBulans, s.sortedBulans.map(b=>s.bulanMap[b].nilai), true);
}

// ════════════════════════════════════════
// FILTER
// ════════════════════════════════════════
function applyFilter(pi) {
  const search = (document.getElementById('fl-search-'+pi)?.value || '').toLowerCase();
  const bulan  = document.getElementById('fl-bulan-'+pi)?.value  || '';
  const ket    = (document.getElementById('fl-ket-'+pi)?.value   || '').toUpperCase();
  const s = getStats(pi);
  const filtered = s.rows.filter(r => {
    const mb = !bulan || r.bulan === bulan;
    const ms = !search || r.kapal.toLowerCase().includes(search) || r.pemilik.toLowerCase().includes(search) || r.ket.toLowerCase().includes(search);
    const mk = !ket || r.ket.toUpperCase().includes(ket);
    return mb && ms && mk;
  });
  const ct = document.getElementById('fl-count-'+pi);
  if (ct) ct.textContent = `${filtered.length} dari ${s.lps} data`;
  const tbody = document.getElementById('tx-tbody-'+pi); if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:28px">Tidak ada data yang sesuai filter</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((r, i) => {
    const rc = r.produksi === 0 ? 'tr-warn-zero' : r.ket.toUpperCase().includes('KOREKSI') ? 'tr-warn-kor' : '';
    return `<tr class="${rc}">
      <td class="td-num" style="color:var(--muted)">${i+1}</td>
      <td class="td-month">${r.bulan}</td>
      <td style="font-weight:600">${r.kapal}</td>
      <td>${r.pemilik}</td>
      <td class="td-num">${r.trip}</td>
      <td class="td-num">${r.produksi.toLocaleString('id-ID')}</td>
      <td class="td-num">${fmtRp(r.nilai)}</td>
      <td>${ketBadge(r.ket)}</td>
      <td><button class="btn-row-del" onclick="deleteRow(${pi},${appData.indexOf(r)})">🗑</button></td>
    </tr>`;
  }).join('');
}

function clearFilter(pi) {
  ['fl-search-','fl-bulan-','fl-ket-'].forEach(p => { const el = document.getElementById(p+pi); if(el) el.value = ''; });
  applyFilter(pi);
}

// ════════════════════════════════════════
// PERINGATAN SISTEM PAGE
// ════════════════════════════════════════
function buildWarningsPage() {
  const el = document.getElementById('warnings-body'); if (!el) return;
  if (!appData.length) { el.innerHTML = emptyStateHTML(''); return; }

  const allLvl = { danger:[], warn:[] };
  [0,1,2].forEach(pi => {
    getWarnings(pi).forEach(w => {
      allLvl[w.level].push({ port:PORT_NAMES[pi], portIdx:pi, text:w.text });
    });
  });

  let html = '';

  // KRITIS section
  html += `<div class="section-card" style="border-left:4px solid #dc2626">
    <div class="section-title" style="color:#991b1b"><span>🔴</span>Tingkat KRITIS (${allLvl.danger.length})</div>
    <div style="font-size:11px;color:#7a95b0;margin-bottom:10px">Peringatan dengan tingkat keparahan tertinggi. Butuh tindak lanjut segera.</div>`;
  if (allLvl.danger.length === 0) {
    html += `<div style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#065f46;font-size:12px">✅ Tidak ada peringatan kritis saat ini.</div>`;
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    allLvl.danger.forEach(w => {
      html += `<div style="padding:11px 14px;background:#fff5f5;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">🚨</span>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:#991b1b;margin-bottom:2px">${w.port}</div>
          <div style="font-size:12px;color:#7f1d1d">${w.text}</div>
        </div>
        <button class="btn btn-outline" style="padding:5px 11px;font-size:11px" onclick="showPage('port-${w.portIdx}')">🔍 Lihat Detail</button>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  // PERHATIAN section
  html += `<div class="section-card" style="border-left:4px solid #d97706">
    <div class="section-title" style="color:#92400e"><span>🟡</span>Tingkat PERHATIAN (${allLvl.warn.length})</div>
    <div style="font-size:11px;color:#7a95b0;margin-bottom:10px">Peringatan tingkat sedang. Perlu dipantau dan direncanakan tindak lanjutnya.</div>`;
  if (allLvl.warn.length === 0) {
    html += `<div style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#065f46;font-size:12px">✅ Tidak ada peringatan tingkat perhatian.</div>`;
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    allLvl.warn.forEach(w => {
      html += `<div style="padding:11px 14px;background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">⚠️</span>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:2px">${w.port}</div>
          <div style="font-size:12px;color:#78350f">${w.text}</div>
        </div>
        <button class="btn btn-outline" style="padding:5px 11px;font-size:11px" onclick="showPage('port-${w.portIdx}')">🔍 Lihat Detail</button>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  el.innerHTML = html;
}

function updateWarningBadge() {
  const el = document.getElementById('nb-warn'); if (!el) return;
  let cnt = 0;
  [0,1,2].forEach(pi => cnt += getWarnings(pi).length);
  el.textContent = cnt;
  el.style.background = cnt > 0 ? 'rgba(220,38,38,.3)' : 'rgba(255,255,255,.1)';
  el.style.color = cnt > 0 ? '#fca5a5' : '#8aabcc';
}

// ════════════════════════════════════════
// PROGRES CAPAIAN PAGE
// ════════════════════════════════════════
function buildProgressPage() {
  const el = document.getElementById('progress-body'); if (!el) return;
  if (!appData.length) { el.innerHTML = emptyStateHTML(''); return; }

  const t = getTotalStats();
  let html = '';

  // Total
  const tWCls = t.pct < 25 ? 'warn-danger' : t.pct < 50 ? 'warn-amber' : t.pct >= 80 ? 'warn-green' : '';
  const tPfCls = t.pct >= 75 ? 'pf-green' : t.pct >= 40 ? 'pf-0' : 'pf-amber';
  const tKur = t.totalTarget - t.totalNilai;
  const tStatus = t.pct < 25 ? {lbl:'KRITIS',c:'#dc2626'} : t.pct < 50 ? {lbl:'KURANG',c:'#d97706'} : t.pct < 75 ? {lbl:'SEDANG',c:'#2563eb'} : {lbl:'BAIK',c:'#059669'};

  html += `<div class="section-card" style="background:linear-gradient(135deg,#eff6ff 0%,#e8f0fb 100%);border:2px solid #bfdbfe">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div>
        <div class="section-title" style="margin-bottom:4px">📊 Progres Gabungan 3 Pelabuhan</div>
        <div style="font-size:11px;color:#3a5070">Agregat seluruh realisasi terhadap target total tahunan</div>
      </div>
      <span style="background:${tStatus.c};color:#fff;font-size:11px;font-weight:800;padding:5px 12px;border-radius:12px">${tStatus.lbl}</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px">
      <div style="font-size:32px;font-weight:800;color:#0f1f35">${fmtPct(t.pct)}</div>
      <div style="font-size:12px;color:#3a5070"><strong>${fmtRp(t.totalNilai)}</strong> dari ${fmtRp(t.totalTarget)}</div>
    </div>
    <div class="prog-track" style="height:12px"><div class="prog-fill ${tPfCls}" style="width:${Math.min(t.pct,100)}%"></div></div>
    <div class="prog-labels" style="margin-top:8px">
      <span class="real">Realisasi: ${fmtRp(t.totalNilai)}</span>
      <span>${tKur > 0 ? 'Kurang: ' + fmtRp(tKur) : '✅ Target Tercapai'}</span>
    </div>
  </div>`;

  // Per-pelabuhan
  html += `<div class="section-card">
    <div class="section-title"><span>🏢</span>Progres Per Pelabuhan</div>
    <div style="display:flex;flex-direction:column;gap:14px">`;

  [0,1,2].forEach(pi => {
    const s = getStats(pi);
    if (!s.rows.length) {
      html += `<div style="padding:14px;background:var(--card2);border:1px solid var(--border);border-radius:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:4px;height:30px;background:${PORT_COLORS[pi]};border-radius:2px"></div>
          <div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text)">${PORT_NAMES[pi]}</div>
          <div style="font-size:11px;color:var(--muted)">Belum ada data</div></div>
        </div>
      </div>`;
      return;
    }
    const pfCls = s.pct >= 75 ? 'pf-green' : s.pct >= 40 ? `pf-${pi}` : 'pf-amber';
    const kur = TARGETS[pi] - s.totalNilai;
    const st = s.pct < 25 ? {lbl:'KRITIS',c:'#dc2626'} : s.pct < 50 ? {lbl:'KURANG',c:'#d97706'} : s.pct < 75 ? {lbl:'SEDANG',c:'#2563eb'} : {lbl:'BAIK',c:'#059669'};

    html += `<div style="padding:14px 16px;border:1px solid var(--border);border-left:4px solid ${PORT_COLORS[pi]};border-radius:8px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${PORT_NAMES[pi]}</div>
        <span style="background:${st.c};color:#fff;font-size:10px;font-weight:700;padding:3px 9px;border-radius:10px">${st.lbl}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px">
        <div style="font-size:22px;font-weight:800;color:${PORT_COLORS[pi]}">${fmtPct(s.pct)}</div>
        <div style="font-size:11px;color:var(--text2)"><strong>${fmtRp(s.totalNilai)}</strong> dari ${fmtRp(TARGETS[pi])}</div>
      </div>
      <div class="prog-track"><div class="prog-fill ${pfCls}" style="width:${Math.min(s.pct,100)}%"></div></div>
      <div class="prog-labels" style="margin-top:6px">
        <span>LPS: <strong>${s.lps}</strong> · Kapal: <strong>${s.ships.length}</strong> · Produksi: <strong>${s.totalProd.toLocaleString('id-ID')} kg</strong></span>
        <span>${kur > 0 ? 'Kurang: ' + fmtRp(kur) : '✅ Tercapai'}</span>
      </div>
    </div>`;
  });

  html += `</div></div>`;

  // Forecast per pelabuhan
  html += `<div class="section-card">
    <div class="section-title"><span>🔮</span>Proyeksi Akhir Tahun</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Estimasi realisasi sampai Desember berdasarkan laju bulan aktif saat ini.</div>
    ${[0,1,2].map(pi => forecastHTML(pi)).join('')}
  </div>`;

  el.innerHTML = html;
}

// ════════════════════════════════════════
// INSIGHT OTOMATIS PAGE
// ════════════════════════════════════════
function buildInsightsPage() {
  const el = document.getElementById('insights-body'); if (!el) return;
  if (!appData.length) { el.innerHTML = emptyStateHTML(''); return; }

  let html = '';
  [0,1,2].forEach(pi => {
    const s = getStats(pi);
    const ins = getInsights(pi);
    html += `<div class="section-card" style="border-left:4px solid ${PORT_COLORS[pi]}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div class="section-title" style="margin:0">💡 ${PORT_NAMES[pi]}</div>
        </div>
        <button class="btn btn-outline" style="padding:5px 11px;font-size:11px" onclick="showPage('port-${pi}')">🔍 Lihat Detail</button>
      </div>`;

    if (!ins.length) {
      html += `<div style="padding:14px;color:var(--muted);font-size:12px">Belum ada data untuk menghasilkan insight.</div>`;
    } else {
      html += `<div class="insight-grid" style="grid-template-columns:repeat(3,1fr)">${ins.map(i => `
        <div class="insight-card ic-${i.type}">
          <div class="insight-icon">${i.icon}</div>
          <div><div class="insight-title">${i.title}</div><div class="insight-text">${i.text}</div></div>
        </div>`).join('')}</div>`;
    }
    html += `</div>`;
  });

  el.innerHTML = html;
}


// ════════════════════════════════════════
// COMPARISON
// ════════════════════════════════════════
function buildComparison() {
  const stats = [0,1,2].map(pi => getStats(pi));
  document.getElementById('cmp-cards').innerHTML = [0,1,2].map(pi => {
    const s = stats[pi];
    if (!s.rows.length) return `<div class="compare-card compare-card-${pi}">
      <div class="compare-port" style="color:${PORT_COLORS[pi]};font-weight:800">${PORT_NAMES[pi]}</div>
      <div style="padding:20px 0;text-align:center;color:var(--muted);font-size:11px">Belum ada data</div>
    </div>`;
    return `<div class="compare-card compare-card-${pi}">
      <div class="compare-port" style="color:${PORT_COLORS[pi]};font-weight:800">${PORT_NAMES[pi]}</div>
      <div class="compare-row"><span class="compare-label">Total Realisasi PNBP</span><span class="compare-value">${fmtRp(s.totalNilai)}</span></div>
      <div class="compare-row"><span class="compare-label">Target</span><span class="compare-value">${fmtRp(TARGETS[pi])}</span></div>
      <div class="compare-row"><span class="compare-label">Capaian</span><span class="compare-value" style="color:${PORT_COLORS[pi]}">${fmtPct(s.pct)}</span></div>
      <div class="compare-row"><span class="compare-label">Total Produksi</span><span class="compare-value">${s.totalProd.toLocaleString('id-ID')} kg</span></div>
      <div class="compare-row"><span class="compare-label">LPS Terbit</span><span class="compare-value">${s.lps}</span></div>
      <div class="compare-row"><span class="compare-label">Kapal Unik</span><span class="compare-value">${s.ships.length}</span></div>
      <div class="compare-row"><span class="compare-label">Prod. Rata-rata/Kapal</span><span class="compare-value">${s.avg.toLocaleString('id-ID')} kg</span></div>
    </div>`;
  }).join('');

  // Charts
  const mkChart = (id, config) => {
    if (chartsMap[id]) chartsMap[id].destroy();
    const ctx = document.getElementById(id); if (!ctx) return;
    chartsMap[id] = new Chart(ctx, config);
  };
  const tip = { backgroundColor:'#fff', borderColor:'#e2eaf3', borderWidth:1, titleColor:'#0f1f35', bodyColor:'#3a5070', padding:10 };

  // ── Custom plugin: tampilkan angka di atas bar (vertical)
  const barDataLabelPlugin = {
    id: 'barDataLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (val == null) return;
          const lbl = ds._labelFormat ? ds._labelFormat(val) : val.toLocaleString('id-ID');
          ctx.save();
          ctx.font = '700 10px "Plus Jakarta Sans",sans-serif';
          ctx.fillStyle = ds.borderColor && typeof ds.borderColor === 'string' ? ds.borderColor : '#0f1f35';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(lbl, bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    }
  };

  // ── Custom plugin: tampilkan angka di ujung bar (horizontal)
  const barDataLabelPluginH = {
    id: 'barDataLabelH',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (val == null) return;
          const lbl = ds._labelFormat ? ds._labelFormat(val) : val.toLocaleString('id-ID');
          ctx.save();
          ctx.font = '700 11px "Plus Jakarta Sans",sans-serif';
          ctx.fillStyle = '#0f1f35';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(lbl, bar.x + 6, bar.y);
          ctx.restore();
        });
      });
    }
  };

  // ── Custom plugin: tampilkan angka di slice donut
  const donutDataLabelPlugin = {
    id: 'donutDataLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const ds = chart.data.datasets[0];
      const meta = chart.getDatasetMeta(0);
      const total = ds.data.reduce((a,b) => a+b, 0);
      meta.data.forEach((arc, i) => {
        const val = ds.data[i];
        if (!val || !total) return;
        const pct = (val/total*100).toFixed(1);
        const pos = arc.tooltipPosition();
        ctx.save();
        ctx.font = '800 11px "Plus Jakarta Sans",sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,.3)';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const txt = val.toLocaleString('id-ID') + ' kg';
        ctx.strokeText(txt, pos.x, pos.y - 6);
        ctx.fillText(txt, pos.x, pos.y - 6);
        ctx.font = '700 10px "Plus Jakarta Sans",sans-serif';
        ctx.strokeText(pct + '%', pos.x, pos.y + 7);
        ctx.fillText(pct + '%', pos.x, pos.y + 7);
        ctx.restore();
      });
    }
  };

  // ── Custom plugin: tampilkan angka di titik line chart
  const lineDataLabelPlugin = {
    id: 'lineDataLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((point, i) => {
          const val = ds.data[i];
          if (val == null || val === 0) return;
          ctx.save();
          ctx.font = '700 9px "Plus Jakarta Sans",sans-serif';
          ctx.fillStyle = ds.borderColor;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const lbl = val >= 1000 ? (val/1000).toFixed(1) + 't' : val.toString();
          ctx.strokeText(lbl, point.x, point.y - 8);
          ctx.fillText(lbl, point.x, point.y - 8);
          ctx.restore();
        });
      });
    }
  };

  // PNBP vs Target bar chart — vertical
  mkChart('cmp-chart-pnbp', { type:'bar', data:{ labels:PORT_NAMES,
    datasets:[
      { label:'Realisasi PNBP', data:stats.map(s=>s.totalNilai), backgroundColor:PORT_COLORS.map(c=>c+'33'), borderColor:PORT_COLORS, borderWidth:2, borderRadius:6, borderSkipped:false, _labelFormat: v => 'Rp '+(v/1e6).toFixed(1)+'Jt' },
      { label:'Target', data:TARGETS, backgroundColor:'rgba(0,0,0,.04)', borderColor:'#94a3b8', borderWidth:2, borderRadius:6, borderSkipped:false, _labelFormat: v => 'Rp '+(v/1e6).toFixed(0)+'Jt' }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, layout:{padding:{top:22}}, plugins:{ legend:{labels:{font:{family:'Plus Jakarta Sans',size:11},color:'#3a5070'}}, tooltip:{...tip,callbacks:{label:ctx=>ctx.dataset.label+': '+fmtRp(ctx.raw)}} },
      scales:{ x:{grid:{display:false},ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:11,weight:'600'}}},
               y:{grid:{color:'#f0f4f8'},ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:10},callback:v=>(v/1e6).toFixed(0)+' Jt'},border:{color:'#e2eaf3'}} } },
    plugins: [barDataLabelPlugin] });

  // Produksi donut
  mkChart('cmp-chart-prod', { type:'doughnut', data:{ labels:PORT_NAMES,
    datasets:[{ data:stats.map(s=>s.totalProd), backgroundColor:PORT_COLORS.map(c=>c+'bb'), borderColor:PORT_COLORS, borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'bottom',labels:{font:{family:'Plus Jakarta Sans',size:11},color:'#3a5070',padding:12}},
      tooltip:{...tip,callbacks:{label:ctx=>ctx.label+': '+ctx.raw.toLocaleString('id-ID')+' kg'}} } },
    plugins: [donutDataLabelPlugin] });

  // LPS horizontal bar
  mkChart('cmp-chart-lps', { type:'bar', data:{ labels:PORT_NAMES,
    datasets:[{ data:stats.map(s=>s.lps), backgroundColor:PORT_COLORS.map(c=>c+'33'), borderColor:PORT_COLORS, borderWidth:2, borderRadius:6, borderSkipped:false, _labelFormat: v => v + ' LPS' }]},
    options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', layout:{padding:{right:60}},
      plugins:{ legend:{display:false}, tooltip:{...tip,callbacks:{label:ctx=>ctx.raw+' LPS'}} },
      scales:{ x:{grid:{color:'#f0f4f8'},ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:10}}},
               y:{grid:{display:false},ticks:{color:'#3a5070',font:{family:'Plus Jakarta Sans',size:11,weight:'600'}}} } },
    plugins: [barDataLabelPluginH] });

  // Line trend
  const allBulans = [...new Set(appData.map(d=>d.bulan))].sort((a,b)=>BULAN_ORDER.indexOf(a)-BULAN_ORDER.indexOf(b));
  mkChart('cmp-chart-trend', { type:'line',
    data:{ labels:allBulans, datasets:[0,1,2].map(pi => ({ label:PORT_NAMES[pi],
      data:allBulans.map(b=>stats[pi].bulanMap[b]?stats[pi].bulanMap[b].prod:0),
      borderColor:PORT_COLORS[pi], backgroundColor:PORT_COLORS[pi]+'22', borderWidth:2,
      pointRadius:5, pointBackgroundColor:PORT_COLORS[pi], fill:false, tension:.35 })) },
    options:{ responsive:true, maintainAspectRatio:false, layout:{padding:{top:18}},
      plugins:{ legend:{labels:{font:{family:'Plus Jakarta Sans',size:11},color:'#3a5070'}},
        tooltip:{...tip,mode:'index',intersect:false,callbacks:{label:ctx=>ctx.dataset.label+': '+ctx.raw.toLocaleString('id-ID')+' kg'}} },
      scales:{ x:{grid:{display:false},ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:11,weight:'600'}}},
               y:{grid:{color:'#f0f4f8'},ticks:{color:'#7a95b0',font:{family:'Plus Jakarta Sans',size:10},callback:v=>(v/1000).toFixed(0)+'t'},border:{color:'#e2eaf3'}} } },
    plugins: [lineDataLabelPlugin] });
}

// ════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════
function buildExportPreview() {
  const tbody = document.getElementById('export-preview'); if (!tbody) return;
  tbody.innerHTML = appData.map((r,i) => `<tr>
    <td class="td-num" style="color:var(--muted)">${i+1}</td>
    <td style="font-size:11px;font-weight:600;color:${PORT_COLORS[r.port]}">${PORT_NAMES[r.port]}</td>
    <td class="td-month">${r.bulan}</td>
    <td style="font-weight:600">${r.kapal}</td>
    <td>${r.pemilik}</td>
    <td class="td-num">${r.trip}</td>
    <td class="td-num">${r.produksi.toLocaleString('id-ID')}</td>
    <td class="td-num">${fmtRp(r.nilai)}</td>
    <td>${ketBadge(r.ket)}</td>
  </tr>`).join('');
}

function exportCSV(pi) {
  const rows = appData.filter(d=>d.port===pi);
  const hdr = 'No,Pelabuhan,Bulan,Nama Kapal,Pemilik,Trip (Hari),Produksi (kg),Nilai PNBP (Rp),Keterangan';
  const body = rows.map((r,i)=>[i+1,PORT_NAMES[r.port],r.bulan,r.kapal,r.pemilik,r.trip,r.produksi,r.nilai,r.ket].join(',')).join('\n');
  dlFile(hdr+'\n'+body, `data_${PORT_NAMES[pi].replace(/\s/g,'_')}.csv`, 'text/csv');
  showToast('#059669', 'CSV berhasil diunduh');
}
function exportCSVAll() {
  const hdr = 'No,Pelabuhan,Bulan,Nama Kapal,Pemilik,Trip (Hari),Produksi (kg),Nilai PNBP (Rp),Keterangan';
  const body = appData.map((r,i)=>[i+1,PORT_NAMES[r.port],r.bulan,r.kapal,r.pemilik,r.trip,r.produksi,r.nilai,r.ket].join(',')).join('\n');
  dlFile(hdr+'\n'+body, 'data_semua_pelabuhan.csv', 'text/csv');
  showToast('#059669', 'CSV semua pelabuhan diunduh');
}
function exportJSON() {
  dlFile(JSON.stringify(appData.map((r,i)=>({no:i+1,pelabuhan:PORT_NAMES[r.port],...r})),null,2), 'data_pnbp.json', 'application/json');
  showToast('#059669', 'JSON berhasil diunduh');
}
function dlFile(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = filename; a.click();
}

// ════════════════════════════════════════
// IMPORT — EXCEL (SheetJS multi-sheet)
// ════════════════════════════════════════
function mapPortFromSheet(name) {
  const n = name.toUpperCase().trim();
  // Prioritas: gunakan kode dari CONFIG (data.json) agar bisa dikustomisasi
  if (CONFIG && CONFIG.pelabuhan) {
    for (const p of CONFIG.pelabuhan) {
      if (n.includes(p.kode.toUpperCase())) return p.id;
      const nm = p.nama.toUpperCase().replace('PP.','').trim();
      if (n.includes(nm)) return p.id;
    }
  }
  // Fallback hardcode
  if (n.includes('KAKAP') || n.includes('SUNGAI')) return 0;
  if (n.includes('SUKABANGUN'))                     return 1;
  if (n.includes('JELAI') || n.includes('KUALA'))   return 2;
  return -1;
}

function normBulan(v) {
  if (!v) return 'JANUARI';
  const u = String(v).toUpperCase().trim();
  return BULAN_ORDER.includes(u) ? u : 'JANUARI';
}

// Parse one sheet's rows into data records.
// Indeks kolom dibaca dari KOLOM (data.json). Default: format Excel DOPK.
function parseSheetRows(rows, portIdx) {
  const iNo  = KOLOM.no       ?? 0;
  const iBul = KOLOM.bulan    ?? 1;
  const iKpl = KOLOM.kapal    ?? 3;
  const iPml = KOLOM.pemilik  ?? 7;
  const iTrp = KOLOM.trip     ?? 13;
  const iPrd = KOLOM.produksi ?? 14;
  const iNil = KOLOM.nilai    ?? 17;
  const iKet = KOLOM.ket      ?? 18;

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const no = r[iNo];
    if (typeof no !== 'number' || !isFinite(no)) continue;
    const nilai = parseFloat(r[iNil]) || 0;
    if (nilai <= 0) continue;
    records.push({
      port:     portIdx,
      bulan:    normBulan(r[iBul]),
      kapal:    String(r[iKpl] || '').trim(),
      pemilik:  String(r[iPml] || '-').trim(),
      trip:     parseFloat(r[iTrp]) || 0,
      produksi: parseFloat(r[iPrd]) || 0,
      nilai:    nilai,
      ket:      String(r[iKet] || 'LUNAS').trim(),
    });
  }
  return records;
}

function handleFileInput(e) {
  const file = e.target.files[0]; if (!file) return;
  readExcelFile(file);
}

function readExcelFile(file) {
  if (typeof XLSX === 'undefined') { showToast('#dc2626', 'Library XLSX belum siap, coba lagi'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:false });
      processWorkbook(wb, file.name);
    } catch(err) {
      showToast('#dc2626', 'Gagal membaca file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function processWorkbook(wb, filename) {
  pendingRows = [];
  const summary = [];
  let unmatched = [];

  wb.SheetNames.forEach(shName => {
    const portIdx = mapPortFromSheet(shName);
    if (portIdx < 0) { unmatched.push(shName); return; }
    const ws = wb.Sheets[shName];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    const recs = parseSheetRows(rows, portIdx);
    pendingRows.push(...recs);
    summary.push({ sheet:shName, port:PORT_NAMES[portIdx], count:recs.length });
  });

  if (!pendingRows.length) {
    showToast('#d97706', 'Tidak ada data valid yang ditemukan. Pastikan format sesuai DOPK.');
    return;
  }

  // Show preview (first 8 rows)
  const preview8 = pendingRows.slice(0, 8);
  document.getElementById('import-preview-table').innerHTML =
    `<thead><tr><th>Pelabuhan</th><th>Bulan</th><th>Nama Kapal</th><th>Pemilik</th><th>Produksi (kg)</th><th>Nilai PNBP (Rp)</th><th>Ket</th></tr></thead>
     <tbody>${preview8.map(r=>`<tr>
       <td style="font-weight:600;color:${PORT_COLORS[r.port]}">${PORT_NAMES[r.port]}</td>
       <td>${r.bulan}</td><td>${r.kapal}</td><td>${r.pemilik}</td>
       <td class="td-num">${r.produksi.toLocaleString('id-ID')}</td>
       <td class="td-num">${fmtRp(r.nilai)}</td>
       <td>${ketBadge(r.ket)}</td>
     </tr>`).join('')}</tbody>`;

  document.getElementById('import-count-text').textContent = `${pendingRows.length} baris valid`;
  document.getElementById('import-preview-wrap').style.display = 'block';

  let sumHTML = summary.map(s => `<strong>${s.sheet}</strong> → ${s.port}: <strong>${s.count}</strong> baris`).join(' &nbsp;|&nbsp; ');
  if (unmatched.length) sumHTML += `<br>⚠️ Sheet tidak dikenali: ${unmatched.join(', ')}`;
  document.getElementById('import-sheet-summary').innerHTML = '📋 ' + sumHTML;

  document.getElementById('import-btn-count').textContent = pendingRows.length;
  document.getElementById('btn-execute-import').style.display = 'inline-flex';
  document.getElementById('import-footer-info').textContent = `Dari: ${filename}`;
}

// ════════════════════════════════════════
// IMPORT — GOOGLE SHEETS
// ════════════════════════════════════════
async function fetchGoogleSheet() {
  const url = document.getElementById('gs-url').value.trim();
  if (!url) { showToast('#d97706', 'Masukkan URL Google Sheets'); return; }
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) { showToast('#dc2626', 'URL tidak valid'); return; }
  const sheetId = match[1];
  const gidM = url.match(/[#&?]gid=(\d+)/);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gidM?gidM[1]:'0'}`;
  const st = document.getElementById('gs-status');
  st.className = 'gs-status loading'; st.textContent = '⏳ Memuat data...';
  try {
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    if (text.includes('<html') || text.length < 20) throw new Error('Bukan CSV valid. Pastikan sheet dipublikasikan.');
    const rows = parseCSV(text);
    const pi = parseInt(document.getElementById('gs-port-select').value);
    const recs = parseSheetRows(rows, pi);
    if (!recs.length) throw new Error('Tidak ada baris valid ditemukan');
    pendingRows = recs;
    st.className = 'gs-status success'; st.textContent = `✅ ${recs.length} baris ditemukan dari Google Sheets`;
    document.getElementById('gs-count-text').textContent = recs.length + ' baris';
    document.getElementById('gs-preview-table').innerHTML =
      `<thead><tr><th>Bulan</th><th>Nama Kapal</th><th>Pemilik</th><th>Produksi (kg)</th><th>Nilai PNBP (Rp)</th></tr></thead>
       <tbody>${recs.slice(0,8).map(r=>`<tr><td>${r.bulan}</td><td>${r.kapal}</td><td>${r.pemilik}</td>
         <td class="td-num">${r.produksi.toLocaleString('id-ID')}</td><td class="td-num">${fmtRp(r.nilai)}</td>
       </tr>`).join('')}</tbody>`;
    document.getElementById('gs-preview-wrap').style.display = 'block';
    document.getElementById('import-btn-count').textContent = recs.length;
    document.getElementById('btn-execute-import').style.display = 'inline-flex';
  } catch(err) {
    st.className = 'gs-status error'; st.textContent = '❌ ' + err.message;
  }
}

function parseCSV(text) {
  return text.split(/\r?\n/).filter(l=>l.trim()).map(l => {
    const cells=[]; let cur=''; let inQ=false;
    for (const c of l) { if(c==='"') inQ=!inQ; else if(c===','&&!inQ){cells.push(cur.trim());cur='';} else cur+=c; }
    cells.push(cur.trim()); return cells;
  });
}

// ════════════════════════════════════════
// EXECUTE IMPORT
// ════════════════════════════════════════
function setImportMode(mode) {
  importMode = mode;
  document.getElementById('im-btn-append').classList.toggle('selected', mode === 'append');
  document.getElementById('im-btn-replace').classList.toggle('selected', mode === 'replace');
}

function executeImport() {
  if (!pendingRows.length) { showToast('#d97706', 'Tidak ada data untuk diimport'); return; }
  const count = pendingRows.length;
  if (importMode === 'replace') {
    appData = [...pendingRows];
  } else {
    appData.push(...pendingRows);
  }
  pendingRows = [];
  saveData(); // Simpan ke localStorage
  closeModal('modal-import');
  refreshAll();
  if (currentPage.startsWith('port-')) buildDetail(parseInt(currentPage.replace('port-','')));
  if (currentPage === 'compare') buildComparison();
  if (currentPage === 'export') buildExportPreview();
  showToast('#059669', `✅ ${importMode==='replace'?'Data diganti':'Ditambahkan'}: ${count} baris berhasil diimport!`);
}

// ════════════════════════════════════════
// MODAL & NAV
// ════════════════════════════════════════
function openImportModal() {
  pendingRows = [];
  document.getElementById('import-preview-wrap').style.display = 'none';
  document.getElementById('btn-execute-import').style.display = 'none';
  document.getElementById('import-footer-info').textContent = '';
  document.getElementById('import-sheet-summary').textContent = '';
  document.getElementById('import-count-text').textContent = '';
  document.getElementById('gs-preview-wrap').style.display = 'none';
  document.getElementById('gs-status').className = 'gs-status';
  document.getElementById('gs-status').textContent = '';
  document.getElementById('file-input').value = '';
  setImportMode('append');
  switchTab('excel');
  document.getElementById('modal-import').classList.add('open');
}

function switchTab(tab) {
  ['excel','gsheets'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === tab);
    document.getElementById('tab-btn-'+t).classList.toggle('active', t === tab);
  });
}

function openConfirmClear() { document.getElementById('modal-confirm').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function clearAllData() {
  appData = []; // Reset ke kosong
  saveData();   // Hapus dari localStorage
  closeModal('modal-confirm');
  refreshAll();
  if (currentPage.startsWith('port-')) buildDetail(parseInt(currentPage.replace('port-','')));
  if (currentPage === 'compare') buildComparison();
  if (currentPage === 'export') buildExportPreview();
  showToast('#dc2626', 'Semua data berhasil dihapus');
}

function deleteRow(pi, idx) {
  if (!confirm('Hapus baris data ini?')) return;
  appData.splice(idx, 1);
  saveData();
  refreshAll();
  buildDetail(pi);
  showToast('#dc2626', 'Data dihapus');
}

function refreshAll() {
  renderOverview();
  [0,1,2].forEach(pi => updateBadge(pi));
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  navIds.forEach(n => {
    const el = document.getElementById('nav-'+n); if (!el) return;
    el.className = 'sb-item';
    if (n === id) {
      if (n === 'port-1') el.classList.add('act1');
      else if (n === 'port-2') el.classList.add('act2');
      else el.classList.add('active');
    }
  });
  currentPage = id;
  if (id.startsWith('port-')) buildDetail(parseInt(id.replace('port-','')));
  if (id === 'compare') buildComparison();
  if (id === 'export') buildExportPreview();
  if (id === 'warnings') buildWarningsPage();
  if (id === 'progress') buildProgressPage();
  if (id === 'insights') buildInsightsPage();
}

// ════════════════════════════════════════
// EXPORT INFOGRAFIS PDF
// ════════════════════════════════════════
function exportInfografis() {
  if (!appData.length) {
    showToast('#d97706', 'Belum ada data. Import data Excel terlebih dahulu.');
    return;
  }

  const now       = new Date();
  const dateStr   = now.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
  const dateDay   = now.toLocaleDateString('id-ID', { day:'numeric' });
  const dateMon   = now.toLocaleDateString('id-ID', { month:'long' });
  const dateYear  = now.getFullYear();
  const dateUpper = dateStr.toUpperCase();

  // ── Config dari data.json (atau fallback)
  const unitName  = (CONFIG && CONFIG.app && CONFIG.app.unit)        || 'PPP TELUK BATANG & PELABUHAN BINAAN';
  const dirText   = (CONFIG && CONFIG.app && CONFIG.app.direktorat)  || 'DIREKTORAT JENDERAL PERIKANAN';
  const instText  = (CONFIG && CONFIG.app && CONFIG.app.kementerian) || 'KEMENTERIAN KELAUTAN DAN PERIKANAN';
  const subInstText = (CONFIG && CONFIG.app && CONFIG.app.upt)       || 'PELABUHAN PERIKANAN PANTAI TELUK BATANG';

  // ── Statistik
  function pStat(pi) {
    const rows = appData.filter(d => d.port === pi);
    const totalProd  = rows.reduce((a,r) => a + r.produksi, 0);
    const totalNilai = rows.reduce((a,r) => a + r.nilai, 0);
    const ships = [...new Set(rows.map(r => r.kapal))].length;
    const avg   = rows.length ? Math.round(totalProd / rows.length) : 0;
    const pct   = TARGETS[pi] > 0 ? totalNilai / TARGETS[pi] * 100 : 0;
    return { totalProd, totalNilai, ships, lps: rows.length, avg, pct };
  }
  const ps         = [0,1,2].map(pi => pStat(pi));
  const totalNilai = ps.reduce((a,s) => a + s.totalNilai, 0);
  const totalProd  = ps.reduce((a,s) => a + s.totalProd,  0);
  const totalLps   = ps.reduce((a,s) => a + s.lps,        0);
  const allShips   = ps.reduce((a,s) => a + s.ships,       0);
  const totalAvg   = totalLps ? Math.round(totalProd / totalLps) : 0;
  const totalTarget= TARGETS.reduce((a,b) => a+b, 0);
  const totalPct   = totalTarget ? totalNilai / totalTarget * 100 : 0;

  // ── Helpers
  const R  = n  => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID');
  const P  = n  => n.toFixed(2).replace('.',',') + '%';
  const KC = p  => p < 25 ? '#f59e0b' : p < 50 ? '#d97706' : p < 75 ? '#2563eb' : '#059669';

  // ── Chart data JSON
  const cd = JSON.stringify({
    produksi: ps.map(s => s.totalProd),
    realisasi: ps.map(s => s.totalNilai),
    targets: TARGETS,
    lps: ps.map(s => s.lps),
    colors: PORT_COLORS,
    names: PORT_NAMES,
  });

  // ════════════════════════════════════════
  // SVG aset inline (agar tidak perlu fetch)
  // ════════════════════════════════════════

  // Logo KKP — lingkaran garuda (SVG inline)
  const logoKKP = `<img src="assets/logo-kkp.png" alt="Logo KKP" width="50" height="50" style="vertical-align:middle;">`;
  const logoBerAKHLAK = `<img src="assets/berakhlaK.png" width="110" style="display:block;">`;
  const logoPPP = `<img src="assets/logo-ppp.svg" width="100" style="display:block;">`;
  const logoGEM = `<img src="assets/gemarikan.svg" width="100" style="display:block;">`;
  h += '<div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;width:100%;padding-right:20px;">';

  // ════════════════════════════════════════
  // CSS
  // ════════════════════════════════════════
  var css = '@page{size:A4 portrait;margin:0}';
  css += '*{margin:0;padding:0;box-sizing:border-box}';
  css += 'body{font-family:"Plus Jakarta Sans",Arial,sans-serif;width:794px;min-height:1123px;margin:0 auto;background:#fff;font-size:11px}';
  css += '@media print{.np{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';

  // ════════════════════════════════════════
  // HTML BUILD
  // ════════════════════════════════════════
  var h = '';
  h += '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">';
  h += '<title>Infografis PNBP Pascaproduksi \u2014 ' + dateStr + '</title>';
  h += '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">';
  h += '<style>' + css + '</style></head><body>';

  // ── Print action bar (tidak tercetak)
  h += '<div class="np" style="background:#0d1b2e;padding:10px 20px;display:flex;gap:10px;align-items:center;position:sticky;top:0;z-index:99;border-bottom:2px solid #1a6fd4">';
  h += '<span style="color:#fff;font-size:12px;font-weight:600;flex:1">📄 Infografis PNBP Pascaproduksi — ' + dateStr + '</span>';
  h += '<button onclick="window.print()" style="background:#1a6fd4;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px">🖨️ Cetak / Simpan PDF</button>';
  h += '<button onclick="window.close()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:8px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px">✕ Tutup</button>';
  h += '</div>';

  h += '<div id="ig" style="width:794px;background:#fff">';

  // ══════════════════════════════════════════════
  // HEADER — Baris 1: Logo + Kementerian | Branding | SDG
  // ══════════════════════════════════════════════
  h += '<div style="background:#fff;padding:12px 20px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2eaf3">';

  // Kiri: Logo KKP + Nama Kementerian
  h += '<div style="display:flex;align-items:center;">';
  h += '<img src="assets/logo-kkp2.svg" height="60" style="display:block;">';
  h += '</div>';

  // RATA KE KANAN
  h += '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;width:100%;padding-right:5px;">';

  h += '<img src="assets/kkp2026.png" width="80" style="display:block;">';
  h += '<img src="assets/ekonomi-biru.svg" width="100" style="display:block;">';
  h += '<img src="assets/pangan-biru.svg" width="90" style="display:block;">';
  h += '<img src="assets/sdg-08.svg" width="50" style="display:block;">';

  h += '</div>';

  h += '</div>';   // end header bar 1

  // ══════════════════════════════════════════════
  // HERO — Judul besar + grafik kapal + PPP
  // ══════════════════════════════════════════════
  h += '<div style="display:flex;min-height:130px">';

  // Kiri: Judul
  h += '<div style="flex:1;padding:16px 18px;background:linear-gradient(135deg,#f8faff 50%,#e8f0fb 100%);display:flex;flex-direction:column;justify-content:center">';
  h += '<div style="font-size:25px;font-weight:900;color:#0d1b2e;line-height:1.15;letter-spacing:-.3px">INFOGRAFIS PERKEMBANGAN</div>';
  h += '<div style="font-size:25px;font-weight:900;color:#0d1b2e;line-height:1.15;letter-spacing:-.3px">CAPAIAN PNBP PASCAPRODUKSI</div>';
  h += '<div style="font-size:20px;font-weight:800;color:#1a6fd4;margin-top:6px;letter-spacing:.4px">PER ' + dateUpper + '</div>';
  h += '</div>';

  // Kanan: Gambar1.png (mengganti gradien biru + kapal emoji)
  h += '<div style="width:250px;flex-shrink:0;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;">';

  // Gambar pengganti (gambar1.png)
  h += '<img src="assets/gambar1.png" style="width:100%; height:100%; object-fit:cover; border-radius:5px;">';
  h += '</div>';
  h += '</div>'; // end hero

  // ── Sub-header: PPP info + legend pelabuhan
  h += '<div style="background:#f8fafc;border-top:1px solid #e2eaf300;border-bottom:3px solid #038ffb;padding:7px 16px;display:flex;align-items:center;justify-content:space-between">';
  h += '<div style="font-size:15px;font-weight:700;color:#3a5070;display:flex;align-items:center;gap:6px">';
  h += '<span>🏛</span><span>' + unitName + '</span>';
  h += '</div>';
  // Legend pelabuhan
  h += '<div style="display:flex;gap:14px">';
  [0, 1, 2].forEach((pi) => {
    h += '<div style="display:flex;align-items:center;gap:5px">';
    h += '<div style="width:10px;height:10px;border-radius:50%;background:' + PORT_COLORS[pi] + '"></div>';
    h += '<span style="font-size:9px;font-weight:600;color:#3a5070">' + PORT_NAMES[pi] + '</span>';
    h += '</div>';
  });
  h += '</div></div>';

  // ══════════════════════════════════════════════
  // CAPAIAN TOTAL — Section header
  // ══════════════════════════════════════════════
  h += '<div style="background:#0d1b2e;color:#fff;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;padding:7px 16px">CAPAIAN TOTAL</div>';

  // ── 6 KPI Cards
  h += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px 14px;background:#f0f4f8">';
  const kpiDefs = [
    { lbl:'TOTAL REALISASI PNBP',     val:R(totalNilai),               sub:'dari target ' + R(totalTarget), ico:'💰', bg:'#1a6fd4', pct:totalPct },
    { lbl:'JUMLAH PRODUKSI',           val:totalProd.toLocaleString('id-ID'), sub:'Kilogram (kg)',            ico:'🐟', bg:'#059669', pct:-1 },
    { lbl:'JUMLAH LPS TERBIT',         val:''+totalLps,                 sub:'Lembar Perhitungan Sendiri',         ico:'📋', bg:'#0891b2', pct:-1 },
    { lbl:'JUMLAH KAPAL AKTIF',        val:''+allShips,                 sub:'Unit Kapal Aktif (3 pelabuhan)', ico:'🚢', bg:'#d97706', pct:-1 },
    { lbl:'PRODUKSI RATA-RATA/KAPAL',  val:totalAvg.toLocaleString('id-ID'), sub:'kg per kapal masuk (' + totalLps + ' LPS)', ico:'📊', bg:'#4f46e5', pct:-1 },
    { lbl:'PERSENTASE REALISASI',       val:P(totalPct),                 sub:'vs target tahunan',              ico:'🎯', bg:KC(totalPct), pct:totalPct },
  ];
  kpiDefs.forEach(k => {
    const badge = k.pct >= 0 && k.pct < 75
      ? '<div style="position:absolute;top:4px;right:4px;background:' + KC(k.pct) + ';color:#fff;font-size:6px;font-weight:800;padding:1px 5px;border-radius:3px">' + (k.pct<25?'KRITIS':k.pct<50?'KURANG':'SEDANG') + '</div>'
      : '';
    h += '<div style="background:#fff;border:1px solid #e2eaf3;border-radius:8px;padding:10px 8px;position:relative;overflow:hidden">';
    h += '<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:' + k.bg + '"></div>';
    h += badge;
    h += '<div style="width:28px;height:28px;background:' + k.bg + ';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;margin-bottom:6px">' + k.ico + '</div>';
    h += '<div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#7a95b0;margin-bottom:3px;line-height:1.3">' + k.lbl + '</div>';
    h += '<div style="font-size:' + (k.val.length > 14 ? '10' : '15') + 'px;font-weight:800;color:#0f1f35;line-height:1">' + k.val + '</div>';
    h += '<div style="font-size:7px;color:#7a95b0;margin-top:3px;line-height:1.3">' + k.sub + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // ══════════════════════════════════════════════
  // KINERJA PER PELABUHAN
  // ══════════════════════════════════════════════
  h += '<div style="background:#0d1b2e;color:#fff;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;padding:7px 16px">KINERJA PER PELABUHAN</div>';
  h += '<div style="display:flex;gap:8px;padding:10px 14px;background:#f8fafc">';

  [0,1,2].forEach(pi => {
    const s  = ps[pi];
    const pc = PORT_COLORS[pi];

    // Grid 3x2 untuk KPI kartu
    const gridItems = [
      { l:'TOTAL REALISASI PNBP', v:R(s.totalNilai), s:'dari target ' + R(TARGETS[pi]), sm:true },
      { l:'JUMLAH PRODUKSI',       v:s.totalProd.toLocaleString('id-ID'), s:'Kilogram (kg)', sm:false },
      { l:'JUMLAH LPS TERBIT',     v:''+s.lps,         s:'Lembar', sm:false },
      { l:'JUMLAH KAPAL AKTIF',    v:''+s.ships,        s:'Unit Kapal Aktif', sm:false },
      { l:'PRODUKSI RATA-RATA/KAPAL', v:s.avg.toLocaleString('id-ID')+' kg', s:'('+s.lps+' LPS)', sm:true },
      { l:'PERSENTASE REALISASI',  v:P(s.pct),         s:'vs target tahunan', sm:false },
    ];

    h += '<div style="flex:1;border:2px solid ' + pc + ';border-radius:8px;overflow:hidden;background:#fff">';
    // Card header
    h += '<div style="background:' + pc + ';color:#fff;padding:8px 10px;display:flex;align-items:center;gap:6px">';
    h += '<span style="font-size:14px">🚢</span>';
    h += '<span style="font-size:10px;font-weight:800;letter-spacing:.3px">' + PORT_NAMES[pi].toUpperCase() + '</span>';
    h += '</div>';
    // Grid KPI
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:7px">';
    gridItems.forEach(item => {
      h += '<div style="border:1px solid #e2eaf3;border-radius:5px;padding:6px 7px">';
      h += '<div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7a95b0;margin-bottom:2px;line-height:1.3">' + item.l + '</div>';
      h += '<div style="font-size:' + (item.sm?'9':'14') + 'px;font-weight:800;color:#0f1f35;line-height:1">' + item.v + '</div>';
      h += '<div style="font-size:7px;color:#7a95b0;margin-top:2px">' + item.s + '</div>';
      h += '</div>';
    });
    h += '</div>';
    h += '</div>';
  });
  h += '</div>';

  // ══════════════════════════════════════════════
  // CHARTS ROW — Donut (kiri) + Bar PNBP (kanan)
  // ══════════════════════════════════════════════
  h += '<div style="display:flex;gap:0;border-top:1px solid #e2eaf3">';

  // Donut
  h += '<div style="flex:0 0 42%;padding:10px 12px;border-right:1px solid #e2eaf3;background:#fff">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7a95b0;margin-bottom:6px">TOTAL PRODUKSI PER PELABUHAN (KG)</div>';
  h += '<div style="height:185px;position:relative"><canvas id="c-donut"></canvas></div>';
  h += '</div>';

  // Bar PNBP vs Target
  h += '<div style="flex:1;padding:10px 12px;background:#fff">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7a95b0;margin-bottom:6px">REALISASI PNBP VS TARGET</div>';
  h += '<div style="height:185px;position:relative"><canvas id="c-bar"></canvas></div>';
  h += '</div>';
  h += '</div>';

  // ── LPS horizontal bar (full width)
  h += '<div style="padding:10px 12px;border-top:1px solid #e2eaf3;background:#fff">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7a95b0;margin-bottom:6px">JUMLAH LPS PER PELABUHAN</div>';
  h += '<div style="height:90px;position:relative"><canvas id="c-lps"></canvas></div>';
  h += '</div>';

  // ══════════════════════════════════════════════
  // FOOTER — Sesuai Template PDF
  // ══════════════════════════════════════════════

  // Footer utama: 3 kolom
  h += '<div style="background:#fff;border-top:2px solid #1a6fd4;padding:12px 16px;display:flex;align-items:center;gap:16px">';

  // ── Kolom Kiri: Logo KKP + Teks Institusi
  h += '<div style="display:flex;align-items:center;gap:10px;flex:1">';
  h += logoKKP;
  h += '<div style="line-height:1.35">';
  h += '<div style="font-size:9px;font-weight:800;color:#0f1f35;letter-spacing:.2px">' + instText + '</div>';
  h += '<div style="font-size:10px;font-weight:900;color:#0d1b2e;letter-spacing:.2px">' + dirText + '</div>';
  h += '<div style="font-size:8px;font-weight:700;color:#3a5070;letter-spacing:.2px">' + subInstText + '</div>';
  h += '</div></div>';

  // ── Kolom Tengah: PPP Teluk Batang + GEMARIKAN
  h += '<div style="display:flex;align-items:center;gap:10px;justify-content:center;flex-shrink:0">';
  h += logoPPP;
  h += logoGEM;
  h += '</div>';

  // ── Kolom Kanan: BerAKHLAK
  h += '<div style="display:flex;align-items:center;justify-content:flex-end;flex-shrink:0">';
  h += logoBerAKHLAK;
  h += '</div>';

  h += '</div>'; // end footer utama

  // Footer bawah: strip gelap dengan tanggal
  h += '<div style="background:#0a1628;padding:8px 16px;display:flex;justify-content:space-between;align-items:center">';
  h += '<div style="font-size:9px;font-weight:600;color:#8aabcc;display:flex;align-items:center;gap:5px">';
  h += '<span>📅</span><span>Data per ' + dateStr + '</span>';
  h += '</div>';
  h += '<div style="font-size:9px;color:#8aabcc">Monitoring Realisasi PNBP Pascaproduksi · KKP ' + dateYear + '</div>';
  h += '</div>';

  h += '</div>'; // #ig

  // ══════════════════════════════════════════════
  // CHART SCRIPTS
  // ══════════════════════════════════════════════
  h += '<script>';
  h += 'var _d=' + cd + ';';
  h += 'function initCharts(){';
  h += '  if(typeof Chart==="undefined"){setTimeout(initCharts,80);return;}';
  h += '  var fn={family:"Plus Jakarta Sans",size:10};';
  h += '  var tp={backgroundColor:"#fff",borderColor:"#e2eaf3",borderWidth:1,titleColor:"#0f1f35",bodyColor:"#3a5070",padding:8};';

  // Plugin: label di donut slice
  h += '  var donutLabel={id:"donutLabel",afterDatasetsDraw:function(chart){';
  h += '    var ctx=chart.ctx;var ds=chart.data.datasets[0];var meta=chart.getDatasetMeta(0);';
  h += '    var total=ds.data.reduce(function(a,b){return a+b},0);';
  h += '    meta.data.forEach(function(arc,i){';
  h += '      var val=ds.data[i];if(!val||!total)return;';
  h += '      var pct=(val/total*100).toFixed(1);';
  h += '      var pos=arc.tooltipPosition();';
  h += '      ctx.save();';
  h += '      ctx.font="800 10px Plus Jakarta Sans,sans-serif";';
  h += '      ctx.fillStyle="#fff";ctx.strokeStyle="rgba(0,0,0,.5)";ctx.lineWidth=3;';
  h += '      ctx.textAlign="center";ctx.textBaseline="middle";';
  h += '      var txt=val.toLocaleString("id-ID")+" kg";';
  h += '      ctx.strokeText(txt,pos.x,pos.y-6);ctx.fillText(txt,pos.x,pos.y-6);';
  h += '      ctx.font="700 9px Plus Jakarta Sans,sans-serif";';
  h += '      ctx.strokeText(pct+"%",pos.x,pos.y+7);ctx.fillText(pct+"%",pos.x,pos.y+7);';
  h += '      ctx.restore();';
  h += '    });';
  h += '  }};';

  // Plugin: label di atas bar vertikal
  h += '  var barLabel={id:"barLabel",afterDatasetsDraw:function(chart){';
  h += '    var ctx=chart.ctx;';
  h += '    chart.data.datasets.forEach(function(ds,di){';
  h += '      var meta=chart.getDatasetMeta(di);if(meta.hidden)return;';
  h += '      meta.data.forEach(function(bar,i){';
  h += '        var val=ds.data[i];if(val==null||val===0)return;';
  h += '        var lbl="Rp "+(val/1e6).toFixed(1)+"Jt";';
  h += '        ctx.save();';
  h += '        ctx.font="700 9px Plus Jakarta Sans,sans-serif";';
  h += '        ctx.fillStyle=typeof ds.borderColor==="string"?ds.borderColor:"#0f1f35";';
  h += '        ctx.textAlign="center";ctx.textBaseline="bottom";';
  h += '        ctx.fillText(lbl,bar.x,bar.y-3);';
  h += '        ctx.restore();';
  h += '      });';
  h += '    });';
  h += '  }};';

  // Plugin: label di ujung bar horizontal
  h += '  var barLabelH={id:"barLabelH",afterDatasetsDraw:function(chart){';
  h += '    var ctx=chart.ctx;';
  h += '    chart.data.datasets.forEach(function(ds,di){';
  h += '      var meta=chart.getDatasetMeta(di);if(meta.hidden)return;';
  h += '      meta.data.forEach(function(bar,i){';
  h += '        var val=ds.data[i];if(val==null||val===0)return;';
  h += '        ctx.save();';
  h += '        ctx.font="800 10px Plus Jakarta Sans,sans-serif";';
  h += '        ctx.fillStyle="#0f1f35";';
  h += '        ctx.textAlign="left";ctx.textBaseline="middle";';
  h += '        ctx.fillText(val+" LPS",bar.x+6,bar.y);';
  h += '        ctx.restore();';
  h += '      });';
  h += '    });';
  h += '  }};';

  // Donut — produksi per pelabuhan
  h += '  new Chart(document.getElementById("c-donut"),{';
  h += '    type:"doughnut",';
  h += '    data:{labels:_d.names,datasets:[{data:_d.produksi,backgroundColor:_d.colors.map(function(c){return c+"bb"}),borderColor:_d.colors,borderWidth:2}]},';
  h += '    options:{responsive:true,maintainAspectRatio:false,plugins:{';
  h += '      legend:{position:"bottom",labels:{font:fn,color:"#3a5070",padding:8,boxWidth:10}},';
  h += '      tooltip:{...tp,callbacks:{label:function(ctx){return ctx.label+": "+ctx.raw.toLocaleString("id-ID")+" kg"}}}';
  h += '    }},plugins:[donutLabel]';
  h += '  });';

  // Bar — realisasi vs target
  h += '  new Chart(document.getElementById("c-bar"),{';
  h += '    type:"bar",';
  h += '    data:{labels:_d.names,datasets:[';
  h += '      {label:"Realisasi PNBP",data:_d.realisasi,backgroundColor:_d.colors.map(function(c){return c+"33"}),borderColor:_d.colors,borderWidth:2,borderRadius:4,borderSkipped:false},';
  h += '      {label:"Target",data:_d.targets,backgroundColor:"rgba(0,0,0,.04)",borderColor:"#94a3b8",borderWidth:1.5,borderRadius:4,borderSkipped:false}';
  h += '    ]},';
  h += '    options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:18}},plugins:{';
  h += '      legend:{labels:{font:fn,color:"#3a5070",boxWidth:10,padding:8}},';
  h += '      tooltip:{...tp,callbacks:{label:function(ctx){return ctx.dataset.label+": Rp "+ctx.raw.toLocaleString("id-ID")}}}';
  h += '    },scales:{';
  h += '      x:{grid:{display:false},ticks:{color:"#7a95b0",font:fn}},';
  h += '      y:{grid:{color:"#f0f4f8"},ticks:{color:"#7a95b0",font:fn,callback:function(v){return(v/1e6).toFixed(0)+"Jt"}},border:{color:"#e2eaf3"}}';
  h += '    }},plugins:[barLabel]';
  h += '  });';

  // Bar horizontal — LPS
  h += '  new Chart(document.getElementById("c-lps"),{';
  h += '    type:"bar",';
  h += '    data:{labels:_d.names,datasets:[{data:_d.lps,backgroundColor:_d.colors.map(function(c){return c+"99"}),borderColor:_d.colors,borderWidth:2,borderRadius:4,borderSkipped:false}]},';
  h += '    options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,layout:{padding:{right:55}},plugins:{';
  h += '      legend:{display:false},';
  h += '      tooltip:{...tp,callbacks:{label:function(ctx){return ctx.raw+" LPS"}}}';
  h += '    },scales:{';
  h += '      x:{grid:{color:"#f0f4f8"},ticks:{color:"#7a95b0",font:fn}},';
  h += '      y:{grid:{display:false},ticks:{color:"#3a5070",font:{family:"Plus Jakarta Sans",size:10,weight:"600"}}}';
  h += '    }},plugins:[barLabelH]';
  h += '  });';

  h += '}';
  h += '<\/script>';
  h += '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" onload="initCharts()"><\/script>';
  h += '</body></html>';

  var win = window.open('', '_blank');
  if (!win) {
    showToast('#dc2626', 'Popup diblokir browser. Izinkan popup lalu coba lagi.');
    return;
  }
  win.document.write(h);
  win.document.close();
  showToast('#059669', 'Infografis dibuka \u2014 klik "Cetak / Simpan PDF" di bar atas halaman tersebut');
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
function showToast(color, msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-bar').style.background = color;
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3500);
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════

// ════════════════════════════════════════
// API CONFIG MODAL
// ════════════════════════════════════════

function openApiConfig() {
  const saved = localStorage.getItem(LS_API_KEY) || getApiUrl();
  const interval = localStorage.getItem(LS_INT_KEY) || '5';
  const inp = document.getElementById('api-url-input');
  if (inp) inp.value = saved;
  const intEl = document.getElementById('cfg-interval');
  if (intEl) intEl.value = interval;
  const res = document.getElementById('api-test-result');
  if (res) { res.style.display='none'; res.textContent=''; }
  document.getElementById('modal-api-config').classList.add('open');
}

function saveApiUrl() {
  const url = (document.getElementById('api-url-input')?.value || '').trim();
  const min = parseInt(document.getElementById('cfg-interval')?.value) || 5;
  const auto= document.getElementById('cfg-auto-refresh')?.checked !== false;

  if (!url) { showToast('#d97706','Masukkan URL terlebih dahulu'); return; }

  // Simpan ke localStorage
  localStorage.setItem(LS_API_KEY, url);
  localStorage.setItem(LS_INT_KEY, String(min));

  // Update CONFIG runtime
  if (!CONFIG) CONFIG = {};
  if (!CONFIG.spreadsheet) CONFIG.spreadsheet = {};
  CONFIG.spreadsheet.api_url      = url;
  CONFIG.spreadsheet.refresh_menit= min;
  CONFIG.spreadsheet.auto_fetch   = auto;

  closeModal('modal-api-config');
  fetchFromSpreadsheet(true); // langsung ambil data
}

async function testApiConnection() {
  const url = (document.getElementById('api-url-input')?.value || '').trim();
  const res = document.getElementById('api-test-result');
  if (!url) { showToast('#d97706','Masukkan URL terlebih dahulu'); return; }
  if (!res) return;

  res.style.display = 'block';
  res.style.background = '#eff6ff';
  res.style.color = '#1e40af';
  res.style.border = '1px solid #bfdbfe';
  res.textContent = '⏳ Menguji koneksi...';

  try {
    const resp = await fetch(url + '?action=ping', { cache:'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    res.style.background = '#f0fdf4';
    res.style.color = '#065f46';
    res.style.border = '1px solid #bbf7d0';
    res.textContent = `✅ Koneksi berhasil! Status: ${data.status || 'ok'} · ${new Date(data.timestamp).toLocaleString('id-ID')}`;
  } catch(err) {
    res.style.background = '#fff5f5';
    res.style.color = '#dc2626';
    res.style.border = '1px solid #fecaca';
    res.textContent = `❌ Gagal: ${err.message}`;
  }
}

function updateLiveIndicator() {
  const el    = document.getElementById('live-indicator');
  const label = document.getElementById('live-label');
  const badge = document.getElementById('api-config-badge');
  const url   = getApiUrl() || localStorage.getItem(LS_API_KEY) || '';

  if (!el) return;

  if (!url) {
    el.className = '';
    el.style.display = 'none';
    if (badge) { badge.style.display = 'flex'; badge.className = ''; }
    return;
  }

  if (badge) { badge.style.display = 'none'; }

  if (_fetchStatus === 'loading') {
    el.className = 'loading';
    el.style.display = 'inline-flex';
    if (label) label.textContent = 'Memuat...';
  } else if (_fetchStatus === 'ok') {
    el.className = 'live';
    el.style.display = 'inline-flex';
    if (label) label.textContent = 'Live';
  } else if (_fetchStatus === 'error') {
    el.className = 'error';
    el.style.display = 'inline-flex';
    if (label) label.textContent = 'Gagal';
  }
}

// setFetchStatus sudah memanggil updateLiveIndicator secara langsung (lihat definisi aslinya)

// Ambil URL — prioritas: data.json > localStorage browser
function getApiUrl() {
  const fromConfig = CONFIG && CONFIG.spreadsheet && CONFIG.spreadsheet.api_url
    ? CONFIG.spreadsheet.api_url.trim() : '';
  if (fromConfig) return fromConfig;
  try { return (localStorage.getItem(LS_API_KEY) || '').trim(); } catch(e) { return ''; }
}


// ════════════════════════════════════════
// ONBOARDING — tampilkan panduan setup jika belum ada URL & data
// ════════════════════════════════════════
function showOnboarding() {
  const el = document.getElementById('ov-0');
  if (!el || appData.length > 0) return;
  const allEmpty = ['ov-0','ov-1','ov-2'].every(id => {
    const e = document.getElementById(id);
    return !e || e.innerHTML.trim() === '';
  });
  // Tampilkan onboarding di area overview
  const ov = document.getElementById('page-overview');
  if (!ov) return;
  const existing = document.getElementById('onboarding-banner');
  if (existing) return; // sudah tampil
  const banner = document.createElement('div');
  banner.id = 'onboarding-banner';
  banner.style.cssText = 'background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:28px 32px;margin-bottom:24px;display:flex;gap:20px;align-items:flex-start';
  banner.innerHTML = `
    <div style="font-size:36px;flex-shrink:0">🚀</div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:800;color:#0d1b2e;margin-bottom:8px">Dashboard Siap — Hubungkan Data Anda</div>
      <div style="font-size:12px;color:#3a5070;line-height:1.7;margin-bottom:16px">
        Dashboard belum terhubung ke Google Sheets. Ada dua cara untuk menampilkan data:
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:#fff;border:1px solid #bfdbfe;border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:800;color:#1a6fd4;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">⚡ Opsi 1 — Live dari Sheets</div>
          <div style="font-size:11px;color:#3a5070;line-height:1.6">Deploy Apps Script → klik <strong>"⚙️ Hubungkan Spreadsheet"</strong> di topbar → paste URL → data langsung tampil & auto-refresh</div>
        </div>
        <div style="background:#fff;border:1px solid #bfdbfe;border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:800;color:#1a6fd4;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📥 Opsi 2 — Upload Excel</div>
          <div style="font-size:11px;color:#3a5070;line-height:1.6">Klik tombol <strong>"📥 Import"</strong> di topbar → upload file Excel DOPK (.xlsx) → data langsung ditampilkan</div>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="openApiConfig()" style="background:#1a6fd4;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">⚙️ Hubungkan Google Sheets</button>
        <button onclick="openImportModal()" style="background:#fff;border:1.5px solid #d0dcea;color:#3a5070;padding:9px 18px;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">📥 Upload Excel</button>
      </div>
    </div>`;
  ov.insertBefore(banner, ov.firstChild);
}

function hideOnboarding() {
  const el = document.getElementById('onboarding-banner');
  if (el) el.remove();
}

window.addEventListener('DOMContentLoaded', async () => {
  // 1. Load konfigurasi dari data.json (termasuk spreadsheet.api_url)
  await loadConfig();

  // 2. Coba load dari localStorage dulu (tampil cepat, tanpa toast)
  const hadCached = loadData();
  renderOverview(); // render segera, apapun kondisinya

  // 3. Update live indicator segera setelah config dimuat
  updateLiveIndicator();

  // 4. Tampilkan onboarding jika tidak ada URL dan tidak ada cache
  const apiUrl = getApiUrl();
  if (!apiUrl && !hadCached) {
    showOnboarding();
  }

  // 5. Fetch data terbaru dari Apps Script jika URL sudah dikonfigurasi
  if (apiUrl && isAutoFetch()) {
    await fetchFromSpreadsheet(!hadCached);
  }

  // Drag & drop pada drop zone import modal
  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) { document.getElementById('file-input').value=''; readExcelFile(f); }
    });
  }

  // Tutup modal saat klik backdrop
  document.querySelectorAll('.modal-overlay').forEach(mo => {
    mo.addEventListener('click', e => { if (e.target === mo) mo.classList.remove('open'); });
  });
});
