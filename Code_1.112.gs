// Code_1.112
/**
 * AMF - Google Apps Script Web App API
 * Deploy as Web App (doGet) and paste /exec URL into config.js (API_URL).
 */
const SPREADSHEET_ID = "1Bx8z3UvERM0ecN6WP6mrG01sGl_Pr3rdVW9Tjxp5vmA";
const CODE_VERSION = "Code_1.112";

const SHEETS = {
  impostazioni: "impostazioni",
  utenti: "utenti",
  pazienti: "pazienti",

  // Terapie multiple
  terapie: "terapie",

  // Eventi singoli / eccezioni (drag&drop)
  sedute: "sedute",

  // Società (nome reale in Sheet: "società")
  societa: "società", // accetta anche "societa" come fallback in sheet_()

  // Legacy (se presenti in vecchi deploy non devono rompere)
  piani_terapia: "piani_terapia",
  orari_terapia: "orari_terapia"
};

function doGet(e) {
  try {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    const action = (e.parameter.action || "").trim();
    const t = new Date().toISOString();
    if (!action) return out_({ ok: false, error: "Missing action" }, cb);

    switch (action) {
      case "listUsers":
        return out_({ ok: true, users: listUsers_() }, cb);
      case "createUser":
        return out_({ ok: true, user: createUser_(e.parameter.nome, e.parameter.password) }, cb);
      case "login":
        return out_({ ok: true, user: login_(e.parameter.nome, e.parameter.password) }, cb);
      case "updatePassword":
        return out_({ ok: true, user: updatePassword_(e.parameter.nome, e.parameter.oldPassword, e.parameter.newPassword) }, cb);
      case "getSettings":
        return out_({ ok: true, settings: getSettings_(e.parameter.userId) }, cb);
      case "saveSettings":
        return out_({ ok: true, settings: saveSettings_(e.parameter.userId, e.parameter.payload) }, cb);
      case "addSocieta":
        return out_({ ok: true, societa: addSocieta_(
          e.parameter.userId,
          e.parameter.nome,
          e.parameter.tag,
          e.parameter.l1,
          e.parameter.l2,
          e.parameter.l3
        ) }, cb);
      case "deleteSocieta":
        return out_({ ok: true, societa: deleteSocieta_(e.parameter.userId, e.parameter.id, e.parameter.nome) }, cb);
      case "listSocieta":
        return out_({ ok: true, societa: listSocieta_(e.parameter.userId) }, cb);
      case "listPatients":
        return out_({ ok: true, pazienti: listPatients_(e.parameter.userId) }, cb);
      case "createPatient":
        return out_({ ok: true, paziente: createPatient_(e.parameter.userId, e.parameter.payload) }, cb);
      case "updatePatient":
        return out_({ ok: true, paziente: updatePatient_(e.parameter.userId, e.parameter.id, e.parameter.payload) }, cb);
      case "deletePatient":
        return out_({ ok: true, paziente: deletePatient_(e.parameter.userId, e.parameter.id) }, cb);
      case "wipeAll":
        wipeAll_(e.parameter.userId);
        return out_({ ok: true }, cb);
      case "ping":
        return out_({ ok: true, t, code: CODE_VERSION, schema: "terapie.giorni_settimana" }, cb);
      case "listMoves":
        return out_({ ok: true, moves: listMoves_(e.parameter.userId, e.parameter.year, e.parameter.month) }, cb);
            case "moveSession":
        return out_({ ok: true, move: moveSession_(
          e.parameter.userId,
          e.parameter.paziente_id,
          e.parameter.terapia_id,
          e.parameter.from_date,
          e.parameter.from_time,
          e.parameter.to_date,
          e.parameter.to_time
        ) }, cb);
      case "deleteSession":
        return out_({ ok: true, move: deleteSession_(
          e.parameter.userId,
          e.parameter.paziente_id,
          e.parameter.terapia_id,
          e.parameter.from_date,
          e.parameter.from_time
        ) }, cb);
      default:
        return out_({ ok: false, error: "Unknown action" }, cb);
    }
  } catch (err) {
    const cb = sanitizeCallback_(e && e.parameter ? e.parameter.callback : "");
    return out_({ ok: false, error: String(err && err.message ? err.message : err) }, cb);
  }
}

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const ss = ss_();
  let s = ss.getSheetByName(name);

  // Fallback per nomi con/ senza accento
  if (!s && name === "società") s = ss.getSheetByName("societa");
  if (!s && name === "societa") s = ss.getSheetByName("società");

  if (!s) throw new Error("Missing sheet: " + name);
  return s;
}

function now_() {
  return new Date().toISOString();
}

function uuid_() {
  return Utilities.getUuid();
}


function genId_() {
  return uuid_();
}
function sha256_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function userHash_(userId, password) {
  return sha256_(password + "|" + userId);
}

function listUsers_() {
  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || !row[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);
    // non esportare hash
    delete obj.pin_hash;
    out.push(obj);
  }
  return out.filter(u => String(u.attivo).toLowerCase() !== "false");
}

function createUser_(nome, password) {
  if (!nome) throw new Error("Nome richiesto");
  if (!password) throw new Error("Password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (h) => headers.indexOf(h) + 1;

  const id = uuid_();
  const createdAt = now_();
  const updatedAt = createdAt;
  const hash = userHash_(id, password);

  // prevent duplicate name (case-insensitive)
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[col("nome")-1]).trim().toLowerCase() === String(nome).trim().toLowerCase()) {
      throw new Error("Utente già esistente");
    }
  }

  const row = new Array(headers.length).fill("");
  row[col("id")-1] = id;
  row[col("nome")-1] = nome;
  if (col("email") > 0) row[col("email")-1] = "";
  if (col("ruolo") > 0) row[col("ruolo")-1] = "admin";
  if (col("attivo") > 0) row[col("attivo")-1] = true;
  row[col("pin_hash")-1] = hash;
  if (col("createdAt") > 0) row[col("createdAt")-1] = createdAt;
  if (col("updatedAt") > 0) row[col("updatedAt")-1] = updatedAt;

  sh.appendRow(row);

  return { id, nome };
}

function login_(nome, password) {
  if (!nome) throw new Error("Nome richiesto");
  if (!password) throw new Error("Password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun utente");
  const headers = values[0];
  const col = (h) => headers.indexOf(h);

  const idxNome = col("nome");
  const idxId = col("id");
  const idxHash = col("pin_hash");
  const idxAttivo = col("attivo");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[idxId]) continue;
    if (String(r[idxNome]).trim().toLowerCase() !== String(nome).trim().toLowerCase()) continue;
    if (idxAttivo >= 0 && String(r[idxAttivo]).toLowerCase() === "false") throw new Error("Utente non attivo");
    const userId = String(r[idxId]);
    const expected = String(r[idxHash]);
    const got = userHash_(userId, password);
    if (got !== expected) throw new Error("Password errata");
    return { id: userId, nome: r[idxNome] };
  }
  throw new Error("Utente non trovato");
}

function updatePassword_(nome, oldPassword, newPassword) {
  if (!nome) throw new Error("Nome richiesto");
  if (!oldPassword) throw new Error("Password attuale richiesta");
  if (!newPassword) throw new Error("Nuova password richiesta");

  const sh = sheet_(SHEETS.utenti);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const col = (h) => headers.indexOf(h);

  const idxNome = col("nome");
  const idxId = col("id");
  const idxHash = col("pin_hash");
  const idxUpdated = col("updatedAt");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[idxId]) continue;
    if (String(r[idxNome]).trim().toLowerCase() !== String(nome).trim().toLowerCase()) continue;

    const userId = String(r[idxId]);
    const expected = String(r[idxHash]);
    const got = userHash_(userId, oldPassword);
    if (got !== expected) throw new Error("Password attuale errata");

    const newHash = userHash_(userId, newPassword);
    sh.getRange(i+1, idxHash+1).setValue(newHash);
    if (idxUpdated >= 0) sh.getRange(i+1, idxUpdated+1).setValue(now_());
    return { id: userId, nome: r[idxNome] };
  }
  throw new Error("Utente non trovato");
}

function getSettings_(userId) {
  const sh = sheet_(SHEETS.impostazioni);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return {};
  const headers = values[0];
  const idxKey = headers.indexOf("key");
  const idxVal = headers.indexOf("value");
  if (idxKey < 0 || idxVal < 0) throw new Error("Schema impostazioni non valido");

  const out = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const k = String(r[idxKey] || "").trim();
    if (!k) continue;
    out[k] = r[idxVal];
  }
  return out;
}

