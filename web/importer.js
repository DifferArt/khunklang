/*
 * ขุนคลัง — นำเข้า Statement ธนาคาร (PDF)
 * อ่าน PDF ในเบราว์เซอร์ด้วย pdf.js → จัดหมวด → ให้ตรวจ → บันทึกทีละชุด → เก็บไฟล์ PDF ใน Drive ของผู้ใช้
 */
var Importer = {
  PDFJS: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/',
  BATCH: 150,
  statements: [],   // ไฟล์ที่อ่านแล้ว
  rows: [],         // รายการทั้งหมดจากทุกไฟล์ (พร้อมสถานะในหน้าตรวจ)
  filter: 'all',
  accountId: '',
  busy: false,
  remember: true,

  STATUS: {
    need: { label: 'ต้องเลือก', cls: 'st-need' },
    guess: { label: 'เดา — ตรวจ', cls: 'st-guess' },
    rule: { label: 'ตามกฎ', cls: 'st-rule' },
    learned: { label: 'จำไว้', cls: 'st-rule' },
    own: { label: 'โอนบัญชีตัวเอง', cls: 'st-own' },
    edited: { label: 'แก้แล้ว', cls: 'st-rule' },
    dup: { label: 'มีแล้ว', cls: 'st-dup' }
  },

  // ------------------------------------------------------------ อ่าน PDF
  loadPdfJs: function () {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    var self = this;
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = self.PDFJS + 'pdf.min.js';
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = self.PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('โหลดตัวอ่าน PDF ไม่ได้ (ต้องต่อเน็ต)')); };
      document.head.appendChild(s);
    });
  },

  /** คืนข้อความทุกหน้า: [[{x, y, s}]] */
  readPdf: function (file) {
    return this.loadPdfJs().then(function (pdfjs) {
      return file.arrayBuffer().then(function (buf) {
        return pdfjs.getDocument({ data: buf }).promise;
      });
    }).then(function (doc) {
      var pages = [];
      var next = function (n) {
        if (n > doc.numPages) return Promise.resolve(pages);
        return doc.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) {
          pages.push(tc.items.filter(function (i) { return i.str.trim(); }).map(function (i) {
            return { x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), s: i.str.trim() };
          }));
          return next(n + 1);
        });
      };
      return next(1);
    }).catch(function (e) {
      if (e && e.name === 'PasswordException') throw new Error('ไฟล์นี้ติดรหัสผ่าน — เปิดใน Chrome แล้ว Ctrl+P → บันทึกเป็น PDF ก่อน');
      throw e;
    });
  },

  /** จัดข้อความเป็นบรรทัด (y เดียวกัน) เรียงจากบนลงล่าง */
  lines: function (pages) {
    var out = [];
    pages.forEach(function (items, pi) {
      var byY = {};
      items.forEach(function (it) { (byY[it.y] = byY[it.y] || []).push(it); });
      Object.keys(byY).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
        out.push({ page: pi + 1, y: y, cells: byY[y].sort(function (a, b) { return a.x - b.x; }) });
      });
    });
    return out;
  },

  // ------------------------------------------------------------ ตัวอ่านแต่ละธนาคาร
  parsers: [],

  parse: function (pages) {
    var all = pages.map(function (p) { return p.map(function (i) { return i.s; }).join(' '); }).join(' ');
    var parser = this.parsers.find(function (p) { return p.detect(all, pages); });
    if (!parser) throw new Error('ยังไม่รองรับ Statement รูปแบบนี้ — ส่งไฟล์ตัวอย่างให้ผู้พัฒนาเพิ่มตัวอ่าน');
    var st = parser.parse(pages, this.lines(pages));
    st.bank = parser.bank;
    st.bankName = parser.name;
    return st;
  },

  /** ตรวจยอดคงเหลือต่อเนื่องทุกบรรทัด + กำหนดทิศทาง (ถอน/ฝาก) จากยอดที่เปลี่ยน */
  verifyChain: function (st) {
    var prev = st.opening, bad = 0, wSum = 0, dSum = 0, wN = 0, dN = 0;
    st.rows.forEach(function (r) {
      if (r.carry) { if (prev !== null && Math.abs(prev - r.balance) > 0.005) bad++; prev = r.balance; return; }
      if (!r.dir) {
        // ใบแจ้งที่มีช่องเงินช่องเดียว: ดูทิศทางจากยอดคงเหลือที่เปลี่ยน
        var diff = KK.round2(r.balance - prev);
        if (Math.abs(Math.abs(diff) - r.amount) > 0.005) bad++;
        r.dir = diff < 0 ? 'out' : 'in';
      } else {
        var expect = KK.round2(prev + (r.dir === 'in' ? r.amount : -r.amount));
        if (r.balance !== null && Math.abs(expect - r.balance) > 0.005) bad++;
        if (r.balance === null) r.balance = expect;
      }
      if (r.dir === 'out') { wSum += r.amount; wN++; } else { dSum += r.amount; dN++; }
      prev = r.balance;
    });
    st.rows = st.rows.filter(function (r) { return !r.carry; });
    st.withdrawals = { count: wN, sum: KK.round2(wSum) };
    st.deposits = { count: dN, sum: KK.round2(dSum) };
    var computed = KK.round2(st.opening - wSum + dSum);
    var totalsOk = !st.totals || ((st.totals.wN == null || st.totals.wN === wN) && (st.totals.dN == null || st.totals.dN === dN) &&
      Math.abs(st.totals.wSum - wSum) < 0.01 && Math.abs(st.totals.dSum - dSum) < 0.01);
    var closingOk = st.closing === null || Math.abs(computed - st.closing) < 0.01;
    if (st.closing === null) st.closing = computed;
    st.note = '';
    if (bad && st.dirKnown && st.totals && totalsOk && closingOk) {
      // ธนาคารพิมพ์บางบรรทัดสลับลำดับ (เช่น ดอกเบี้ย) แต่ยอดรวมตรงทุกบาท
      st.note = 'ลำดับบรรทัดในใบแจ้งสลับ ' + bad + ' จุด แต่ยอดรวมตรง';
      bad = 0;
    }
    st.ok = bad === 0 && totalsOk && closingOk;
    st.problem = bad ? 'ยอดคงเหลือไม่ต่อเนื่อง ' + bad + ' บรรทัด' : (!totalsOk ? 'ยอดรวมไม่ตรงกับใบแจ้ง' : (st.ok ? '' : 'ยอดยกไปไม่ตรง'));
    return st;
  },

  // ------------------------------------------------------------ แยกชื่อ/บัญชีปลายทาง
  /** "เพื่อชำระ Ref X5005 ร้าน (ชื่อบัญชี: ...)" / "โอนไป SCB X1234 ชื่อ++" / "จาก BBL X5678 NAME++" */
  partyOf: function (detail) {
    var d = String(detail || '').trim(), m;
    m = /^เพื่อชำระ\s+Ref\s+\S+\s+(.+?)(?:\s*\(ชื่อบัญชี:.*)?$/.exec(d);
    if (m) return { name: m[1].trim(), kind: 'pay' };
    m = /^(โอนไป|จาก)\s+(?:([A-Z]{2,6})\s+)?(พร้อมเพย์\s+)?X(\d{3,})\s*(.*)$/.exec(d);
    if (m) {
      return {
        name: m[5].replace(/\+\+$/, '').trim(), kind: m[1] === 'จาก' ? 'from' : 'to',
        bank: m[3] ? '' : (m[2] || 'KBANK'), last4: m[4].slice(-4), promptpay: !!m[3]
      };
    }
    return { name: d, kind: 'other' };
  },

  hint4: function (v) {
    var s = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
    return s ? ('0000' + s).slice(-4) : '';
  },

  /** บัญชีของเราที่ตรงกับ ธนาคาร + เลขท้าย 4 ตัว */
  ownAccountByHint: function (bank, last4) {
    if (!bank || !last4) return null;
    var self = this;
    return App.active(App.data.accounts).find(function (a) {
      return KK.bankOf(a) === bank && self.hint4(a.number_hint) === last4;
    }) || null;
  },

  // ------------------------------------------------------------ จัดหมวด
  classify: function (row, st) {
    var parser = this.parsers.find(function (x) { return x.bank === st.bank; });
    var p = parser && parser.party ? parser.party(row) : this.partyOf(row.detail);
    row.counterparty = p.name;
    row.party = p;
    row.type = row.dir === 'out' ? 'expense' : 'income';
    row.category_id = ''; row.other_account_id = ''; row.asset_id = '';

    // 1) โอนระหว่างบัญชีตัวเอง (ดูจากเลขท้ายบัญชี หรือชื่อเจ้าของ)
    var own = this.ownAccountByHint(p.bank, p.last4);
    var owners = [App.data.settings.owner_names, st.owner].filter(Boolean).join(',');
    if (own && own.id !== this.accountId) {
      row.type = 'transfer'; row.other_account_id = own.id; row.status = 'own'; return row;
    }
    if ((p.kind === 'to' || p.kind === 'from') && KK.isOwnerName(p.name, owners)) {
      row.type = 'transfer'; row.status = 'need'; row.needOther = true; return row;
    }

    // 2) กฎ (กฎที่จำจากการแก้อยู่บนสุด)
    var self = this;
    var fitting = self.allRules().filter(function (r) { return self.ruleFits(r, row); });
    var rule = KK.matchRule(row.detail + ' ' + row.channel, fitting, row.amount);
    // กฎจากราคาอย่างเดียว (ไม่มีคำ) ยังเป็นการเดา — ให้ตรวจ
    if (rule && !String(rule.pattern || '').trim()) {
      if (!p.anon && p.kind === 'from') {
        row.category_id = rule.category_id || ''; row.asset_id = rule.asset_id || '';
        row.status = 'guess'; row.byPrice = true;
        return row;
      }
      rule = null;
    }
    if (rule) {
      row.type = rule.type;
      row.category_id = rule.type === 'transfer' ? '' : rule.category_id || '';
      row.other_account_id = rule.type === 'transfer' ? rule.other_account_id || '' : '';
      row.asset_id = rule.asset_id || '';
      row.status = /^L_/.test(rule.id) ? 'learned' : 'rule';
      if (row.type !== 'transfer' && !row.category_id) row.status = 'need';
      return row;
    }

    // 3) เดาตามลักษณะรายการ
    if (row.dir === 'out' && p.kind === 'pay') { row.category_id = 'EXP_MISC'; row.status = 'guess'; return row; }
    if (row.dir === 'in' && p.kind === 'from' && !p.promptpay && !p.anon && p.name) { row.category_id = 'INC_COURSE'; row.status = 'guess'; return row; }
    row.status = 'need';
    return row;
  },

  /** กฎในชีต + กฎตั้งต้นที่เพิ่มในรุ่นหลัง (ชีตเดิมไม่ได้รับกฎใหม่จาก setup) */
  allRules: function () {
    var have = {};
    var rules = (App.data.rules || []).slice();
    rules.forEach(function (r) { have[r.id] = true; });
    (KK_SEED.rules || []).forEach(function (r) { if (!have[r.id]) rules.push(Object.assign({ active: true }, r)); });
    return rules;
  },

  ruleFits: function (rule, row) {
    if (rule.type === 'transfer') return !!rule.other_account_id && rule.other_account_id !== this.accountId;
    return (rule.type === 'expense' && row.dir === 'out') || (rule.type === 'income' && row.dir === 'in');
  },

  // ------------------------------------------------------------ กันซ้ำกับที่มีในระบบแล้ว
  markDuplicates: function (existing) {
    var acc = this.accountId;
    var refs = {};
    var used = {}; // รายการเดิมหนึ่งรายการ จับคู่ได้กับแถวเดียว (กันยอดเท่ากันสองแถวถูกทิ้งทั้งคู่)
    existing.forEach(function (t) { if (t.import_ref) refs[t.import_ref] = true; });
    var dayDiff = function (a, b) { return Math.abs(new Date(a) - new Date(b)) / 86400000; };
    // จับคู่แถวที่วันตรงกันก่อน แล้วค่อยแถวที่ต่างกัน 1 วัน
    var order = this.rows.map(function (r, i) { return i; });
    var markDup = function (r, why) {
      if (r.status !== 'dup') r.preDupStatus = r.status;
      r.status = 'dup'; r.dupWhy = why; r.checked = false;
    };
    this.rows.forEach(function (r) {
      // ตรวจซ้ำรอบใหม่: คืนสถานะเดิมก่อน
      if (r.status === 'dup') { r.status = r.preDupStatus || 'need'; r.checked = true; r.dupWhy = ''; }
      r.refDup = false; r.dupMatched = false;
      if (refs[r.import_ref]) { markDup(r, 'นำเข้าไปแล้ว'); r.refDup = true; }
    });
    var rows = this.rows;
    [0, 1].forEach(function (maxDays) {
      order.forEach(function (i) {
        var r = rows[i];
        if (r.refDup || r.dupMatched) return;
        findAndMark(r, maxDays);
      });
    });
    function findAndMark(r, maxDays) {
      var sameDay = function (d) { return dayDiff(d, r.date) <= maxDays; };
      // ทิศทางต้องตรงกัน: เงินออกจากบัญชีนี้ ↔ แถวถอน, เงินเข้าบัญชีนี้ ↔ แถวฝาก
      var sameDir = function (t) {
        if (t.type === 'transfer') return r.dir === 'out' ? t.account_id === acc : t.to_account_id === acc;
        return t.account_id === acc && (r.dir === 'out' ? t.type === 'expense' : t.type === 'income');
      };
      var hit = existing.find(function (t) {
        if (used[t.id] || KK.isDeleted(t) || !sameDir(t)) return false;
        var amt = t.type === 'transfer' && t.to_account_id === acc && KK.num(t.to_amount) > 0 ? KK.num(t.to_amount) : KK.num(t.amount);
        if (amt !== r.amount) return false;
        // โอนที่นำเข้าจาก Statement ของอีกบัญชีแล้ว (เช่น กสิกร → กรุงไทย) อาจลงคนละวัน ±1
        if (t.import_ref) return t.type === 'transfer' && sameDay(t.date);
        return t.date === r.date;
      });
      if (hit) {
        used[hit.id] = true;
        r.dupMatched = true;
        markDup(r, hit.import_ref ? 'มีจากการนำเข้าบัญชีอื่นแล้ว' : 'อาจซ้ำกับที่บันทึกเอง');
      }
    }
  },

  // ------------------------------------------------------------ ขั้นตอนหลัก
  open: function () {
    if (!App.data) { App.toast('ยังโหลดข้อมูลไม่เสร็จ', true); return; }
    App.go('import');
    this.render();
  },

  handleFiles: function (files) {
    var self = this;
    if (!files || !files.length || self.busy) return;
    self.busy = true;
    self.setStatus('กำลังอ่านไฟล์…');
    var list = Array.prototype.slice.call(files);
    var parsed = [];
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () { return self.readPdf(f); }).then(function (pages) {
        var st = self.verifyChain(self.parse(pages));
        st.fileName = f.name;
        st.file = f; // เก็บไว้ส่งขึ้น Drive หลังบันทึก (ใช้แนบตอนส่งบัญชี)
        if (st.empty || !st.rows.length) skipped.push(f.name + ' (ไม่มีรายการเดือนนี้)');
        else parsed.push(st);
      }).catch(function (e) {
        // ไฟล์เดียวมีปัญหา ไม่ต้องทิ้งไฟล์อื่น
        skipped.push(f.name + ': ' + (e.message || e));
      });
    });
    var skipped = [];
    chain.then(function () {
      if (skipped.length) App.toast('ข้าม ' + skipped.length + ' ไฟล์ — ' + skipped.join(' · '), !parsed.length);
      if (!parsed.length) { self.setStatus(''); return; }
      parsed.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      // นำเข้าได้ทีละบัญชี: ไฟล์ของบัญชีอื่นให้นำเข้าแยกอีกรอบ
      var ref = self.statements[0] || parsed[0];
      var key = function (s) { return s.bank + ':' + s.last4; };
      var other = parsed.filter(function (s) { return key(s) !== key(ref); });
      if (other.length) {
        parsed = parsed.filter(function (s) { return key(s) === key(ref); });
        App.toast('ไฟล์ของคนละบัญชี (···' + other.map(function (s) { return s.last4; }).join(', ···') +
          ') ถูกข้าม — นำเข้าแยกทีละบัญชี', true);
        if (!parsed.length) { self.setStatus(''); return; }
      }
      // เลือกบัญชีให้อัตโนมัติจากเลขท้ายบัญชี
      var first = parsed[0];
      var match = self.ownAccountByHint(first.bank, first.last4);
      if (!match) {
        // ยังไม่รู้เลขท้าย: ถ้ามีบัญชีของธนาคารนี้บัญชีเดียวก็เลือกให้เลย
        var same = App.active(App.data.accounts).filter(function (a) { return KK.bankOf(a) === first.bank; });
        if (same.length === 1) match = same[0];
      }
      if (match) self.accountId = match.id;
      else if (!self.statements.length) {
        // ธนาคารนี้มีหลายบัญชีและไม่รู้เลขท้าย — ไม่เดา ให้ผู้ใช้เลือกเอง
        self.accountId = '';
        App.toast('ไม่พบบัญชีที่ลงท้าย ···' + first.last4 + ' — กรุณาเลือก "นำเข้าเป็นบัญชี" เอง', true);
      }
      self.statements = self.statements.concat(parsed);
      return self.rebuild();
    }).catch(function (e) {
      self.setStatus('');
      App.toast(e.message || String(e), true);
    }).then(function () { self.busy = false; });
  },

  /** สร้างรายการใหม่จากทุกไฟล์ (เรียกเมื่อเปลี่ยนบัญชีหรือเพิ่มไฟล์) */
  rebuild: function () {
    var self = this;
    var st0 = self.statements[0];
    if (!st0) { self.rows = []; self.render(); return Promise.resolve(); }
    self.rows = [];
    self.statements.forEach(function (st) {
      st.rows.forEach(function (r) {
        var row = Object.assign({}, r, {
          import_ref: st.bank + ':' + st.last4 + ':' + r.date + ':' + r.time + ':' + r.amount.toFixed(2) + ':' + r.balance.toFixed(2),
          checked: true
        });
        self.classify(row, st);
        self.rows.push(row);
      });
    });
    return self.checkDuplicates();
  },

  /** ดึงรายการเดิมของเดือนที่เกี่ยวข้อง (±1 เดือน เผื่อรายการข้ามเดือน) มาเทียบกันซ้ำ — ไม่แตะการแก้หมวดของผู้ใช้ */
  checkDuplicates: function () {
    var self = this;
    var months = {};
    self.rows.forEach(function (r) {
      var m = r.date.slice(0, 7);
      months[m] = true;
      var d = new Date(r.date);
      if (d.getDate() <= 1) months[App.shiftMonth(m, -1)] = true;
      if (d.getDate() >= 28) months[App.shiftMonth(m, 1)] = true;
    });
    self.setStatus('กำลังตรวจรายการซ้ำ…');
    var existing = [];
    var chain = Promise.resolve();
    Object.keys(months).forEach(function (m) {
      chain = chain.then(function () {
        return Api.call('listTx', { month: m }).then(function (res) { existing = existing.concat(res.txs); });
      });
    });
    self.dupChecked = false;
    return chain.then(function () {
      self.markDuplicates(existing);
      self.dupChecked = true;
      self.setStatus('');
      self.render();
    }, function (e) {
      // ห้ามบันทึกจนกว่าจะตรวจซ้ำได้ ไม่อย่างนั้นโอนระหว่างบัญชีจะถูกบันทึกสองครั้ง
      self.setStatus('ยังตรวจรายการซ้ำไม่ได้ (' + e.message + ') — กด "บันทึก" อีกครั้งเพื่อลองใหม่');
      self.render();
    });
  },

  reset: function () {
    this.statements = []; this.rows = []; this.filter = 'all';
    this.render();
  },

  // ------------------------------------------------------------ แก้ไขในหน้าตรวจ
  update: function (idx, field, value) {
    var r = this.rows[idx];
    if (!r) return;
    if (field === 'checked') { r.checked = value; this.renderFooter(); return; }
    r[field] = value;
    if (field === 'type') { r.category_id = ''; r.other_account_id = ''; }
    if (field === 'category_id') {
      var c = App.cat(value);
      if (c && c.default_asset_id && !r.asset_id) r.asset_id = c.default_asset_id;
    }
    r.status = this.isComplete(r) ? 'edited' : 'need';
    r.touched = true;
    if (r.status === 'edited') r.checked = true;
    // ใช้กับรายการชื่อเดียวกันที่ยังไม่ได้แก้เอง
    var same = 0, self = this;
    if (r.counterparty && r.status === 'edited') {
      this.rows.forEach(function (o, i) {
        if (i === idx || o.touched || o.status === 'dup' || o.status === 'own') return;
        if (o.counterparty !== r.counterparty || o.dir !== r.dir) return;
        o.type = r.type; o.category_id = r.category_id; o.other_account_id = r.other_account_id; o.asset_id = r.asset_id;
        o.status = 'edited'; o.checked = true; same++;
      });
    }
    if (same) App.toast('ใช้กับ "' + r.counterparty + '" อีก ' + same + ' รายการ');
    self.renderRows();
  },

  isComplete: function (r) {
    if (r.type === 'transfer') return !!r.other_account_id && r.other_account_id !== this.accountId;
    var c = App.cat(r.category_id);
    return !!c && c.type === r.type;
  },

  // ------------------------------------------------------------ บันทึก
  save: function () {
    var self = this;
    if (!self.accountId) { App.toast('กรุณาเลือก "นำเข้าเป็นบัญชี" ก่อน', true); return; }
    if (!self.dupChecked) {
      App.toast('กำลังตรวจรายการซ้ำอีกครั้ง… ตรวจเสร็จแล้วกดบันทึกอีกครั้ง');
      self.checkDuplicates();
      return;
    }
    var picked = self.rows.filter(function (r) { return r.checked; });
    var missing = picked.filter(function (r) { return !self.isComplete(r); });
    if (missing.length) {
      self.filter = 'need'; self.renderRows();
      App.toast('ยังมี ' + missing.length + ' รายการที่ต้องเลือกหมวด/บัญชี (หรือเอาติ๊กออก)', true);
      return;
    }
    if (!picked.length) { App.toast('ยังไม่ได้เลือกรายการ', true); return; }
    var acc = self.accountId;
    var txs = picked.map(function (r) {
      var tx = {
        id: App.newId(), date: r.date, amount: r.amount, type: r.type,
        category_id: r.type === 'transfer' ? '' : r.category_id, asset_id: r.asset_id || '',
        counterparty: r.counterparty, note: r.type === 'transfer' ? r.counterparty : '',
        import_ref: r.import_ref, account_id: acc, to_account_id: ''
      };
      if (r.type === 'transfer') {
        // ถอน = โอนออกจากบัญชีนี้, ฝาก = โอนเข้าบัญชีนี้
        if (r.dir === 'out') tx.to_account_id = r.other_account_id;
        else { tx.account_id = r.other_account_id; tx.to_account_id = acc; }
        var from = App.acc(tx.account_id), to = App.acc(tx.to_account_id);
        if (from && to && from.currency !== to.currency) {
          // โอนข้ามสกุลเงิน: ฝั่ง Statement เป็นบาท อีกฝั่งยังไม่รู้ยอด USD → ใช้อัตราในตั้งค่าโดยประมาณ
          var rate = KK.num(App.data.settings.usd_thb) || 1;
          if (r.dir === 'in') { tx.amount = KK.round2(r.amount / rate); tx.to_amount = r.amount; tx.note = 'ยอด USD ประมาณจากอัตรา ' + rate; }
          else { tx.to_amount = KK.round2(r.amount / rate); }
        }
      }
      return tx;
    });

    self.busy = true;
    $('impSave').disabled = true;
    var total = { saved: 0, skipped: 0, errors: [] };
    var chain = Promise.resolve();
    for (var i = 0; i < txs.length; i += self.BATCH) {
      (function (chunk, start) {
        chain = chain.then(function () {
          self.setStatus('กำลังบันทึก ' + Math.min(start + chunk.length, txs.length) + ' / ' + txs.length + '…');
          return Api.call('saveTxBatch', { txs: chunk }).then(function (res) {
            total.saved += res.saved; total.skipped += res.skipped;
            total.errors = total.errors.concat(res.errors || []);
          });
        });
      })(txs.slice(i, i + self.BATCH), i);
    }
    chain.then(function () {
      // รายการบันทึกครบแล้ว — การจำกฎ/เลขบัญชีพลาดไม่ถือว่านำเข้าล้มเหลว
      self.setStatus('กำลังจำการแก้ไข…');
      return self.saveLearning(picked).then(function () { return ''; }, function (e) {
        return ' · แต่จำการแก้ไขไม่สำเร็จ (' + e.message + ')';
      });
    }).then(function (warn) {
      return self.saveStatementFiles(acc).then(function () { return warn; }, function (e) {
        return warn + ' · เก็บไฟล์ Statement ไม่สำเร็จ (' + e.message + ') — แนบเองได้ที่หน้า 📤 ส่งบัญชี';
      });
    }).then(function (warn) {
      self.setStatus('');
      App.toast('บันทึก ' + total.saved + ' รายการ' + (total.skipped ? ' · ข้ามที่ซ้ำ ' + total.skipped : '') +
        (total.errors.length ? ' · ผิดพลาด ' + total.errors.length : '') + warn, !!(total.errors.length || warn));
      self.statements = []; self.rows = []; self.filter = 'all';
      self.render();
      App.go('accounts');
      return App.refresh();
    }).catch(function (e) {
        self.setStatus('');
        App.toast('บันทึกไม่สำเร็จ: ' + e.message + (total.saved ? ' (บันทึกไปแล้ว ' + total.saved + ' — กดบันทึกซ้ำได้ ระบบข้ามรายการซ้ำให้)' : ''), true);
      }).then(function () { self.busy = false; var b = $('impSave'); if (b) b.disabled = false; });
  },

  /** ส่งไฟล์ Statement PDF ขึ้น Drive (ใช้ประกอบชุดส่งบัญชี) */
  saveStatementFiles: function (accountId) {
    var self = this;
    return self.statements.reduce(function (p, st, i) {
      if (!st.file) return p;
      var dates = st.rows.map(function (r) { return r.date; }).sort();
      var from = st.from || dates[0], to = st.to || dates[dates.length - 1];
      return p.then(function () {
        self.setStatus('กำลังเก็บไฟล์ Statement ' + (i + 1) + ' / ' + self.statements.length + '…');
        return Attach.uploadStatement(st.file, accountId, from, to);
      });
    }, Promise.resolve());
  },

  /** จำการแก้ไขเป็นกฎ + จำเลขท้ายบัญชี + ตั้งชื่อเจ้าของ */
  saveLearning: function (picked) {
    var self = this;
    var jobs = [];
    var rules = {}, now = Date.now();
    if (self.remember) {
      picked.forEach(function (r) {
        if (!r.touched || !r.counterparty || r.counterparty.length < 3) return;
        if (r.party && r.party.kind === 'other') return;
        // โอนเข้าบัญชีตัวเองใช้เลขท้ายบัญชีจับคู่แทน (ชื่อเดียวกันแต่ไปได้หลายบัญชี)
        if (r.needOther || (r.type === 'transfer' && r.party && r.party.last4 && r.party.bank)) return;
        var id = 'L_' + self.hash(r.counterparty + '|' + r.dir);
        rules[id] = {
          id: id, pattern: r.counterparty, type: r.type, sort: -Math.round(now / 1000),
          category_id: r.type === 'transfer' ? '' : r.category_id,
          other_account_id: r.type === 'transfer' ? r.other_account_id : '', asset_id: r.asset_id || '', active: true
        };
      });
    }
    var ruleList = Object.keys(rules).map(function (k) { return rules[k]; });
    if (ruleList.length) jobs.push(function () { return Api.call('saveRules', { rules: ruleList }); });

    var updates = {};
    var st0 = self.statements[0];
    var acc = App.acc(self.accountId);
    if (st0 && acc && st0.last4 && self.hint4(acc.number_hint) !== st0.last4) {
      updates[acc.id] = { id: acc.id, number_hint: "'" + st0.last4, bank: st0.bank };
    }
    picked.forEach(function (r) {
      if (r.type !== 'transfer' || !r.party || !r.party.last4 || !r.party.bank) return;
      var other = App.acc(r.other_account_id);
      if (other && !other.number_hint && !updates[other.id]) {
        updates[other.id] = { id: other.id, number_hint: "'" + r.party.last4, bank: r.party.bank };
      }
    });
    var opening = $('impOpening');
    if (opening && opening.checked && st0) {
      updates[self.accountId] = Object.assign(updates[self.accountId] || { id: self.accountId }, { opening_balance: st0.opening });
    }
    var upd = Object.keys(updates).map(function (k) { return updates[k]; });
    if (upd.length) jobs.push(function () { return Api.call('updateAccounts', { updates: upd }); });

    // จำชื่อเจ้าของบัญชี (ที่แก้เอง หรือชื่อจากใบแจ้งครั้งแรก)
    var ownerInput = $('impOwner');
    var owner = ownerInput ? ownerInput.value.trim() : '';
    if (owner && (self.ownerDirty || !self.ownerSaved)) {
      jobs.push(function () {
        return Api.call('saveSettings', { settings: { owner_names: owner } }).then(function () { self.ownerDirty = false; });
      });
    }
    return jobs.reduce(function (p, job) { return p.then(job); }, Promise.resolve());
  },

  hash: function (s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  },

  // ------------------------------------------------------------ แสดงผล
  setStatus: function (msg) {
    var el = $('impStatus');
    if (el) { el.textContent = msg; el.hidden = !msg; }
  },

  counts: function () {
    var c = { all: this.rows.length, need: 0, guess: 0, own: 0, dup: 0 };
    this.rows.forEach(function (r) {
      if (r.status === 'need') c.need++;
      else if (r.status === 'guess') c.guess++;
      else if (r.status === 'own') c.own++;
      else if (r.status === 'dup') c.dup++;
    });
    return c;
  },

  render: function () {
    var el = $('impBody');
    if (!el) return;
    var self = this;
    if (!self.statements.length) {
      var c0 = Config.get();
      el.innerHTML = ((c0.demo || !c0.url)
        ? '<p class="form-error">⚠️ ตอนนี้อยู่ใน <b>โหมดทดลอง</b> — นำเข้าแล้วจะไม่ถูกบันทึกลง Google Sheet · ไปที่ ⚙️ ตั้งค่า เพื่อเชื่อมต่อก่อน</p>' : '') +
        '<div class="card form-card">' +
        '<p>เลือกไฟล์ Statement (PDF) — เลือกได้หลายเดือนพร้อมกัน</p>' +
        '<label class="btn primary file-btn">📄 เลือกไฟล์ PDF<input type="file" id="impFile" accept="application/pdf,.pdf" multiple hidden></label>' +
        '<p class="hint">ไฟล์ถูกอ่านในเครื่องนี้ แล้วเก็บสำเนาไว้ใน Google Drive ของคุณเพื่อใช้ส่งบัญชี · ถ้าไฟล์ติดรหัสผ่าน เปิดใน Chrome → Ctrl+P → บันทึกเป็น PDF ก่อน</p>' +
        '<p class="hint">รองรับตอนนี้: ' + self.parsers.map(function (p) { return p.name; }).join(', ') + '</p>' +
        '</div>';
      $('impFile').addEventListener('change', function () { self.handleFiles(this.files); this.value = ''; });
      return;
    }

    var accOpts = (self.accountId ? '' : '<option value="" selected>— เลือกบัญชี —</option>') +
      App.active(App.data.accounts).filter(function (a) { return a.kind === 'bank'; }).map(function (a) {
        return '<option value="' + App.esc(a.id) + '"' + (a.id === self.accountId ? ' selected' : '') + '>' + App.esc(KK.accountName(a)) + '</option>';
      }).join('');
    var cfg = Config.get();
    var demoWarn = (cfg.demo || !cfg.url)
      ? '<p class="form-error">⚠️ ตอนนี้อยู่ใน <b>โหมดทดลอง</b> — รายการจะไม่ถูกบันทึกลง Google Sheet และใช้บัญชีตัวอย่าง (ไม่มีเลขท้ายบัญชีของคุณ) ' +
        'ไปที่ ⚙️ ตั้งค่า → เชื่อมต่อ Google Sheet ก่อน แล้วค่อยนำเข้าใหม่</p>'
      : '';
    var acc = App.acc(self.accountId);
    self.ownerSaved = !!String(App.data.settings.owner_names || '').trim();
    var owners = App.data.settings.owner_names || self.statements[0].owner || '';
    var stHtml = self.statements.map(function (st) {
      return '<div class="imp-st"><b>' + App.esc(st.bankName) + ' ···' + App.esc(st.last4) + '</b> ' +
        App.esc(App.dayLabel(st.from)) + ' – ' + App.esc(App.dayLabel(st.to)) + ' · ' + st.rows.length + ' รายการ<br>' +
        '<span class="hint">ยอดยกมา ' + App.money(st.opening) + ' → ยอดยกไป ' + App.money(st.closing) + ' · ' +
        (st.ok ? '<span class="pos">✅ ยอดตรงกับใบแจ้งทุกบรรทัด</span>' : '<span class="neg">⚠️ ' + App.esc(st.problem) + '</span>') + '</span></div>';
    }).join('');
    var st0 = self.statements[0];
    var showOpening = acc && KK.num(acc.opening_balance) === 0 && st0.opening;

    el.innerHTML = demoWarn +
      '<div class="card form-card">' + stHtml +
      '<label>นำเข้าเป็นบัญชี<select id="impAccount">' + accOpts + '</select></label>' +
      (showOpening ? '<label class="row-check"><input type="checkbox" id="impOpening" checked> ตั้งยอดยกมาของบัญชีนี้ = ' + App.money(st0.opening) + ' (ยอดก่อน ' + App.esc(App.dayLabel(st0.from)) + ')</label>' : '') +
      '<label>ชื่อเจ้าของบัญชี (ไทย, อังกฤษ — คั่นด้วย ,) ใช้แยกโอนเข้าบัญชีตัวเอง' +
      '<input type="text" id="impOwner" value="' + App.esc(owners) + '"></label>' +
      '<div class="btn-row"><label class="btn file-btn">＋ เพิ่มไฟล์<input type="file" id="impFile" accept="application/pdf,.pdf" multiple hidden></label>' +
      '<button type="button" class="btn danger" id="impReset">ล้าง</button></div>' +
      '</div>' +
      '<div class="chips imp-chips" id="impChips"></div>' +
      '<div id="impRows"></div>' +
      '<div class="imp-footer" id="impFooter"></div>';

    $('impAccount').addEventListener('change', function () { self.accountId = this.value; self.rebuild(); });
    $('impOwner').addEventListener('change', function () {
      App.data.settings.owner_names = this.value.trim();
      self.ownerDirty = true;
      self.rebuild();
    });
    $('impFile').addEventListener('change', function () { self.handleFiles(this.files); this.value = ''; });
    $('impReset').addEventListener('click', function () { self.reset(); });
    self.renderRows();
  },

  renderRows: function () {
    var self = this;
    var c = self.counts();
    var chips = [['all', 'ทั้งหมด'], ['need', 'ต้องเลือก'], ['guess', 'เดา'], ['own', 'โอนตัวเอง'], ['dup', 'ซ้ำ']];
    $('impChips').innerHTML = chips.map(function (ch) {
      return '<button type="button" class="chip' + (self.filter === ch[0] ? ' on' : '') + '" data-f="' + ch[0] + '">' +
        ch[1] + ' ' + c[ch[0]] + '</button>';
    }).join('');
    $('impChips').querySelectorAll('[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { self.filter = b.dataset.f; self.renderRows(); });
    });

    var cats = { expense: '', income: '' };
    ['expense', 'income'].forEach(function (type) {
      var groups = {};
      App.active(App.data.categories).filter(function (cat) { return cat.type === type; }).forEach(function (cat) {
        (groups[cat.group] = groups[cat.group] || []).push(cat);
      });
      cats[type] = Object.keys(groups).map(function (g) {
        return '<optgroup label="' + App.esc(g) + '">' + groups[g].map(function (cat) {
          return '<option value="' + App.esc(cat.id) + '">' + App.esc(cat.name) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    });
    var accOpts = App.active(App.data.accounts).filter(function (a) { return a.id !== self.accountId; }).map(function (a) {
      return '<option value="' + App.esc(a.id) + '">' + App.esc(KK.accountName(a)) + '</option>';
    }).join('');
    var assetOpts = '<option value="">— บ้าน/รถ —</option>' + App.active(App.data.assets).map(function (s) {
      return '<option value="' + App.esc(s.id) + '">' + App.esc(s.name) + '</option>';
    }).join('');
    var sel = function (html, value) {
      return html.replace('value="' + App.esc(value) + '"', 'value="' + App.esc(value) + '" selected');
    };

    var html = '';
    var shown = 0;
    self.rows.forEach(function (r, i) {
      if (self.filter !== 'all' && r.status !== self.filter) return;
      shown++;
      var st = self.STATUS[r.status] || self.STATUS.need;
      var sign = r.dir === 'out' ? '-' : '+';
      var typeOpts = r.dir === 'out'
        ? '<option value="expense">รายจ่าย</option><option value="transfer">โอนออก → บัญชีตัวเอง</option>'
        : '<option value="income">รายรับ</option><option value="transfer">โอนเข้า ← บัญชีตัวเอง</option>';
      var second = r.type === 'transfer'
        ? '<select data-i="' + i + '" data-k="other_account_id"><option value="">— เลือกบัญชีอีกฝั่ง —</option>' + sel(accOpts, r.other_account_id) + '</select>'
        : '<select data-i="' + i + '" data-k="category_id"><option value="">— เลือกหมวด —</option>' + sel(cats[r.type], r.category_id) + '</select>';
      var cat = App.cat(r.category_id);
      var needAsset = r.asset_id || (cat && /บ้าน|รถ|ค่าเช่า/.test(cat.group));
      html += '<div class="imp-row ' + st.cls + (r.checked ? '' : ' off') + '">' +
        '<label class="imp-top"><input type="checkbox" data-i="' + i + '" data-k="checked"' + (r.checked ? ' checked' : '') + '>' +
        '<span class="imp-date">' + App.esc(App.dayLabel(r.date)) + ' ' + App.esc(r.time) + '</span>' +
        '<span class="badge">' + st.label + (r.byPrice && r.status === 'guess' ? ' (จากราคา)' : '') + (r.dupWhy ? ' · ' + App.esc(r.dupWhy) : '') + '</span>' +
        '<b class="' + (r.dir === 'out' ? 'neg' : 'pos') + '">' + sign + App.money(r.amount) + '</b></label>' +
        '<div class="imp-detail">' + App.esc(r.detail) + ' <span class="hint">· ' + App.esc(r.channel) + '</span></div>' +
        '<div class="imp-ctl"><select data-i="' + i + '" data-k="type">' + sel(typeOpts, r.type) + '</select>' + second +
        (needAsset ? '<select data-i="' + i + '" data-k="asset_id">' + sel(assetOpts, r.asset_id) + '</select>' : '') +
        '</div></div>';
    });
    $('impRows').innerHTML = html || '<div class="empty">ไม่มีรายการในกลุ่มนี้</div>';
    $('impRows').querySelectorAll('[data-k]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var v = inp.type === 'checkbox' ? inp.checked : inp.value;
        self.update(+inp.dataset.i, inp.dataset.k, v);
      });
    });
    self.renderFooter();
  },

  renderFooter: function () {
    var picked = this.rows.filter(function (r) { return r.checked; });
    var out = 0, inn = 0, trf = 0, self = this;
    picked.forEach(function (r) {
      if (r.type === 'transfer') trf += r.amount; else if (r.dir === 'out') out += r.amount; else inn += r.amount;
    });
    var missing = picked.filter(function (r) { return !self.isComplete(r); }).length;
    $('impFooter').innerHTML =
      '<div class="imp-sum">เลือก ' + picked.length + '/' + this.rows.length + ' · รายจ่าย <b class="neg">' + App.money(out) +
      '</b> · รายรับ <b class="pos">' + App.money(inn) + '</b> · โอน <b class="trf">' + App.money(trf) + '</b>' +
      (missing ? ' · <b class="neg">ต้องเลือกอีก ' + missing + '</b>' : '') + '</div>' +
      '<div class="imp-actions"><label class="row-check"><input type="checkbox" id="impRemember"' + (this.remember ? ' checked' : '') +
      '> จำการแก้ไขไว้ใช้ครั้งหน้า</label>' +
      '<button type="button" class="btn primary" id="impSave"' + (this.busy ? ' disabled' : '') + '>บันทึก ' + picked.length + ' รายการ</button></div>';
    $('impSave').addEventListener('click', function () { self.save(); });
    $('impRemember').addEventListener('change', function () { self.remember = this.checked; });
  }
};

