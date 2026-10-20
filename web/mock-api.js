/*
 * ขุนคลัง — โหมดทดลอง: จำลอง API ของ Apps Script โดยเก็บข้อมูลในเบราว์เซอร์
 * ใช้ลองแอปก่อนเชื่อม Google Sheet จริง (ข้อมูลโหมดนี้ไม่ถูกส่งไปไหน)
 */
var MockApi = {
  KEY: 'kk_demo_db',

  load: function () {
    var db = null;
    try { db = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { db = null; }
    if (!db) { db = this.fresh(); this.store(db); }
    return db;
  },

  store: function (db) {
    try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  },

  reset: function () {
    try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ }
  },

  fresh: function () {
    var withDefaults = function (rows) {
      return rows.map(function (r, i) {
        return Object.assign({ sort: i + 1, active: true }, r);
      });
    };
    var accounts = withDefaults(KK_SEED.accounts).map(function (a) {
      return Object.assign({ opening_balance: 0 }, a);
    });
    // ตัวอย่างยอดเริ่มต้น + รายการ เพื่อให้เห็นภาพในโหมดทดลอง
    var opening = { KB1: 25000, KB2: 8000, BBL1: 12000, KTB: 15000, UOB: 5000, PAYONEER: 340, SKRILL: 85, CC_BBL: -4200 };
    accounts.forEach(function (a) { if (opening[a.id]) a.opening_balance = opening[a.id]; });

    var d = new Date();
    var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    var day = function (n) { return ym + '-' + String(Math.min(n, d.getDate())).padStart(2, '0'); };
    var t = function (date, type, amount, acc, cat, extra) {
      return Object.assign({
        id: 'demo-' + Math.random().toString(36).slice(2), date: date, type: type, amount: amount,
        account_id: acc, category_id: cat || '', to_account_id: '', to_amount: '', asset_id: '',
        note: '', slip_ref: '', created_at: date + 'T08:00:00Z', updated_at: '', deleted: false
      }, extra || {});
    };
    var txs = [
      t(day(1), 'income', 120.5, 'PAYONEER', 'INC_SHUTTERSTOCK'),
      t(day(2), 'income', 8000, 'KB1', 'INC_RENT', { asset_id: 'H_RENT' }),
      t(day(3), 'expense', 9500, 'KTB', 'EXP_HOME_LOAN', { asset_id: 'H_MAIN' }),
      t(day(3), 'expense', 7200, 'BBL1', 'EXP_HOME_LOAN', { asset_id: 'H_RENT' }),
      t(day(4), 'transfer', 100, 'PAYONEER', '', { to_account_id: 'KB2', to_amount: 3250 }),
      t(day(5), 'expense', 65, 'KB1', 'EXP_COFFEE'),
      t(day(5), 'expense', 300, 'KB1', 'EXP_GF'),
      t(day(6), 'expense', 1290, 'CC_BBL', 'EXP_SHOPEE'),
      t(day(7), 'transfer', 4200, 'BBL1', '', { to_account_id: 'CC_BBL' }),
      t(day(8), 'income', 2450, 'BBL1', 'INC_SEED')
    ];
    return {
      accounts: accounts,
      categories: withDefaults(KK_SEED.categories),
      assets: withDefaults(KK_SEED.assets),
      favorites: withDefaults(KK_SEED.favorites),
      rules: withDefaults(KK_SEED.rules),
      settings: Object.assign({}, KK_SEED.settings),
      txs: txs
    };
  },

  handle: function (action, p) {
    var db = this.load();
    if (!db.rules) db.rules = this.fresh().rules; // ข้อมูลทดลองจากรุ่นก่อน
    var month = function (m) {
      return KK.sortTxDesc(db.txs.filter(function (t) {
        return !KK.isDeleted(t) && (!m || t.date.indexOf(m) === 0);
      }));
    };
    var balances = function () { return KK.computeBalances(db.accounts, db.txs); };

    switch (action) {
      case 'ping': return { time: new Date().toISOString() };
      case 'bootstrap':
        return {
          accounts: db.accounts, categories: db.categories, assets: db.assets,
          favorites: db.favorites, rules: db.rules, settings: db.settings, balances: balances(), txs: month(p.month)
        };
      case 'listTx': return { txs: month(p.month) };
      case 'saveTx': {
        var accById = KK.byId(db.accounts);
        var err = KK.validateTx(p.tx, accById, KK.byId(db.categories));
        if (err) throw new Error(err);
        var tx = KK.normalizeTx(p.tx, accById);
        var now = new Date().toISOString();
        if (!tx.id) tx.id = 'demo-' + Math.random().toString(36).slice(2);
        var i = db.txs.findIndex(function (x) { return x.id === tx.id; });
        tx.created_at = i >= 0 ? db.txs[i].created_at : (tx.created_at || now);
        tx.updated_at = now;
        if (i >= 0) db.txs[i] = tx; else db.txs.push(tx);
        this.store(db);
        return { tx: tx, balances: balances() };
      }
      case 'deleteTx': {
        db.txs.forEach(function (x) { if (x.id === p.id) x.deleted = true; });
        this.store(db);
        return { id: p.id, balances: balances() };
      }
      case 'saveTxBatch': {
        var accs = KK.byId(db.accounts), cats = KK.byId(db.categories);
        var refs = {}, ids = {};
        db.txs.forEach(function (t) { ids[t.id] = true; if (t.import_ref && !KK.isDeleted(t)) refs[t.import_ref] = true; });
        var saved = 0, skipped = 0, errors = [], stamp = new Date().toISOString();
        (p.txs || []).forEach(function (input, idx) {
          if ((input.import_ref && refs[input.import_ref]) || (input.id && ids[input.id])) { skipped++; return; }
          var e = KK.validateTx(input, accs, cats);
          if (e) { errors.push({ index: idx, error: e }); return; }
          var t = KK.normalizeTx(input, accs);
          if (!t.id) t.id = 'demo-' + Math.random().toString(36).slice(2);
          t.created_at = t.updated_at = stamp;
          ids[t.id] = true; if (t.import_ref) refs[t.import_ref] = true;
          db.txs.push(t); saved++;
        });
        this.store(db);
        return { saved: saved, skipped: skipped, errors: errors, balances: balances() };
      }
      case 'saveRules':
        (p.rules || []).forEach(function (r) {
          var i = db.rules.findIndex(function (x) { return x.id === r.id; });
          if (i >= 0) db.rules[i] = Object.assign({}, db.rules[i], r); else db.rules.push(Object.assign({ active: true }, r));
        });
        db.rules.sort(function (a, b) { return KK.num(a.sort) - KK.num(b.sort); });
        this.store(db);
        return { rules: db.rules };
      case 'updateAccounts':
        (p.updates || []).forEach(function (u) {
          var a = db.accounts.find(function (x) { return x.id === u.id; });
          if (!a) return;
          if (u.currency !== undefined) {
            if (!KK.canChangeCurrency(u.id, db.txs)) throw new Error('เปลี่ยนสกุลเงินไม่ได้ เพราะบัญชีนี้มีรายการแล้ว');
            a.currency = u.currency;
          }
          KK.ACCOUNT_EDITABLE.forEach(function (k) {
            if (u[k] !== undefined) a[k] = typeof u[k] === 'string' ? u[k].replace(/^'/, '') : u[k]; // ' = บังคับเป็นข้อความในชีต
          });
        });
        this.store(db);
        return { accounts: db.accounts, balances: balances() };
      case 'saveCategories':
        (p.categories || []).forEach(function (c) {
          var bad = KK.validateCategory(c);
          if (bad) throw new Error(bad);
          var i = db.categories.findIndex(function (x) { return x.id === c.id; });
          if (i >= 0) db.categories[i] = Object.assign({}, db.categories[i], c);
          else db.categories.push(Object.assign({ active: true, sort: db.categories.length + 1 }, c));
        });
        this.store(db);
        return { categories: db.categories };
      case 'addAccount': {
        var a = p.account || {};
        var bad = KK.validateAccount(a);
        if (bad) throw new Error(bad);
        var row = { id: 'ACC_' + Date.now().toString(36).toUpperCase(), kind: a.kind, currency: a.currency || 'THB',
          sort: db.accounts.length + 1, opening_balance: 0 };
        KK.ACCOUNT_EDITABLE.forEach(function (k) {
          if (a[k] !== undefined) row[k] = typeof a[k] === 'string' ? a[k].replace(/^'/, '') : a[k];
        });
        row.active = true;
        db.accounts.push(row);
        this.store(db);
        return { accounts: db.accounts, balances: balances() };
      }
      case 'saveSettings':
        Object.assign(db.settings, p.settings || {});
        this.store(db);
        return { settings: db.settings };
      default: throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    }
  }
};