function saveSettings_(userId, payloadJson) {
  const payload = payloadJson ? JSON.parse(payloadJson) : {};
  const sh = sheet_(SHEETS.impostazioni);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idxKey = headers.indexOf("key");
  const idxVal = headers.indexOf("value");
  const idxUpd = headers.indexOf("updatedAt");
  if (idxKey < 0 || idxVal < 0) throw new Error("Schema impostazioni non valido");

  const mapRow = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][idxKey] || "").trim();
    if (k) mapRow[k] = i+1;
  }

  const keys = ["anno_esercizio","tariffa_livello_1","tariffa_livello_2","tariffa_livello_3"];
  const now = now_();
  keys.forEach(k => {
    const v = (payload[k] !== undefined) ? payload[k] : "";
    if (mapRow[k]) {
      sh.getRange(mapRow[k], idxVal+1).setValue(v);
      if (idxUpd >= 0) sh.getRange(mapRow[k], idxUpd+1).setValue(now);
    } else {
      const row = new Array(headers.length).fill("");
      row[idxKey] = k;
      row[idxVal] = v;
      if (idxUpd >= 0) row[idxUpd] = now;
      sh.appendRow(row);
    }
  });
  return getSettings_(userId);
}


function addSocieta_(userId, nome, tag, l1, l2, l3) {
  if (!nome) throw new Error("Nome società richiesto");
  if (!userId) throw new Error("userId richiesto");
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("id_user");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxTag = headers.indexOf("tag");
  const idxL1 = headers.indexOf("L1");
  const idxL2 = headers.indexOf("L2");
  const idxL3 = headers.indexOf("L3");
  const idxCre = headers.indexOf("createdAt");
  const idxUpd = headers.indexOf("updatedAt");

  const now = now_();
  const nameNorm = String(nome || "").trim();
  const nameKey = nameNorm.toLowerCase();

  const tagNum = Math.max(0, Math.min(5, parseInt(tag, 10) || 0));

  // Se esiste già (stesso nome) PER LO STESSO USER, riattiva e aggiorna tag/valori
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const rUser = idxUser >= 0 ? String(r[idxUser] || "").trim() : "";
    if (idxUser >= 0 && rUser !== String(userId)) continue;
    const existingName = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!existingName) continue;
    if (existingName.toLowerCase() !== nameKey) continue;

    const rowNum = i + 1;
    if (idxAtt >= 0) sh.getRange(rowNum, idxAtt + 1).setValue(true);
    if (idxTag >= 0) sh.getRange(rowNum, idxTag + 1).setValue(tagNum);
    if (idxL1 >= 0) sh.getRange(rowNum, idxL1 + 1).setValue(l1 !== undefined ? l1 : "");
    if (idxL2 >= 0) sh.getRange(rowNum, idxL2 + 1).setValue(l2 !== undefined ? l2 : "");
    if (idxL3 >= 0) sh.getRange(rowNum, idxL3 + 1).setValue(l3 !== undefined ? l3 : "");
    if (idxUpd >= 0) sh.getRange(rowNum, idxUpd + 1).setValue(now);

    const id = idxId >= 0 ? String(r[idxId] || "").trim() : "";
    return { id: id || "", id_user: String(userId), nome: nameNorm, tag: tagNum, L1: l1, L2: l2, L3: l3 };
  }

  const id = uuid_();
  const row = new Array(headers.length).fill("");

  if (idxId >= 0) row[idxId] = id;
  if (idxUser >= 0) row[idxUser] = String(userId);
  if (idxNome >= 0) row[idxNome] = nameNorm;
  if (idxAtt >= 0) row[idxAtt] = true;
  if (idxTag >= 0) row[idxTag] = tagNum;
  if (idxL1 >= 0) row[idxL1] = l1 !== undefined ? l1 : "";
  if (idxL2 >= 0) row[idxL2] = l2 !== undefined ? l2 : "";
  if (idxL3 >= 0) row[idxL3] = l3 !== undefined ? l3 : "";
  if (idxCre >= 0) row[idxCre] = now;
  if (idxUpd >= 0) row[idxUpd] = now;

  sh.appendRow(row);
  return { id, id_user: String(userId), nome: nameNorm, tag: tagNum, L1: l1, L2: l2, L3: l3 };
}



function listSocieta_(userId) {
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];
  const idxUser = headers.indexOf("id_user");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxId = headers.indexOf("id");
  const idxTag = headers.indexOf("tag");
  const idxL1 = headers.indexOf("L1");
  const idxL2 = headers.indexOf("L2");
  const idxL3 = headers.indexOf("L3");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    // Multi-account: restituisce solo le società dell'account corrente
    if (idxUser >= 0 && String(r[idxUser] || "").trim() !== String(userId || "").trim()) continue;

    const nome = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (!nome) continue;
    const att = idxAtt >= 0 ? r[idxAtt] : true;
    if (String(att).toLowerCase() === "false") continue;

    const tagRaw = idxTag >= 0 ? r[idxTag] : 0;
    const tag = Math.max(0, Math.min(5, parseInt(tagRaw, 10) || 0));

    out.push({
      id: idxId >= 0 ? r[idxId] : "",
      nome,
      tag,
      L1: idxL1 >= 0 ? r[idxL1] : "",
      L2: idxL2 >= 0 ? r[idxL2] : "",
      L3: idxL3 >= 0 ? r[idxL3] : ""
    });
  }
  out.sort((a,b) => String(a.nome).localeCompare(String(b.nome), "it", { sensitivity: "base" }));
  return out;
}



function deleteSocieta_(userId, id, nome) {
  const sh = sheet_(SHEETS.societa);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessuna società");
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("id_user");
  const idxNome = headers.indexOf("nome");
  const idxAtt = headers.indexOf("attiva");
  const idxUpd = headers.indexOf("updatedAt");

  const idKey = String(id || "").trim();
  const nameKey = String(nome || "").trim().toLowerCase();
  if (!idKey && !nameKey) throw new Error("Id o nome richiesto");

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (idxUser >= 0 && String(r[idxUser] || "").trim() !== String(userId || "").trim()) continue;
    const rid = idxId >= 0 ? String(r[idxId] || "").trim() : "";
    const rname = idxNome >= 0 ? String(r[idxNome] || "").trim() : "";
    if (idKey && rid && rid === idKey) { rowNum = i + 1; break; }
    if (!idKey && rname && rname.toLowerCase() === nameKey) { rowNum = i + 1; break; }
  }
  if (rowNum < 0) throw new Error("Società non trovata");

  if (idxAtt >= 0) sh.getRange(rowNum, idxAtt + 1).setValue(false);
  if (idxUpd >= 0) sh.getRange(rowNum, idxUpd + 1).setValue(now_());

  return { id: idKey || "", nome: nome || "" };
}