// ---------------------------------------------------------------- กสิกรไทย (บัญชีออมทรัพย์)
Importer.parsers.push({
  bank: 'KBANK',
  name: 'กสิกรไทย (บัญชีเงินฝาก)',

  detect: function (text) {
    return /ถอนเงิน\s*\/\s*ฝากเงิน/.test(text) && /ช่องทาง/.test(text) && /\d\d-\d\d-\d\d/.test(text);
  },

  toIso: function (d) {
    var m = /^(\d\d)-(\d\d)-(\d\d)$/.exec(d);
    var y = 2000 + +m[3];
    if (y > new Date().getFullYear() + 1) y -= 543; // เผื่อปี พ.ศ. 2 หลัก
    return y + '-' + m[2] + '-' + m[1];
  },

  parse: function (pages, lines) {
    var num = function (s) { return parseFloat(String(s).replace(/,/g, '')); };
    var first = pages[0];
    var text0 = first.map(function (i) { return i.s; }).join(' ');
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '' };

    var acct = /(\d{3}-\d-\d{5}-\d)/.exec(text0);
    if (acct) st.last4 = acct[1].replace(/\D/g, '').slice(-4);
    var owner = first.find(function (i) { return /^ชื่อบัญชี\s/.test(i.s); });
    if (owner) st.owner = owner.s.replace(/^ชื่อบัญชี\s+/, '').trim();
    var period = /(\d\d)\/(\d\d)\/(\d{4})\s*-\s*(\d\d)\/(\d\d)\/(\d{4})/.exec(text0);
    if (period) {
      st.from = period[3] + '-' + period[2] + '-' + period[1];
      st.to = period[6] + '-' + period[5] + '-' + period[4];
    }

    // ยอดรวมบนหัวใบแจ้ง: "รวมถอนเงิน N รายการ" / "รวมฝากเงิน N รายการ" / "ยอดยกไป" + ตัวเลขด้านขวาบรรทัดเดียวกัน
    var rightOf = function (label) {
      var it = first.find(function (i) { return i.s.indexOf(label) === 0; });
      if (!it) return null;
      var v = first.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x && /^[\d,]+\.\d\d$/.test(i.s); })[0];
      return v ? { label: it.s, value: num(v.s) } : null;
    };
    var w = rightOf('รวมถอนเงิน'), d = rightOf('รวมฝากเงิน'), c = rightOf('ยอดยกไป');
    if (c) st.closing = c.value;
    if (w && d) {
      st.totals = {
        wN: +(/(\d+)\s*รายการ/.exec(w.label) || [0, -1])[1], wSum: w.value,
        dN: +(/(\d+)\s*รายการ/.exec(d.label) || [0, -1])[1], dSum: d.value
      };
    }

    // ตารางรายการ: ตำแหน่งคอลัมน์ (x) ตามแบบฟอร์มของกสิกร
    var last = null;
    lines.forEach(function (ln) {
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b && !/หน้าที่ \(PAGE\/OF\)/.test(k.s); })
          .map(function (k) { return k.s; }).join(' ').trim();
      };
      var date = get(0, 90);
      if (/^\d\d-\d\d-\d\d$/.test(date)) {
        var type = get(118, 200), bal = get(290, 330);
        if (!/^[\d,]+\.\d\d$/.test(bal)) { last = null; return; }
        if (type === 'ยอดยกมา') {
          if (st.opening === null) st.opening = num(bal);
          st.rows.push({ carry: true, balance: num(bal) });
          last = null;
          return;
        }
        last = {
          date: Importer.parsers[0].toIso(date), time: get(95, 118), kind: type,
          amount: num(get(200, 290)), balance: num(bal), channel: get(330, 400), detail: get(400, 9999)
        };
        st.rows.push(last);
      } else if (last && ln.page && get(400, 9999) && !get(0, 400)) {
        last.detail = (last.detail + ' ' + get(400, 9999)).trim(); // รายละเอียดที่ขึ้นบรรทัดใหม่
      } else if (!date) {
        last = last && get(0, 400) ? null : last;
      }
    });
    if (!st.rows.length) throw new Error('ไม่พบรายการในไฟล์นี้');
    if (st.opening === null) st.opening = KK.round2(st.rows[0].balance + (st.rows[0].amount || 0));
    if (!st.from) { st.from = st.rows[0].date; st.to = st.rows[st.rows.length - 1].date; }
    return st;
  }
});

