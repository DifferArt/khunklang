/*
 * ขุนคลัง — 📤 ส่งบัญชี: ตรวจความครบของเอกสารประจำเดือน แล้วสั่งสร้างชุดเอกสารใน Google Drive
 * (รายงาน Google Sheet + Excel + PDF, PDF รวมสลิป 4/6 ใบต่อหน้า, สำเนา Statement)
 */
var Exporter = {
  month: '',
  scope: 'all',     // all | course
  perPage: 4,
  txs: null,
  files: null,
  error: '',
  result: null,
  busy: false,
  showMissing: false,
  stAccount: '',

  bind: function () {
    var self = this;
    $('expPrev').addEventListener('click', function () { self.setMonth(App.shiftMonth(self.month, -1)); });
    $('expNext').addEventListener('click', function () { self.setMonth(App.shiftMonth(self.month, 1)); });
    $('expStFile').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (f) self.attachStatement(f, self.stAccount);
    });
  },

  open: function () {
    // ปกติส่งเอกสารของเดือนที่เพิ่งจบ
    if (!this.month) this.month = App.shiftMonth(App.monthOf(App.today()), -1);
    App.go('export');
    this.load();
  },

  setMonth: function (m) {
    if (this.busy) return;
    this.month = m;
    this.load();
  },

  load: function () {
    var self = this, m = self.month;
    self.txs = self.files = null;
    self.error = '';
    self.result = null;
    self.render();
    Promise.all([Api.call('listTx', { month: m }), Api.call('listFiles', { month: m })]).then(function (r) {
      if (m !== self.month) return;
      self.txs = r[0].txs;
      self.files = r[1].files;
      self.render();
    }).catch(function (err) {
      if (m !== self.month) return;
      self.error = err.message;
      self.render();
    });
  },

  isCourse: function (t) {
    var c = App.cat(t.category_id);
    return t.type === 'income' && !!c && /คอร์ส/.test(c.group);
  },

  scoped: function () {
    var self = this;
    return (self.txs || []).filter(function (t) { return self.scope !== 'course' || self.isCourse(t); });
  },

  /** บัญชีธนาคาร/e-Wallet ที่มีรายการเดือนนี้ (ควรมี Statement) */
  statementAccounts: function () {
    var used = {};
    (this.txs || []).forEach(function (t) { used[t.account_id] = true; if (t.to_account_id) used[t.to_account_id] = true; });
    return (App.data.accounts || []).filter(function (a) {
      return (a.kind === 'bank' || a.kind === 'ewallet') && used[a.id];
    });
  },

  render: function () {
    var self = this;
    $('expMonth').textContent = App.monthLabel(self.month);
    var el = $('expBody');
    if (!App.data) { el.innerHTML = '<div class="empty">กำลังโหลด…</div>'; return; }
    var cfg = Config.get();
    var demo = cfg.demo || !cfg.url;

    var chips = function (name, opts, cur) {
      return '<div class="chips">' + opts.map(function (o) {
        return '<button type="button" class="chip' + (String(o[0]) === String(cur) ? ' on' : '') + '" data-' + name + '="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    };
    var html = '<div class="card form-card">' +
      '<span class="lbl">ส่งอะไร</span>' + chips('scope', [['all', 'ทั้งหมด'], ['course', 'เฉพาะรายได้คอร์ส']], self.scope) +
      '<span class="lbl" style="margin-top:10px">สลิปต่อหน้า A4</span>' + chips('per', [[4, '4 ใบ (ใหญ่)'], [6, '6 ใบ']], self.perPage) +
      '</div>';

    if (self.error) {
      html += '<div class="card"><p class="form-error">โหลดข้อมูลไม่ได้: ' + App.esc(self.error) + '</p>' +
        '<button type="button" class="btn" id="expRetry">ลองใหม่</button></div>';
    } else if (!self.txs) {
      html += '<div class="empty">กำลังตรวจเอกสาร…</div>';
    } else {
      html += self.renderChecklist();
    }

    if (demo) {
      html += '<p class="hint">🧪 โหมดทดลองสร้างไฟล์ใน Google Drive ไม่ได้ — เชื่อม Google Sheet ในหน้าตั้งค่าก่อน</p>';
    }
    var count = self.scoped().length;
    html += '<button type="button" class="btn primary import-btn" id="expRun"' + (self.busy || !self.txs || !count || demo ? ' disabled' : '') + '>' +
      (self.busy ? '⏳ กำลังสร้าง… (อาจใช้ 1–3 นาที อย่าปิดหน้านี้)' : '📤 สร้างชุดเอกสาร ' + App.monthLabel(self.month)) + '</button>';
    if (self.result) html += self.renderResult();
    el.innerHTML = html;

    el.querySelectorAll('[data-scope]').forEach(function (b) {
      b.addEventListener('click', function () { self.scope = b.dataset.scope; self.result = null; self.render(); });
    });
    el.querySelectorAll('[data-per]').forEach(function (b) {
      b.addEventListener('click', function () { self.perPage = +b.dataset.per; self.render(); });
    });
    el.querySelectorAll('[data-st]').forEach(function (b) {
      b.addEventListener('click', function () { self.stAccount = b.dataset.st; $('expStFile').click(); });
    });
    el.querySelectorAll('[data-strm]').forEach(function (b) {
      b.addEventListener('click', function () { self.removeStatement(b.dataset.strm); });
    });
    el.querySelectorAll('[data-tx]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tx = (self.txs || []).find(function (x) { return x.id === b.dataset.tx; });
        if (tx) App.openForm(tx);
      });
    });
    var toggle = $('expMissing');
    if (toggle) toggle.addEventListener('click', function () { self.showMissing = !self.showMissing; self.render(); });
    var retry = $('expRetry');
    if (retry) retry.addEventListener('click', function () { self.load(); });
    $('expRun').addEventListener('click', function () { self.run(); });
  },

  renderChecklist: function () {
    var self = this;
    var txs = self.scoped();
    if (!txs.length) {
      return '<div class="card"><div class="empty">ไม่มีรายการ' + (self.scope === 'course' ? 'หมวดคอร์ส' : '') + 'ในเดือนนี้</div></div>';
    }
    var html = '';
    if (self.scope === 'all') {
      var stFiles = self.files.filter(function (f) { return f.kind === 'statement'; });
      var rows = self.statementAccounts().map(function (a) {
        var mine = stFiles.filter(function (f) { return f.account_id === a.id; });
        var right = mine.length
          ? mine.map(function (f) {
            return '<span class="exp-ok">✅ ' + App.esc(f.date_from.slice(8) + '/' + f.date_from.slice(5, 7) + '–' + f.date_to.slice(8) + '/' + f.date_to.slice(5, 7)) +
              ' <button type="button" class="link" data-strm="' + App.esc(f.id) + '" aria-label="ลบ Statement">✕</button></span>';
          }).join(' ')
          : '<button type="button" class="chip warn" data-st="' + App.esc(a.id) + '">⬆️ แนบ PDF</button>';
        return '<div class="exp-row"><span>' + App.esc((a.icon || '') + ' ' + KK.accountName(a)) + '</span><span>' + right + '</span></div>';
      });
      html += '<div class="card"><h2 class="sec" style="margin-top:0">Statement ธนาคาร</h2>' +
        (rows.length ? rows.join('') : '<div class="hint">ไม่มีบัญชีธนาคารที่มีรายการเดือนนี้</div>') +
        '<p class="hint">นำเข้า Statement ครั้งต่อไป ระบบจะเก็บ PDF ให้เอง · เดือนที่นำเข้าไปแล้ว กด "แนบ PDF" ได้เลย</p></div>';
    }

    var withDoc = txs.filter(function (t) { return t.slip_ref; });
    var missing = txs.filter(function (t) { return !t.slip_ref && t.type !== 'transfer'; });
    var s = App.summary(txs);
    html += '<div class="card"><h2 class="sec" style="margin-top:0">สรุปที่จะส่ง</h2>' +
      '<div class="exp-row"><span>รายรับ</span><b class="pos">' + App.money(s.income) + '</b></div>' +
      (self.scope === 'all' ? '<div class="exp-row"><span>รายจ่าย</span><b class="neg">' + App.money(s.expense) + '</b></div>' : '') +
      '<div class="exp-row"><span>รายการทั้งหมด</span><b>' + txs.length + '</b></div>' +
      '<div class="exp-row"><span>มีสลิป/ใบเสร็จแนบ</span><b>' + withDoc.length + '</b></div>' +
      (missing.length
        ? '<div class="exp-row"><span>รายรับ-จ่ายที่ยังไม่มีเอกสาร</span><button type="button" class="link" id="expMissing">' + missing.length +
          ' รายการ ' + (self.showMissing ? '▲' : '▼') + '</button></div>'
        : '') +
      (self.showMissing && missing.length
        ? '<div class="tx-list">' + missing.map(function (t) { return App.txRow(t, false); }).join('') +
          '</div><p class="hint">แตะรายการเพื่อเปิดแล้วกด 📎 แนบสลิป</p>'
        : '') +
      '</div>';
    return html;
  },

  renderResult: function () {
    var r = this.result;
    var link = function (label, url) {
      return '<a class="exp-link" href="' + App.esc(url) + '" target="_blank" rel="noopener">' + App.esc(label) + ' ↗</a>';
    };
    return '<div class="card"><h2 class="sec" style="margin-top:0">✅ สร้างเสร็จแล้ว</h2>' +
      link('📁 เปิดโฟลเดอร์ (แชร์โฟลเดอร์นี้ให้นักบัญชี)', r.folderUrl) +
      r.files.map(function (f) {
        var ico = { sheet: '📊', xlsx: '📗', pdf: '📄', folder: '📂' }[f.kind] || '📄';
        return link(ico + ' ' + f.label, f.url);
      }).join('') +
      (r.missing && r.missing.length ? '<p class="form-error">ยังไม่มี Statement: ' + App.esc(r.missing.join(', ')) + '</p>' : '') +
      '<p class="hint">วิธีส่ง: เปิดโฟลเดอร์ → แชร์ → ใส่อีเมลนักบัญชี (สิทธิ์ผู้มีสิทธิ์อ่าน) · สร้างใหม่ได้ทุกเมื่อ ไฟล์ชุดเก่าจะย้ายไปถังขยะ</p></div>';
  },

  run: function () {
    var self = this;
    if (self.busy) return;
    self.busy = true;
    self.result = null;
    self.render();
    Api.call('exportMonth', { month: self.month, scope: self.scope, perPage: self.perPage }).then(function (res) {
      self.result = res;
      App.toast('สร้างชุดเอกสารแล้ว');
    }).catch(function (err) {
      App.toast('สร้างไม่สำเร็จ: ' + err.message, true);
    }).then(function () {
      self.busy = false;
      self.render();
    });
  },

  /** แนบ Statement ย้อนหลัง: อ่านรอบวันที่จากไฟล์ (ถ้าอ่านได้) ไม่งั้นใช้ทั้งเดือน */
  attachStatement: function (file, accountId) {
    var self = this;
    var acc = App.acc(accountId);
    var m = self.month;
    var last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
    var period = { from: m + '-01', to: m + '-' + String(last).padStart(2, '0') };
    App.toast('กำลังอ่านไฟล์…');
    Importer.readPdf(file).then(function (pages) {
      var st = Importer.parse(pages);
      if (acc && KK.last4(acc) && st.last4 && st.last4 !== KK.last4(acc) &&
        !confirm('ไฟล์นี้เป็นบัญชี ···' + st.last4 + ' ไม่ใช่ ' + KK.accountName(acc) + ' — แนบต่อไหม?')) return null;
      if (st.from && st.to) {
        if ((st.from.slice(0, 7) > m || st.to.slice(0, 7) < m) &&
          !confirm('ไฟล์นี้เป็นรอบ ' + st.from + ' ถึง ' + st.to + ' ไม่ใช่' + App.monthLabel(m) + ' — แนบต่อไหม?')) return null;
        period = { from: st.from, to: st.to };
      }
      return period;
    }, function () { return period; }).then(function (p) {
      if (!p) return;
      App.toast('กำลังส่งไฟล์…');
      return Attach.uploadStatement(file, accountId, p.from, p.to).then(function () {
        App.toast('แนบ Statement แล้ว');
        self.load();
      });
    }).catch(function (err) { App.toast('แนบไม่สำเร็จ: ' + err.message, true); });
  },

  removeStatement: function (id) {
    var self = this;
    if (!confirm('เอา Statement นี้ออก? (ไฟล์ใน Drive จะย้ายไปถังขยะ)')) return;
    Api.call('deleteFile', { id: id }).then(function () { self.load(); })
      .catch(function (err) { App.toast(err.message, true); });
  }
};