function listPatients_(userId) {
  const shP = sheet_(SHEETS.pazienti);
  const valuesP = shP.getDataRange().getValues();
  if (valuesP.length <= 1) return [];

  const headersP = valuesP[0] || [];
  const idxId = headersP.indexOf("id");
  const idxDel = headersP.indexOf("isDeleted");
  const idxUser = headersP.indexOf("utente_id");

  // Carica tutte le terapie (multi-terapia) e raggruppa per paziente_id
  const shT = ensureTerapieSheet_();
  const valuesT = shT.getDataRange().getValues();
  const headersT = (valuesT && valuesT.length) ? (valuesT[0] || []) : [];
  const idxTPatient = headersT.indexOf("paziente_id");
  const idxTUser = headersT.indexOf("utente_id");
  const idxTDel = headersT.indexOf("isDeleted");

  const idxTId = headersT.indexOf("id");
  const idxTSoc = headersT.indexOf("societa_id");
  const idxTLiv = headersT.indexOf("livello");
  const idxTStart = headersT.indexOf("data_inizio");
  const idxTEnd = headersT.indexOf("data_fine");
  const idxTGiorni = headersT.indexOf("giorni_settimana");
  const idxTAttiva = headersT.indexOf("attiva");
  const idxTNote = headersT.indexOf("note");

  const byPatient = {};
  for (let i = 1; i < valuesT.length; i++) {
    const r = valuesT[i];
    if (!r) continue;

    if (idxTDel >= 0 && String(r[idxTDel] || "").toLowerCase() === "true") continue;
    if (idxTUser >= 0 && userId && String(r[idxTUser] || "") !== String(userId)) continue;

    const pid = idxTPatient >= 0 ? String(r[idxTPatient] || "").trim() : "";
    if (!pid) continue;

    const t = {
      id: idxTId >= 0 ? String(r[idxTId] || "").trim() : "",
      societa_id: idxTSoc >= 0 ? String(r[idxTSoc] || "").trim() : "",
      livello: idxTLiv >= 0 ? String(r[idxTLiv] || "").trim() : "",
      data_inizio: normalizeYmd_(idxTStart >= 0 ? r[idxTStart] : ""),
      data_fine: normalizeYmd_(idxTEnd >= 0 ? r[idxTEnd] : ""),
      giorni_settimana: (idxTGiorni >= 0 ? (r[idxTGiorni] || "{}") : "{}"),
      attiva: (idxTAttiva >= 0 ? r[idxTAttiva] : true),
      note: (idxTNote >= 0 ? (r[idxTNote] || "") : "")
    };

    if (!byPatient[pid]) byPatient[pid] = [];
    byPatient[pid].push(t);
  }

  // Ordina terapie per data_inizio (utile per scegliere legacy fields)
  Object.keys(byPatient).forEach((pid) => {
    byPatient[pid].sort((a, b) => {
      const da = ymdToDate_(a.data_inizio);
      const db = ymdToDate_(b.data_inizio);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });
  });


  // Carica spostamenti/override sedute (drag&drop) e calcola la data più lontana per paziente.
  // Serve per aggiornare la "scadenza" nelle card pazienti anche dopo spostamenti nel foglio "sedute".
  const seduteMaxByPatient = {};
  try {
    const shS = ensureSeduteSheet_();
    const valuesS = shS.getDataRange().getValues();
    if (valuesS && valuesS.length > 1) {
      const headersS = valuesS[0] || [];
      const idxSUser = headersS.indexOf("utente_id");
      const idxSPatient = headersS.indexOf("paziente_id");
      const idxSAction = headersS.indexOf("azione");
      const idxSDate = headersS.indexOf("data");
      const idxSDel = headersS.indexOf("isDeleted");

      for (let i = 1; i < valuesS.length; i++) {
        const r = valuesS[i];
        if (!r) continue;

        if (idxSDel >= 0 && String(r[idxSDel] || "").toLowerCase() === "true") continue;
        if (idxSUser >= 0 && userId && String(r[idxSUser] || "") !== String(userId)) continue;

        const pid = idxSPatient >= 0 ? String(r[idxSPatient] || "").trim() : "";
        if (!pid) continue;

        // Considera solo MOVE (o azione vuota su legacy)
        const act = idxSAction >= 0 ? String(r[idxSAction] || "").trim().toUpperCase() : "";
        if (act && act !== "MOVE") continue;

        const ymd = normalizeYmd_(idxSDate >= 0 ? r[idxSDate] : "");
        if (!ymd) continue;

        const prev = seduteMaxByPatient[pid] || "";
        // confronto lessicografico su YYYY-MM-DD
        if (!prev || String(ymd) > String(prev)) seduteMaxByPatient[pid] = String(ymd);
      }
    }
  } catch (err) {
    // non bloccare la lista pazienti se il foglio sedute non è disponibile
  }

  const out = [];
  for (let i = 1; i < valuesP.length; i++) {
    const r = valuesP[i];
    if (!r) continue;

    const id = idxId >= 0 ? r[idxId] : "";
    if (!id) continue;

    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
    if (idxUser >= 0 && userId && String(r[idxUser] || "") !== String(userId)) continue;

    const obj = {};
    headersP.forEach((h, j) => obj[h] = r[j]);

    // Allego terapie come JSON string (compat con app)
    const pid = String(obj.id || "").trim();
    const therapies = byPatient[pid] || [];
    obj.terapie = JSON.stringify(therapies);

    // Data massima da foglio 'sedute' (spostamenti drag&drop)
    obj.sedute_max_data = seduteMaxByPatient[pid] || "";

    // Legacy fields (compat): usa la prima terapia se presente
    if (therapies.length) {
      const t0 = therapies[0];
      obj.societa_id = t0.societa_id || obj.societa_id || "";
      obj.livello = t0.livello || obj.livello || "";
      obj.data_inizio = t0.data_inizio || obj.data_inizio || "";
      obj.data_fine = t0.data_fine || obj.data_fine || "";
      obj.giorni_settimana = t0.giorni_settimana || obj.giorni_settimana || "{}";
    } else {
      // garantisci campi vuoti se non presenti sullo sheet
      if (!Object.prototype.hasOwnProperty.call(obj, "societa_id")) obj.societa_id = "";
      if (!Object.prototype.hasOwnProperty.call(obj, "livello")) obj.livello = "";
      if (!Object.prototype.hasOwnProperty.call(obj, "data_inizio")) obj.data_inizio = "";
      if (!Object.prototype.hasOwnProperty.call(obj, "data_fine")) obj.data_fine = "";
      if (!Object.prototype.hasOwnProperty.call(obj, "giorni_settimana")) obj.giorni_settimana = "{}";
    }

    out.push(obj);
  }

  return out;
}


function createPatient_(userId, payloadJson) {
  if (!userId) throw new Error("UserId richiesto");
  const payload = payloadJson ? JSON.parse(payloadJson) : {};

  const now = new Date().toISOString();
  const id = genId_();

  const sh = sheet_(SHEETS.pazienti);
  const headers = sh.getDataRange().getValues()[0] || [];
  const col = (name) => headers.indexOf(name) + 1;

  const row = Array(headers.length).fill("");
  if (col("id") > 0) row[col("id") - 1] = id;
  if (col("utente_id") > 0) row[col("utente_id") - 1] = String(userId);
  if (col("nome_cognome") > 0) row[col("nome_cognome") - 1] = String(payload.nome_cognome || "").trim();
  if (col("address") > 0) row[col("address") - 1] = String(payload.address || payload.indirizzo || "").trim();
  if (col("note") > 0) row[col("note") - 1] = payload.note || "";
  if (col("isDeleted") > 0) row[col("isDeleted") - 1] = false;
  if (col("createdAt") > 0) row[col("createdAt") - 1] = now;
  if (col("updatedAt") > 0) row[col("updatedAt") - 1] = now;

  sh.appendRow(row);

  // Terapie: accetta payload.terapie (JSON) oppure fallback ai campi legacy nel payload
  upsertTherapiesForPatient_(userId, id, payload);

  return { id };
}



function updatePatient_(userId, patientId, payloadJson) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("PatientId richiesto");
  const payload = payloadJson ? JSON.parse(payloadJson) : {};

  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");

  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");

  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (idxId >= 0 && String(r[idxId] || "") === String(patientId)) {
      if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") throw new Error("Paziente eliminato");
      if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) throw new Error("Non autorizzato");
      rowIndex = i + 1; // 1-based
      break;
    }
  }
  if (rowIndex < 0) throw new Error("Paziente non trovato");

  const setIfCol = (name, val) => {
    const idx = headers.indexOf(name);
    if (idx >= 0) sh.getRange(rowIndex, idx + 1).setValue(val);
  };

  setIfCol("nome_cognome", String(payload.nome_cognome || "").trim());
  setIfCol("address", String(payload.address || payload.indirizzo || "").trim());
  setIfCol("note", payload.note || "");
  setIfCol("updatedAt", new Date().toISOString());

  // Terapie: upsert univoco per id (insert/update) + hard delete delle schede rimosse
  upsertTherapiesForPatient_(userId, String(patientId), payload);

  return { id: String(patientId) };
}


function deletePatient_(userId, patientId) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("Id paziente richiesto");

  // Hard delete paziente
  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");

  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");

  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (idxId >= 0 && String(r[idxId] || "") === String(patientId)) {
      if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) throw new Error("Non autorizzato");
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex < 0) throw new Error("Paziente non trovato");

  // 1) Elimina righe collegate in tutti i fogli noti
  hardDeletePatientEverywhere_(userId, patientId);

  // 2) Elimina riga paziente
  sh.deleteRow(rowIndex);

  return { id: String(patientId) };
}


function wipeAll_(userId) {
  const ss = ss_();
  const targets = [
    SHEETS.impostazioni,
    SHEETS.utenti,
    SHEETS.pazienti,
    SHEETS.piani_terapia,
    SHEETS.orari_terapia,
    SHEETS.sedute,
    SHEETS.societa
  ];
  targets.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (last >= 2 && lastCol >= 1) {
      sh.getRange(2, 1, last-1, lastCol).clearContent();
    }
  });
}