// ---------------------------------------------------------------- กรุงไทย (บัญชีออมทรัพย์)
Importer.BANK_CODES = {
  '002': 'BBL', '004': 'KBANK', '006': 'KTB', '011': 'TTB', '014': 'SCB', '022': 'CIMBT', '024': 'UOBT',
  '025': 'BAY', '030': 'GSB', '033': 'GHB', '034': 'BAAC', '065': 'TBANK', '066': 'IBANK', '067': 'TISCO',
  '069': 'KKP', '070': 'ICBC', '071': 'TCRB', '073': 'LHB'
};

Importer.parsers.push({
  bank: 'KTB',
  name: 'กรุงไทย (บัญชีออมทรัพย์)',

  detect: function (text) {
    return /รายการเดินบัญชี/.test(text) && /รายการถอน/.test(text) && /รายการฝาก/.test(text) && /ยอดเงินคงเหลือ/.test(text);
  },

  toIso: function (d) {
    var m = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(d);
    var y = 2000 + +m[3];
    if (y > new Date().getFullYear() + 1) y = 1957 + +m[3]; // ปี พ.ศ. 2 หลัก (69 → 2026)
    return y + '-' + m[2] + '-' + m[1];
  },

  /** "004-0123456789" = รหัสธนาคาร + เลขบัญชี / "Transfer From ชื่อ" / อื่น ๆ */
  party: function (row) {
    var d = row.detail, m;
    m = /^(\d{3})-(\d{6,})$/.exec(d);
    if (m) {
      var bank = Importer.BANK_CODES[m[1]] || m[1];
      var last4 = m[2].slice(-4);
      return { name: bank + ' X' + last4, kind: row.dir === 'out' ? 'to' : 'from', bank: bank, last4: last4, anon: true };
    }
    m = /^Transfer From\s+(.+)$/i.exec(d);
    if (m) return { name: m[1].trim(), kind: 'from' };
    return { name: d, kind: 'other' };
  },

  parse: function (pages, lines) {
    var num = function (s) { return s ? parseFloat(String(s).replace(/,/g, '')) : 0; };
    var self = this;
    var first = pages[0];
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '', dirKnown: true };

    var at = function (label) {
      var it = first.find(function (i) { return i.s === label; });
      if (!it) return '';
      var v = first.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x; }).sort(function (a, b) { return a.x - b.x; })[0];
      return v ? v.s : '';
    };
    st.owner = at('ชื่อบัญชี');
    st.last4 = at('เลขที่บัญชี').replace(/\D/g, '').slice(-4);
    var period = /(\d\d\/\d\d\/\d\d)\s*ถึง\s*(\d\d\/\d\d\/\d\d)/.exec(at('รายการบัญชีระหว่างวันที่'));
    if (period) { st.from = self.toIso(period[1]); st.to = self.toIso(period[2]); }

    // ยอดรวมท้ายใบแจ้ง: "รายการถอนทั้งหมด  N  ยอด" / "รายการฝากทั้งหมด  N  ยอด"
    var all = [].concat.apply([], pages);
    var total = function (label) {
      var it = all.find(function (i) { return i.s === label; });
      if (!it) return null;
      var vals = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x; }).sort(function (a, b) { return a.x - b.x; });
      return vals.length >= 2 ? { n: +vals[0].s, sum: num(vals[1].s) } : null;
    };
    var tw = total('รายการถอนทั้งหมด'), td = total('รายการฝากทั้งหมด');
    if (tw && td) st.totals = { wN: tw.n, wSum: tw.sum, dN: td.n, dSum: td.sum };

    // ตาราง: วันที่ (บรรทัดถัดไปคือเวลา) | รายการ | รายละเอียด | ถอน | ฝาก | คงเหลือ | สาขา
    var raw = [], cur = null;
    lines.forEach(function (ln) {
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b; }).map(function (k) { return k.s; }).join(' ').trim();
      };
      var d = get(0, 80);
      if (/^\d\d\/\d\d\/\d\d$/.test(d)) {
        cur = { date: self.toIso(d), time: '', kind: get(80, 205), detail: get(205, 330),
          w: num(get(330, 403)), dep: num(get(403, 468)), balance: num(get(468, 528)) };
        raw.push(cur);
      } else if (cur && (!d || /^\d\d:\d\d$/.test(d)) && !get(80, 205) && !get(330, 9999)) {
        if (/^\d\d:\d\d$/.test(d)) cur.time = d;
        var more = get(205, 330);
        if (more) cur.detail += ' ' + more;
      } else {
        cur = null;
      }
    });
    if (!raw.length) throw new Error('ไม่พบรายการในไฟล์นี้');

    raw.forEach(function (r) {
      var detail = r.detail.replace(/~.*$/, '').trim(); // ตัด "~ Future Amount: ... ~ Tran: ..."
      var base = { date: r.date, time: r.time, channel: r.kind, detail: detail || r.kind };
      // บรรทัดเดียวอาจมีทั้งถอนและฝาก (เช่น ภาษีดอกเบี้ย + ดอกเบี้ย) — แยกเป็น 2 รายการ, ข้ามยอด 0
      if (r.w > 0 && r.dep > 0) {
        st.rows.push(Object.assign({}, base, { dir: 'out', amount: r.w, balance: null }));
        st.rows.push(Object.assign({}, base, { dir: 'in', amount: r.dep, balance: r.balance }));
      } else if (r.w > 0) {
        st.rows.push(Object.assign({}, base, { dir: 'out', amount: r.w, balance: r.balance }));
      } else if (r.dep > 0) {
        st.rows.push(Object.assign({}, base, { dir: 'in', amount: r.dep, balance: r.balance }));
      }
    });
    var f = raw[0];
    st.opening = KK.round2(f.balance + f.w - f.dep);
    if (!st.from) { st.from = raw[0].date; st.to = raw[raw.length - 1].date; }
    return st;
  }
});

