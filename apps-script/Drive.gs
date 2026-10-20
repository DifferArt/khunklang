/*
 * ขุนคลัง — ไฟล์แนบใน Google Drive (สลิป / ใบเสร็จ / Statement) และชุดเอกสาร "ส่งบัญชี" รายเดือน
 * วางคู่กับ Code.gs (ไฟล์นี้เขียนเอง ไม่ได้คัดลอกมาจาก web/)
 */
var KK_FILE_KINDS = { slip: 'สลิป', receipt: 'ใบเสร็จ/บิล', statement: 'Statement' };
var KK_MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var KK_MAX_FILE = 15 * 1024 * 1024;

/** รันครั้งเดียวจากเมนู หลังอัปเดตโค้ด เพื่อให้สิทธิ์ Google Drive / Docs กับสคริปต์ */
function authorizeDrive() {
  var root = kkRootFolder_();
  kkAlert_('เปิดสิทธิ์ Google Drive แล้ว ✅\n\nสลิป ใบเสร็จ และชุดส่งบัญชี จะเก็บในโฟลเดอร์\n"' + root.getName() + '"\n' + root.getUrl() +
    '\n\nอย่าลืม: การทำให้ใช้งานได้ → จัดการ → ✏️ → เวอร์ชันใหม่');
}

// ---------------------------------------------------------------- โฟลเดอร์

function kkRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try {
      var found = DriveApp.getFolderById(id);
      if (!found.isTrashed()) return found;
    } catch (e) { /* ถูกลบไปแล้ว — สร้างใหม่ */ }
  }
  var folder = DriveApp.createFolder('ขุนคลัง — เอกสาร');
  try {
    // วางไว้โฟลเดอร์เดียวกับไฟล์ชีต จะได้หาเจอง่าย
    var parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    if (parents.hasNext()) folder.moveTo(parents.next());
  } catch (e) { /* อยู่ที่ My Drive ก็ได้ */ }
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function kkSubFolder_(names) {
  var f = kkRootFolder_();
  names.forEach(function (name) {
    var it = f.getFoldersByName(name);
    f = it.hasNext() ? it.next() : f.createFolder(name);
  });
  return f;
}

/** ล้างไฟล์ชุดเก่าในโฟลเดอร์ส่งบัญชี (ย้ายไปถังขยะ กู้คืนได้ 30 วัน) */
function kkEmptyFolder_(folder) {
  var files = folder.getFiles();
  while (files.hasNext()) files.next().setTrashed(true);
  var subs = folder.getFolders();
  while (subs.hasNext()) subs.next().setTrashed(true);
}