// -------------------------------
// Sedute / Spostamenti (override calendario)
// -------------------------------
const SEDUTE_HEADERS = [
  "id",
  "utente_id",
  "paziente_id",
  "from_date",
  "from_time",
  "to_date",
  "to_time",
  "isDeleted",
  "createdAt",
  "updatedAt"
];

function ensureSeduteSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.sedute);
  if (!sh) sh = ss.insertSheet(SHEETS.sedute);

  const headers = [
    "id","utente_id","paziente_id","terapia_id","azione",
    "orig_data","orig_ora","data","ora",
    "note","isDeleted","createdAt","updatedAt"
  ];

  const rng = sh.getDataRange();
  const values = rng.getValues();
  if (!values || values.length === 0) {
    sh.appendRow(headers);
    return sh;
  }

  const first = values[0] || [];
  const missing = headers.filter((h) => first.indexOf(h) < 0);

  // Se sheet vecchio (from_date...), crea intestazione corretta preservando dati esistenti
  const hasLegacy = first.indexOf("from_date") >= 0 || first.indexOf("to_date") >= 0;
  if (hasLegacy) {
    // Mappa legacy -> nuovo schema
    const idx = (h) => first.indexOf(h);
    const out = [headers];
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      const row = Array(headers.length).fill("");
      row[headers.indexOf("id")] = r[idx("id")] || r[0] || "";
      row[headers.indexOf("utente_id")] = idx("utente_id")>=0 ? r[idx("utente_id")] : "";
      row[headers.indexOf("paziente_id")] = idx("paziente_id")>=0 ? r[idx("paziente_id")] : "";
      row[headers.indexOf("terapia_id")] = idx("terapia_id")>=0 ? r[idx("terapia_id")] : "";
      row[headers.indexOf("azione")] = "MOVE";
      row[headers.indexOf("orig_data")] = normalizeYmd_(idx("from_date")>=0 ? r[idx("from_date")] : "");
      row[headers.indexOf("orig_ora")] = normalizeTime_(idx("from_time")>=0 ? r[idx("from_time")] : "");
      row[headers.indexOf("data")] = normalizeYmd_(idx("to_date")>=0 ? r[idx("to_date")] : "");
      row[headers.indexOf("ora")] = normalizeTime_(idx("to_time")>=0 ? r[idx("to_time")] : "");
      row[headers.indexOf("note")] = idx("note")>=0 ? r[idx("note")] : "";
      row[headers.indexOf("isDeleted")] = idx("isDeleted")>=0 ? r[idx("isDeleted")] : false;
      row[headers.indexOf("createdAt")] = idx("createdAt")>=0 ? r[idx("createdAt")] : "";
      row[headers.indexOf("updatedAt")] = idx("updatedAt")>=0 ? r[idx("updatedAt")] : "";
      out.push(row);
    }
    sh.clearContents();
    sh.getRange(1,1,out.length,headers.length).setValues(out);
    return sh;
  }

  if (missing.length) {
    // aggiungi colonne mancanti in coda
    sh.getRange(1, first.length + 1, 1, missing.length).setValues([missing]);
  }

  return sh;
}

function normalizeTime_(t) {
  t = String(t || "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseYmd_(s) {
  s = String(s || "").trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

function ymdToDate_(ymd) {
  if (Object.prototype.toString.call(ymd) === "[object Date]" && !isNaN(ymd.getTime())) {
    const d = new Date(ymd.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const norm = normalizeYmd_(ymd);
  const p = parseYmd_(norm);
  if (!p) return null;
  const d = new Date(p.y, p.m - 1, p.d);
  d.setHours(0, 0, 0, 0);
  return d;
}


function dateToYmd_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}


function normalizeYmd_(v) {
  // Accepts Date objects, ISO strings (YYYY-MM-DD...), or other date-like strings.
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return dateToYmd_(v);
  }
  const s = String(v).trim();
  const ymd = s.slice(0, 10);
  if (parseYmd_(ymd)) return ymd;

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    d.setHours(0, 0, 0, 0);
    return dateToYmd_(d);
  }
  return "";
}

function listMoves_(userId, yearStr, monthStr) {
  if (!userId) throw new Error("UserId richiesto");
  const year = parseInt(String(yearStr || "").trim(), 10);
  const month = parseInt(String(monthStr || "").trim(), 10); // 1..12
  if (!year || !month) return [];

  const start = new Date(year, month - 1, 1); start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0); end.setHours(0, 0, 0, 0);

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0] || [];

  const idxUser = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  const idxPid = headers.indexOf("paziente_id");
  const idxTid = headers.indexOf("terapia_id");
  const idxAct = headers.indexOf("azione");
  const idxOD = headers.indexOf("orig_data");
  const idxOT = headers.indexOf("orig_ora");
  const idxD = headers.indexOf("data");
  const idxT = headers.indexOf("ora");
  const idxId = headers.indexOf("id");
  const idxNote = headers.indexOf("note");
  const idxCA = headers.indexOf("createdAt");
  const idxUA = headers.indexOf("updatedAt");

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;

    const act = String(idxAct >= 0 ? (r[idxAct] || "") : "").trim().toUpperCase();
    const od = normalizeYmd_(idxOD >= 0 ? r[idxOD] : "");
    const d = normalizeYmd_(idxD >= 0 ? r[idxD] : "");
    const fd = ymdToDate_(od);
    const td = ymdToDate_(d);

    const inMonth =
      (fd && fd.getTime() >= start.getTime() && fd.getTime() <= end.getTime()) ||
      (td && td.getTime() >= start.getTime() && td.getTime() <= end.getTime());

    // per CANCEL, conta solo orig_data
    const inMonthCancel =
      act === "CANCEL" && (fd && fd.getTime() >= start.getTime() && fd.getTime() <= end.getTime());

    if (!inMonth && !inMonthCancel) continue;

    // Output compatibile con app: from_/to_ (MOVE) oppure from_ con to_ vuoti (CANCEL)
    out.push({
      id: (idxId >= 0 ? r[idxId] : ""),
      utente_id: (idxUser >= 0 ? r[idxUser] : ""),
      paziente_id: (idxPid >= 0 ? r[idxPid] : ""),
      terapia_id: (idxTid >= 0 ? r[idxTid] : ""),
      from_date: od,
      from_time: normalizeTime_(idxOT >= 0 ? r[idxOT] : ""),
      to_date: (act === "MOVE" || act === "ADD") ? d : "",
      to_time: (act === "MOVE" || act === "ADD") ? normalizeTime_(idxT >= 0 ? r[idxT] : "") : "",
      azione: act || "MOVE",
      note: (idxNote >= 0 ? r[idxNote] : ""),
      createdAt: (idxCA >= 0 ? r[idxCA] : ""),
      updatedAt: (idxUA >= 0 ? r[idxUA] : "")
    });
  }
  return out;
}

function getPatientRow_(userId, patientId) {
  const sh = sheet_(SHEETS.pazienti);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) throw new Error("Nessun paziente");
  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");
  if (idxId < 0) throw new Error("Colonna id mancante");

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (String(r[idxId] || "") !== String(patientId)) continue;
    if (idxUser >= 0 && userId && String(r[idxUser] || "") !== String(userId)) throw new Error("Non autorizzato");

    const obj = {};
    headers.forEach((h, j) => obj[h] = r[j]);
    return { sh, headers, rowNum: i + 1, patient: obj };
  }
  throw new Error("Paziente non trovato");
}