// ---------------------------------------------------------------- กรุงเทพ (บัญชีออมทรัพย์)
Importer.parsers.push({
  bank: 'BBL',
  name: 'กรุงเทพ (บัญชีออมทรัพย์)',

  detect: function (text) {
    return /STATEMENT OF SAVING ACCOUNT/.test(text) && /Bangkok Bank/i.test(text);
  },

  toIso: function (d) {
    var m = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(d);
    var y = 2000 + +m[3];
    if (y > new Date().getFullYear() + 1) y = 1957 + +m[3]; // เผื่อเป็นปี พ.ศ. 2 หลัก
    return y + '-' + m[2] + '-' + m[1];
  },

  /** ใบแจ้งกรุงเทพไม่บอกชื่อ/บัญชีอีกฝั่ง — ใช้คำอธิบายรายการเป็นชื่อ */
  party: function (row) {
    return { name: row.detail, kind: 'other', anon: true };
  },

  parse: function (pages, lines) {
    var num = function (s) { return s ? parseFloat(String(s).replace(/,/g, '')) : 0; };
    var isAmt = function (s) { return /^[\d,]+\.\d\d$/.test(s); };
    var self = this;
    var all = [].concat.apply([], pages);
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '', dirKnown: true };

    var right = function (label) {
      var it = all.find(function (i) { return i.s.indexOf(label) === 0; });
      if (!it) return '';
      var v = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x + 60; }).sort(function (a, b) { return a.x - b.x; })[0];
      return v ? v.s : '';
    };
    st.owner = right('ชื่อ/Name');
    st.last4 = right('เลขที่บัญชี/Account No.').replace(/\D/g, '').slice(-4);
    var period = /(\d\d)\/(\d\d)\/(\d{4})\s*-\s*(\d\d)\/(\d\d)\/(\d{4})/.exec(right('รอบรายการบัญชี'));
    if (period) {
      st.from = period[3] + '-' + period[2] + '-' + period[1];
      st.to = period[6] + '-' + period[5] + '-' + period[4];
    }

    // ยอดรวมท้ายใบแจ้ง: จำนวนรายการ (x≈279) และจำนวนเงิน (ขวาสุด) อยู่บรรทัดเดียวกับป้าย
    var footer = function (label) {
      var it = all.find(function (i) { return i.s.indexOf(label) >= 0; });
      if (!it) return null;
      var same = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x; });
      var n = same.find(function (i) { return /^\d+$/.test(i.s); });
      var amt = same.filter(function (i) { return isAmt(i.s); }).sort(function (a, b) { return b.x - a.x; })[0];
      return { n: n ? +n.s : -1, sum: amt ? num(amt.s) : -1 };
    };
    var w = footer('Total No. of Debits'), d = footer('Total No. of Credits');
    if (w && d) st.totals = { wN: w.n, wSum: w.sum, dN: d.n, dSum: d.sum };

    // ตาราง: วันที่ | รายการ | เลขที่เช็ค | ถอน | ฝาก | คงเหลือ | ผ่านทาง
    lines.forEach(function (ln) {
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b; }).map(function (k) { return k.s; }).join(' ').trim();
      };
      var date = get(0, 55);
      if (!/^\d\d\/\d\d\/\d\d$/.test(date)) return;
      var detail = get(55, 160), wd = get(200, 320), dep = get(320, 390), bal = get(390, 430), via = get(430, 9999);
      if (!isAmt(bal)) return;
      if (detail === 'B/F') { if (st.opening === null) st.opening = num(bal); return; }
      var row = { date: self.toIso(date), time: '', channel: via, detail: detail, balance: num(bal) };
      if (isAmt(wd) && num(wd) > 0) st.rows.push(Object.assign({ dir: 'out', amount: num(wd) }, row));
      else if (isAmt(dep) && num(dep) > 0) st.rows.push(Object.assign({ dir: 'in', amount: num(dep) }, row));
    });
    if (!st.rows.length) throw new Error('ไม่พบรายการในไฟล์นี้');
    if (st.opening === null) {
      var f = st.rows[0];
      st.opening = KK.round2(f.balance + (f.dir === 'out' ? f.amount : -f.amount));
    }
    // ใบแจ้งไม่มีเวลา — ใช้ลำดับบรรทัดแทน เพื่อให้รหัสกันซ้ำไม่ชนกันในวันเดียวกัน
    st.rows.forEach(function (r, i) { r.time = 'L' + i; });
    if (!st.from) { st.from = st.rows[0].date; st.to = st.rows[st.rows.length - 1].date; }
    return st;
  }
});

