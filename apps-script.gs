/**
 * ════════════════════════════════════════════════════════
 * DOPK DASHBOARD — Google Apps Script (apps-script.gs)
 * Backend API untuk Dashboard PNBP Pascaproduksi
 *
 * CARA DEPLOY:
 *   1. Buka Google Sheets Anda
 *   2. Menu: Extensions → Apps Script
 *   3. Hapus kode default, paste seluruh file ini
 *   4. Klik "Save" (Ctrl+S)
 *   5. Klik "Deploy" → "New deployment"
 *   6. Type: "Web app"
 *   7. Execute as: "Me"
 *   8. Who has access: "Anyone" ← PENTING agar dashboard bisa akses
 *   9. Klik "Deploy" → salin URL yang muncul
 *  10. Tempel URL tersebut ke data.json → spreadsheet.api_url
 * ════════════════════════════════════════════════════════
 */

// ── Konfigurasi nama sheet (sesuaikan jika berbeda)
const SHEET_CONFIG = [
  { portIdx: 0, keywords: ['KAKAP', 'SUNGAI KAKAP'] },
  { portIdx: 1, keywords: ['SUKABANGUN'] },
  { portIdx: 2, keywords: ['JELAI', 'KUALA JELAI'] },
];

// ── Konfigurasi kolom Excel DOPK (0-based, sama dengan data.json)
const COL = {
  no:       0,   // A  — Nomor urut (penanda baris valid)
  bulan:    1,   // B  — Bulan
  kapal:    3,   // D  — Nama Kapal
  pemilik:  7,   // H  — Pemilik
  trip:     13,  // N  — Trip Penangkapan (Hari)
  produksi: 14,  // O  — Jumlah Produksi (kg)
  nilai:    17,  // R  — Nominal Bayar PNBP (Rp)
  ket:      18,  // S  — Keterangan
};

const BULAN_VALID = [
  'JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI',
  'JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'
];

/**
 * Main entry point — dipanggil oleh dashboard via fetch()
 * GET ?action=data  → semua data dari 3 pelabuhan
 * GET ?action=meta  → metadata (jumlah baris, timestamp update terakhir)
 * GET ?action=ping  → health check
 */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'data';
  let result;

  try {
    if (action === 'data') {
      result = getAllData();
    } else if (action === 'meta') {
      result = getMetadata();
    } else if (action === 'ping') {
      result = { status: 'ok', timestamp: new Date().toISOString() };
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = {
      error: err.message,
      stack: err.stack,
    };
  }

  // CORS headers agar dashboard bisa fetch dari domain manapun
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ambil semua data dari seluruh sheet yang cocok
 */
function getAllData() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const records = [];
  const summary = [];

  sheets.forEach(sheet => {
    const name     = sheet.getName().toUpperCase().trim();
    const portConf = matchPort(name);
    if (!portConf) return; // sheet tidak dikenali → lewati

    const rows    = sheet.getDataRange().getValues();
    const parsed  = parseSheetRows(rows, portConf.portIdx);
    records.push(...parsed);
    summary.push({
      sheet:   sheet.getName(),
      portIdx: portConf.portIdx,
      count:   parsed.length,
    });
  });

  return {
    ok:        true,
    timestamp: new Date().toISOString(),
    total:     records.length,
    summary,
    data:      records,
  };
}

/**
 * Metadata ringan (untuk polling cepat tanpa load data penuh)
 */
function getMetadata() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const sheets  = ss.getSheets();
  const meta    = [];
  let totalRows = 0;

  sheets.forEach(sheet => {
    const name     = sheet.getName().toUpperCase().trim();
    const portConf = matchPort(name);
    if (!portConf) return;

    const rows    = sheet.getDataRange().getValues();
    const count   = countValidRows(rows);
    totalRows    += count;
    meta.push({
      sheet:   sheet.getName(),
      portIdx: portConf.portIdx,
      count,
      lastModified: sheet.getLastUpdated ? sheet.getLastUpdated().toISOString() : null,
    });
  });

  return {
    ok:        true,
    timestamp: new Date().toISOString(),
    totalRows,
    sheets:    meta,
  };
}

/**
 * Cocokkan nama sheet ke pelabuhan
 */
function matchPort(sheetNameUpper) {
  for (const conf of SHEET_CONFIG) {
    for (const kw of conf.keywords) {
      if (sheetNameUpper.includes(kw)) return conf;
    }
  }
  return null;
}

/**
 * Parse baris data dari satu sheet
 */
function parseSheetRows(rows, portIdx) {
  const records = [];

  for (let i = 1; i < rows.length; i++) { // skip baris 0 (header)
    const r = rows[i];
    if (!r || r.length === 0) continue;

    // Baris valid: kolom NO harus berupa angka
    const no = r[COL.no];
    if (typeof no !== 'number' || !isFinite(no) || no <= 0) continue;

    const nilai = parseFloat(r[COL.nilai]) || 0;
    if (nilai <= 0) continue; // skip baris tanpa nilai PNBP

    const bulanRaw = String(r[COL.bulan] || '').toUpperCase().trim();
    const bulan    = BULAN_VALID.includes(bulanRaw) ? bulanRaw : 'JANUARI';

    records.push({
      port:     portIdx,
      bulan,
      kapal:    String(r[COL.kapal]    || '').trim(),
      pemilik:  String(r[COL.pemilik]  || '-').trim(),
      trip:     parseFloat(r[COL.trip])     || 0,
      produksi: parseFloat(r[COL.produksi]) || 0,
      nilai,
      ket:      String(r[COL.ket]      || 'LUNAS').trim(),
    });
  }

  return records;
}

/**
 * Hitung baris valid tanpa parsing penuh (untuk metadata)
 */
function countValidRows(rows) {
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const no    = r[COL.no];
    const nilai = parseFloat(r[COL.nilai]) || 0;
    if (typeof no === 'number' && isFinite(no) && no > 0 && nilai > 0) count++;
  }
  return count;
}
