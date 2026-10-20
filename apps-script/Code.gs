/*
 * ขุนคลัง — Apps Script (ตัวกลางระหว่างเว็บแอปกับ Google Sheet)
 * ต้องวางคู่กับ Core.gs และ Seed.gs (คัดลอกมาจาก web/core.js และ web/seed.js)
 */
var KK_TZ = 'Asia/Bangkok';

function kkDefs_() {
  return {
    // คอลัมน์ใหม่ต่อท้ายเสมอ เพื่อไม่ให้ข้อมูลเดิมในชีตเลื่อน
    accounts: { name: 'Accounts', fields: ['id', 'name', 'kind', 'currency', 'opening_balance', 'icon', 'sort', 'active', 'note', 'bank', 'number_hint'] },
    categories: { name: 'Categories', fields: ['id', 'type', 'group', 'name', 'default_account_id', 'default_asset_id', 'tax_tag', 'sort', 'active'] },
    assets: { name: 'Assets', fields: ['id', 'name', 'kind', 'icon', 'sort', 'active'] },
    favorites: { name: 'Favorites', fields: ['id', 'label', 'icon', 'type', 'account_id', 'to_account_id', 'category_id', 'asset_id', 'amount', 'sort', 'active'] },
    transactions: { name: 'Transactions', fields: KK.TX_FIELDS_V1.concat(['account_label', 'to_account_label', 'category_label', 'asset_label'], KK.TX_FIELDS_V2) },
    settings: { name: 'Settings', fields: ['key', 'value'] },
    rules: { name: 'Rules', fields: ['id', 'pattern', 'type', 'category_id', 'other_account_id', 'asset_id', 'sort', 'active', 'amount'] }
  };
}

// ---------------------------------------------------------------- เมนูในชีต

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ขุนคลัง')
    .addItem('1) ตั้งค่าเริ่มต้น (สร้างชีต + ข้อมูลตั้งต้น)', 'setup')
    .addItem('2) แสดงรหัส API', 'showApiKey')
    .addItem('สร้างรหัส API ใหม่', 'resetApiKey')
    .addSeparator()
    .addItem('เรียงชีต Transactions ตามวันที่', 'sortTransactions')
    .addToUi();
}

