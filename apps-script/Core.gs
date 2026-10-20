/*
 * ขุนคลัง — ตรรกะกลาง ใช้ร่วมกันทั้งเว็บแอปและ Apps Script
 * (ห้ามใช้ API เฉพาะเบราว์เซอร์หรือเฉพาะ Apps Script ในไฟล์นี้)
 */
var KK = {
  TX_TYPES: ['income', 'expense', 'transfer'],

  // คอลัมน์รุ่นแรก (ลำดับในชีตห้ามเปลี่ยน) + คอลัมน์ที่เพิ่มทีหลัง (ต่อท้ายชีตเสมอ)
  TX_FIELDS_V1: ['id', 'date', 'type', 'amount', 'account_id', 'to_account_id', 'to_amount',
    'category_id', 'asset_id', 'note', 'slip_ref', 'created_at', 'updated_at', 'deleted'],
  TX_FIELDS_V2: ['counterparty', 'import_ref'],
  TX_FIELDS: null, // = V1 + V2 (ตั้งค่าด้านล่าง)

  // รหัสธนาคารที่ใช้ใน Statement → เดาจาก id บัญชีถ้าในชีตไม่ได้ใส่คอลัมน์ bank
  BANK_BY_PREFIX: { KB: 'KBANK', BBL: 'BBL', KTB: 'KTB', UOB: 'UOBT', GSB: 'GSB', TTB: 'TTB', SCB: 'SCB', BAY: 'BAY' },

  bankOf: function (account) {
    if (!account) return '';
    if (account.bank) return String(account.bank).toUpperCase();
    if (account.kind !== 'bank') return '';
    var m = /^[A-Z]+/.exec(String(account.id));
    return m && KK.BANK_BY_PREFIX[m[0]] || '';
  },

  /** ช่องของบัญชีที่แก้จากแอปได้ (id/kind/currency แก้ไม่ได้ เพราะรายการเดิมผูกอยู่) */
  ACCOUNT_EDITABLE: ['name', 'opening_balance', 'bank', 'number_hint', 'active', 'icon', 'note'],

  /** เปลี่ยนสกุลเงินได้เฉพาะบัญชีที่ยังไม่มีรายการ (ยอดเดิมจะได้ไม่ผิดความหมาย) */
  canChangeCurrency: function (accountId, txs) {
    return !txs.some(function (t) {
      return !KK.isDeleted(t) && (t.account_id === accountId || t.to_account_id === accountId);
    });
  },

  validateAccount: function (a) {
    if (!String(a.name || '').trim()) return 'กรุณาใส่ชื่อบัญชี';
    if (!KK.ACCOUNT_KINDS[a.kind]) return 'ประเภทบัญชีไม่ถูกต้อง';
    if (a.currency && ['THB', 'USD'].indexOf(a.currency) < 0) return 'สกุลเงินไม่ถูกต้อง';
    return null;
  },

  validateCategory: function (c) {
    if (!c || !/^[A-Z][A-Z0-9_]*$/.test(String(c.id || ''))) return 'รหัสหมวดต้องเป็นภาษาอังกฤษตัวใหญ่/ตัวเลข/_';
    if (c.type !== 'income' && c.type !== 'expense') return 'ประเภทหมวดไม่ถูกต้อง';
    if (!String(c.group || '').trim() || !String(c.name || '').trim()) return 'กรุณาใส่กลุ่มและชื่อหมวด';
    return null;
  },

  /** เลขท้าย 4 หลักจากคอลัมน์ number_hint (ชีตอาจเก็บเป็นตัวเลข เลข 0 นำหน้าหาย) */
  last4: function (account) {
    var s = String(account && account.number_hint !== undefined && account.number_hint !== null ? account.number_hint : '').replace(/\D/g, '');
    return s ? ('0000' + s).slice(-4) : '';
  },

  /** ชื่อที่แสดง: ชื่อบัญชี + ·เลขท้าย 4 หลัก (ถ้ามี และชื่อยังไม่มีเลขนั้น) */
  accountName: function (account) {
    if (!account) return '';
    var name = String(account.name || account.id);
    var l4 = KK.last4(account);
    return l4 && name.indexOf(l4) < 0 ? name + ' ·' + l4 : name;
  },

  /**
   * หากฎข้อแรกที่ตรง: pattern = คำในรายละเอียด (คั่นด้วย |), amount = ยอดเงิน (คั่นด้วย |)
   * กฎต้องมีอย่างน้อยหนึ่งอย่าง ถ้ามีทั้งคู่ต้องตรงทั้งคู่
   */
  matchRule: function (text, rules, amount) {
    var hay = String(text || '').toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!KK.isActive(r)) continue;
      var hasPattern = !!String(r.pattern || '').trim();
      var hasAmount = r.amount !== undefined && r.amount !== null && String(r.amount).trim() !== '';
      if (!hasPattern && !hasAmount) continue;
      if (hasAmount) {
        var amts = String(r.amount).split('|').map(KK.num);
        if (amount === undefined || amts.indexOf(KK.round2(KK.num(amount))) < 0) continue;
      }
      if (hasPattern) {
        var parts = String(r.pattern).toLowerCase().split('|');
        var hit = false;
        for (var j = 0; j < parts.length && !hit; j++) hit = !!parts[j] && hay.indexOf(parts[j]) >= 0;
        if (!hit) continue;
      }
      return r;
    }
    return null;
  },

  /** ตัดคำนำหน้าชื่อ/ช่องว่าง/เครื่องหมาย เพื่อเทียบชื่อคนแบบหลวม ๆ */
  normName: function (s) {
    return String(s || '').toLowerCase()
      .replace(/\+\+$/, '')
      .replace(/^(นางสาว|น\.ส\.|นาย|นาง|ว่าที่\s*ร\.ต\.(หญิง)?|mr\.?|mrs\.?|miss|ms\.?)\s*/i, '')
      .replace(/[\s.]/g, '');
  },

  /** ชื่อในรายการ (ที่อาจถูกตัดท้าย) ตรงกับชื่อเจ้าของบัญชีไหม */
  isOwnerName: function (name, ownerNames) {
    var n = KK.normName(name);
    if (n.length < 4) return false;
    return String(ownerNames || '').split(',').some(function (o) {
      var on = KK.normName(o);
      return on.length >= 4 && (on.indexOf(n) === 0 || n.indexOf(on) === 0);
    });
  },

  ACCOUNT_KINDS: {
    bank: 'ธนาคาร', ewallet: 'e-Wallet', cash: 'เงินสด',
    credit: 'บัตรเครดิต / PayLater', loan: 'เงินกู้ / บัตรกดเงินสด'
  },

  isLiability: function (account) {
    return account.kind === 'credit' || account.kind === 'loan';
  },

  byId: function (rows) {
    var map = {};
    rows.forEach(function (r) { map[r.id] = r; });
    return map;
  },

  num: function (v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  },

  round2: function (n) { return Math.round(n * 100) / 100; },

  isActive: function (row) {
    return row.active !== false && row.active !== 'FALSE' && row.active !== 0;
  },

  isDeleted: function (tx) {
    return tx.deleted === true || tx.deleted === 'TRUE';
  },

  /** ตรวจรายการก่อนบันทึก คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
  validateTx: function (tx, accounts, categories) {
    if (KK.TX_TYPES.indexOf(tx.type) < 0) return 'ประเภทรายการไม่ถูกต้อง';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date || ''))) return 'วันที่ไม่ถูกต้อง';
    if (!(KK.num(tx.amount) > 0)) return 'กรุณาใส่จำนวนเงินมากกว่า 0';
    if (!accounts[tx.account_id]) return 'กรุณาเลือกบัญชี';
    if (tx.type === 'transfer') {
      if (!accounts[tx.to_account_id]) return 'กรุณาเลือกบัญชีปลายทาง';
      if (tx.to_account_id === tx.account_id) return 'บัญชีต้นทางและปลายทางต้องไม่ซ้ำกัน';
    } else {
      var cat = categories[tx.category_id];
      if (!cat) return 'กรุณาเลือกหมวด';
      if (cat.type !== tx.type) return 'หมวดไม่ตรงกับประเภทรายการ';
    }
    return null;
  },

  /** จัดรูปรายการให้สะอาดก่อนบันทึก */
  normalizeTx: function (tx, accounts) {
    var out = {};
    KK.TX_FIELDS.forEach(function (f) { out[f] = tx[f] === undefined || tx[f] === null ? '' : tx[f]; });
    out.amount = KK.round2(KK.num(out.amount));
    if (out.type === 'transfer') {
      out.category_id = '';
      var from = accounts[out.account_id], to = accounts[out.to_account_id];
      // โอนข้ามสกุลเงิน (เช่น Payoneer USD → กสิกร THB) ต้องมียอดปลายทาง
      if (from && to && from.currency !== to.currency) {
        out.to_amount = KK.round2(KK.num(out.to_amount));
      } else {
        out.to_amount = '';
      }
    } else {
      out.to_account_id = '';
      out.to_amount = '';
    }
    out.note = String(out.note).trim();
    out.counterparty = String(out.counterparty).trim();
    out.deleted = KK.isDeleted(tx);
    return out;
  },

  /** ยอดคงเหลือทุกบัญชี (สกุลเงินของบัญชีนั้น) — หนี้จะติดลบ */
  computeBalances: function (accounts, txs) {
    var bal = {};
    accounts.forEach(function (a) { bal[a.id] = KK.num(a.opening_balance); });
    txs.forEach(function (t) {
      if (KK.isDeleted(t)) return;
      var amt = KK.num(t.amount);
      if (t.type === 'income') {
        if (t.account_id in bal) bal[t.account_id] += amt;
      } else if (t.type === 'expense') {
        if (t.account_id in bal) bal[t.account_id] -= amt;
      } else if (t.type === 'transfer') {
        if (t.account_id in bal) bal[t.account_id] -= amt;
        var inAmt = t.to_amount !== '' && t.to_amount !== undefined && KK.num(t.to_amount) > 0
          ? KK.num(t.to_amount) : amt;
        if (t.to_account_id in bal) bal[t.to_account_id] += inAmt;
      }
    });
    Object.keys(bal).forEach(function (k) { bal[k] = KK.round2(bal[k]); });
    return bal;
  },

  /** แปลงเป็นบาท ตามสกุลเงินของบัญชี */
  toTHB: function (amount, account, settings) {
    if (!account || account.currency === 'THB' || !account.currency) return amount;
    if (account.currency === 'USD') return amount * KK.num(settings.usd_thb || 0);
    return amount;
  },

  /**
   * สรุปรายรับ-รายจ่าย "จริง" (ไม่นับเงินโอนระหว่างบัญชี) เป็นบาท
   * คืน { income, expense, net, transfers, byCategory: {catId: thb}, byGroup: {group: thb} }
   */
  summarize: function (txs, accounts, categories, settings) {
    var s = { income: 0, expense: 0, net: 0, transfers: 0, byCategory: {}, byGroup: {} };
    txs.forEach(function (t) {
      if (KK.isDeleted(t)) return;
      var thb = KK.toTHB(KK.num(t.amount), accounts[t.account_id], settings);
      if (t.type === 'transfer') { s.transfers += thb; return; }
      if (t.type === 'income') s.income += thb; else s.expense += thb;
      s.byCategory[t.category_id] = (s.byCategory[t.category_id] || 0) + thb;
      var cat = categories[t.category_id];
      var g = (cat ? cat.group : '?') + '|' + t.type;
      s.byGroup[g] = (s.byGroup[g] || 0) + thb;
    });
    s.income = KK.round2(s.income);
    s.expense = KK.round2(s.expense);
    s.net = KK.round2(s.income - s.expense);
    s.transfers = KK.round2(s.transfers);
    return s;
  },

  /** เรียงใหม่สุดก่อน */
  sortTxDesc: function (txs) {
    return txs.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(a.created_at) < String(b.created_at) ? 1 : -1;
    });
  },

  /** สร้างข้อความอ่านง่ายสำหรับคอลัมน์ในชีต */
  labels: function (tx, accounts, categories, assets) {
    var a = accounts[tx.account_id], to = accounts[tx.to_account_id];
    var c = categories[tx.category_id], s = assets[tx.asset_id];
    return {
      account_label: a ? KK.accountName(a) : '',
      to_account_label: to ? KK.accountName(to) : '',
      category_label: tx.type === 'transfer' ? 'โอนย้าย' : (c ? c.group + ' > ' + c.name : ''),
      asset_label: s ? s.name : ''
    };
  }
};
KK.TX_FIELDS = KK.TX_FIELDS_V1.concat(KK.TX_FIELDS_V2);