// ---------------------------------------------------------------- UOB (TMRW บัญชีเงินฝาก รายเดือน)
Importer.parsers.push({
  bank: 'UOBT',
  name: 'UOB TMRW (บัญชีเงินฝาก)',
  MONTHS: { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' },

  detect: function (text) {
    return /Account Transaction Details/.test(text) && /Trans Date/.test(text) && /Value Date/.test(text);
  },

  /** บรรทัดที่สองของรายละเอียดใช้ฟอนต์เพี้ยน (ตัวอักษรเลื่อนไป 29) เช่น "82%" = "UOB" */
  decode: function (s) {
    if (/[A-Za-z]{2}/.test(s)) return s;
    return s.split('').map(function (ch) {
      var c = ch.charCodeAt(0);
      return c < 0x62 ? String.fromCharCode(c + 29) : ch;
    }).join('');
  },

  party: function (row) {
    return { name: row.detail, kind: 'other', anon: true };
  },

  parse: function (pages, lines) {
    var num = function (s) { return s ? parseFloat(String(s).replace(/,/g, '')) : 0; };
    var isAmt = function (s) { return /^[\d,]+\.\d\d$/.test(s); };
    var self = this;
    var all = [].concat.apply([], pages);
    var text = all.map(function (i) { return i.s; }).join(' ');
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '', dirKnown: true };

    var period = /Period:\s*(\d\d) (\w{3}) (\d{4}) to (\d\d) (\w{3}) (\d{4})/.exec(text);
    if (!period) throw new Error('ไม่พบรอบใบแจ้ง (Period)');
    st.from = period[3] + '-' + self.MONTHS[period[2]] + '-' + period[1];
    st.to = period[6] + '-' + self.MONTHS[period[5]] + '-' + period[4];
    var endYear = +period[6], endMonth = +self.MONTHS[period[5]];
    var acct = /TMRW[^\d]*(\d{3}-\d{3}-\d{3}-\d)/.exec(text);
    if (acct) st.last4 = acct[1].replace(/\D/g, '').slice(-4);

    var toIso = function (d) {
      var m = /^(\d\d) (\w{3})$/.exec(d);
      var mon = +self.MONTHS[m[2]];
      var y = mon > endMonth ? endYear - 1 : endYear; // รายการข้ามปี (เช่น ธ.ค. ในใบแจ้ง ม.ค.)
      return y + '-' + self.MONTHS[m[2]] + '-' + m[1];
    };

    var cur = null;
    lines.forEach(function (ln) {
      if (ln.page < 2 && !/Trans Date/.test(text)) return;
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b; }).map(function (k) { return k.s; }).join(' ').trim();
      };
      var d = get(0, 100);
      if (d === 'Total' || get(100, 140) === 'Total') {
        var amts = ln.cells.filter(function (k) { return isAmt(k.s); }).sort(function (a, b) { return a.x - b.x; });
        if (amts.length >= 2) st.totals = { wN: null, wSum: num(amts[0].s), dN: null, dSum: num(amts[1].s) };
        cur = null;
        return;
      }
      if (/^\d\d \w{3}$/.test(d) && self.MONTHS[d.slice(3)]) {
        var detail = get(140, 330), wd = get(330, 410), dep = get(410, 500), bal = get(500, 9999);
        if (detail === 'BALANCE B/F') { st.opening = num(bal); cur = null; return; }
        cur = { date: toIso(d), time: '', channel: '', detail: detail, balance: isAmt(bal) ? num(bal) : null };
        if (isAmt(wd)) { cur.dir = 'out'; cur.amount = num(wd); st.rows.push(cur); }
        else if (isAmt(dep)) { cur.dir = 'in'; cur.amount = num(dep); st.rows.push(cur); }
        else cur = null;
      } else if (cur && !d && !get(330, 9999)) {
        // ตัดเศษอักษรไทยที่ฟอนต์เพี้ยนอ่านไม่ได้ทิ้ง เหลือแต่ข้อความภาษาอังกฤษ/ตัวเลข
        var more = ln.cells.filter(function (k) { return k.x >= 140 && k.x < 330; }).map(function (k) { return self.decode(k.s); })
          .join(' ').replace(/[^\x20-\x7E]+/g, ' ').replace(/(^|\s)\S(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
        if (more) cur.detail = (cur.detail + ' ' + more).trim();
      }
    });
    if (st.opening === null) throw new Error('ไม่พบยอดยกมา (BALANCE B/F)');
    st.empty = !st.rows.length; // เดือนที่ไม่มีความเคลื่อนไหว
    st.rows.forEach(function (r, i) { r.time = 'L' + i; });
    return st;
  }
});