/** สร้างชีตทั้งหมด ใส่ข้อมูลตั้งต้นเฉพาะชีตที่ยังว่าง — รันซ้ำได้ ไม่ทับข้อมูลเดิม */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(KK_TZ);
  var defs = kkDefs_();

  Object.keys(defs).forEach(function (key) {
    var def = defs[key];
    kkWriteHeaders_(ss.getSheetByName(def.name) || ss.insertSheet(def.name), def.fields);
  });

  var tx = ss.getSheetByName(defs.transactions.name);
  var f = defs.transactions.fields;
  var col = function (name) { return f.indexOf(name) + 1; };
  ['id', 'note', 'slip_ref', 'created_at', 'updated_at', 'account_id', 'to_account_id', 'category_id', 'asset_id', 'counterparty', 'import_ref']
    .forEach(function (n) { tx.getRange(2, col(n), tx.getMaxRows() - 1, 1).setNumberFormat('@'); });
  tx.getRange(2, col('date'), tx.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  tx.getRange(2, col('amount'), tx.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');
  tx.getRange(2, col('to_amount'), tx.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');

  kkSeedIfEmpty_('accounts', KK_SEED.accounts, { opening_balance: 0, active: true });
  kkSeedIfEmpty_('categories', KK_SEED.categories, { active: true });
  kkSeedIfEmpty_('assets', KK_SEED.assets, { active: true });
  kkSeedIfEmpty_('favorites', KK_SEED.favorites, { active: true });
  var settingsRows = Object.keys(KK_SEED.settings).map(function (k) { return { key: k, value: KK_SEED.settings[k] }; });
  kkSeedIfEmpty_('settings', settingsRows, {});
  kkSeedIfEmpty_('rules', KK_SEED.rules, { active: true });

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  kkEnsureKey_();
  kkAlert_('ตั้งค่าเสร็จแล้ว ✅\n\nขั้นต่อไป: เมนู ขุนคลัง → แสดงรหัส API\nแล้วนำไป Deploy เป็น Web app ตามคู่มือ');
}

function kkSeedIfEmpty_(key, rows, defaults) {
  var def = kkDefs_()[key];
  var sh = kkSheet_(key);
  if (sh.getLastRow() > 1 || !rows.length) return;
  var values = rows.map(function (r, i) {
    return def.fields.map(function (f) {
      if (f === 'sort' && r.sort === undefined) return i + 1;
      if (r[f] !== undefined) return r[f];
      return defaults[f] !== undefined ? defaults[f] : '';
    });
  });
  sh.getRange(2, 1, values.length, def.fields.length).setValues(values);
}

/** เรียงแถวรายการตามวันที่ (เก่า → ใหม่) — แอปหารายการจาก id จึงเรียงได้ปลอดภัย */
function sortTransactions() {
  var sh = kkSheet_('transactions');
  var fields = kkDefs_().transactions.fields;
  var last = sh.getLastRow();
  if (last > 2) {
    sh.getRange(2, 1, last - 1, fields.length).sort([
      { column: fields.indexOf('date') + 1, ascending: true },
      { column: fields.indexOf('created_at') + 1, ascending: true }
    ]);
  }
  kkAlert_('เรียงตามวันที่แล้ว ✅');
}

function showApiKey() {
  kkAlert_('รหัส API ของคุณ (เก็บเป็นความลับ):\n\n' + kkEnsureKey_());
}

function resetApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  kkAlert_('รหัสใหม่:\n\n' + kkEnsureKey_() + '\n\nต้องใส่รหัสใหม่ในแอปทุกเครื่อง');
}

function kkEnsureKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('API_KEY', key);
  }
  return key;
}

// ---------------------------------------------------------------- Web API

function doGet() {
  return ContentService.createTextOutput('ขุนคลัง API ทำงานปกติ ✅');
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return kkJson_({ ok: false, error: 'คำขอไม่ถูกต้อง' });
  }
  var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key || req.key !== key) return kkJson_({ ok: false, error: 'รหัส API ไม่ถูกต้อง', code: 'unauthorized' });
  try {
    return kkJson_({ ok: true, result: kkHandle_(req.action, req.payload || {}) });
  } catch (err) {
    return kkJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function kkJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function kkHandle_(action, p) {
  switch (action) {
    case 'ping': return { time: new Date().toISOString() };
    case 'bootstrap': return kkBootstrap_(p.month);
    case 'listTx': return { txs: kkListTx_(p.month) };
    case 'saveTx': return kkWithLock_(function () { return kkSaveTx_(p.tx); });
    case 'deleteTx': return kkWithLock_(function () { return kkDeleteTx_(p.id); });
    case 'saveSettings': return kkWithLock_(function () { return kkSaveSettings_(p.settings || {}); });
    case 'saveTxBatch': return kkWithLock_(function () { return kkSaveTxBatch_(p.txs || []); });
    case 'saveRules': return kkWithLock_(function () { return kkSaveRules_(p.rules || []); });
    case 'updateAccounts': return kkWithLock_(function () { return kkUpdateAccounts_(p.updates || []); });
    case 'addAccount': return kkWithLock_(function () { return kkAddAccount_(p.account); });
    case 'saveCategories': return kkWithLock_(function () { return kkSaveCategories_(p.categories || []); });
    default: throw new Error('ไม่รู้จักคำสั่ง: ' + action);
  }
}

function kkWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- การอ่าน/เขียนชีต

var kkHeadersChecked_ = {};

function kkSheet_(key) {
  var def = kkDefs_()[key];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(def.name);
  if (!sh && key === 'rules') {
    // ชีตที่เพิ่มในรุ่นหลัง — สร้างให้เองโดยไม่ต้องรัน setup ใหม่
    sh = ss.insertSheet(def.name);
    kkWriteHeaders_(sh, def.fields);
    kkHeadersChecked_[key] = true;
    kkSeedIfEmpty_(key, KK_SEED.rules, { active: true });
  }
  if (!sh) throw new Error('ไม่พบชีต ' + def.name + ' — กรุณารันเมนู ขุนคลัง → ตั้งค่าเริ่มต้น');
  if (!kkHeadersChecked_[key]) {
    // เติมหัวคอลัมน์ที่เพิ่มมาในรุ่นใหม่ (ต่อท้าย) ให้อัตโนมัติ
    kkHeadersChecked_[key] = true;
    var have = sh.getRange(1, 1, 1, def.fields.length).getValues()[0];
    if (have.join('|') !== def.fields.join('|')) kkWriteHeaders_(sh, def.fields);
  }
  return sh;
}

function kkWriteHeaders_(sh, fields) {
  sh.getRange(1, 1, 1, fields.length).setValues([fields])
    .setFontWeight('bold').setBackground('#14532d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function kkRead_(key) {
  var def = kkDefs_()[key];
  var sh = kkSheet_(key);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, def.fields.length).getValues();
  return values.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    def.fields.forEach(function (f, i) { o[f] = kkCell_(f, r[i]); });
    return o;
  });
}