function kkSafeName_(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

// ---------------------------------------------------------------- ไฟล์แนบ

function kkActiveFiles_() {
  return kkRead_('files').filter(function (f) { return !KK.isDeleted(f); });
}

/** id ไฟล์แนบของรายการ (คั่นด้วย ,) — เก็บในคอลัมน์ slip_ref ของรายการ */
function kkSlipRef_(txId, files) {
  if (!txId) return '';
  return (files || kkActiveFiles_()).filter(function (f) {
    return f.tx_id === txId && f.kind !== 'statement';
  }).map(function (f) { return f.id; }).join(',');
}

function kkSyncSlipRef_(txId) {
  var sh = kkSheet_('transactions');
  var row = kkFindRow_(sh, txId);
  if (!row) return; // รายการยังส่งไม่ถึง — saveTx จะเติมให้ตอนมาถึง
  var fields = kkDefs_().transactions.fields;
  sh.getRange(row, fields.indexOf('slip_ref') + 1).setValue(kkSlipRef_(txId));
}

/** อัปโหลดไฟล์ (base64) — ส่งซ้ำด้วย id เดิมจะไม่เกิดไฟล์ซ้ำ */
function kkUploadFile_(input) {
  if (!input || !input.id || !input.data) throw new Error('ไม่มีข้อมูลไฟล์');
  if (!KK_FILE_KINDS[input.kind]) throw new Error('ชนิดไฟล์ไม่ถูกต้อง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date_from || ''))) throw new Error('วันที่ของไฟล์ไม่ถูกต้อง');
  var dup = kkActiveFiles_().filter(function (f) { return f.id === input.id; })[0];
  if (dup) return { file: dup, duplicate: true };

  var bytes = Utilities.base64Decode(input.data);
  if (bytes.length > KK_MAX_FILE) throw new Error('ไฟล์ใหญ่เกิน 15 MB');
  var folder = kkSubFolder_([input.kind === 'statement' ? 'Statement' : 'สลิปและใบเสร็จ', String(input.date_from).slice(0, 7)]);
  var name = kkSafeName_(input.name || input.id);
  var file = folder.createFile(Utilities.newBlob(bytes, input.mime || 'application/octet-stream', name));
  var row = {
    id: input.id, tx_id: input.tx_id || '', kind: input.kind, account_id: input.account_id || '',
    date_from: input.date_from, date_to: input.date_to || input.date_from, name: name,
    mime: file.getMimeType(), drive_id: file.getId(), size: bytes.length,
    created_at: new Date().toISOString(), deleted: false
  };
  kkUpsert_('files', [row], true);
  if (row.tx_id) kkSyncSlipRef_(row.tx_id);
  return { file: row };
}

function kkOverlapsMonth_(f, month) {
  var from = String(f.date_from).slice(0, 7), to = String(f.date_to || f.date_from).slice(0, 7);
  return from <= month && month <= to;
}

function kkListFiles_(p) {
  return {
    files: kkActiveFiles_().filter(function (f) {
      if (p.tx_id && f.tx_id !== p.tx_id) return false;
      if (p.month && !kkOverlapsMonth_(f, p.month)) return false;
      return true;
    })
  };
}

function kkGetFile_(id) {
  var row = kkActiveFiles_().filter(function (f) { return f.id === id; })[0];
  if (!row) throw new Error('ไม่พบไฟล์');
  var file = DriveApp.getFileById(row.drive_id);
  if (file.getSize() > 8 * 1024 * 1024) return { file: row, url: file.getUrl(), data: '' }; // ใหญ่ไป เปิดใน Drive แทน
  return { file: row, url: file.getUrl(), mime: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function kkDeleteFile_(id) {
  var row = kkActiveFiles_().filter(function (f) { return f.id === id; })[0];
  if (!row) return { id: id };
  kkUpsert_('files', [{ id: id, deleted: true }], false);
  try { DriveApp.getFileById(row.drive_id).setTrashed(true); } catch (e) { /* ไฟล์ถูกลบใน Drive ไปแล้ว */ }
  if (row.tx_id) kkSyncSlipRef_(row.tx_id);
  return { id: id };
}

// ---------------------------------------------------------------- ส่งบัญชี

function kkMonthTh_(month) {
  return KK_MONTHS_TH[+month.slice(5, 7) - 1] + ' ' + (+month.slice(0, 4) + 543);
}

function kkDateTh_(date) {
  var p = String(date).split('-');
  return p[2] + '/' + p[1] + '/' + (+p[0] + 543);
}

function kkMoney_(n, cur) {
  var parts = Math.abs(KK.num(n)).toFixed(2).split('.');
  return (KK.num(n) < 0 ? '-' : '') + (cur === 'USD' ? '$' : '฿') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}

/**
 * สร้างชุดเอกสารประจำเดือนในโฟลเดอร์ "ส่งบัญชี/YYYY-MM":
 * Google Sheet + Excel + PDF รายงาน, PDF รวมสลิป (4 หรือ 6 ใบต่อหน้า A4), สำเนา Statement และใบเสร็จที่เป็น PDF
 * p = { month: 'YYYY-MM', scope: 'all' | 'course', perPage: 4 | 6 }
 */
function kkExportMonth_(p) {
  var month = String(p.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('เดือนไม่ถูกต้อง');
  var course = p.scope === 'course';
  var perPage = +p.perPage === 6 ? 6 : 4;
  var ctx = kkContext_();
  var settings = kkSettings_();
  var all = kkRead_('transactions').filter(function (t) { return !KK.isDeleted(t); });
  var isCourse = function (t) {
    var c = ctx.categoriesById[t.category_id];
    return t.type === 'income' && !!c && /คอร์ส/.test(c.group);
  };
  var inMonth = all.filter(function (t) { return String(t.date).indexOf(month) === 0; });
  var txs = inMonth.filter(function (t) { return !course || isCourse(t); }).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.created_at) < String(b.created_at) ? -1 : 1;
  });
  if (!txs.length) throw new Error('ไม่มีรายการใน' + kkMonthTh_(month) + (course ? ' (หมวดคอร์ส)' : ''));

  var files = kkActiveFiles_();
  var attachByTx = {};
  files.forEach(function (f) {
    if (f.kind !== 'statement' && f.tx_id) (attachByTx[f.tx_id] = attachByTx[f.tx_id] || []).push(f);
  });
  // เลขที่เอกสาร S-001… เรียงตามวันที่ ใช้อ้างอิงระหว่างรายงานกับ PDF สลิป
  var docs = [], refOf = {};
  txs.forEach(function (t) {
    (attachByTx[t.id] || []).forEach(function (f) {
      var label = 'S-' + ('00' + (docs.length + 1)).slice(-3);
      docs.push({ label: label, file: f, tx: t });
      refOf[t.id] = (refOf[t.id] ? refOf[t.id] + ', ' : '') + label;
    });
  });

  var title = 'ส่งบัญชี ' + kkMonthTh_(month) + (course ? ' (เฉพาะคอร์ส)' : '');
  var folder = kkSubFolder_(['ส่งบัญชี', month + (course ? ' คอร์ส' : '')]);
  kkEmptyFolder_(folder);

  var ss = SpreadsheetApp.create(title);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  kkBuildReport_(ss, { title: title, month: month, course: course, txs: txs, all: all, inMonth: inMonth,
    ctx: ctx, settings: settings, refOf: refOf, docCount: docs.length });
  SpreadsheetApp.flush();

  var out = [{ kind: 'sheet', label: 'Google Sheet', url: ss.getUrl() }];
  out.push(kkExportSheet_(ss.getId(), 'xlsx', title + '.xlsx', folder, 'Excel'));
  out.push(kkExportSheet_(ss.getId(), 'pdf', title + ' — รายงาน.pdf', folder, 'PDF รายงาน'));

  var images = docs.filter(function (d) { return /^image\//.test(d.file.mime); });
  var others = docs.filter(function (d) { return !/^image\//.test(d.file.mime); });
  if (images.length) out.push(kkSlipsPdf_(folder, title + ' — สลิปและใบเสร็จ', images, perPage, ctx));
  if (others.length) {
    var docFolder = folder.createFolder('ใบเสร็จ PDF');
    others.forEach(function (d) {
      DriveApp.getFileById(d.file.drive_id).makeCopy(d.label + ' ' + d.file.name, docFolder);
    });
    out.push({ kind: 'folder', label: 'ใบเสร็จ PDF ' + others.length + ' ไฟล์', url: docFolder.getUrl() });
  }

  var missing = [];
  if (!course) {
    var statements = files.filter(function (f) { return f.kind === 'statement' && kkOverlapsMonth_(f, month); });
    if (statements.length) {
      var stFolder = folder.createFolder('Statement');
      statements.forEach(function (f) {
        DriveApp.getFileById(f.drive_id).makeCopy(f.name, stFolder);
      });
      out.push({ kind: 'folder', label: 'Statement ' + statements.length + ' ไฟล์', url: stFolder.getUrl() });
    }
    missing = kkMissingStatements_(month, inMonth, statements, ctx).map(function (a) { return KK.accountName(a); });
  }

  return {
    folderUrl: folder.getUrl(), files: out, missing: missing,
    counts: { txs: txs.length, docs: docs.length, images: images.length }
  };
}

/** บัญชีธนาคาร/e-Wallet ที่มีรายการเดือนนี้ แต่ยังไม่ได้แนบ Statement */
function kkMissingStatements_(month, inMonth, statements, ctx) {
  var used = {};
  inMonth.forEach(function (t) { used[t.account_id] = true; if (t.to_account_id) used[t.to_account_id] = true; });
  var have = {};
  statements.forEach(function (f) { have[f.account_id] = true; });
  return ctx.accounts.filter(function (a) {
    return (a.kind === 'bank' || a.kind === 'ewallet') && used[a.id] && !have[a.id];
  });
}

function kkExportSheet_(id, format, name, folder, label) {
  var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=' + format;
  if (format === 'pdf') {
    url += '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=true&pagenum=CENTER' +
      '&fzr=true&top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4';
  }
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('สร้างไฟล์ ' + label + ' ไม่สำเร็จ (' + res.getResponseCode() + ')');
  var f = folder.createFile(res.getBlob().setName(name));
  return { kind: format, label: label, url: f.getUrl() };
}

// ---------------------------------------------------------------- รายงานใน Google Sheet

function kkBuildReport_(ss, d) {
  var ctx = d.ctx, settings = d.settings;
  var thb = function (t) { return KK.round2(KK.toTHB(KK.num(t.amount), ctx.accountsById[t.account_id], settings)); };
  var accName = function (id) { var a = ctx.accountsById[id]; return a ? KK.accountName(a) : id; };
  var catOf = function (t) { return ctx.categoriesById[t.category_id] || { group: '', name: '(ไม่มีหมวด)' }; };
  var cur = function (t) { return (ctx.accountsById[t.account_id] || {}).currency || 'THB'; };

  // --- สรุป
  var sum = ss.getSheets()[0].setName('สรุป');
  var s = KK.summarize(d.txs, ctx.accountsById, ctx.categoriesById, settings);
  var r = 1;
  sum.getRange(r, 1).setValue(d.title).setFontSize(14).setFontWeight('bold');
  r += 1;
  sum.getRange(r, 1, 2, 2).setValues([
    ['ช่วงเวลา', '1 – ' + new Date(+d.month.slice(0, 4), +d.month.slice(5, 7), 0).getDate() + ' ' + kkMonthTh_(d.month)],
    ['สร้างเมื่อ', Utilities.formatDate(new Date(), KK_TZ, 'dd/MM/') + (+Utilities.formatDate(new Date(), KK_TZ, 'yyyy') + 543) +
      Utilities.formatDate(new Date(), KK_TZ, ' HH:mm')]
  ]);
  r += 3;
  var totals = [['รายรับรวม (บาท)', s.income]];
  if (!d.course) totals.push(['รายจ่ายรวม (บาท)', s.expense], ['คงเหลือสุทธิ (บาท)', s.net]);
  sum.getRange(r, 1, totals.length, 2).setValues(totals).setFontWeight('bold');
  sum.getRange(r, 2, totals.length, 1).setNumberFormat('#,##0.00');
  r += totals.length + 1;

  ['income', 'expense'].forEach(function (type) {
    if (type === 'expense' && d.course) return;
    var byCat = {};
    d.txs.forEach(function (t) {
      if (t.type !== type) return;
      var k = t.category_id;
      byCat[k] = byCat[k] || { c: catOf(t), n: 0, v: 0 };
      byCat[k].n++; byCat[k].v += thb(t);
    });
    var rows = Object.keys(byCat).map(function (k) { var x = byCat[k]; return [x.c.group, x.c.name, x.n, KK.round2(x.v)]; })
      .sort(function (a, b) { return b[3] - a[3]; });
    sum.getRange(r, 1).setValue(type === 'income' ? 'รายรับตามหมวด' : 'รายจ่ายตามหมวด').setFontWeight('bold');
    r = kkTable_(sum, r + 1, ['กลุ่ม', 'หมวด', 'จำนวนรายการ', 'ยอด (บาท)'], rows, [4], []) + 1;
  });

  var notes = [];
  if (!d.course && s.transfers) notes.push(['ไม่รวมเงินโอนระหว่างบัญชีของตัวเอง / จ่ายบัตร ' + kkMoney_(s.transfers) + ' (ดูแท็บ "โอนระหว่างบัญชี")']);
  if (d.txs.some(function (t) { return cur(t) === 'USD'; })) notes.push(['ยอด USD แปลงเป็นบาทที่ 1 USD = ' + KK.num(settings.usd_thb) + ' บาท']);
  notes.push(['เอกสารแนบ ' + d.docCount + ' ไฟล์ — เลขที่ S-001… ตรงกับคอลัมน์ "เอกสารแนบ" และไฟล์ PDF สลิป']);
  sum.getRange(r, 1, notes.length, 1).setValues(notes).setFontColor('#555555');
  r += notes.length + 1;

  if (!d.course) {
    // ยอดบัญชีต้นเดือน/สิ้นเดือน ไว้เทียบกับ Statement
    var first = d.month + '-01';
    var b0 = KK.computeBalances(ctx.accounts, d.all.filter(function (t) { return String(t.date) < first; }));
    var b1 = KK.computeBalances(ctx.accounts, d.all.filter(function (t) { return String(t.date).slice(0, 7) <= d.month; }));
    var flow = {};
    var add = function (id, k, v) { flow[id] = flow[id] || { i: 0, o: 0 }; flow[id][k] += v; };
    d.inMonth.forEach(function (t) {
      var amt = KK.num(t.amount);
      if (t.type === 'income') add(t.account_id, 'i', amt);
      else if (t.type === 'expense') add(t.account_id, 'o', amt);
      else {
        add(t.account_id, 'o', amt);
        add(t.to_account_id, 'i', KK.num(t.to_amount) > 0 ? KK.num(t.to_amount) : amt);
      }
    });
    var accRows = ctx.accounts.filter(function (a) {
      return flow[a.id] || (KK.isActive(a) && (KK.num(b0[a.id]) || KK.num(b1[a.id])));
    }).sort(function (a, b) { return KK.num(a.sort) - KK.num(b.sort); }).map(function (a) {
      var f = flow[a.id] || { i: 0, o: 0 };
      return [KK.accountName(a) + (a.currency !== 'THB' ? ' (' + a.currency + ')' : ''),
        KK.round2(b0[a.id] || 0), KK.round2(f.i), KK.round2(f.o), KK.round2(b1[a.id] || 0)];
    });
    sum.getRange(r, 1).setValue('ยอดแต่ละบัญชี (สกุลเงินของบัญชี)').setFontWeight('bold');
    kkTable_(sum, r + 1, ['บัญชี', 'ยกมาต้นเดือน', 'เงินเข้า', 'เงินออก', 'คงเหลือสิ้นเดือน'], accRows, [2, 3, 4, 5], []);
  }
  sum.setColumnWidth(1, 230); sum.setColumnWidths(2, 4, 130);

  // --- รายละเอียด
  var detail = function (name, type) {
    var rows = d.txs.filter(function (t) { return t.type === type; }).map(function (t) {
      var c = catOf(t);
      return [kkDateCell_(t.date), c.name, t.counterparty || '', accName(t.account_id), KK.num(t.amount), cur(t), thb(t),
        t.note && t.note !== t.counterparty ? t.note : '', d.refOf[t.id] || ''];
    });
    if (!rows.length) return;
    var sh = ss.insertSheet(name);
    var end = kkTable_(sh, 1, ['วันที่', 'หมวด', type === 'income' ? 'ผู้จ่าย' : 'ผู้รับ', 'บัญชี', 'จำนวนเงิน', 'สกุลเงิน', 'ยอด (บาท)', 'บันทึก', 'เอกสารแนบ'],
      rows, [5, 7], [1]);
    sh.getRange(end, 6, 1, 2).setValues([['รวม', '=SUM(G2:G' + (end - 1) + ')']]).setFontWeight('bold');
    sh.getRange(end, 7).setNumberFormat('#,##0.00');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 9);
  };
  detail('รายรับ', 'income');
  if (!d.course) {
    detail('รายจ่าย', 'expense');
    var trf = d.txs.filter(function (t) { return t.type === 'transfer'; }).map(function (t) {
      var toCur = (ctx.accountsById[t.to_account_id] || {}).currency || 'THB';
      return [kkDateCell_(t.date), accName(t.account_id), accName(t.to_account_id), KK.num(t.amount), cur(t),
        KK.num(t.to_amount) > 0 ? KK.num(t.to_amount) : '', KK.num(t.to_amount) > 0 ? toCur : '', t.note || '', d.refOf[t.id] || ''];
    });
    if (trf.length) {
      var tsh = ss.insertSheet('โอนระหว่างบัญชี');
      kkTable_(tsh, 1, ['วันที่', 'จากบัญชี', 'ไปบัญชี', 'จำนวนเงิน', 'สกุลเงิน', 'ยอดที่เข้า', 'สกุลเงินปลายทาง', 'บันทึก', 'เอกสารแนบ'],
        trf, [4, 6], [1]);
      tsh.setFrozenRows(1);
      tsh.autoResizeColumns(1, 9);
    }
  }

  // --- ผู้เรียน (รายได้คอร์ส แยกตามชื่อ)
  var courseTx = d.txs.filter(function (t) {
    var c = ctx.categoriesById[t.category_id];
    return t.type === 'income' && c && /คอร์ส/.test(c.group);
  });
  if (courseTx.length) {
    var people = courseTx.slice().sort(function (a, b) {
      var x = String(a.counterparty || '~'), y = String(b.counterparty || '~');
      return x !== y ? (x < y ? -1 : 1) : (a.date < b.date ? -1 : 1);
    }).map(function (t) {
      return [t.counterparty || '(ไม่ระบุชื่อ)', catOf(t).name, kkDateCell_(t.date), accName(t.account_id), thb(t), d.refOf[t.id] || ''];
    });
    var psh = ss.insertSheet('ผู้เรียน');
    var pend = kkTable_(psh, 1, ['ชื่อผู้เรียน', 'คอร์ส', 'วันที่', 'บัญชี', 'ยอด (บาท)', 'เอกสารแนบ'], people, [5], [3]);
    psh.getRange(pend, 4, 1, 2).setValues([['รวม ' + people.length + ' รายการ', '=SUM(E2:E' + (pend - 1) + ')']]).setFontWeight('bold');
    psh.getRange(pend, 5).setNumberFormat('#,##0.00');
    psh.setFrozenRows(1);
    psh.autoResizeColumns(1, 6);
  }
}

/** เขียนตาราง คืนแถวถัดไป */
function kkTable_(sh, row, header, rows, moneyCols, dateCols) {
  sh.getRange(row, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#dcfce7');
  if (rows.length) {
    sh.getRange(row + 1, 1, rows.length, header.length).setValues(rows);
    moneyCols.forEach(function (c) { sh.getRange(row + 1, c, rows.length, 1).setNumberFormat('#,##0.00'); });
    dateCols.forEach(function (c) { sh.getRange(row + 1, c, rows.length, 1).setNumberFormat('dd/mm/yyyy'); });
  }
  return row + rows.length + 1;
}

// ---------------------------------------------------------------- PDF รวมสลิป

/** วางรูปสลิป/ใบเสร็จ 4 หรือ 6 ใบต่อหน้า A4 พร้อมป้ายกำกับ แล้วแปลงเป็น PDF */
function kkSlipsPdf_(folder, title, items, perPage, ctx) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  var W = 595.28, H = 841.89, M = 24, cols = 2, rows = perPage / cols;
  body.setPageWidth(W).setPageHeight(H).setMarginTop(M).setMarginBottom(M).setMarginLeft(M).setMarginRight(M);
  var boxW = (W - 2 * M) / cols - 16;
  var boxH = (H - 2 * M) / rows - 62; // เผื่อที่ป้ายกำกับ 2 บรรทัด

  for (var p = 0; p < items.length; p += perPage) {
    var chunk = items.slice(p, p + perPage);
    var grid = [];
    for (var i = 0; i < rows; i++) grid.push(cols === 2 ? ['', ''] : ['']);
    var table = p === 0 ? body.insertTable(0, grid) : body.appendTable(grid);
    table.setBorderColor('#cccccc');
    chunk.forEach(function (it, idx) {
      var cell = table.getCell(Math.floor(idx / cols), idx % cols);
      cell.setPaddingTop(6).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
      var para = cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      try {
        var img = para.appendInlineImage(DriveApp.getFileById(it.file.drive_id).getBlob());
        var k = Math.min(boxW / img.getWidth(), boxH / img.getHeight(), 1);
        img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
      } catch (e) {
        para.appendText('(ใส่รูปไม่ได้ — ดูไฟล์ ' + it.file.name + ' ใน Drive)');
      }
      var lines = kkSlipLabel_(it, ctx);
      cell.appendParagraph(lines[0]).setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .editAsText().setFontSize(9).setBold(true);
      cell.appendParagraph(lines[1]).setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .editAsText().setFontSize(8).setBold(false);
    });
    if (p + perPage < items.length) body.appendPageBreak();
  }
  doc.saveAndClose();
  var src = DriveApp.getFileById(doc.getId());
  var pdf = folder.createFile(src.getAs('application/pdf').setName(title + '.pdf'));
  src.setTrashed(true);
  return { kind: 'pdf', label: 'PDF สลิปและใบเสร็จ (' + items.length + ' ใบ)', url: pdf.getUrl() };
}

function kkSlipLabel_(it, ctx) {
  var t = it.tx;
  var a = ctx.accountsById[t.account_id] || {};
  var what;
  if (t.type === 'transfer') what = 'โอน → ' + KK.accountName(ctx.accountsById[t.to_account_id]);
  else what = (ctx.categoriesById[t.category_id] || {}).name || '';
  return [
    it.label + '   ' + kkDateTh_(t.date) + '   ' + kkMoney_(t.amount, a.currency) + '   ' + (KK_FILE_KINDS[it.file.kind] || ''),
    [what, t.counterparty, KK.accountName(a)].filter(Boolean).join(' · ')
  ];
}