function updatePatientEndAfterMove_(pr, fromDate, toDate) {
  if (!pr || !pr.sh || !pr.headers || !pr.rowNum) return "";
  const sh = pr.sh;
  const headers = pr.headers;
  const rowNum = pr.rowNum;
  const p = pr.patient || {};
  const col = (h) => headers.indexOf(h) + 1;

  const now = now_();
  const fromY = normalizeYmd_(fromDate) || String(fromDate || "").slice(0, 10);
  const toY = normalizeYmd_(toDate) || String(toDate || "").slice(0, 10);

  let therapies = [];
  let therapiesChanged = false;

  try {
    const raw = p.terapie;
    if (raw && typeof raw === "string" && raw.trim()) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) therapies = j;
    } else if (Array.isArray(raw)) {
      therapies = raw;
    }
  } catch (e) {}

  // aggiorna end della terapia che aveva la scadenza uguale al giorno spostato
  if (Array.isArray(therapies) && therapies.length) {
    for (let i = 0; i < therapies.length; i++) {
      const t = therapies[i] || {};
      const end0 = normalizeYmd_(t.data_fine) || String(t.data_fine || "").slice(0, 10);
      if (end0 && end0 === fromY) {
        t.data_fine = toY;
        therapies[i] = t;
        therapiesChanged = true;
      }
    }
  }

  // fallback legacy: se la scadenza paziente coincide con fromDate, aggiornala
  let legacyEnd = normalizeYmd_(p.data_fine) || String(p.data_fine || "").slice(0, 10);
  if (legacyEnd && legacyEnd === fromY) legacyEnd = toY;

  // ricalcola scadenza massima dalle terapie (se presenti)
  let maxEnd = legacyEnd || "";
  if (Array.isArray(therapies) && therapies.length) {
    for (let i = 0; i < therapies.length; i++) {
      const t = therapies[i] || {};
      const e = normalizeYmd_(t.data_fine) || String(t.data_fine || "").slice(0, 10);
      if (e) {
        if (!maxEnd) maxEnd = e;
        else if (parseYmd_(e) && parseYmd_(maxEnd) && parseYmd_(e).getTime() > parseYmd_(maxEnd).getTime()) maxEnd = e;
      }
    }
  }

  // scrivi su sheet
  if (col("data_fine") > 0) sh.getRange(rowNum, col("data_fine")).setValue(maxEnd || "");
  if (therapiesChanged && col("terapie") > 0) sh.getRange(rowNum, col("terapie")).setValue(JSON.stringify(therapies));
  if (col("updatedAt") > 0) sh.getRange(rowNum, col("updatedAt")).setValue(now);

  return maxEnd || "";
}

function normDayLabel_(s) {
  s = String(s || "").trim().toUpperCase();
  // accetta "LUN", "LU", "MON" ecc. -> normalizza a 2 lettere italiane
  if (s.startsWith("LUN") || s === "MON") return "LU";
  if (s.startsWith("MAR") || s === "TUE") return "MA";
  if (s.startsWith("MER") || s === "WED") return "ME";
  if (s.startsWith("GIO") || s === "THU") return "GI";
  if (s.startsWith("VEN") || s === "FRI") return "VE";
  if (s.startsWith("SAB") || s === "SAT") return "SA";
  if (s.startsWith("DOM") || s === "SUN") return "DO";
  if (s === "LUNEDÌ" || s === "LUNEDI") return "LU";
  if (s === "MARTEDÌ" || s === "MARTEDI") return "MA";
  if (s === "MERCOLEDÌ" || s === "MERCOLEDI") return "ME";
  if (s === "GIOVEDÌ" || s === "GIOVEDI") return "GI";
  if (s === "VENERDÌ" || s === "VENERDI") return "VE";
  if (s === "SABATO") return "SA";
  if (s === "DOMENICA") return "DO";
  if (s === "LU" || s === "MA" || s === "ME" || s === "GI" || s === "VE" || s === "SA" || s === "DO") return s;
  return s;
}

function weekdayKey_(dayLabel) {
  // JS: 0=Sun..6=Sat
  const x = normDayLabel_(dayLabel);
  if (x === "DO") return 0;
  if (x === "LU") return 1;
  if (x === "MA") return 2;
  if (x === "ME") return 3;
  if (x === "GI") return 4;
  if (x === "VE") return 5;
  if (x === "SA") return 6;
  // numeric support: 1..7 (7=Sunday)
  if (/^\d+$/.test(String(dayLabel || "").trim())) {
    const n = parseInt(String(dayLabel || "").trim(), 10);
    if (n === 7) return 0;
    if (n >= 0 && n <= 6) return n;
    if (n >= 1 && n <= 6) return n;
  }
  return null;
}

function parseGiorniMap_(raw) {
  if (!raw) return {};
  try {
    if (typeof raw === "object") return raw;
    const s = String(raw || "").trim();
    if (!s) return {};
    if (s.startsWith("{") || s.startsWith("[")) {
      const obj = JSON.parse(s);
      return (obj && typeof obj === "object") ? obj : {};
    }
    return {};
  } catch (e) {
    return {};
  }
}

function normalizeTimeList_(v) {
  const out = [];
  if (v == null) return out;
  if (Array.isArray(v)) {
    v.forEach((x) => { const t = normalizeTime_(x); if (t && t !== "—") out.push(t); });
    return out;
  }
  const s = String(v || "").trim();
  if (!s) return out;
  if (s.includes(",")) {
    s.split(",").forEach((x) => { const t = normalizeTime_(x); if (t && t !== "—") out.push(t); });
    return out;
  }
  const t = normalizeTime_(s);
  if (t && t !== "—") out.push(t);
  return out;
}

function lastOccurrenceDateForPatient_(patient, movesForPatient) {
  const start = ymdToDate_(patient.data_inizio);
  const end0 = ymdToDate_(patient.data_fine);
  if (!start) return null;

  const moves = Array.isArray(movesForPatient) ? movesForPatient : [];
  let maxTo = null;

  moves.forEach((mv) => {
    const td = ymdToDate_(mv.to_date);
    if (td && (!maxTo || td.getTime() > maxTo.getTime())) maxTo = td;
  });

  // candidate end: max(original end, max to_date)
  let end = end0 || start;
  if (maxTo && maxTo.getTime() > end.getTime()) end = maxTo;

  // schedule map
  const map = parseGiorniMap_(patient.giorni_settimana || patient.giorni || "");
  const wkToTimes = {}; // wk -> times[]
  Object.keys(map || {}).forEach((k) => {
    const wk = weekdayKey_(k);
    if (wk == null) return;
    const times = normalizeTimeList_(map[k]);
    if (!times.length) return;
    wkToTimes[wk] = (wkToTimes[wk] || []).concat(times);
  });

  // moves sets
  const removed = {};
  const added = {};
  moves.forEach((mv) => {
    const fk = `${String(mv.from_date || "").slice(0, 10)}|${normalizeTime_(mv.from_time)}`;
    const tk = `${String(mv.to_date || "").slice(0, 10)}|${normalizeTime_(mv.to_time)}`;
    removed[fk] = true;
    added[tk] = true;
  });

  // scan backwards to find last day with at least one occurrence
  const cur = new Date(end);
  cur.setHours(0, 0, 0, 0);

  while (cur.getTime() >= start.getTime()) {
    const ymd = dateToYmd_(cur);

    // base occurrences for that day
    const wk = cur.getDay();
    const times = wkToTimes[wk] || [];
    let count = 0;
    times.forEach((t) => {
      const k = `${ymd}|${normalizeTime_(t)}`;
      if (!removed[k]) count += 1;
    });

    // added occurrences for that day
    // (any moved-to entry counts)
    Object.keys(added).forEach((k) => {
      if (k.startsWith(ymd + "|")) count += 1;
    });

    if (count > 0) return ymd;

    cur.setDate(cur.getDate() - 1);
  }
  return dateToYmd_(start);
}

function purgeSeduteForPatientTherapies_(userId, patientId, removedTherapies) {
  if (!userId || !patientId) return;
  const list = Array.isArray(removedTherapies) ? removedTherapies : [];
  if (!list.length) return;

  const ids = {};
  const ranges = [];
  list.forEach((t) => {
    const id = String(t && t.id ? t.id : "").trim();
    if (id) ids[id] = true;

    const s = ymdToDate_(normalizeYmd_(t && t.data_inizio ? t.data_inizio : ""));
    const e = ymdToDate_(normalizeYmd_(t && t.data_fine ? t.data_fine : ""));
    ranges.push({ s: s, e: e });
  });

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return;
  const headers = values[0] || [];

  const idxUser = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxTid = headers.indexOf("terapia_id");
  const idxOD = headers.indexOf("orig_data");
  const idxD = headers.indexOf("data");

  const out = [headers];

  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];

    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) { out.push(r); continue; }
    if (idxPid >= 0 && String(r[idxPid] || "") !== String(patientId)) { out.push(r); continue; }

    const tid = (idxTid >= 0) ? String(r[idxTid] || "").trim() : "";
    if (tid && ids[tid]) continue;

    // compat: righe storiche senza terapia_id -> elimina se orig_data (o data) ricade nella finestra della terapia rimossa
    if (!tid && ranges.length) {
      const od = normalizeYmd_(idxOD >= 0 ? r[idxOD] : "");
      const d = normalizeYmd_(idxD >= 0 ? r[idxD] : "");
      const cand = ymdToDate_(od) || ymdToDate_(d);
      if (cand) {
        const ct = cand.getTime();
        let hit = false;
        for (let j = 0; j < ranges.length; j++) {
          const s = ranges[j].s;
          const e = ranges[j].e;
          if (s && ct < s.getTime()) continue;
          if (e && ct > e.getTime()) continue;
          hit = true;
          break;
        }
        if (hit) continue;
      }
    }

    out.push(r);
  }

  if (out.length === values.length) return;

  sh.clearContents();
  sh.getRange(1, 1, out.length, headers.length).setValues(out);
}


