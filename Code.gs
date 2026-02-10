// Code_AMF_2.011
/**
 * AMF - Google Apps Script Web App API (v3 schema: multi-utente + società con tariffe + sedute immutabili)
 * Spreadsheet ID is fixed to the user's new sheet.
 *
 * NOTE:
 * - All actions are GET (JSONP-friendly) to support iOS PWA / GitHub Pages.
 * - Every write is filtered by userId (utente_id).
 * - The server is responsible for ensuring sheet headers exist.
 */
const SPREADSHEET_ID = "1Bx8z3UvERM0ecN6WP6mrG01sGl_Pr3rdVW9Tjxp5vmA";

const SHEETS = {
  utenti: "utenti",
  societa: "societa",
  societa_tariffe: "societa_tariffe",
  pazienti: "pazienti",
  terapie: "terapie",
  sedute: "sedute"
};

// -------------------- Utilities --------------------
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function nowIso_() { return new Date().toISOString(); }
function uuid_() { return Utilities.getUuid(); }
function toBool_(v) { return String(v).toLowerCase() === "true" || v === true || v === 1 || v === "1"; }
function norm_(v) { return String(v == null ? "" : v).trim(); }
function sanitizeCallback_(cb) {
  const s = String(cb || "").trim();
  if (!s) return "";
  if (!/^[a-zA-Z0-9_$\.]+$/.test(s)) return "";
  return s;
}
function out_(obj, cb) {
  const json = JSON.stringify(obj);
  if (cb) {
    return ContentService.createTextOutput(`${cb}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function sha256_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s || ""), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function userHash_(userId, pw) { return sha256_(String(userId) + "|" + String(pw)); }

function parseJson_(s, fallback) {
  try { return JSON.parse(String(s || "")); } catch (_) { return fallback; }
}

function colMap_(headers) {
  const m = {};
  for (let i = 0; i < headers.length; i++) m[String(headers[i] || "").trim()] = i;
  return m;
}
function ensureHeaders_(sheetName, required) {
  const ss = ss_();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Missing sheet: " + sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), required.length);
  if (lastRow < 1) {
    sh.getRange(1, 1, 1, required.length).setValues([required]);
    return sh;
  }
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  const existing = new Set(headers.map(h => String(h || "").trim()).filter(Boolean));
  const missing = required.filter(h => !existing.has(h));
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}
function readAll_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { headers: sh.getRange(1,1,1,lastCol).getValues()[0] || [], rows: [] };
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0] || [];
  const rows = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  return { headers, rows };
}
function rowToObj_(headers, row) {
  const o = {};
  for (let i = 0; i < headers.length; i++) {
    const k = String(headers[i] || "").trim();
    if (!k) continue;
    o[k] = row[i];
  }
  return o;
}
function writeRow_(sh, headers, obj) {
  const m = colMap_(headers);
  const row = new Array(headers.length).fill("");
  Object.keys(obj || {}).forEach(k => {
    if (k in m) row[m[k]] = obj[k];
  });
  sh.appendRow(row);
}

function setCell_(sh, rowIndex1, headers, key, value) {
  const idx = headers.indexOf(key);
  if (idx < 0) return;
  sh.getRange(rowIndex1, idx + 1).setValue(value);
}

function toIsoDate_(v) {
  // Accept: "YYYY-MM-DD", Date, or Sheets date; always return "YYYY-MM-DD" or ""
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    const d = v;
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // try parse
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return Utilities.formatDate(d2, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return "";
}

function weekdayKey_(label) {
  const s = String(label || "").trim().toUpperCase();
  const map = { "DO":0, "DOM":0, "SU":0, "SUN":0,
                "LU":1, "LUN":1, "MO":1, "MON":1,
                "MA":2, "MAR":2, "TU":2, "TUE":2,
                "ME":3, "MER":3, "WE":3, "WED":3,
                "GI":4, "GIO":4, "TH":4, "THU":4,
                "VE":5, "VEN":5, "FR":5, "FRI":5,
                "SA":6, "SAB":6, "SAT":6 };
  if (s in map) return map[s];
  const n = parseInt(s, 10);
  if (isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}

// -------------------- Schema / Headers --------------------
const H_UTENTI = ["id","nome","active_year","password_hash","createdAt","updatedAt","isDeleted"];
const H_IMPOST = ["id","utente_id","payload_json","createdAt","updatedAt","isDeleted"];
const H_SOC = ["id","utente_id","nome","tag_colore","valuta_default","createdAt","updatedAt","isDeleted"];
const H_SOCIETA_TARIFFE = ["id","utente_id","societa_id","anno_esercizio","L1_importo","L2_importo","L3_importo","valuta","createdAt","updatedAt","isDeleted"];

const H_PAZ = ["id","utente_id","societa_id","nome_cognome","address","note","geo_lat","geo_lng","geo_accuracy","geo_ts","createdAt","updatedAt","isDeleted"];
const H_TER = ["id","utente_id","paziente_id","livello","valid_from","valid_to","weekdays_json","from_time","to_time","note","createdAt","updatedAt","isDeleted"];
const H_SED = ["id","utente_id","paziente_id","terapia_id","tipo","status","from_date","from_time","to_date","to_time","date","livello","importo","importo_override","valuta","anno_esercizio","note","createdAt","updatedAt","isDeleted"];

function ensureAllSheets_() {
  ensureHeaders_(SHEETS.utenti, H_UTENTI);
  ensureHeaders_(SHEETS.societa, H_SOC);
  ensureHeaders_(SHEETS.societa_tariffe, H_SOCIETA_TARIFFE);
  ensureHeaders_(SHEETS.pazienti, H_PAZ);
  ensureHeaders_(SHEETS.terapie, H_TER);
  const shSed = ensureHeaders_(SHEETS.sedute, H_SED);
  try {
    const colsText = ["from_date","to_date","from_time","to_time","date"];
    colsText.forEach(k => {
      const idx = H_SED.indexOf(k);
      if (idx >= 0) shSed.getRange(2, idx+1, Math.max(1, shSed.getMaxRows()-1), 1).setNumberFormat("@STRING@");
    });
  } catch (_) {}
}

// -------------------- Auth --------------------
function listUsers_() {
  const sh = ensureHeaders_(SHEETS.utenti, H_UTENTI);
  const { headers, rows } = readAll_(sh);
  const idxDel = headers.indexOf("isDeleted");
  return rows
    .filter(r => !(idxDel>=0 && String(r[idxDel]).toLowerCase()==="true"))
    .map(r => {
      const o = rowToObj_(headers, r);
      delete o.password_hash;
      return o;
    });
}

function createUser_(nome, password) {
  ensureAllSheets_();
  nome = String(nome||"").trim();
  password = String(password||"");
  if (!nome) throw new Error("Nome mancante");
  if (!password) throw new Error("Password mancante");

  const shU = ss_().getSheetByName(SHEETS.utenti);
  const { headers, rows } = readAll_(shU);
  const idxNome = headers.indexOf("nome");
  const idxDel = headers.indexOf("isDeleted");

  for (const r of rows) {
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxNome]||"").trim().toLowerCase() === nome.toLowerCase()) throw new Error("Utente già esistente");
  }

  const id = uuid_();
  const now = nowIso_();
  const year = String(new Date().getFullYear());
  const row = headers.map(h => {
    switch (h) {
      case "id": return id;
      case "nome": return nome;
      case "active_year": return year;
      case "password_hash": return hashPass_(password);
      case "createdAt": return now;
      case "updatedAt": return now;
      case "isDeleted": return "0";
      default: return "";
    }
  });
  shU.appendRow(row);
  return { id, nome, active_year: year };
}

function login_(nome, password) {
  ensureAllSheets_();
  nome = String(nome||"").trim();
  password = String(password||"");
  const shU = ss_().getSheetByName(SHEETS.utenti);
  const { headers, rows } = readAll_(shU);
  const idxNome = headers.indexOf("nome");
  const idxHash = headers.indexOf("password_hash");
  const idxId = headers.indexOf("id");
  const idxYear = headers.indexOf("active_year");
  const idxDel = headers.indexOf("isDeleted");

  for (const r of rows) {
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxNome]||"").trim().toLowerCase() !== nome.toLowerCase()) continue;
    if (!verifyPass_(password, String(r[idxHash]||""))) throw new Error("Password errata");
    return { id: String(r[idxId]||""), nome: String(r[idxNome]||""), active_year: String(r[idxYear]||"") };
  }
  throw new Error("Utente non trovato");
}

function updatePassword_(nome, oldPassword, newPassword) {
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.utenti);
  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idxNome = headers.indexOf("nome");
  const idxId = headers.indexOf("id");
  const idxHash = headers.indexOf("password_hash");
  const idxUpd = headers.indexOf("updatedAt");
  for (let r=2;r<=lastRow;r++) {
    const row = sh.getRange(r,1,1,headers.length).getValues()[0];
    if (String(row[idxNome]||"").trim() !== String(nome||"").trim()) continue;
    const uid = String(row[idxId]||"");
    const stored = String(row[idxHash]||"");
    if (stored !== userHash_(uid, String(oldPassword||""))) throw new Error("Password attuale errata");
    setCell_(sh, r, headers, "password_hash", userHash_(uid, String(newPassword||"")));
    setCell_(sh, r, headers, "updatedAt", nowIso_());
    return { id: uid, nome: String(nome||"").trim() };
  }
  throw new Error("Utente non trovato");
}

// -------------------- Settings --------------------
function ensureImpostazioniRow_(userId, activeYear) { return; }

function getSettings_(userId) {
  ensureAllSheets_();
  const shU = ss_().getSheetByName(SHEETS.utenti);
  const { headers, rows } = readAll_(shU);
  const idxId = headers.indexOf("id");
  const idxYear = headers.indexOf("active_year");
  let activeYear = String(new Date().getFullYear());
  for (const r of rows) {
    if (String(r[idxId]||"") === String(userId||"")) { activeYear = String(r[idxYear]||activeYear); break; }
  }
  return { active_year: activeYear };
}

function saveSettings_(userId, payloadStr) {
  ensureAllSheets_();
  const payload = parseJson_(payloadStr, {});
  const nextYear = payload && payload.active_year ? String(payload.active_year) : "";
  if (!nextYear) return getSettings_(userId);

  const shU = ss_().getSheetByName(SHEETS.utenti);
  const { headers, rows } = readAll_(shU);
  const idxId = headers.indexOf("id");
  const idxYear = headers.indexOf("active_year");
  const idxDel = headers.indexOf("isDeleted");
  const idxUpd = headers.indexOf("updatedAt");
  const now = nowIso_();

  for (let i=0;i<rows.length;i++){
    const r=rows[i];
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxId]||"")!==String(userId||"")) continue;
    shU.getRange(i+2, idxYear+1).setValue(nextYear);
    if (idxUpd>=0) shU.getRange(i+2, idxUpd+1).setValue(now);
    return { active_year: nextYear };
  }
  throw new Error("User not found");
}

// -------------------- Società --------------------
function addSocieta_(userId, nome, tag, l1, l2, l3, valuta) {
  ensureAllSheets_();
  userId = String(userId||"");
  nome = String(nome||"").trim();
  if (!userId) throw new Error("userId mancante");
  if (!nome) throw new Error("Nome società mancante");

  const now = nowIso_();
  const sh = ss_().getSheetByName(SHEETS.societa);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxNome = headers.indexOf("nome");
  const idxDel = headers.indexOf("isDeleted");
  for (const r of rows) {
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")===userId && String(r[idxNome]||"").trim().toLowerCase()===nome.toLowerCase()) throw new Error("Società già esistente");
  }

  const id = uuid_();
  const row = headers.map(h => {
    switch(h){
      case "id": return id;
      case "utente_id": return userId;
      case "nome": return nome;
      case "tag_colore": return String(tag||"").trim() || "0";
      case "valuta_default": return String(valuta||"").trim() || "EUR";
      case "createdAt": return now;
      case "updatedAt": return now;
      case "isDeleted": return "0";
      default: return "";
    }
  });
  sh.appendRow(row);

  const year = String(getSettings_(userId).active_year || String(new Date().getFullYear()));
  upsertSocietaTariffe_(userId, id, year, l1, l2, l3, valuta);

  return { id, utente_id: userId, nome, tag_colore: String(tag||"").trim() || "0", valuta_default: String(valuta||"").trim() || "EUR" };
}

function listSocieta_(userId) {
  ensureAllSheets_();
  userId = String(userId||"");
  const year = String(getSettings_(userId).active_year || String(new Date().getFullYear()));
  const sh = ss_().getSheetByName(SHEETS.societa);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxId = headers.indexOf("id");
  const idxDel = headers.indexOf("isDeleted");

  const tariffsBySoc = buildTariffeMap_(userId, year);

  const out = [];
  for (const r of rows) {
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")!==userId) continue;
    const id = String(r[idxId]||"");
    const obj = rowToObj_(headers, r);
    const t = tariffsBySoc[id] || {};
    obj.l1 = t.L1_importo != null ? String(t.L1_importo) : "";
    obj.l2 = t.L2_importo != null ? String(t.L2_importo) : "";
    obj.l3 = t.L3_importo != null ? String(t.L3_importo) : "";
    obj.anno_esercizio = year;
    if (!obj.valuta) obj.valuta = t.valuta || obj.valuta_default || "EUR";
    out.push(obj);
  }
  return out;
}

function deleteSocieta_(userId, id, nome) {
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.societa);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idxUid = headers.indexOf("utente_id");
  const idxId = headers.indexOf("id");
  const idxNome = headers.indexOf("nome");
  for (let r=2;r<=sh.getLastRow();r++) {
    const row = sh.getRange(r,1,1,headers.length).getValues()[0];
    if (String(row[idxUid]||"")!==String(userId||"")) continue;
    const ok = (id && String(row[idxId]||"")===String(id)) || (!id && nome && String(row[idxNome]||"")===String(nome));
    if (!ok) continue;
    setCell_(sh, r, headers, "isDeleted", "TRUE");
    setCell_(sh, r, headers, "updatedAt", nowIso_());
    return { ok: true };
  }
  return { ok: true };
}

// -------------------- Pazienti --------------------
function listPatients_(userId) {
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.pazienti);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  return rows
    .filter(r => String(r[idxUid]||"")===String(userId||"") && !(idxDel>=0 && String(r[idxDel]).toLowerCase()==="true"))
    .map(r => rowToObj_(headers, r));
}

function levelToTariffaTipo_(lvl) {
  const s = String(lvl||"").toUpperCase().trim();
  if (s==="L1") return "A";
  if (s==="L2") return "B";
  if (s==="L3") return "C";
  return "A";
}

function createPatient_(userId, payloadStr) {
  ensureAllSheets_();
  userId = String(userId||"");
  const payload = parseJson_(payloadStr, {});
  const now = nowIso_();
  const sh = ss_().getSheetByName(SHEETS.pazienti);
  const { headers } = readAll_(sh);
  const id = uuid_();
  const row = headers.map(h => {
    switch(h){
      case "id": return id;
      case "utente_id": return userId;
      case "societa_id": return String(payload.societa_id||"");
      case "nome_cognome": return String(payload.nome_cognome||"").trim();
      case "address": return String(payload.address||"").trim();
      case "note": return String(payload.note||"").trim();
      case "geo_lat": return payload.geo_lat || "";
      case "geo_lng": return payload.geo_lng || "";
      case "geo_accuracy": return payload.geo_accuracy || "";
      case "geo_ts": return payload.geo_ts || "";
      case "createdAt": return now;
      case "updatedAt": return now;
      case "isDeleted": return "0";
      default: return "";
    }
  });
  sh.appendRow(row);
  return { id, utente_id: userId, societa_id: String(payload.societa_id||""), nome_cognome: String(payload.nome_cognome||""), address: String(payload.address||"") };
}

function updatePatient_(userId, id, payloadStr) {
  ensureAllSheets_();
  userId = String(userId||"");
  id = String(id||"");
  const payload = parseJson_(payloadStr, {});
  const sh = ss_().getSheetByName(SHEETS.pazienti);
  const { headers, rows } = readAll_(sh);
  const idxId = headers.indexOf("id");
  const idxUid = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  const now = nowIso_();
  for (let i=0;i<rows.length;i++){
    const r=rows[i];
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")!==userId) continue;
    if (String(r[idxId]||"")!==id) continue;
    const up = {
      societa_id: String(payload.societa_id||""),
      nome_cognome: String(payload.nome_cognome||"").trim(),
      address: String(payload.address||"").trim(),
      note: String(payload.note||"").trim(),
      geo_lat: payload.geo_lat || "",
      geo_lng: payload.geo_lng || "",
      geo_accuracy: payload.geo_accuracy || "",
      geo_ts: payload.geo_ts || "",
      updatedAt: now
    };
    Object.entries(up).forEach(([k,v])=>{
      const c=headers.indexOf(k);
      if (c>=0) sh.getRange(i+2,c+1).setValue(v);
    });
    return { id, utente_id:userId, societa_id:up.societa_id, nome_cognome:up.nome_cognome, address:up.address };
  }
  throw new Error("Paziente non trovato");
}

function deletePatient_(userId, id) {
  ensureAllSheets_();

  const patientId = String(id || "");
  const uid = String(userId || "");

  // Helper: delete rows matching predicate (iterate bottom-up)
  function purge_(sheetName, rowMatchFn) {
    const sh = ss_().getSheetByName(sheetName);
    if (!sh) return 0;
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return 0;

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    let removed = 0;
    for (let r = lastRow; r >= 2; r--) {
      const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
      if (rowMatchFn(headers, row)) {
        sh.deleteRow(r);
        removed++;
      }
    }
    return removed;
  }

  // 1) pazienti: remove the patient row (id match + ownership)
  const removedPatients = purge_(SHEETS.pazienti, (headers, row) => {
    const idxUid = headers.indexOf("utente_id");
    const idxId = headers.indexOf("id");
    return String(row[idxUid] || "") === uid && String(row[idxId] || "") === patientId;
  });

  // 2) terapie: remove all therapies for that patient
  const removedTherapies = purge_(SHEETS.terapie, (headers, row) => {
    const idxUid = headers.indexOf("utente_id");
    const idxPid = headers.indexOf("paziente_id");
    return String(row[idxUid] || "") === uid && String(row[idxPid] || "") === patientId;
  });

  // 3) sedute: remove all sessions + moves for that patient
  const removedSedute = purge_(SHEETS.sedute, (headers, row) => {
    const idxUid = headers.indexOf("utente_id");
    const idxPid = headers.indexOf("paziente_id");
    return String(row[idxUid] || "") === uid && String(row[idxPid] || "") === patientId;
  });

  // 4) audit_log (optional)
  let removedAudit = 0;
  try {
    const shAudit = ss_().getSheetByName("audit_log");
    if (shAudit) {
      removedAudit = purge_("audit_log", (headers, row) => {
        const idxUid = headers.indexOf("utente_id");
        const idxEntity = headers.indexOf("entity");
        const idxEntityId = headers.indexOf("entity_id");
        return String(row[idxUid] || "") === uid &&
               (String(row[idxEntity] || "") === "pazienti" || String(row[idxEntity] || "") === "terapie" || String(row[idxEntity] || "") === "sedute") &&
               String(row[idxEntityId] || "") === patientId;
      });
    }
  } catch (_) {}

  return { ok: true, removed: { pazienti: removedPatients, terapie: removedTherapies, sedute: removedSedute, audit_log: removedAudit } };
}

// -------------------- Terapie + Sedute generation --------------------
function listTherapies_(userId, pazienteId) {
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.terapie);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxDel = headers.indexOf("isDeleted");
  return rows
    .filter(r => String(r[idxUid]||"")===String(userId||"") &&
                 (!pazienteId || String(r[idxPid]||"")===String(pazienteId||"")) &&
                 !(idxDel>=0 && String(r[idxDel]).toLowerCase()==="true"))
    .map(r => rowToObj_(headers, r));
}

function listMoves_(userId, pazienteId) {
  // A "move" is a seduta with tipo="move" and status="planned"
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.sedute);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxTipo = headers.indexOf("tipo");
  const idxStatus = headers.indexOf("status");
  const idxDel = headers.indexOf("isDeleted");
  return rows
    .filter(r => String(r[idxUid]||"")===String(userId||"") &&
                 (!pazienteId || String(r[idxPid]||"")===String(pazienteId||"")) &&
                 String(r[idxTipo]||"")==="move" &&
                 String(r[idxStatus]||"")!=="canceled" &&
                 !(idxDel>=0 && String(r[idxDel]).toLowerCase()==="true"))
    .map(r => rowToObj_(headers, r));
}

function moveSessionObj_(userId, payload) {
  // payload: { paziente_id, from_date, from_time, to_date, to_time, note, importo, valuta }
  ensureAllSheets_();
  const p = payload || {};
  const sh = ss_().getSheetByName(SHEETS.sedute);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const ts = nowIso_();
  const id = uuid_();
  writeRow_(sh, headers, {
    id,
    utente_id: String(userId),
    paziente_id: String(p.paziente_id||""),
    tipo: "move",
    status: "planned",
    from_date: toIsoDate_(p.from_date),
    from_time: String(p.from_time||""),
    to_date: toIsoDate_(p.to_date),
    to_time: String(p.to_time||""),
    importo: norm_(p.importo),
    valuta: String(p.valuta||"EUR"),
    note: String(p.note||""),
    createdAt: ts,
    updatedAt: ts,
    isDeleted: "FALSE"
  });
  return { id };
}

// Legacy wrapper (kept for compatibility)
function moveSession_(userId, payloadStr) {
  const p = parseJson_(payloadStr, {});
  return moveSessionObj_(userId, p);
}

function deleteSessionById_(userId, id) {
  ensureAllSheets_();
  const sh = ss_().getSheetByName(SHEETS.sedute);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idxUid = headers.indexOf("utente_id");
  const idxId = headers.indexOf("id");
  for (let r=2;r<=sh.getLastRow();r++) {
    const row = sh.getRange(r,1,1,headers.length).getValues()[0];
    if (String(row[idxUid]||"")===String(userId||"") && String(row[idxId]||"")===String(id||"")) {
      setCell_(sh, r, headers, "isDeleted", "TRUE");
      setCell_(sh, r, headers, "updatedAt", nowIso_());
      return { ok: true };
    }
  }
  return { ok: true };
}

function wipeAll_(userId) {
  // Safety: only wipes the current user's data (not other users)
  ensureAllSheets_();
  const targets = [SHEETS.societa, SHEETS.societa_tariffe, SHEETS.pazienti, SHEETS.terapie, SHEETS.sedute];
  const ss = ss_();
  targets.forEach(name => {
    const sh = ss.getSheetByName(name);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const idxUid = headers.indexOf("utente_id");
    const idxDel = headers.indexOf("isDeleted");
    if (idxUid < 0 || idxDel < 0) return;
    for (let r=2;r<=sh.getLastRow();r++) {
      const uid = String(sh.getRange(r, idxUid+1).getValue()||"");
      if (uid !== String(userId||"")) continue;
      sh.getRange(r, idxDel+1).setValue("TRUE");
    }
  });
  return { ok: true };
}

function syncTerapieAndSedute_(userId, pazienteId, startIso, endIso, giorniJson, effectiveFromIso) {
  // Deterministic sync: update terapie + regenerate sedute future from effectiveFrom (past remains immutable)
  if (!pazienteId) return;

  const start = startIso ? new Date(startIso + "T00:00:00") : null;
  const end = endIso ? new Date(endIso + "T00:00:00") : null;
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return;

  const effIso = toIsoDate_(effectiveFromIso) || startIso;
  const eff = effIso ? new Date(effIso + "T00:00:00") : start;
  const effClamped = (eff && eff.getTime() < start.getTime()) ? start : eff;

  const giorni = parseJson_(giorniJson, {});
  // Extract day entries: { LU:{from:"08:00",to:""}, ... } (client stores times in map)
  const dayKeys = Object.keys(giorni || {});
  if (!dayKeys.length) return;

  // 1) Soft-delete existing terapie for this patient (user scoped)
  const shT = ss_().getSheetByName(SHEETS.terapie);
  const hT = shT.getRange(1,1,1,shT.getLastColumn()).getValues()[0];
  const idxUidT = hT.indexOf("utente_id");
  const idxPidT = hT.indexOf("paziente_id");
  const idxDelT = hT.indexOf("isDeleted");
  for (let r=2;r<=shT.getLastRow();r++) {
    const row = shT.getRange(r,1,1,hT.length).getValues()[0];
    if (String(row[idxUidT]||"")===String(userId) && String(row[idxPidT]||"")===String(pazienteId)) {
      shT.getRange(r, idxDelT+1).setValue("TRUE");
      shT.getRange(r, hT.indexOf("updatedAt")+1).setValue(nowIso_());
    }
  }

  // Insert new terapie rows (one per weekday)
  const tz = Session.getScriptTimeZone();
  const ts = nowIso_();
  dayKeys.forEach(k => {
    const wk = weekdayKey_(k);
    if (wk == null) return;
    const entry = giorni[k];
    let fromT = "";
    let toT = "";
    if (entry && typeof entry === "object") {
      fromT = String(entry.from || entry.from_time || entry.time || "").trim();
      toT = String(entry.to || entry.to_time || "").trim();
    } else {
      const s = String(entry || "").trim();
      if (s.includes("-")) {
        const parts = s.split("-");
        fromT = String(parts[0] || "").trim();
        toT = String(parts[1] || parts[0] || "").trim();
      } else {
        fromT = s;
        toT = s;
      }
    }
    if (!fromT) return;
    writeRow_(shT, hT, {
      id: uuid_(),
      utente_id: String(userId),
      paziente_id: String(pazienteId),
      valid_from: effIso,
      valid_to: endIso,
      weekdays: String(wk),
      from_time: fromT,
      to_time: toT,
      timezone: tz,
      note: "",
      createdAt: ts,
      updatedAt: ts,
      isDeleted: "FALSE"
    });
  });

  // 2) Sedute: soft-delete existing AUTO planned within range for patient, then regenerate
  const shS = ss_().getSheetByName(SHEETS.sedute);
  const hS = shS.getRange(1,1,1,shS.getLastColumn()).getValues()[0];
  const idxUidS = hS.indexOf("utente_id");
  const idxPidS = hS.indexOf("paziente_id");
  const idxTipoS = hS.indexOf("tipo");
  const idxStatusS = hS.indexOf("status");
  const idxFromDate = hS.indexOf("from_date");
  const idxDelS = hS.indexOf("isDeleted");
  const idxLocked = hS.indexOf("locked");
  // mark for delete
  for (let r=2;r<=shS.getLastRow();r++) {
    const row = shS.getRange(r,1,1,hS.length).getValues()[0];
    if (String(row[idxUidS]||"")!==String(userId)) continue;
    if (String(row[idxPidS]||"")!==String(pazienteId)) continue;
    if (String(row[idxTipoS]||"")!=="auto") continue;
    if (String(row[idxStatusS]||"") && String(row[idxStatusS]||"")!=="planned") continue;
    if (idxLocked >= 0 && String(row[idxLocked]||"").toLowerCase()==="true") continue;
    const d = toIsoDate_(row[idxFromDate]);
    if (!d) continue;
    if (d >= effIso && d <= endIso) {
      shS.getRange(r, idxDelS+1).setValue("TRUE");
      shS.getRange(r, hS.indexOf("updatedAt")+1).setValue(nowIso_());
    }
  }

  // Resolve currency from societa (best-effort)
  let valuta = "EUR";
  try {
    const shP = ss_().getSheetByName(SHEETS.pazienti);
    const hP = shP.getRange(1,1,1,shP.getLastColumn()).getValues()[0];
    const { rows: rp } = readAll_(shP);
    const idxIdP = hP.indexOf("id");
    const idxSocId = hP.indexOf("societa_id");
    const idxTarTipo = hP.indexOf("tariffa_tipo");
    let societaId = "";
    let tariffaTipo = "A";
    for (const r of rp) if (String(r[idxIdP]||"")===String(pazienteId)) { societaId=String(r[idxSocId]||""); tariffaTipo=String(r[idxTarTipo]||"A"); break; }
    const shSoc = ss_().getSheetByName(SHEETS.societa);
    const { headers: hs, rows: rs } = readAll_(shSoc);
    const idxSocId2 = hs.indexOf("id");
    const idxVal = hs.indexOf("valuta");
    const idxA = hs.indexOf("tariffa_a");
    const idxB = hs.indexOf("tariffa_b");
    const idxC = hs.indexOf("tariffa_c");
    for (const r of rs) if (String(r[idxSocId2]||"")===societaId) {
      valuta = String(r[idxVal]||"EUR") || "EUR";
      break;
    }
  } catch (_) {}

  // Generate
  const msDay = 24*60*60*1000;
  for (let d=new Date(effClamped.getTime()); d.getTime()<=end.getTime(); d=new Date(d.getTime()+msDay)) {
    const jsWk = d.getDay(); // 0..6
    // Find matching day label entry by mapping weekdays
    for (const k of dayKeys) {
      const wk = weekdayKey_(k);
      if (wk==null || wk!==jsWk) continue;
      const entry = giorni[k] || {};
      const fromT = String(entry.from || entry.from_time || entry.time || "").trim();
      const toT = String(entry.to || entry.to_time || "").trim();
      if (!fromT) continue;
      const dateIso = Utilities.formatDate(d, tz, "yyyy-MM-dd");
      writeRow_(shS, hS, {
        id: uuid_(),
        utente_id: String(userId),
        paziente_id: String(pazienteId),
        tipo: "auto",
        status: "planned",
        from_date: dateIso,
        from_time: fromT,
        to_date: dateIso,
        to_time: (toT || fromT),
        importo: "",
        valuta: valuta,
        note: "",
        createdAt: ts,
        updatedAt: ts,
        isDeleted: "FALSE"
      });
    }
  }
}

// -------------------- Router --------------------

/* -------------------- Società Tariffe (per anno esercizio) -------------------- */
function buildTariffeMap_(userId, anno) {
  const sh = ss_().getSheetByName(SHEETS.societa_tariffe);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxSoc = headers.indexOf("societa_id");
  const idxAnno = headers.indexOf("anno_esercizio");
  const idxDel = headers.indexOf("isDeleted");
  const map = {};
  for (const r of rows) {
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")!==String(userId||"")) continue;
    if (String(r[idxAnno]||"")!==String(anno||"")) continue;
    const sid = String(r[idxSoc]||"");
    if (!sid) continue;
    map[sid] = rowToObj_(headers, r);
  }
  return map;
}

function upsertSocietaTariffe_(userId, societaId, anno, l1, l2, l3, valuta) {
  const sh = ss_().getSheetByName(SHEETS.societa_tariffe);
  const { headers, rows } = readAll_(sh);
  const idxUid = headers.indexOf("utente_id");
  const idxSoc = headers.indexOf("societa_id");
  const idxAnno = headers.indexOf("anno_esercizio");
  const idxDel = headers.indexOf("isDeleted");
  const idxUpd = headers.indexOf("updatedAt");
  const now = nowIso_();
  const sid = String(societaId||"");
  const y = String(anno||"");
  for (let i=0;i<rows.length;i++){
    const r=rows[i];
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")!==String(userId||"")) continue;
    if (String(r[idxSoc]||"")!==sid) continue;
    if (String(r[idxAnno]||"")!==y) continue;
    const up = {"L1_importo":String(l1||""),"L2_importo":String(l2||""),"L3_importo":String(l3||""),"valuta":String(valuta||"EUR")};
    Object.entries(up).forEach(([k,v])=>{
      const c=headers.indexOf(k); if (c>=0) sh.getRange(i+2,c+1).setValue(v);
    });
    if (idxUpd>=0) sh.getRange(i+2, idxUpd+1).setValue(now);
    return;
  }
  const id = uuid_();
  const row = headers.map(h=>{
    switch(h){
      case "id": return id;
      case "utente_id": return String(userId||"");
      case "societa_id": return sid;
      case "anno_esercizio": return y;
      case "L1_importo": return String(l1||"");
      case "L2_importo": return String(l2||"");
      case "L3_importo": return String(l3||"");
      case "valuta": return String(valuta||"EUR");
      case "createdAt": return now;
      case "updatedAt": return now;
      case "isDeleted": return "0";
      default: return "";
    }
  });
  sh.appendRow(row);
}

/* -------------------- Terapie CRUD -------------------- */
function addTherapy_(userId, payloadStr) {
  ensureAllSheets_();
  userId = String(userId||"");
  const payload = parseJson_(payloadStr, {});
  const now = nowIso_();
  const sh = ss_().getSheetByName(SHEETS.terapie);
  const { headers } = readAll_(sh);
  const id = uuid_();
  const row = headers.map(h=>{
    switch(h){
      case "id": return id;
      case "utente_id": return userId;
      case "paziente_id": return String(payload.paziente_id||"");
      case "livello": return String(payload.livello||"L1");
      case "valid_from": return String(payload.valid_from||"");
      case "valid_to": return String(payload.valid_to||"");
      case "weekdays_json": return String(payload.weekdays_json||"[]");
      case "from_time": return String(payload.from_time||"");
      case "to_time": return String(payload.to_time||"");
      case "note": return String(payload.note||"");
      case "createdAt": return now;
      case "updatedAt": return now;
      case "isDeleted": return "0";
      default: return "";
    }
  });
  sh.appendRow(row);
  return rowToObj_(headers, row);
}

function updateTherapy_(userId, id, payloadStr) {
  ensureAllSheets_();
  userId = String(userId||"");
  id = String(id||"");
  const payload = parseJson_(payloadStr, {});
  const sh = ss_().getSheetByName(SHEETS.terapie);
  const { headers, rows } = readAll_(sh);
  const idxId = headers.indexOf("id");
  const idxUid = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  const now = nowIso_();
  for (let i=0;i<rows.length;i++){
    const r=rows[i];
    if (idxDel>=0 && String(r[idxDel]||"")==="1") continue;
    if (String(r[idxUid]||"")!==userId) continue;
    if (String(r[idxId]||"")!==id) continue;
    const up = {
      paziente_id: String(payload.paziente_id||r[headers.indexOf("paziente_id")]||""),
      livello: String(payload.livello||r[headers.indexOf("livello")]||"L1"),
      valid_from: String(payload.valid_from||""),
      valid_to: String(payload.valid_to||""),
      weekdays_json: String(payload.weekdays_json||"[]"),
      from_time: String(payload.from_time||""),
      to_time: String(payload.to_time||""),
      note: String(payload.note||""),
      updatedAt: now
    };
    Object.entries(up).forEach(([k,v])=>{ const c=headers.indexOf(k); if (c>=0) sh.getRange(i+2,c+1).setValue(v); });
    return { id: id };
  }
  throw new Error("Terapia non trovata");
}

function deleteTherapy_(userId, id) {
  ensureAllSheets_();
  userId = String(userId||"");
  id = String(id||"");
  const sh = ss_().getSheetByName(SHEETS.terapie);
  const { headers, rows } = readAll_(sh);
  const idxId = headers.indexOf("id");
  const idxUid = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  const idxUpd = headers.indexOf("updatedAt");
  const now = nowIso_();
  for (let i=0;i<rows.length;i++){
    const r=rows[i];
    if (String(r[idxUid]||"")!==userId) continue;
    if (String(r[idxId]||"")!==id) continue;
    if (idxDel>=0) sh.getRange(i+2, idxDel+1).setValue("1");
    if (idxUpd>=0) sh.getRange(i+2, idxUpd+1).setValue(now);
    return { id, deleted:true };
  }
  throw new Error("Terapia non trovata");
}


function doGet(e) {
  try {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    const action = (e && e.parameter && e.parameter.action ? String(e.parameter.action).trim() : "");
    if (!action) return out_({ ok: false, error: "Missing action" }, cb);

    // Ensure schema exists for all requests (idempotent)
    if (action !== "ping") ensureAllSheets_();

    switch (action) {
      case "ping":
        return out_({ ok: true, ts: nowIso_(), version: "2.000" }, cb);

      // Auth
      case "listUsers":
        return out_({ ok: true, users: listUsers_() }, cb);
      case "createUser":
        return out_({ ok: true, user: createUser_(e.parameter.nome, e.parameter.password) }, cb);
      case "login":
        return out_({ ok: true, user: login_(e.parameter.nome, e.parameter.password) }, cb);
      case "updatePassword":
        return out_({ ok: true, user: updatePassword_(e.parameter.nome, e.parameter.oldPassword, e.parameter.newPassword) }, cb);

      // Settings
      case "getSettings":
        return out_({ ok: true, settings: getSettings_(e.parameter.userId) }, cb);
      case "saveSettings":
        return out_({ ok: true, settings: saveSettings_(e.parameter.userId, e.parameter.payload) }, cb);

      // Società
      case "addSocieta":
        return out_({ ok: true, societa: addSocieta_(
          e.parameter.userId,
          e.parameter.nome,
          e.parameter.tag,   // tag_colore
          e.parameter.l1, e.parameter.l2, e.parameter.l3,
          e.parameter.valuta
        ) }, cb);
      case "deleteSocieta":
        return out_({ ok: true, societa: deleteSocieta_(e.parameter.userId, e.parameter.id, e.parameter.nome) }, cb);
      case "listSocieta":
        return out_({ ok: true, societa: listSocieta_(e.parameter.userId) }, cb);

      // Pazienti
      case "listPatients":
        return out_({ ok: true, patients: listPatients_(e.parameter.userId), pazienti: listPatients_(e.parameter.userId) }, cb);
      case "createPatient":
        return out_({ ok: true, patient: createPatient_(e.parameter.userId, e.parameter.payload) }, cb);
      case "updatePatient":
        return out_({ ok: true, patient: updatePatient_(e.parameter.userId, e.parameter.id, e.parameter.payload) }, cb);
      case "deletePatient":
        return out_({ ok: true, patient: deletePatient_(e.parameter.userId, e.parameter.id) }, cb);

      // Terapie / Move
      case "listTherapies":
        return out_({ ok: true, therapies: listTherapies_(e.parameter.userId, e.parameter.pazienteId), terapie: listTherapies_(e.parameter.userId, e.parameter.pazienteId) }, cb);
      
case "addTherapy":
  return out_({ ok: true, therapy: addTherapy_(e.parameter.userId, e.parameter.payload) }, cb);
case "updateTherapy":
  return out_({ ok: true, therapy: updateTherapy_(e.parameter.userId, e.parameter.id, e.parameter.payload) }, cb);
case "deleteTherapy":
  return out_({ ok: true, therapy: deleteTherapy_(e.parameter.userId, e.parameter.id) }, cb);

case "listMoves":

        return out_({ ok: true, moves: listMoves_(e.parameter.userId, e.parameter.pazienteId), spostamenti: listMoves_(e.parameter.userId, e.parameter.pazienteId) }, cb);
      case "moveSession": {
        // Supports both legacy JSON payload and flat params (paziente_id/from_date/from_time/to_date/to_time/note...)
        const payload = e.parameter.payload ? parseJson_(e.parameter.payload, {}) : {
          paziente_id: e.parameter.paziente_id,
          from_date: e.parameter.from_date,
          from_time: e.parameter.from_time,
          to_date: e.parameter.to_date,
          to_time: e.parameter.to_time,
          note: e.parameter.note,
          importo: e.parameter.importo,
          valuta: e.parameter.valuta
        };
        return out_({ ok: true, move: moveSessionObj_(e.parameter.userId, payload) }, cb);
      }

      case "deleteSession": {
        // App-side delete is recorded as a "move" without destination (to_date/to_time empty)
        if (e.parameter.id) {
          return out_({ ok: true, res: deleteSessionById_(e.parameter.userId, e.parameter.id) }, cb);
        }
        const payload = {
          paziente_id: e.parameter.paziente_id,
          from_date: e.parameter.from_date,
          from_time: e.parameter.from_time,
          to_date: "",
          to_time: "",
          note: e.parameter.note || ""
        };
        return out_({ ok: true, move: moveSessionObj_(e.parameter.userId, payload) }, cb);
      }


      // Data ops
      case "wipeAll":
        return out_({ ok: true, res: wipeAll_(e.parameter.userId) }, cb);

      default:
        return out_({ ok: false, error: "Unknown action: " + action }, cb);
    }
  } catch (err) {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    return out_({ ok: false, error: String(err && err.message ? err.message : err) }, cb);
  }
}
