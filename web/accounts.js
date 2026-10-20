/* ขุนคลัง — แก้ไข / เพิ่มบัญชีและบัตร จากในแอป */
var AccountEditor = {
  editingId: null,   // null = เพิ่มบัญชีใหม่
  bound: false,

  bind: function () {
    if (this.bound) return;
    this.bound = true;
    var self = this;
    $('accClose').addEventListener('click', function () { self.close(); });
    $('accSheet').addEventListener('click', function (e) { if (e.target === $('accSheet')) self.close(); });
    $('accForm').addEventListener('submit', function (e) { e.preventDefault(); self.save(); });
    $('aLast4').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
    $('aKind').innerHTML = Object.keys(KK.ACCOUNT_KINDS).map(function (k) {
      return '<option value="' + k + '">' + KK.ACCOUNT_KINDS[k] + '</option>';
    }).join('');
    $('aKind').addEventListener('change', function () { self.updateHints(); });
  },

  open: function (id) {
    if (!App.data) return;
    this.bind();
    var a = id ? (App.data.accounts || []).find(function (x) { return x.id === id; }) : null;
    this.editingId = a ? a.id : null;
    $('accTitle').textContent = a ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี / บัตร';
    $('aName').value = a ? a.name || '' : '';
    $('aLast4').value = a ? KK.last4(a) : '';
    $('aOpening').value = a && KK.num(a.opening_balance) !== 0 ? a.opening_balance : '';
    $('aIcon').value = a ? a.icon || '' : '';
    $('aHidden').checked = a ? !KK.isActive(a) : false;
    $('aHideWrap').hidden = !a;
    // บัญชีเดิม: แก้สกุลเงินได้เฉพาะตอนยังไม่มีรายการ (ประเภทแก้ไม่ได้)
    this.currencyEditable = !a || !this.hasTxs(a.id);
    $('aNewOnly').hidden = !!a && !this.currencyEditable;
    $('aKind').parentNode.hidden = !!a;
    $('aKind').value = a ? a.kind : 'bank';
    $('aCurrency').value = a ? a.currency || 'THB' : 'THB';
    $('aInfo').textContent = a
      ? 'ประเภท: ' + (KK.ACCOUNT_KINDS[a.kind] || a.kind) + ' · ' + (a.currency || 'THB') + ' · รหัส ' + a.id +
        (this.currencyEditable ? ' (ยังไม่มีรายการ — เปลี่ยนสกุลเงินได้)' : ' (มีรายการแล้ว — ประเภท/สกุลเงินแก้ไม่ได้)')
      : '';
    $('aError').hidden = true;
    $('aSubmit').disabled = false;
    this.updateHints();
    $('accSheet').hidden = false;
    setTimeout(function () { $('aName').focus(); }, 60);
  },

  updateHints: function () {
    var a = this.editingId ? App.acc(this.editingId) : null;
    var kind = a ? a.kind : $('aKind').value;
    $('aOpeningHint').textContent = KK.isLiability({ kind: kind })
      ? '— หนี้ใส่ติดลบ เช่น -4200 (ยอดค้างชำระก่อนรายการแรก)'
      : '— ยอดเงินก่อนรายการแรกที่บันทึก (เช่น ณ 31 ธ.ค. 2568)';
  },

  /** มีรายการในเดือนที่โหลดไว้ไหม (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำกับข้อมูลทั้งหมดอีกชั้น) */
  hasTxs: function (id) {
    return Object.keys(App.monthTxs).some(function (m) {
      return App.monthTxs[m].some(function (t) { return t.account_id === id || t.to_account_id === id; });
    }) || KK.num((App.data.balances || {})[id]) !== KK.num((App.acc(id) || {}).opening_balance);
  },

  close: function () { $('accSheet').hidden = true; },

  save: function () {
    var self = this;
    var name = $('aName').value.trim();
    var last4 = $('aLast4').value.replace(/\D/g, '');
    if (!name) return self.error('กรุณาใส่ชื่อบัญชี');
    if (last4 && last4.length !== 4) return self.error('เลขท้ายต้องมี 4 หลัก');
    var opening = String($('aOpening').value).trim();
    if (opening && !isFinite(parseFloat(opening.replace(/,/g, '')))) return self.error('ยอดยกมาไม่ถูกต้อง');

    var data = {
      name: name,
      number_hint: last4 ? "'" + last4 : '',  // ' = ให้ชีตเก็บเป็นข้อความ เลข 0 นำหน้าไม่หาย
      opening_balance: KK.round2(KK.num(opening)),
      icon: $('aIcon').value.trim()
    };
    var req;
    if (self.editingId) {
      data.id = self.editingId;
      data.active = !$('aHidden').checked;
      var cur = App.acc(self.editingId);
      if (self.currencyEditable && cur && $('aCurrency').value !== (cur.currency || 'THB')) data.currency = $('aCurrency').value;
      req = Api.call('updateAccounts', { updates: [data] });
    } else {
      data.kind = $('aKind').value;
      data.currency = $('aCurrency').value;
      if (!data.icon) data.icon = { bank: '🏦', ewallet: '👛', cash: '💵', credit: '💳', loan: '🏧' }[data.kind];
      req = Api.call('addAccount', { account: data });
    }
    $('aSubmit').disabled = true;
    req.then(function (res) {
      App.data.accounts = res.accounts;
      App.data.balances = res.balances;
      App.writeCache();
      App.renderAll();
      self.close();
      App.toast(self.editingId ? 'บันทึกบัญชีแล้ว' : 'เพิ่มบัญชีแล้ว');
    }).catch(function (e) {
      $('aSubmit').disabled = false;
      var msg = e.network ? 'เชื่อมต่อไม่ได้ — ลองใหม่เมื่อมีเน็ต' : e.message;
      if (/ไม่รู้จักคำสั่ง/.test(msg)) msg = 'Apps Script ยังเป็นรุ่นเก่า — วางโค้ดใหม่และ Deploy เวอร์ชันใหม่ก่อน';
      self.error(msg);
    });
  },

  error: function (msg) { $('aError').textContent = msg; $('aError').hidden = false; }
};