function moveSession_(userId, patientId, terapiaId, from_date, from_time, to_date, to_time) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("Paziente richiesto");

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (name) => headers.indexOf(name) + 1;

  const now = new Date().toISOString();
  const id = genId_();

  const row = Array(headers.length).fill("");
  if (col("id") > 0) row[col("id") - 1] = id;
  if (col("utente_id") > 0) row[col("utente_id") - 1] = String(userId);
  if (col("paziente_id") > 0) row[col("paziente_id") - 1] = String(patientId);

  // terapia_id opzionale: se viene passato dal client
  // (lasciato vuoto se non presente)
  if (col("terapia_id") > 0) row[col("terapia_id") - 1] = String(terapiaId || "").trim();

  if (col("azione") > 0) row[col("azione") - 1] = "MOVE";
  if (col("orig_data") > 0) row[col("orig_data") - 1] = normalizeYmd_(from_date);
  if (col("orig_ora") > 0) row[col("orig_ora") - 1] = normalizeTime_(from_time);
  if (col("data") > 0) row[col("data") - 1] = normalizeYmd_(to_date);
  if (col("ora") > 0) row[col("ora") - 1] = normalizeTime_(to_time);

  if (col("note") > 0) row[col("note") - 1] = "";
  if (col("isDeleted") > 0) row[col("isDeleted") - 1] = false;
  if (col("createdAt") > 0) row[col("createdAt") - 1] = now;
  if (col("updatedAt") > 0) row[col("updatedAt") - 1] = now;

  sh.appendRow(row);

  // Non aggiornare mai la data_fine nel foglio 'terapie' a seguito di MOVE/CANCEL

  return { id };
}



function deleteSession_(userId, patientId, terapiaId, from_date, from_time) {
  if (!userId) throw new Error("UserId richiesto");
  if (!patientId) throw new Error("Paziente richiesto");

  const sh = ensureSeduteSheet_();
  const values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const col = (name) => headers.indexOf(name);

  const now = new Date().toISOString();
  const id = genId_();

  // Registra una CANCEL come eccezione (non rimuove righe MOVE esistenti)
  const row = Array(headers.length).fill("");
  if (col("id") >= 0) row[col("id")] = id;
  if (col("utente_id") >= 0) row[col("utente_id")] = String(userId);
  if (col("paziente_id") >= 0) row[col("paziente_id")] = String(patientId);
  if (col("terapia_id") >= 0) row[col("terapia_id")] = String(terapiaId || "").trim();
  if (col("azione") >= 0) row[col("azione")] = "CANCEL";
  if (col("orig_data") >= 0) row[col("orig_data")] = normalizeYmd_(from_date);
  if (col("orig_ora") >= 0) row[col("orig_ora")] = normalizeTime_(from_time);
  if (col("data") >= 0) row[col("data")] = "";
  if (col("ora") >= 0) row[col("ora")] = "";
  if (col("note") >= 0) row[col("note")] = "";
  if (col("isDeleted") >= 0) row[col("isDeleted")] = false;
  if (col("createdAt") >= 0) row[col("createdAt")] = now;
  if (col("updatedAt") >= 0) row[col("updatedAt")] = now;

  sh.appendRow(row);

  // Non aggiornare mai la data_fine nel foglio 'terapie' a seguito di MOVE/CANCEL

  return { id };
}


/**
 * Ricalcola e persiste la scadenza (data_fine) della terapia:
 * - Se l'ultima azione per terapia_id è MOVE/ADD -> scadenza = data dell'ultima azione
 * - Se l'ultima azione è CANCEL -> scadenza = ultima casella effettivamente occupata (calcolata da schema terapia + sedute)
 */
function recomputeAndPersistTherapyEnd_(userId, patientId, terapiaId) {
  terapiaId = String(terapiaId || "").trim();
  if (!terapiaId) return;

  const tr = getTerapiaRowById_(userId, patientId, terapiaId);
  if (!tr) return;

  const th = tr.therapy;
  const lastYmd = computeTherapyLastDate_(userId, patientId, terapiaId, th);
  if (!lastYmd) return;

  const cur = normalizeYmd_(th.data_fine) || String(th.data_fine || "").slice(0, 10);
  if (cur && cur === lastYmd) return;

  const sh = tr.sh;
  const headers = tr.headers;
  const rowNum = tr.rowNum;
  const idxEnd = headers.indexOf("data_fine");
  const idxUA = headers.indexOf("updatedAt");

  if (idxEnd >= 0) sh.getRange(rowNum, idxEnd + 1).setValue(lastYmd);
  if (idxUA >= 0) sh.getRange(rowNum, idxUA + 1).setValue(now_());
}

/**
 * Trova la riga terapia nel foglio "terapie" per id, verificando utente_id e paziente_id.
 */
function getTerapiaRowById_(userId, patientId, terapiaId) {
  const sh = ensureTerapieSheet_();
  const values = sh.getDataRange().getValues();
  if (!values || values.length <= 1) return null;

  const headers = values[0] || [];
  const idxId = headers.indexOf("id");
  const idxUser = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  if (idxId < 0) return null;

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    if (String(r[idxId] || "").trim() !== String(terapiaId)) continue;
    if (idxUser >= 0 && userId && String(r[idxUser] || "") !== String(userId)) return null;
    if (idxPid >= 0 && patientId && String(r[idxPid] || "") !== String(patientId)) return null;

    const th = {};
    headers.forEach((h, j) => th[h] = r[j]);
    return { sh, headers, rowNum: i + 1, therapy: th };
  }
  return null;
}

/**
 * Calcola l'ultima data effettivamente occupata dalla terapia.
 */