// ---------------------------------------------------------------- ออมสิน (บัญชีเงินฝากเผื่อเรียก รายเดือน)
Importer.parsers.push({
  bank: 'GSB',
  name: 'ออมสิน (เงินฝากเผื่อเรียก)',

  detect: function (text) {
    return /รายการเดินบัญชีเงินฝาก/.test(text) && /ยอดยกมา/.test(text) && /ยอดยกไป/.test(text) && /ผู้ทำ/.test(text);
  },

  toIso: function (d) {
    var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(d);
    var y = +m[3];
    if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    return y + '-' + m[2] + '-' + m[1];
  },

  /** ใบแจ้งออมสินไม่บอกชื่อปลายทาง — ใช้ประเภทรายการ (เช่น "C Scan B", "MyMo Transfer") เป็นชื่อ */
  party: function (row) {
    return { name: row.detail, kind: 'other', anon: true };
  },

  parse: function (pages, lines) {
    var num = function (s) { return s ? parseFloat(String(s).replace(/,/g, '')) : 0; };
    var isAmt = function (s) { return /^[\d,]+\.\d\d$/.test(s); };
    var self = this;
    var all = [].concat.apply([], pages);
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '', dirKnown: true };

    var right = function (label) {
      var it = all.find(function (i) { return i.s === label; });
      if (!it) return '';
      var v = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x; }).sort(function (a, b) { return a.x - b.x; })[0];
      return v ? v.s : '';
    };
    st.owner = right('ชื่อบัญชี');
    st.last4 = right('เลขที่บัญชี').replace(/\D/g, '').slice(-4);
    var period = /(\d\d\/\d\d\/\d{4})\s*-\s*(\d\d\/\d\d\/\d{4})/.exec(right('รอบวันที่'));
    if (period) { st.from = self.toIso(period[1]); st.to = self.toIso(period[2]); }

    var amountOnLine = function (label) {
      var it = all.find(function (i) { return i.s.indexOf(label) === 0; });
      if (!it) return null;
      var v = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && isAmt(i.s); })[0];
      return { label: it.s, value: v ? num(v.s) : null };
    };
    var op = amountOnLine('ยอดยกมา'), cl = amountOnLine('ยอดยกไป');
    if (op) st.opening = op.value;
    if (cl) st.closing = cl.value;
    var tw = amountOnLine('ยอดรวมรายการถอน'), td = amountOnLine('ยอดรวมรายการฝาก');
    if (tw && td) {
      var cnt = function (s) { var m = /=\s*(\d+)\s*รายการ/.exec(s); return m ? +m[1] : null; };
      st.totals = { wN: cnt(tw.label), wSum: tw.value, dN: cnt(td.label), dSum: td.value };
    }

    // แถว: "dd/mm/yyyy รายการ" | ถอน | ฝาก | คงเหลือ | รหัสสาขา | ผู้ทำรายการ
    lines.forEach(function (ln) {
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b; }).map(function (k) { return k.s; }).join(' ').trim();
      };
      var head = get(0, 250);
      var m = /^(\d\d\/\d\d\/\d{4})\s+(.*)$/.exec(head);
      if (!m) return;
      var wd = get(250, 340), dep = get(340, 420), bal = get(420, 500), branch = get(500, 530);
      if (!isAmt(bal)) return;
      var row = { date: self.toIso(m[1]), time: '', channel: 'สาขา ' + branch, detail: m[2].trim(), balance: num(bal) };
      if (isAmt(wd) && num(wd) > 0) st.rows.push(Object.assign({ dir: 'out', amount: num(wd) }, row));
      else if (isAmt(dep) && num(dep) > 0) st.rows.push(Object.assign({ dir: 'in', amount: num(dep) }, row));
    });
    if (st.opening === null) throw new Error('ไม่พบยอดยกมา');
    st.empty = !st.rows.length;
    st.rows.forEach(function (r, i) { r.time = 'L' + i; });
    if (!st.from && st.rows.length) { st.from = st.rows[0].date; st.to = st.rows[st.rows.length - 1].date; }
    return st;
  }
});

