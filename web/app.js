/* ขุนคลัง — หน้าแอป */
var $ = function (id) { return document.getElementById(id); };

var App = {
  data: null,            // ผลจาก bootstrap: accounts, categories, assets, favorites, settings, balances
  monthTxs: {},          // 'YYYY-MM' -> [tx]
  homeMonth: '',
  listMonth: '',
  listType: '',
  listAccount: '',
  editing: null,         // รายการที่กำลังแก้ (null = รายการใหม่)
  formType: 'expense',
  view: 'home',
  CACHE_KEY: 'kk_cache',

  // ------------------------------------------------------------ เริ่มต้น
  init: function () {
    App.homeMonth = App.listMonth = App.monthOf(App.today());
    App.bindUi();
    var cached = App.readCache();
    if (cached) { App.data = cached.data; App.monthTxs = cached.monthTxs || {}; App.renderAll(); }
    App.refresh();
    window.addEventListener('online', function () { App.sync(); });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    }
  },

  refresh: function () {
    App.renderSyncPill('กำลังโหลด…');
    return Outbox.flush().then(function () {
      return Api.call('bootstrap', { month: App.homeMonth });
    }).then(function (res) {
      App.data = res;
      App.monthTxs = {};
      App.monthTxs[App.homeMonth] = res.txs;
      delete App.data.txs;
      App.writeCache();
      App.renderAll();
      if (App.listMonth !== App.homeMonth) App.loadMonth(App.listMonth);
    }).catch(function (err) {
      App.renderSyncPill();
      if (!App.data) App.toast(err.message + ' — ตรวจการตั้งค่า', true);
      else if (!err.network) App.toast(err.message, true);
    });
  },

  sync: function () {
    return Outbox.flush().then(function (n) {
      if (n > 0) { App.toast('ส่งรายการค้าง ' + n + ' รายการแล้ว'); return App.refresh(); }
      App.renderSyncPill();
    });
  },

  loadMonth: function (month) {
    return Api.call('listTx', { month: month }).then(function (res) {
      App.monthTxs[month] = res.txs;
      App.writeCache();
      App.renderList();
    }).catch(function (err) {
      if (!err.network) App.toast(err.message, true);
      App.renderList();
    });
  },

  readCache: function () {
    try { return JSON.parse(localStorage.getItem(App.CACHE_KEY + (Config.get().demo ? '_demo' : ''))); }
    catch (e) { return null; }
  },
  writeCache: function () {
    try {
      localStorage.setItem(App.CACHE_KEY + (Config.get().demo ? '_demo' : ''),
        JSON.stringify({ data: App.data, monthTxs: App.monthTxs }));
    } catch (e) { /* ignore */ }
  },

  // ------------------------------------------------------------ ตัวช่วย
  today: function (offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  monthOf: function (date) { return String(date).slice(0, 7); },
  shiftMonth: function (month, n) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
    var d = new Date(y, m, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  },
  monthLabel: function (month) {
    return new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1)
      .toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  },
  dayLabel: function (date) {
    if (date === App.today()) return 'วันนี้';
    if (date === App.today(-1)) return 'เมื่อวาน';
    var p = date.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
  },
  esc: function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },
  curSym: function (cur) { return cur === 'USD' ? '$' : '฿'; },
  money: function (n, cur, signed) {
    var v = KK.num(n);
    var s = Math.abs(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var sign = v < 0 ? '-' : (signed && v > 0 ? '+' : '');
    return sign + App.curSym(cur || 'THB') + s;
  },
  acc: function (id) { return App.data && KK.byId(App.data.accounts)[id]; },
  cat: function (id) { return App.data && KK.byId(App.data.categories)[id]; },
  asset: function (id) { return App.data && KK.byId(App.data.assets)[id]; },
  active: function (rows) { return (rows || []).filter(KK.isActive); },
  newId: function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  },

  toast: function (msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 4500 : 2200);
  },

  /** ผลของรายการต่อยอดบัญชี (ใช้ปรับยอดทันทีโดยไม่ต้องรอเซิร์ฟเวอร์) */
  applyEffect: function (bal, tx, sign) {
    if (!tx || KK.isDeleted(tx)) return;
    var amt = KK.num(tx.amount) * sign;
    var add = function (id, v) { if (id in bal) bal[id] = KK.round2(bal[id] + v); };
    if (tx.type === 'income') add(tx.account_id, amt);
    else if (tx.type === 'expense') add(tx.account_id, -amt);
    else if (tx.type === 'transfer') {
      add(tx.account_id, -amt);
      add(tx.to_account_id, KK.num(tx.to_amount) > 0 ? KK.num(tx.to_amount) * sign : amt);
    }
  },

  // ------------------------------------------------------------ การเชื่อม UI
  bindUi: function () {
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.dataset.goto); });
    });
    $('addBtn').addEventListener('click', function () { App.openForm(); });
    document.querySelectorAll('[data-import]').forEach(function (b) {
      b.addEventListener('click', function () { Importer.open(); });
    });
    $('syncPill').addEventListener('click', function () { App.refresh(); });

    $('prevMonth').addEventListener('click', function () { App.changeListMonth(-1); });
    $('nextMonth').addEventListener('click', function () { App.changeListMonth(1); });
    $('typeChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      App.listType = b.dataset.type;
      $('typeChips').querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      App.renderList();
    });
    $('accFilter').addEventListener('change', function () { App.listAccount = this.value; App.renderList(); });

    // ฟอร์ม
    $('sheetClose').addEventListener('click', App.closeForm);
    $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) App.closeForm(); });
    $('typeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      App.setFormType(b.dataset.type);
    });
    $('fCategory').addEventListener('change', function () {
      var c = App.cat(this.value);
      if (!c) return;
      if (c.default_account_id && App.acc(c.default_account_id)) $('fAccount').value = c.default_account_id;
      if (c.default_asset_id) $('fAsset').value = c.default_asset_id;
      App.updateCurrency();
      App.updateCpLabel();
    });
    $('fAccount').addEventListener('change', App.updateCurrency);
    $('fToAccount').addEventListener('change', App.updateCurrency);
    document.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () { $('fDate').value = App.today(+b.dataset.day); });
    });
    $('txForm').addEventListener('submit', function (e) { e.preventDefault(); App.submitForm(); });
    $('fDelete').addEventListener('click', App.deleteEditing);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('sheet').hidden) App.closeForm(); });

    // ตั้งค่า
    $('cfgSave').addEventListener('click', App.saveConfig);
    $('cfgDemo').addEventListener('change', function () {
      $('cfgUrl').disabled = $('cfgKey').disabled = this.checked;
    });
    $('rateSave').addEventListener('click', App.saveRate);
    $('demoReset').addEventListener('click', function () {
      if (!confirm('ล้างข้อมูลโหมดทดลองทั้งหมด?')) return;
      MockApi.reset();
      App.refresh().then(function () { App.toast('เริ่มข้อมูลทดลองใหม่แล้ว'); });
    });
  },

  go: function (view) {
    App.view = view;
    ['home', 'list', 'accounts', 'settings', 'import'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tabbar [data-goto]').forEach(function (b) { b.classList.toggle('on', b.dataset.goto === view); });
    if (view === 'settings') App.renderSettings();
    if (view === 'list' && !App.monthTxs[App.listMonth]) App.loadMonth(App.listMonth);
    window.scrollTo(0, 0);
  },

  changeListMonth: function (n) {
    App.listMonth = App.shiftMonth(App.listMonth, n);
    App.renderList();
    App.loadMonth(App.listMonth);
  },

  // ------------------------------------------------------------ แสดงผล
  renderAll: function () {
    if (!App.data) return;
    App.renderSyncPill();
    App.renderHome();
    App.renderList();
    App.renderAccounts();
  },

  renderSyncPill: function (text) {
    var pill = $('syncPill');
    var pending = Outbox.list().length;
    var cfg = Config.get();
    pill.className = 'pill';
    if (text) pill.textContent = text;
    else if (pending) { pill.textContent = '⏳ ค้างส่ง ' + pending; pill.classList.add('warn'); }
    else if (cfg.demo || !cfg.url) { pill.textContent = '🧪 โหมดทดลอง'; }
    else if (!navigator.onLine) { pill.textContent = '📴 ออฟไลน์'; pill.classList.add('warn'); }
    else { pill.textContent = '✅ Google Sheet'; pill.classList.add('ok'); }
  },

  txsOf: function (month) {
    var txs = (App.monthTxs[month] || []).slice();
    // รวมรายการที่ยังค้างส่ง ให้เห็นทันที
    Outbox.list().forEach(function (op) {
      if (op.kind === 'delete') { txs = txs.filter(function (t) { return t.id !== op.id; }); return; }
      if (App.monthOf(op.tx.date) !== month) { txs = txs.filter(function (t) { return t.id !== op.id; }); return; }
      var copy = Object.assign({ _pending: true }, op.tx);
      var i = txs.findIndex(function (t) { return t.id === op.id; });
      if (i >= 0) txs[i] = copy; else txs.push(copy);
    });
    return KK.sortTxDesc(txs);
  },

  summary: function (txs) {
    return KK.summarize(txs, KK.byId(App.data.accounts), KK.byId(App.data.categories), App.data.settings || {});
  },

  renderHome: function () {
    var txs = App.txsOf(App.homeMonth);
    var s = App.summary(txs);
    $('homeMonth').textContent = App.monthLabel(App.homeMonth);
    $('sumIncome').textContent = App.money(s.income);
    $('sumExpense').textContent = App.money(s.expense);
    $('sumNet').textContent = App.money(s.net, 'THB', true);
    $('sumNet').className = s.net >= 0 ? 'pos' : 'neg';
    $('sumTransfer').textContent = 'ไม่นับเงินโอนระหว่างบัญชี/จ่ายบัตร ' + App.money(s.transfers) +
      (App.hasUsd(txs) ? ' · USD คิดที่ ' + KK.num(App.data.settings.usd_thb) + ' บาท' : '');

    $('favGrid').innerHTML = App.active(App.data.favorites).map(function (f) {
      return '<button type="button" class="fav ' + App.esc(f.type) + '" data-fav="' + App.esc(f.id) + '">' +
        '<span class="ico">' + App.esc(f.icon || '•') + '</span>' + App.esc(f.label) + '</button>';
    }).join('');
    $('favGrid').querySelectorAll('[data-fav]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = App.data.favorites.find(function (x) { return x.id === b.dataset.fav; });
        App.openForm(null, f);
      });
    });

    var groups = Object.keys(s.byGroup).filter(function (k) { return /\|expense$/.test(k); })
      .map(function (k) { return { name: k.split('|')[0], v: s.byGroup[k] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
    var max = groups.length ? groups[0].v : 1;
    $('groupBars').innerHTML = groups.length ? groups.map(function (g) {
      return '<div class="bar-row"><span>' + App.esc(g.name) + '</span>' +
        '<div class="track"><div class="fill" style="width:' + Math.max(3, g.v / max * 100) + '%"></div></div>' +
        '<span class="amt">' + App.money(g.v) + '</span></div>';
    }).join('') : '<div class="empty">ยังไม่มีรายจ่ายเดือนนี้</div>';

    App.renderTxList($('recentList'), txs.slice(0, 8), false);
  },

  hasUsd: function (txs) {
    return txs.some(function (t) { var a = App.acc(t.account_id); return a && a.currency === 'USD'; });
  },

  renderList: function () {
    if (!App.data) return;
    $('listMonth').textContent = App.monthLabel(App.listMonth);
    var sel = $('accFilter');
    var opts = '<option value="">ทุกบัญชี</option>' + App.active(App.data.accounts).map(function (a) {
      return '<option value="' + App.esc(a.id) + '">' + App.esc(KK.accountName(a)) + '</option>';
    }).join('');
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    sel.value = App.listAccount;

    var loaded = !!App.monthTxs[App.listMonth];
    var txs = App.txsOf(App.listMonth).filter(function (t) {
      if (App.listType === 'unknown') {
        var c = App.cat(t.category_id);
        if (!c || !/รอตรวจ/.test(c.group)) return false;
      } else if (App.listType && t.type !== App.listType) return false;
      if (App.listAccount && t.account_id !== App.listAccount && t.to_account_id !== App.listAccount) return false;
      return true;
    });
    var s = App.summary(txs);
    $('listSummary').innerHTML = '<span>รายรับ <b class="pos">' + App.money(s.income) + '</b></span>' +
      '<span>รายจ่าย <b class="neg">' + App.money(s.expense) + '</b></span>' +
      '<span>โอน <b class="trf">' + App.money(s.transfers) + '</b></span>' +
      '<span>' + txs.length + ' รายการ</span>';
    if (!loaded && !txs.length) { $('txList').innerHTML = '<div class="empty">กำลังโหลด…</div>'; return; }
    App.renderTxList($('txList'), txs, true);
  },

  renderTxList: function (el, txs, withDays) {
    if (!txs.length) { el.innerHTML = '<div class="empty">ยังไม่มีรายการ — กด ＋ เพื่อบันทึก</div>'; return; }
    var html = '', lastDay = '';
    txs.forEach(function (t) {
      if (withDays && t.date !== lastDay) {
        lastDay = t.date;
        var day = App.summary(txs.filter(function (x) { return x.date === t.date; }));
        html += '<div class="day"><span>' + App.esc(App.dayLabel(t.date)) + '</span><span>' +
          (day.expense ? '-' + App.money(day.expense) : '') + (day.income ? '  +' + App.money(day.income) : '') + '</span></div>';
      }
      html += App.txRow(t, withDays);
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-tx]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tx = txs.find(function (x) { return x.id === b.dataset.tx; });
        App.openForm(tx);
      });
    });
  },

  txRow: function (t, hideDate) {
    var a = App.acc(t.account_id) || {}, c = App.cat(t.category_id), s = App.asset(t.asset_id);
    var title, icon, cls, sign;
    if (t.type === 'transfer') {
      var to = App.acc(t.to_account_id) || {};
      title = (to.kind === 'credit' || to.kind === 'loan') ? 'จ่าย ' + KK.accountName(to) : 'โอน → ' + KK.accountName(to);
      icon = '🔁'; cls = 'trf'; sign = '';
    } else {
      title = c ? c.name : '(ไม่มีหมวด)';
      icon = c ? c.group.split(' ')[0] : '•';
      cls = t.type === 'income' ? 'pos' : 'neg';
      sign = t.type === 'income' ? '+' : '-';
    }
    var sub = [t.counterparty, KK.accountName(a), s ? s.name : '', t.note !== t.counterparty ? t.note : '',
      hideDate ? '' : App.dayLabel(t.date)].filter(Boolean).join(' · ');
    var extra = t.type === 'transfer' && KK.num(t.to_amount) > 0
      ? '<small>→ ' + App.money(t.to_amount, (App.acc(t.to_account_id) || {}).currency) + '</small>' : '';
    if (t._pending) extra += '<small>⏳ รอส่ง</small>';
    return '<button type="button" class="tx' + (t._pending ? ' pending' : '') + '" data-tx="' + App.esc(t.id) + '">' +
      '<span class="ico">' + App.esc(icon) + '</span>' +
      '<span class="main"><div class="t1">' + App.esc(title) + '</div><div class="t2">' + App.esc(sub) + '</div></span>' +
      '<span class="amt ' + cls + '">' + sign + App.money(t.amount, a.currency) + extra + '</span></button>';
  },

  renderAccounts: function () {
    var bal = App.data.balances || {};
    var settings = App.data.settings || {};
    var assets = 0, debts = 0, hasUsd = false;
    var groups = {};
    App.active(App.data.accounts).forEach(function (a) {
      var b = KK.num(bal[a.id]);
      var thb = KK.toTHB(b, a, settings);
      if (a.currency === 'USD') hasUsd = true;
      if (KK.isLiability(a)) debts += thb; else assets += thb;
      (groups[a.kind] = groups[a.kind] || []).push({ a: a, b: b });
    });
    $('nwAssets').textContent = App.money(assets);
    $('nwDebts').textContent = App.money(Math.abs(Math.min(0, debts)));
    var net = assets + debts;
    $('nwNet').textContent = App.money(net, 'THB');
    $('nwNet').className = net >= 0 ? 'pos' : 'neg';
    $('nwHint').textContent = 'ยอดคำนวณจากยอดยกมา + รายการที่บันทึก · กด ✏️ เพื่อแก้ชื่อ เลขท้าย หรือยอดยกมา' +
      (hasUsd ? ' · USD คิดที่ ' + KK.num(settings.usd_thb) + ' บาท' : '');

    var row = function (a, b) {
      var cls = b < 0 ? 'neg' : '';
      return '<div class="acc-row"><button type="button" class="acc" data-acc="' + App.esc(a.id) + '"><span>' + App.esc(a.icon || '') + ' ' +
        App.esc(KK.accountName(a)) + '</span><b class="' + cls + '">' + App.money(b, a.currency) + '</b></button>' +
        '<button type="button" class="icon-btn acc-edit" data-edit="' + App.esc(a.id) + '" aria-label="แก้ไขบัญชี">✏️</button></div>';
    };
    var hidden = (App.data.accounts || []).filter(function (a) { return !KK.isActive(a); });
    $('accGroups').innerHTML = Object.keys(KK.ACCOUNT_KINDS).filter(function (k) { return groups[k]; }).map(function (k) {
      return '<div class="acc-group"><h3>' + KK.ACCOUNT_KINDS[k] + '</h3>' + groups[k].map(function (x) {
        return row(x.a, x.b);
      }).join('') + '</div>';
    }).join('') +
      '<button type="button" class="btn import-btn" id="accAdd">＋ เพิ่มบัญชี / บัตร</button>' +
      (hidden.length ? '<details class="acc-group acc-hidden"><summary>บัญชีที่ซ่อนอยู่ (' + hidden.length + ')</summary>' +
        hidden.map(function (a) { return row(a, KK.num(bal[a.id])); }).join('') + '</details>' : '');
    $('accGroups').querySelectorAll('[data-acc]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.listAccount = b.dataset.acc;
        App.go('list');
        App.renderList();
      });
    });
    $('accGroups').querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { AccountEditor.open(b.dataset.edit); });
    });
    $('accAdd').addEventListener('click', function () { AccountEditor.open(null); });
  },

  renderSettings: function () {
    var cfg = Config.get();
    $('cfgDemo').checked = !!cfg.demo || !cfg.url;
    $('cfgUrl').value = cfg.url || '';
    $('cfgKey').value = cfg.key || '';
    $('cfgUrl').disabled = $('cfgKey').disabled = $('cfgDemo').checked;
    $('cfgRate').value = App.data && App.data.settings ? App.data.settings.usd_thb : '';
    $('demoTools').hidden = !$('cfgDemo').checked;
  },

  saveConfig: function () {
    var demo = $('cfgDemo').checked;
    var url = $('cfgUrl').value.trim(), key = $('cfgKey').value.trim();
    if (!demo && (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url) || !key)) {
      $('cfgStatus').textContent = '⚠️ กรุณาใส่ Web app URL (ลงท้ายด้วย /exec) และรหัส API';
      return;
    }
    if (!demo && Config.get().demo && Outbox.list().length) Outbox.save([]); // รายการค้างของโหมดทดลองไม่ส่งไปชีตจริง
    Config.set({ demo: demo, url: url, key: key });
    $('cfgStatus').textContent = 'กำลังทดสอบ…';
    App.data = null; App.monthTxs = {};
    var cached = App.readCache();
    if (cached) { App.data = cached.data; App.monthTxs = cached.monthTxs || {}; }
    Api.call('ping').then(function () {
      $('cfgStatus').textContent = demo ? '✅ ใช้โหมดทดลอง' : '✅ เชื่อมต่อ Google Sheet สำเร็จ';
      App.renderSettings();
      return App.refresh();
    }).catch(function (err) {
      $('cfgStatus').textContent = '❌ ' + err.message;
    });
  },

  saveRate: function () {
    var rate = KK.num($('cfgRate').value);
    if (!(rate > 0)) { App.toast('อัตราไม่ถูกต้อง', true); return; }
    Api.call('saveSettings', { settings: { usd_thb: rate } }).then(function (res) {
      App.data.settings = res.settings; App.writeCache(); App.renderAll();
      App.toast('บันทึกอัตรา 1 USD = ' + rate + ' บาท');
    }).catch(function (err) { App.toast(err.message, true); });
  },

  // ------------------------------------------------------------ ฟอร์มบันทึก
  fillSelects: function () {
    var accOpts = App.active(App.data.accounts).map(function (a) {
      return '<option value="' + App.esc(a.id) + '">' + App.esc(KK.accountName(a)) + (a.currency !== 'THB' ? ' (' + a.currency + ')' : '') + '</option>';
    }).join('');
    $('fAccount').innerHTML = accOpts;
    $('fToAccount').innerHTML = accOpts;
    $('fAsset').innerHTML = '<option value="">— ไม่ระบุ —</option>' + App.active(App.data.assets).map(function (s) {
      return '<option value="' + App.esc(s.id) + '">' + App.esc((s.icon || '') + ' ' + s.name) + '</option>';
    }).join('');
  },

  fillCategories: function (type) {
    var groups = {};
    App.active(App.data.categories).filter(function (c) { return c.type === type; }).forEach(function (c) {
      (groups[c.group] = groups[c.group] || []).push(c);
    });
    $('fCategory').innerHTML = '<option value="">— เลือกหมวด —</option>' + Object.keys(groups).map(function (g) {
      return '<optgroup label="' + App.esc(g) + '">' + groups[g].map(function (c) {
        return '<option value="' + App.esc(c.id) + '">' + App.esc(c.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  },

  setFormType: function (type) {
    App.formType = type;
    $('typeSeg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.type === type); });
    var isTrf = type === 'transfer';
    $('catWrap').hidden = isTrf;
    $('transferWrap').hidden = !isTrf;
    $('accLabel').textContent = isTrf ? 'จากบัญชี' : (type === 'income' ? 'เข้าบัญชี' : 'จ่ายจากบัญชี');
    if (!isTrf) {
      var keep = $('fCategory').value;
      App.fillCategories(type);
      var c = App.cat(keep);
      if (c && c.type === type) $('fCategory').value = keep;
    }
    App.updateCurrency();
  },

  updateCurrency: function () {
    var from = App.acc($('fAccount').value) || {}, to = App.acc($('fToAccount').value) || {};
    $('amtCur').textContent = App.curSym(from.currency);
    var cross = App.formType === 'transfer' && from.currency && to.currency && from.currency !== to.currency;
    $('toAmtWrap').hidden = !cross;
    if (cross) $('toAmtLabel').textContent = 'ยอดที่เข้า ' + KK.accountName(to) + ' (' + to.currency + ')';
  },

  /** tx = แก้รายการเดิม, fav = เปิดจากปุ่มลัด */
  openForm: function (tx, fav) {
    if (!App.data) { App.toast('ยังโหลดข้อมูลไม่เสร็จ', true); return; }
    App.editing = tx || null;
    App.fillSelects();
    var src = tx || fav || {};
    var type = src.type || 'expense';
    App.fillCategories(type === 'transfer' ? 'expense' : type);
    $('fCategory').value = src.category_id || '';
    $('fAccount').value = src.account_id || 'KB1';
    if (!$('fAccount').value) $('fAccount').selectedIndex = 0;
    $('fToAccount').value = src.to_account_id || '';
    $('fAsset').value = src.asset_id || '';
    $('fAmount').value = tx ? tx.amount : (fav && KK.num(fav.amount) > 0 ? fav.amount : '');
    $('fToAmount').value = tx && tx.to_amount ? tx.to_amount : '';
    $('fDate').value = tx ? tx.date : App.today();
    $('fNote').value = tx ? tx.note || '' : '';
    $('fCounterparty').value = tx ? tx.counterparty || '' : '';
    App.fillCounterparties();
    App.setFormType(type);
    App.updateCpLabel();
    $('sheetTitle').textContent = tx ? 'แก้ไขรายการ' : (fav ? (fav.icon || '') + ' ' + fav.label : 'บันทึกรายการ');
    $('fDelete').hidden = !tx;
    $('formError').hidden = true;
    $('fSubmit').disabled = false;
    $('sheet').hidden = false;
    setTimeout(function () { $('fAmount').focus(); }, 60);
  },

  /** หมวดคอร์ส → ช่องชื่อเปลี่ยนเป็น "ชื่อผู้เรียน" */
  updateCpLabel: function () {
    var c = App.cat($('fCategory').value);
    var course = App.formType === 'income' && c && /คอร์ส/.test(c.group);
    $('cpLabel').textContent = course ? 'ชื่อผู้เรียน' : 'ชื่อผู้จ่าย / ผู้รับ (ไม่บังคับ)';
  },

  /** รายชื่อที่เคยใช้ (จากรายการที่โหลดไว้) ให้เลือกตอนพิมพ์ */
  fillCounterparties: function () {
    var seen = {};
    Object.keys(App.monthTxs).forEach(function (m) {
      App.monthTxs[m].forEach(function (t) { if (t.counterparty) seen[t.counterparty] = true; });
    });
    $('cpList').innerHTML = Object.keys(seen).sort().map(function (n) {
      return '<option value="' + App.esc(n) + '">';
    }).join('');
  },

  closeForm: function () { $('sheet').hidden = true; App.editing = null; },

  formError: function (msg) { $('formError').textContent = msg; $('formError').hidden = false; },

  submitForm: function () {
    var tx = {
      id: App.editing ? App.editing.id : App.newId(),
      type: App.formType,
      date: $('fDate').value,
      amount: KK.num($('fAmount').value),
      account_id: $('fAccount').value,
      to_account_id: App.formType === 'transfer' ? $('fToAccount').value : '',
      to_amount: !$('toAmtWrap').hidden ? KK.num($('fToAmount').value) : '',
      category_id: App.formType === 'transfer' ? '' : $('fCategory').value,
      asset_id: $('fAsset').value,
      note: $('fNote').value,
      counterparty: $('fCounterparty').value,
      import_ref: App.editing ? App.editing.import_ref || '' : '',
      slip_ref: App.editing ? App.editing.slip_ref || '' : '',
      created_at: App.editing ? App.editing.created_at : new Date().toISOString()
    };
    var accs = KK.byId(App.data.accounts);
    var err = KK.validateTx(tx, accs, KK.byId(App.data.categories));
    if (!err && !$('toAmtWrap').hidden && !(tx.to_amount > 0)) err = 'กรุณาใส่ยอดที่เข้าบัญชีปลายทาง';
    if (err) { App.formError(err); return; }
    tx = KK.normalizeTx(tx, accs);

    var old = App.editing ? Object.assign({}, App.editing) : null;
    App.applyLocal(old, tx);
    Outbox.push({ kind: 'save', id: tx.id, tx: tx });
    App.closeForm();
    App.renderAll();
    App.toast(old ? 'แก้ไขแล้ว' : 'บันทึกแล้ว ' + App.money(tx.amount, (accs[tx.account_id] || {}).currency));
    App.pushNow();
  },

  deleteEditing: function () {
    var tx = App.editing;
    if (!tx || !confirm('ลบรายการนี้?')) return;
    App.applyLocal(tx, null);
    Outbox.push({ kind: 'delete', id: tx.id });
    App.closeForm();
    App.renderAll();
    App.toast('ลบแล้ว');
    App.pushNow();
  },

  /** อัปเดตข้อมูลในเครื่องทันที (ยอดบัญชี + รายการในเดือน) */
  applyLocal: function (oldTx, newTx) {
    var bal = App.data.balances;
    if (oldTx) App.applyEffect(bal, oldTx, -1);
    if (newTx) App.applyEffect(bal, newTx, 1);
    var id = (newTx || oldTx).id;
    Object.keys(App.monthTxs).forEach(function (m) {
      App.monthTxs[m] = App.monthTxs[m].filter(function (t) { return t.id !== id; });
    });
    if (newTx) {
      var m = App.monthOf(newTx.date);
      if (App.monthTxs[m]) App.monthTxs[m].push(newTx);
    }
    App.writeCache();
  },

  pushNow: function () {
    Outbox.flush().then(function () {
      App.renderSyncPill();
      // ขอยอดจริงจากเซิร์ฟเวอร์อีกครั้ง เพื่อให้ตรงกับชีต
      if (!Outbox.list().length) {
        Api.call('bootstrap', { month: App.homeMonth }).then(function (res) {
          App.monthTxs[App.homeMonth] = res.txs; delete res.txs;
          App.data = res; App.writeCache(); App.renderAll();
        }).catch(function () { /* ใช้ข้อมูลในเครื่องต่อไป */ });
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', App.init);