function computeTherapyLastDate_(userId, patientId, terapiaId, therapyRow) {
  const th = therapyRow || {};
  const startY = normalizeYmd_(th.data_inizio) || String(th.data_inizio || "").slice(0, 10);
  const endY0 = normalizeYmd_(th.data_fine) || String(th.data_fine || "").slice(0, 10);

  const start = ymdToDate_(startY);
  const end0 = ymdToDate_(endY0);
  if (!start || !end0) return endY0 || "";

  // Carica sedute per questa terapia
  const shS = ensureSeduteSheet_();
  const values = shS.getDataRange().getValues();
  if (!values || values.length <= 1) return endY0 || "";

  const headers = values[0] || [];
  const idxUser = headers.indexOf("utente_id");
  const idxPid = headers.indexOf("paziente_id");
  const idxTid = headers.indexOf("terapia_id");
  const idxAct = headers.indexOf("azione");
  const idxOD = headers.indexOf("orig_data");
  const idxOT = headers.indexOf("orig_ora");
  const idxD = headers.indexOf("data");
  const idxT = headers.indexOf("ora");
  const idxDel = headers.indexOf("isDeleted");
  const idxCA = headers.indexOf("createdAt");
  const idxUA = headers.indexOf("updatedAt");

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;

    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;
    if (idxUser >= 0 && userId && String(r[idxUser] || "") !== String(userId)) continue;
    if (idxPid >= 0 && patientId && String(r[idxPid] || "") !== String(patientId)) continue;
    if (idxTid >= 0 && String(r[idxTid] || "").trim() !== String(terapiaId)) continue;

    const act = String(idxAct >= 0 ? (r[idxAct] || "") : "").trim().toUpperCase() || "MOVE";
    const od = normalizeYmd_(idxOD >= 0 ? r[idxOD] : "");
    const ot = normalizeTime_(idxOT >= 0 ? r[idxOT] : "");
    const d = normalizeYmd_(idxD >= 0 ? r[idxD] : "");
    const t = normalizeTime_(idxT >= 0 ? r[idxT] : "");

    const ts = parseIsoTs_(idxUA >= 0 ? r[idxUA] : "") || parseIsoTs_(idxCA >= 0 ? r[idxCA] : "") || i;

    rows.push({ act, od, ot, d, t, ts });
  }

  if (!rows.length) return endY0 || "";

  // Ultima azione globale (regola MOVE vs CANCEL)
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const last = rows[rows.length - 1];

  if (last && (last.act === "MOVE" || last.act === "ADD") && last.d) {
    return String(last.d);
  }

  // CANCEL (o altri casi): calcola l'ultima casella effettivamente occupata
  const overrideByOrig = {};
  rows.forEach((r) => {
    const key = r.od && r.ot ? `${r.od}|${r.ot}` : "";
    if (!key) return;
    const cur = overrideByOrig[key];
    if (!cur || (r.ts || 0) >= (cur.ts || 0)) overrideByOrig[key] = r;
  });

  const giorniMap = parseGiorniMap_(th.giorni_settimana || th.giorni || "{}");
  const weekdayNums = [];
  Object.keys(giorniMap || {}).forEach((k) => {
    const kk = String(k || "").trim().toUpperCase();
    if (!kk) return;
    if (kk === "LU") weekdayNums.push({ w: 1, key: k });
    else if (kk === "MA") weekdayNums.push({ w: 2, key: k });
    else if (kk === "ME") weekdayNums.push({ w: 3, key: k });
    else if (kk === "GI") weekdayNums.push({ w: 4, key: k });
    else if (kk === "VE") weekdayNums.push({ w: 5, key: k });
    else if (kk === "SA") weekdayNums.push({ w: 6, key: k });
    else if (kk === "DO" || kk === "SU" || kk === "DOM") weekdayNums.push({ w: 0, key: k });
    else if (/^\d+$/.test(kk)) {
      const n = parseInt(kk, 10);
      if (n === 7) weekdayNums.push({ w: 0, key: k });
      else if (n >= 0 && n <= 6) weekdayNums.push({ w: n, key: k });
      else if (n >= 1 && n <= 6) weekdayNums.push({ w: n, key: k });
    }
  });

  let maxYmd = "";
  const curDate = new Date(start); curDate.setHours(0, 0, 0, 0);
  const endDate = new Date(end0); endDate.setHours(0, 0, 0, 0);

  while (curDate.getTime() <= endDate.getTime()) {
    const wk = curDate.getDay();
    weekdayNums.forEach((winfo) => {
      if (winfo.w !== wk) return;
      const times = normalizeTimeList_(giorniMap[winfo.key]);
      if (!times.length) return;

      const ymd = dateToYmd_(curDate);
      times.forEach((tt) => {
        const origKey = `${ymd}|${tt}`;
        const ov = overrideByOrig[origKey];
        if (ov) {
          if (ov.act === "CANCEL") return;
          const effY = ov.d || "";
          if (effY && (!maxYmd || String(effY) > String(maxYmd))) maxYmd = String(effY);
          return;
        }
        if (!maxYmd || String(ymd) > String(maxYmd)) maxYmd = String(ymd);
      });
    });

    curDate.setDate(curDate.getDate() + 1);
  }

  // Considera anche eventuali destinazioni MOVE/ADD fuori range base
  rows.forEach((r) => {
    if ((r.act === "ADD" || r.act === "MOVE") && r.d) {
      if (!maxYmd || String(r.d) > String(maxYmd)) maxYmd = String(r.d);
    }
  });

  return maxYmd || endY0 || "";
}

function parseIsoTs_(v) {
  const s = String(v || "").trim();
  if (!s) return 0;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const s2 = s.replace(" ", "T");
  const d2 = new Date(s2);
  if (!isNaN(d2.getTime())) return d2.getTime();
  return 0;
}

function sanitizeCallback_(cb) {
  cb = String(cb || "").trim();
  if (!cb) return "";
  cb = cb.replace(/[^0-9A-Za-z_$.]/g, "");
  if (!cb) return "";
  if (!/^[A-Za-z_$]/.test(cb)) return "";
  return cb;
}