// ---------------------------------------------------------------- ttb ทีทีบี (บัญชีออมทรัพย์ แบบมีรายละเอียด)
Importer.TH_MONTHS = { 'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04', 'พ.ค.': '05', 'มิ.ย.': '06',
  'ก.ค.': '07', 'ส.ค.': '08', 'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12' };

Importer.parsers.push({
  bank: 'TTB',
  name: 'ttb (บัญชีออมทรัพย์)',

  detect: function (text) {
    return /ttbbank\.com/i.test(text) && /รายการเดินบัญชีเงินฝาก/.test(text) && /ยอดเงินคงเหลือ/.test(text);
  },

  /** "30 ก.ย. 69" → 2026-09-30 */
  toIso: function (d) {
    var m = /^(\d{1,2})\s+(\S+)\s+(\d{2,4})$/.exec(d);
    if (!m || !Importer.TH_MONTHS[m[2]]) return null;
    var y = +m[3];
    if (y < 100) y += 2500;
    if (y > 2400) y -= 543;
    return y + '-' + Importer.TH_MONTHS[m[2]] + '-' + ('0' + m[1]).slice(-2);
  },

  /** "ttb X1234 นาย ..." = ธนาคาร + เลขท้าย + ชื่อ */
  party: function (row) {
    var m = /^([A-Za-z]{2,6})\s+X(\d{3,})\s*(.*)$/.exec(row.detail);
    if (m) {
      var bank = m[1].toUpperCase();
      if (bank === 'KBANK' || bank === 'KPLUS') bank = 'KBANK';
      if (bank === 'UOB') bank = 'UOBT';
      return { name: m[3].trim() || row.detail, kind: row.dir === 'out' ? 'to' : 'from', bank: bank, last4: m[2].slice(-4) };
    }
    return { name: row.kind + (row.detail && row.detail !== '-' ? ' ' + row.detail : ''), kind: 'other', anon: true };
  },

  parse: function (pages, lines) {
    var num = function (s) { return parseFloat(String(s).replace(/[,+]/g, '')); };
    var self = this;
    // ฟอนต์ใน PDF ของ ttb แมปวรรณยุกต์ผิด (เช่น "ทีŮ" = "ที่", "ดอกเบีűย" = "ดอกเบี้ย")
    var fix = function (s) { return s.replace(/Ů/g, '่').replace(/ű/g, '้'); };
    pages.forEach(function (p) { p.forEach(function (i) { i.s = fix(i.s); }); });
    lines.forEach(function (ln) { ln.cells.forEach(function (c) { c.s = fix(c.s); }); });
    var all = [].concat.apply([], pages);
    var st = { rows: [], opening: null, closing: null, totals: null, owner: '', last4: '', from: '', to: '', dirKnown: true };

    var right = function (label) {
      var it = all.find(function (i) { return i.s.replace(/[^฀-๿a-zA-Z]/g, '').indexOf(label) === 0; });
      if (!it) return '';
      var v = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2 && i.x > it.x + 30; }).sort(function (a, b) { return a.x - b.x; })[0];
      return v ? v.s : '';
    };
    var acct = all.find(function (i) { return /^\d{3}-\d-\d{5}-\d$/.test(i.s); });
    if (acct) st.last4 = acct.s.replace(/\D/g, '').slice(-4);
    var name = all.find(function (i) { return /^นาย|^นาง|^น\.ส\./.test(i.s); });
    if (name) st.owner = name.s;

    var tot = function (label) {
      var it = all.find(function (i) { return i.s === label; });
      if (!it) return null;
      var same = all.filter(function (i) { return Math.abs(i.y - it.y) <= 2; });
      var n = same.find(function (i) { return /^\d+\s*รายการ$/.test(i.s); });
      var a = same.find(function (i) { return /^[\d,]+\.\d\d$/.test(i.s); });
      return { n: n ? parseInt(n.s, 10) : null, sum: a ? num(a.s) : null };
    };
    var tw = tot('รวมถอนเงิน'), td = tot('รวมฝากเงิน');
    if (tw && td) st.totals = { wN: tw.n, wSum: tw.sum, dN: td.n, dSum: td.sum };

    // ตาราง (ใหม่ → เก่า): วันที่ | เวลา | รายการ | ช่องทาง | จำนวนเงิน (+/-) | ยอดคงเหลือ | รายละเอียด
    var rows = [];
    lines.forEach(function (ln) {
      var get = function (a, b) {
        return ln.cells.filter(function (k) { return k.x >= a && k.x < b; }).map(function (k) { return k.s; }).join(' ').trim();
      };
      var date = self.toIso(get(0, 80));
      if (!date) return;
      var amt = get(280, 360), bal = get(360, 432);
      if (!/^[+-][\d,]+\.\d\d$/.test(amt) || !/^-?[\d,]+\.\d\d$/.test(bal)) return;
      var v = num(amt);
      var kind = get(105, 210);
      var detail = get(432, 9999);
      rows.push({ date: date, time: get(80, 105), channel: get(210, 280), kind: kind,
        detail: detail === '-' ? kind : detail, dir: v < 0 ? 'out' : 'in', amount: Math.abs(v), balance: num(bal) });
    });
    if (!rows.length) { st.opening = 0; st.empty = true; return st; }
    // เรียงเก่า → ใหม่ (ใบแจ้งเรียงใหม่สุดก่อน)
    rows.reverse();
    var f = rows[0];
    st.opening = KK.round2(f.balance + (f.dir === 'out' ? f.amount : -f.amount));
    st.rows = rows;
    st.from = rows[0].date; st.to = rows[rows.length - 1].date;
    return st;
  }
});