function kkCell_(field, v) {
  if (v instanceof Date) {
    return field === 'date' ? Utilities.formatDate(v, KK_TZ, 'yyyy-MM-dd') : v.toISOString();
  }
  return v;
}

function kkSettings_() {
  var s = {};
  kkRead_('settings').forEach(function (r) { s[r.key] = r.value; });
  return s;
}

function kkContext_() {
  var accounts = kkRead_('accounts'), categories = kkRead_('categories'), assets = kkRead_('assets');
  return {
    accounts: accounts, categories: categories, assets: assets,
    accountsById: KK.byId(accounts), categoriesById: KK.byId(categories), assetsById: KK.byId(assets)
  };
}

function kkBootstrap_(month) {
  var ctx = kkContext_();
  var txs = kkRead_('transactions');
  var bySort = function (a, b) { return KK.num(a.sort) - KK.num(b.sort); };
  return {
    accounts: ctx.accounts.sort(bySort),
    categories: ctx.categories.sort(bySort),
    assets: ctx.assets.sort(bySort),
    favorites: kkRead_('favorites').sort(bySort),
    rules: kkRead_('rules').sort(bySort),
    settings: kkSettings_(),
    balances: KK.computeBalances(ctx.accounts, txs),
    txs: kkFilterMonth_(txs, month)
  };
}

function kkFilterMonth_(txs, month) {
  return KK.sortTxDesc(txs.filter(function (t) {
    return !KK.isDeleted(t) && (!month || String(t.date).indexOf(month) === 0);
  }));
}

function kkListTx_(month) {
  return kkFilterMonth_(kkRead_('transactions'), month);
}

function kkFindRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  var cell = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function kkDateCell_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : s;
}

/** เพิ่มหรือแก้รายการ (ถ้ามี id อยู่แล้วจะแก้ไข — ส่งซ้ำได้ไม่เกิดรายการซ้ำ) */
function kkSaveTx_(input) {
  if (!input) throw new Error('ไม่มีข้อมูลรายการ');
  var ctx = kkContext_();
  var err = KK.validateTx(input, ctx.accountsById, ctx.categoriesById);
  if (err) throw new Error(err);

  var tx = KK.normalizeTx(input, ctx.accountsById);
  var sh = kkSheet_('transactions');
  var fields = kkDefs_().transactions.fields;
  var now = new Date().toISOString();
  if (!tx.id) tx.id = Utilities.getUuid();
  var row = kkFindRow_(sh, tx.id);

  if (row) {
    var oldCreated = sh.getRange(row, fields.indexOf('created_at') + 1).getValue();
    tx.created_at = kkCell_('created_at', oldCreated) || now;
  } else {
    tx.created_at = tx.created_at || now;
  }
  tx.updated_at = now;

  var full = Object.assign({}, tx, KK.labels(tx, ctx.accountsById, ctx.categoriesById, ctx.assetsById));
  var values = [fields.map(function (f) { return f === 'date' ? kkDateCell_(full.date) : full[f]; })];
  if (row) sh.getRange(row, 1, 1, fields.length).setValues(values);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, fields.length).setValues(values);

  return { tx: tx, balances: KK.computeBalances(ctx.accounts, kkRead_('transactions')) };
}

