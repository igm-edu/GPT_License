const SHEETS = {
  roots: ["id","name","email","billingDay","expiry","capacity","status","memo"],
  children: ["id","rootId","name","email","status","memo"],
  guests: ["id","name","email","organization","rootId","courseId","start","end","removedAt","memo"],
  courses: ["id","title","start","end","required","assigned","memberMode","rootId","manager","status","memo"]
};

// These values represent the date and time entered by an operator, not an
// instant that should move when a Google account uses another time zone.
const TEXT_DATE_COLUMNS = {
  roots: ["expiry"],
  guests: ["start", "end", "removedAt"],
  courses: ["start", "end"]
};

function doGet(e) {
  try { return json_({ok:true, data:readAll_()}); }
  catch (error) { return json_({ok:false, error:String(error)}); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const body = JSON.parse(e.postData.contents || "{}");
    if (body.action !== "saveAll" || !body.data) throw new Error("Invalid request");
    validate_(body.data);
    Object.keys(SHEETS).forEach(key => writeSheet_(key, body.data[key] || []));
    writeSettings_(body.data.settings || {});
    return json_({ok:true});
  } catch (error) { return json_({ok:false, error:String(error)}); }
  finally { lock.releaseLock(); }
}

function setup() {
  Object.keys(SHEETS).forEach(key => writeSheet_(key, []));
  writeSettings_({ownerUsesSeat:true});
}

function readAll_() {
  const data = {};
  Object.keys(SHEETS).forEach(key => data[key] = readSheet_(key));
  data.settings = readSettings_();
  return data;
}

function readSheet_(name) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  return values.slice(1).filter(row => row[0] !== "").map(row => Object.fromEntries(headers.map((h,i) => [h, normalize_(row[i], timeZone)])));
}

function writeSheet_(name, rows) {
  const sheet = getSheet_(name), headers = SHEETS[name];
  sheet.clearContents();
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold").setBackground("#dcece2");
  if (rows.length) {
    // Force date/date-time fields to plain text before writing. Without this,
    // Sheets may turn 2026-08-11T09:00 into a Date and shift it when the
    // spreadsheet and Apps Script time zones differ.
    (TEXT_DATE_COLUMNS[name] || []).forEach(header => {
      const column = headers.indexOf(header) + 1;
      if (column > 0) sheet.getRange(2, column, rows.length, 1).setNumberFormat("@");
    });
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows.map(row => headers.map(h => row[h] ?? "")));
  }
  sheet.setFrozenRows(1);
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeSettings_(settings) {
  const sheet = getSheet_("settings");
  sheet.clearContents();
  sheet.getRange(1,1,2,2).setValues([["key","value"],["ownerUsesSeat",String(settings.ownerUsesSeat !== false)]]);
}

function readSettings_() {
  const sheet = getSheet_("settings"), rows = sheet.getDataRange().getValues().slice(1);
  const values = Object.fromEntries(rows.filter(r => r[0]).map(r => [r[0], r[1]]));
  return {ownerUsesSeat:String(values.ownerUsesSeat) !== "false"};
}

function validate_(data) {
  ["roots","children","guests","courses"].forEach(k => { if (!Array.isArray(data[k])) throw new Error(`${k} must be an array`); });
  const ids = data.roots.map(r => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate root id");
  data.guests.forEach(g => { if (g.end < g.start) throw new Error("Guest end date is invalid"); });
  // Members must point at a workspace that still exists. Courses may leave
  // rootId blank, which means "let the app pick the workspace automatically".
  const rootIds = new Set(ids);
  data.children.forEach(c => { if (!rootIds.has(c.rootId)) throw new Error(`Unknown rootId on member ${c.email || c.id}`); });
  data.guests.forEach(g => { if (!rootIds.has(g.rootId)) throw new Error(`Unknown rootId on guest ${g.email || g.id}`); });
  data.courses.forEach(c => { if (c.rootId && !rootIds.has(c.rootId)) throw new Error(`Unknown rootId on course ${c.title || c.id}`); });
}

function normalize_(value, timeZone) {
  // Legacy rows may already be Date cells. Formatting them in the spreadsheet
  // time zone recovers the wall-clock value originally entered by the user.
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm");
  return value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