function out_(obj, cb) {
  const txt = JSON.stringify(obj);
  if (cb) {
    return ContentService
      .createTextOutput(cb + "(" + txt + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(txt)
    .setMimeType(ContentService.MimeType.JSON);
}


function normalizeHeaderKey_(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureTerapieSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.terapie);
  if (!sh) sh = ss.insertSheet(SHEETS.terapie);

  const headers = [
    "id","utente_id","paziente_id","societa_id",
    "livello", // opzionale: se non lo usi puoi lasciarlo vuoto
    "data_inizio","data_fine","giorni_settimana",
    "attiva","note","isDeleted","createdAt","updatedAt"
  ];

  const values = sh.getDataRange().getValues();
  if (!values || values.length === 0) {
    sh.appendRow(headers);
    return sh;
  }

  const first = values[0] || [];
  const firstStr = first.map((x) => (x == null ? "" : String(x)));
  const firstKeys = firstStr.map((x) => normalizeHeaderKey_(x));
  const desiredKeys = headers.map((h) => normalizeHeaderKey_(h));

  // Se la riga header è vuota, imposta direttamente gli header canonici
  if (firstKeys.filter(Boolean).length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }

  // Canonicalizza header: trim/case/spazi/simboli (es. "giorni settimana" -> "giorni_settimana")
  for (let i = 0; i < headers.length; i++) {
    const key = desiredKeys[i];
    const canonical = headers[i];
    const j = firstKeys.indexOf(key);
    if (j >= 0) {
      const cur = String(firstStr[j] || "").trim();
      if (cur !== canonical) {
        sh.getRange(1, j + 1).setValue(canonical);
        firstStr[j] = canonical;
        firstKeys[j] = key;
      }
    }
  }

  const present = new Set(firstKeys.filter(Boolean));
  const missing = [];
  for (let i = 0; i < headers.length; i++) {
    const key = desiredKeys[i];
    if (!present.has(key)) missing.push(headers[i]);
  }

  if (missing.length) {
    sh.getRange(1, first.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}


function softDeleteByPatient_(sheetName, userId, patientId) {
  let sh;
  if (sheetName === SHEETS.sedute) sh = ensureSeduteSheet_();
  else if (sheetName === SHEETS.terapie) sh = ensureTerapieSheet_();
  else sh = sheet_(sheetName);

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return;

  const headers = values[0] || [];
  const idxPid = headers.indexOf("paziente_id");
  const idxUser = headers.indexOf("utente_id");
  const idxDel = headers.indexOf("isDeleted");
  const idxUpd = headers.indexOf("updatedAt");
  if (idxPid < 0) return;

  const now = new Date().toISOString();
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r) continue;
    if (String(r[idxPid] || "") !== String(patientId)) continue;
    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
    if (idxDel >= 0 && String(r[idxDel] || "").toLowerCase() === "true") continue;

    if (idxDel >= 0) sh.getRange(i + 1, idxDel + 1).setValue(true);
    if (idxUpd >= 0) sh.getRange(i + 1, idxUpd + 1).setValue(now);
  }
}

/**
 * Hard delete: rimuove fisicamente tutte le righe collegate a un paziente.
 * Cancella SOLO righe con header "paziente_id" (e opzionalmente "utente_id").
 */
function hardDeleteByPatient_(sheetName, userId, patientId) {
  let sh;
  if (sheetName === SHEETS.sedute) sh = ensureSeduteSheet_();
  else if (sheetName === SHEETS.terapie) sh = ensureTerapieSheet_();
  else sh = sheet_(sheetName);

  const values = sh.getDataRange().getValues();
  if (!values || values.length <= 1) return;

  const headers = values[0] || [];
  const idxPid = headers.indexOf("paziente_id");
  if (idxPid < 0) return;

  const idxUser = headers.indexOf("utente_id");

  // cancella dal basso per non shiftare gli indici
  for (let i = values.length - 1; i >= 1; i--) {
    const r = values[i];
    if (!r) continue;
    if (String(r[idxPid] || "") !== String(patientId)) continue;
    if (idxUser >= 0 && String(r[idxUser] || "") !== String(userId)) continue;
    sh.deleteRow(i + 1);
  }
}

function hardDeletePatientEverywhere_(userId, patientId) {
  // Sheets "note" al sistema (incluse legacy) dove cerchiamo la colonna paziente_id
  const targets = [
    SHEETS.terapie,
    SHEETS.sedute,
    SHEETS.piani_terapia,
    SHEETS.orari_terapia
  ];

  targets.forEach((name) => {
    try { hardDeleteByPatient_(name, userId, patientId); } catch (_) {}
  });
}


function upsertTherapiesForPatient_(userId, patientId, payload) {
  const shT = ensureTerapieSheet_();
  const valuesT = shT.getDataRange().getValues();
  const headersT = (valuesT && valuesT.length) ? (valuesT[0] || []) : [];
  const col = (name) => headersT.indexOf(name) + 1;

  const idxId = headersT.indexOf("id");
  const idxUser = headersT.indexOf("utente_id");
  const idxPid = headersT.indexOf("paziente_id");
  const idxDel = headersT.indexOf("isDeleted");

  const idxTStart = headersT.indexOf("data_inizio");
  const idxTEnd = headersT.indexOf("data_fine");

  if (idxId < 0 || idxPid < 0) throw new Error("Sheet terapie: header mancanti (id/paziente_id)");

  const now = new Date().toISOString();

  // --- 1) Leggi terapie esistenti (attive o anche soft-delete, ma verranno gestite dal sync)
  const existing = []; // { id, rowIndex }
  for (let i = 1; i < valuesT.length; i++) {
    const r = valuesT[i];
    if (!r) continue;

    if (String(r[idxPid] || "") !== String(patientId)) continue;
    if (idxUser >= 0) {
      const u = String(r[idxUser] || "").trim();
      if (u && u !== String(userId)) continue;
    }

    // Se esiste isDeleted e la riga è soft-deleted, la trattiamo comunque come "esistente":
    // in caso di update/riattivazione verrà rimessa a false.
    let rid = String(r[idxId] || "").trim();
    // Fix storico: righe senza ID -> assegna un id, così la terapia diventa gestibile (update/delete) e non duplica.
    if (!rid) {
      rid = genId_();
      shT.getRange(i + 1, idxId + 1).setValue(rid);
      if (col("createdAt") > 0) {
        const cv = shT.getRange(i + 1, col("createdAt")).getValue();
        if (!cv) shT.getRange(i + 1, col("createdAt")).setValue(now);
      }
      if (col("updatedAt") > 0) shT.getRange(i + 1, col("updatedAt")).setValue(now);
    }

    existing.push({ id: rid, rowIndex: i + 1, data_inizio: normalizeYmd_(idxTStart >= 0 ? r[idxTStart] : ""), data_fine: normalizeYmd_(idxTEnd >= 0 ? r[idxTEnd] : "") });
  }

  const existingById = {};
  existing.forEach(o => { existingById[o.id] = o.rowIndex; });

  // --- 2) Decodifica nuove terapie dal payload
  let arr = [];
  try {
    const raw = (payload && (payload.terapie ?? payload.terapia)) ?? "";
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === "string" && raw.trim()) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) arr = j;
    }
  } catch (_) { arr = []; }

  // fallback legacy: se payload porta solo Terapia 1
  if (!Array.isArray(arr) || !arr.length) {
    const di = String(payload.data_inizio || payload.start_date || payload.start || "").trim();
    const df = String(payload.data_fine || payload.end_date || payload.end || "").trim();
    const gs = payload.giorni_settimana || payload.weekdays || payload.giorni || "{}";
    const soc = String(payload.societa_id || payload.societaId || "").trim();
    const liv = String(payload.livello || "").trim();
    if (di || df || liv || soc) {
      arr = [{
        societa_id: soc,
        livello: liv,
        data_inizio: di,
        data_fine: df,
        giorni_settimana: gs,
        attiva: true
      }];
    }
  }

  const keepIds = new Set();

  // helper: aggiorna una riga esistente
  function updateRow_(rowIndex, t) {
    const societa_id = String(t?.societa_id || t?.societaId || payload.societa_id || payload.societaId || "").trim();
    const livello = String(t?.livello || "").trim();
    const di = normalizeYmd_(t?.data_inizio || t?.start || "");
    const df = normalizeYmd_(t?.data_fine || t?.end || "");
    let giorni = t?.giorni_settimana ?? t?.giorni_map ?? t?.giorni ?? "{}";
    if (typeof giorni === "object") {
      try { giorni = JSON.stringify(giorni); } catch (_) { giorni = "{}"; }
    }
    giorni = String(giorni || "{}");

    // Assicura i riferimenti (fix righe legacy)
    if (col("utente_id") > 0) shT.getRange(rowIndex, col("utente_id")).setValue(String(userId));
    if (col("paziente_id") > 0) shT.getRange(rowIndex, col("paziente_id")).setValue(String(patientId));

    if (col("societa_id") > 0) shT.getRange(rowIndex, col("societa_id")).setValue(societa_id);
    if (col("livello") > 0) shT.getRange(rowIndex, col("livello")).setValue(livello);
    if (col("data_inizio") > 0) shT.getRange(rowIndex, col("data_inizio")).setValue(di);
    if (col("data_fine") > 0) shT.getRange(rowIndex, col("data_fine")).setValue(df);
    if (col("giorni_settimana") > 0) shT.getRange(rowIndex, col("giorni_settimana")).setValue(giorni);
    if (col("attiva") > 0) shT.getRange(rowIndex, col("attiva")).setValue((t && t.attiva != null) ? t.attiva : true);
    if (col("note") > 0) shT.getRange(rowIndex, col("note")).setValue(t?.note || "");
    if (col("updatedAt") > 0) shT.getRange(rowIndex, col("updatedAt")).setValue(now);
  }

  // helper: inserisce una nuova riga
  function insertRow_(id, t) {
    const row = Array(headersT.length).fill("");

    const societa_id = String(t?.societa_id || t?.societaId || payload.societa_id || payload.societaId || "").trim();
    const livello = String(t?.livello || "").trim();
    const di = normalizeYmd_(t?.data_inizio || t?.start || "");
    const df = normalizeYmd_(t?.data_fine || t?.end || "");
    let giorni = t?.giorni_settimana ?? t?.giorni_map ?? t?.giorni ?? "{}";
    if (typeof giorni === "object") {
      try { giorni = JSON.stringify(giorni); } catch (_) { giorni = "{}"; }
    }
    giorni = String(giorni || "{}");

    if (col("id") > 0) row[col("id") - 1] = id;
    if (col("utente_id") > 0) row[col("utente_id") - 1] = String(userId);
    if (col("paziente_id") > 0) row[col("paziente_id") - 1] = String(patientId);
    if (col("societa_id") > 0) row[col("societa_id") - 1] = societa_id;
    if (col("livello") > 0) row[col("livello") - 1] = livello;
    if (col("data_inizio") > 0) row[col("data_inizio") - 1] = di;
    if (col("data_fine") > 0) row[col("data_fine") - 1] = df;
    if (col("giorni_settimana") > 0) row[col("giorni_settimana") - 1] = giorni;
    if (col("attiva") > 0) row[col("attiva") - 1] = (t && t.attiva != null) ? t.attiva : true;
    if (col("note") > 0) row[col("note") - 1] = t?.note || "";
    if (col("createdAt") > 0) row[col("createdAt") - 1] = now;
    if (col("updatedAt") > 0) row[col("updatedAt") - 1] = now;

    shT.appendRow(row);
  }

  // --- 3) Sync: update / insert e calcola cosa mantenere
  if (Array.isArray(arr) && arr.length) {
    arr.forEach((t) => {
      const incomingId = String(t?.id || t?.therapy_id || t?.terapia_id || "").trim();
      if (incomingId && existingById[incomingId]) {
        keepIds.add(incomingId);
        updateRow_(existingById[incomingId], t);
      } else {
        const idToUse = incomingId || genId_();
        keepIds.add(idToUse);
        insertRow_(idToUse, t);
      }
    });
  }

  // --- 4) Hard delete: tutte le terapie esistenti NON presenti nel payload
  // Se il payload non contiene terapie, l'utente ha cancellato tutto: elimina tutto.
  const toDeleteRowIdx = [];
  const removedTherapies = [];
  existing.forEach(o => {
    if (!keepIds.has(o.id)) {
      toDeleteRowIdx.push(o.rowIndex);
      removedTherapies.push({ id: o.id, data_inizio: o.data_inizio || "", data_fine: o.data_fine || "" });
    }
  });

  // Elimina anche gli spostamenti/cancellazioni sedute collegati alle terapie rimosse (o legacy senza terapia_id)
  if (removedTherapies.length) {
    purgeSeduteForPatientTherapies_(userId, String(patientId), removedTherapies);
  }

  // se arr è vuoto, keepIds è vuoto -> elimina tutto l'esistente
  toDeleteRowIdx.sort((a, b) => b - a).forEach((ri) => {
    shT.deleteRow(ri);
  });
}