/** ลบแบบซ่อน (deleted = TRUE) ข้อมูลยังอยู่ในชีต กู้คืนได้ */
function kkDeleteTx_(id) {
  var sh = kkSheet_('transactions');
  var row = kkFindRow_(sh, id);
  if (row) {
    var fields = kkDefs_().transactions.fields;
    sh.getRange(row, fields.indexOf('deleted') + 1).setValue(true);
    sh.getRange(row, fields.indexOf('updated_at') + 1).setValue(new Date().toISOString());
  }
  var ctx = kkContext_();
  return { id: id, balances: KK.computeBalances(ctx.accounts, kkRead_('transactions')) };
}

function kkSaveSettings_(settings) {
  var sh = kkSheet_('settings');
  Object.keys(settings).forEach(function (k) {
    var row = kkFindRow_(sh, k);
    if (row) sh.getRange(row, 2).setValue(settings[k]);
    else sh.appendRow([k, settings[k]]);
  });
  return { settings: kkSettings_() };
}

/**
 * บันทึกหลายรายการในครั้งเดียว (ใช้ตอนนำเข้า Statement)
 * ข้ามรายการที่ import_ref หรือ id มีอยู่แล้ว — นำเข้าไฟล์เดิมซ้ำได้ไม่เกิดรายการซ้ำ
 */
function kkSaveTxBatch_(inputs) {
  var ctx = kkContext_();
  var sh = kkSheet_('transactions');
  var fields = kkDefs_().transactions.fields;
  var all = kkRead_('transactions');
  var seenRefs = {}, seenIds = {};
  all.forEach(function (t) {
    seenIds[t.id] = true;
    if (t.import_ref && !KK.isDeleted(t)) seenRefs[t.import_ref] = true;
  });
  var now = new Date().toISOString();
  var rows = [], skipped = 0, errors = [];

  inputs.forEach(function (input, i) {
    if ((input.import_ref && seenRefs[input.import_ref]) || (input.id && seenIds[input.id])) { skipped++; return; }
    var err = KK.validateTx(input, ctx.accountsById, ctx.categoriesById);
    if (err) { errors.push({ index: i, error: err }); return; }
    var tx = KK.normalizeTx(input, ctx.accountsById);
    if (!tx.id) tx.id = Utilities.getUuid();
    tx.created_at = now;
    tx.updated_at = now;
    seenIds[tx.id] = true;
    if (tx.import_ref) seenRefs[tx.import_ref] = true;
    all.push(tx);
    var full = Object.assign({}, tx, KK.labels(tx, ctx.accountsById, ctx.categoriesById, ctx.assetsById));
    rows.push(fields.map(function (f) { return f === 'date' ? kkDateCell_(full.date) : full[f]; }));
  });

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, fields.length).setValues(rows);
  return { saved: rows.length, skipped: skipped, errors: errors, balances: KK.computeBalances(ctx.accounts, all) };
}

/** เพิ่มหรือแก้แถวตาม id — แก้เฉพาะช่องที่ส่งมา ช่องอื่นคงเดิม */
function kkUpsert_(key, rows, allowCreate) {
  var def = kkDefs_()[key];
  var sh = kkSheet_(key);
  var current = KK.byId(kkRead_(key));
  rows.forEach(function (r) {
    if (!r || !r.id || (!allowCreate && !current[r.id])) return;
    var merged = Object.assign({ active: true }, current[r.id] || {}, r);
    var values = [def.fields.map(function (f) { return merged[f] === undefined ? '' : merged[f]; })];
    var row = kkFindRow_(sh, r.id);
    if (row) sh.getRange(row, 1, 1, def.fields.length).setValues(values);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, def.fields.length).setValues(values);
  });
}

function kkSaveRules_(rules) {
  kkUpsert_('rules', rules, true);
  return { rules: kkRead_('rules').sort(function (a, b) { return KK.num(a.sort) - KK.num(b.sort); }) };
}

/** แก้ชื่อ / เลขท้าย / ยอดยกมา / ซ่อนบัญชี (ไม่สร้างบัญชีใหม่) */
function kkUpdateAccounts_(updates) {
  var txs = null;
  updates.forEach(function (u) {
    if (u.name !== undefined && !String(u.name).trim()) throw new Error('ชื่อบัญชีว่างไม่ได้');
    if (u.currency !== undefined) {
      if (['THB', 'USD'].indexOf(u.currency) < 0) throw new Error('สกุลเงินไม่ถูกต้อง');
      txs = txs || kkRead_('transactions');
      if (!KK.canChangeCurrency(u.id, txs)) throw new Error('เปลี่ยนสกุลเงินไม่ได้ เพราะบัญชีนี้มีรายการแล้ว');
    }
  });
  kkUpsert_('accounts', updates.map(function (u) {
    var o = { id: u.id };
    KK.ACCOUNT_EDITABLE.forEach(function (k) { if (u[k] !== undefined) o[k] = u[k]; });
    if (u.currency !== undefined) o.currency = u.currency;
    return o;
  }), false);
  return kkAccountsResult_();
}

/** เพิ่มบัญชีใหม่ (id สร้างให้อัตโนมัติ) */
function kkAddAccount_(input) {
  var err = KK.validateAccount(input || {});
  if (err) throw new Error(err);
  var current = kkRead_('accounts');
  var sort = current.reduce(function (m, a) { return Math.max(m, KK.num(a.sort)); }, 0) + 1;
  var row = { id: 'ACC_' + Date.now().toString(36).toUpperCase(), kind: input.kind, currency: input.currency || 'THB', sort: sort, active: true };
  KK.ACCOUNT_EDITABLE.forEach(function (k) { if (input[k] !== undefined) row[k] = input[k]; });
  row.active = true;
  kkUpsert_('accounts', [row], true);
  return kkAccountsResult_();
}

/** เพิ่มหรือแก้หมวด (ตาม id) */
function kkSaveCategories_(cats) {
  cats.forEach(function (c) {
    var err = KK.validateCategory(c);
    if (err) throw new Error(err);
  });
  var current = kkRead_('categories');
  var sort = current.reduce(function (m, c) { return Math.max(m, KK.num(c.sort)); }, 0);
  kkUpsert_('categories', cats.map(function (c) {
    var o = Object.assign({}, c);
    if (o.sort === undefined && !current.some(function (x) { return x.id === c.id; })) o.sort = ++sort;
    return o;
  }), true);
  return { categories: kkRead_('categories').sort(function (a, b) { return KK.num(a.sort) - KK.num(b.sort); }) };
}

function kkAccountsResult_() {
  var accounts = kkRead_('accounts').sort(function (a, b) { return KK.num(a.sort) - KK.num(b.sort); });
  return { accounts: accounts, balances: KK.computeBalances(accounts, kkRead_('transactions')) };
}

/** แสดงข้อความในชีต — ถ้ารันจากหน้า Apps Script (ไม่มีหน้าชีต) จะไปแสดงใน "บันทึกการดำเนินการ" แทน */
function kkAlert_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}
