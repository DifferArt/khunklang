/*
 * ขุนคลัง — ไฟล์แนบ (สลิป / ใบเสร็จ / Statement)
 * รูปถูกย่อในเครื่องก่อนส่ง (ด้านยาวสุด 1600px, JPEG) แล้วเก็บใน Google Drive ผ่าน Apps Script
 */
var Attach = {
  MAX_SIDE: 1600,
  QUALITY: 0.82,
  MAX_BYTES: 15 * 1024 * 1024,
  KINDS: { slip: 'สลิป', receipt: 'ใบเสร็จ/บิล' },
  pending: [],    // เลือกในฟอร์มแล้ว ยังไม่ได้ส่ง: {id, kind, name, mime, data, preview}
  existing: [],   // แนบไว้แล้วของรายการที่กำลังแก้
  thumbs: {},     // id ไฟล์ → dataURL ที่โหลดมาแล้ว
  txId: '',

  // ------------------------------------------------------------ อ่าน/ย่อไฟล์
  readDataUrl: function (blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('อ่านไฟล์ไม่ได้')); };
      r.readAsDataURL(blob);
    });
  },

  /** คืน {name, mime, data(base64), preview} — รูปถูกย่อเป็น JPEG, ไฟล์อื่นส่งตามเดิม */
  prepare: function (file) {
    var self = this;
    if (file.size > self.MAX_BYTES) return Promise.reject(new Error(file.name + ' ใหญ่เกิน 15 MB'));
    var isImg = /^image\//.test(file.type);
    var raw = function () {
      return self.readDataUrl(file).then(function (url) {
        return { name: file.name, mime: file.type || 'application/octet-stream', data: url.split(',')[1], preview: isImg ? url : '' };
      });
    };
    if (!isImg || file.type === 'image/gif') return raw();
    return self.shrink(file).then(function (url) {
      return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: url.split(',')[1], preview: url };
    }, raw); // เบราว์เซอร์เปิดรูปชนิดนี้ไม่ได้ (เช่น HEIC) — ส่งไฟล์เดิม
  },

  shrink: function (file) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(src);
        var k = Math.min(1, self.MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', self.QUALITY));
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error('ย่อรูปไม่ได้')); };
      img.src = src;
    });
  },

  // ------------------------------------------------------------ ในฟอร์มบันทึก
  bind: function () {
    var self = this;
    $('fFiles').addEventListener('change', function () { self.add(this.files); this.value = ''; });
    $('attList').addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) { self.remove(rm.dataset.rm); return; }
      var v = e.target.closest('[data-view]');
      if (v) self.view(v.dataset.view);
    });
    $('attList').addEventListener('change', function (e) {
      var sel = e.target.closest('[data-kind]');
      if (!sel) return;
      var p = self.pending.find(function (x) { return x.id === sel.dataset.kind; });
      if (p) p.kind = sel.value;
    });
    $('viewer').addEventListener('click', function () { $('viewer').hidden = true; $('viewerImg').src = ''; });
  },

  /** เปิดฟอร์ม: ล้างไฟล์ที่ค้าง แล้วโหลดไฟล์ที่แนบไว้ของรายการเดิม */
  reset: function (tx) {
    var self = this;
    self.pending = [];
    self.existing = [];
    self.txId = tx ? tx.id : '';
    self.render();
    if (!tx || !tx.slip_ref) return;
    var id = tx.id;
    Api.call('listFiles', { tx_id: id }).then(function (res) {
      if (self.txId !== id) return;
      self.existing = res.files;
      self.render();
      self.loadThumbs();
    }).catch(function (err) {
      if (self.txId === id) $('attList').insertAdjacentHTML('beforeend', '<p class="hint">โหลดไฟล์แนบไม่ได้: ' + App.esc(err.message) + '</p>');
    });
  },

  add: function (files) {
    var self = this;
    var kind = App.formType === 'expense' ? 'receipt' : 'slip';
    Array.prototype.slice.call(files || []).reduce(function (p, f) {
      return p.then(function () { return self.prepare(f); }).then(function (x) {
        self.pending.push(Object.assign({ id: App.newId(), kind: kind }, x));
        self.render();
      }, function (err) { App.toast(err.message, true); });
    }, Promise.resolve());
  },

  remove: function (id) {
    var self = this;
    if (self.pending.some(function (p) { return p.id === id; })) {
      self.pending = self.pending.filter(function (p) { return p.id !== id; });
      self.render();
      return;
    }
    if (!confirm('ลบไฟล์แนบนี้? (ไฟล์ใน Drive จะย้ายไปถังขยะ)')) return;
    Api.call('deleteFile', { id: id }).then(function () {
      self.existing = self.existing.filter(function (f) { return f.id !== id; });
      self.render();
      App.toast('ลบไฟล์แนบแล้ว');
      App.pushNow();
    }).catch(function (err) { App.toast(err.message, true); });
  },

  render: function () {
    var self = this;
    var chip = function (f, isNew) {
      var src = isNew ? f.preview : self.thumbs[f.id];
      var pic = src ? '<img src="' + src + '" alt="">' : '<span class="att-ico">' + (/pdf/.test(f.mime) ? '📄' : '🖼️') + '</span>';
      var kind = isNew
        ? '<select data-kind="' + App.esc(f.id) + '" aria-label="ชนิดเอกสาร">' + Object.keys(self.KINDS).map(function (k) {
          return '<option value="' + k + '"' + (k === f.kind ? ' selected' : '') + '>' + self.KINDS[k] + '</option>';
        }).join('') + '</select>'
        : '<small>' + App.esc(self.KINDS[f.kind] || f.kind) + '</small>';
      return '<div class="att' + (isNew ? ' new' : '') + '">' +
        '<button type="button" class="att-pic" ' + (isNew ? '' : 'data-view="' + App.esc(f.id) + '"') + '>' + pic + '</button>' +
        kind +
        '<button type="button" class="att-rm" data-rm="' + App.esc(f.id) + '" aria-label="เอาไฟล์ออก">✕</button></div>';
    };
    $('attList').innerHTML = self.existing.map(function (f) { return chip(f, false); }).join('') +
      self.pending.map(function (f) { return chip(f, true); }).join('');
  },

  loadThumbs: function () {
    var self = this;
    self.existing.filter(function (f) { return /^image\//.test(f.mime) && !self.thumbs[f.id]; }).reduce(function (p, f) {
      return p.then(function () {
        return Api.call('getFile', { id: f.id }).then(function (res) {
          if (res.data) { self.thumbs[f.id] = 'data:' + res.mime + ';base64,' + res.data; self.render(); }
        }, function () { /* แสดงไอคอนแทน */ });
      });
    }, Promise.resolve());
  },

  view: function (id) {
    var self = this;
    var f = self.existing.find(function (x) { return x.id === id; });
    if (f && /^image\//.test(f.mime) && self.thumbs[id]) {
      $('viewerImg').src = self.thumbs[id];
      $('viewer').hidden = false;
      return;
    }
    // PDF / รูปที่ยังไม่โหลด: เปิดใน Google Drive
    var win = window.open('', '_blank');
    Api.call('getFile', { id: id }).then(function (res) {
      if (win) win.location = res.url; else location.href = res.url;
    }).catch(function (err) { if (win) win.close(); App.toast(err.message, true); });
  },

  /** เอาไฟล์ที่เลือกในฟอร์มออกมาส่ง (เรียกตอนกดบันทึก) */
  take: function () {
    var out = this.pending;
    this.pending = [];
    return out;
  },

  /** ส่งไฟล์ของรายการขึ้น Drive ทีละไฟล์ */
  upload: function (items, tx) {
    var acc = App.acc(tx.account_id);
    var label = tx.type === 'transfer' ? 'โอน' : ((App.cat(tx.category_id) || {}).name || '');
    var done = 0;
    return items.reduce(function (p, it, i) {
      return p.then(function () {
        var ext = (/\.[^.]+$/.exec(it.name) || [''])[0];
        return Api.call('uploadFile', { file: {
          id: it.id, tx_id: tx.id, kind: it.kind, account_id: tx.account_id, date_from: tx.date, mime: it.mime, data: it.data,
          name: tx.date + '_' + KK.num(tx.amount).toFixed(2) + '_' + label + (acc ? '_' + KK.accountName(acc) : '') + (items.length > 1 ? '_' + (i + 1) : '') + ext
        } }).then(function () { done++; });
      });
    }, Promise.resolve()).then(function () {
      App.toast('แนบไฟล์แล้ว ' + done + ' ไฟล์');
    }, function (err) {
      App.toast('แนบไฟล์ไม่สำเร็จ (' + err.message + ') — เปิดรายการแล้วแนบใหม่อีกครั้ง', true);
    });
  },

  /** ส่ง Statement PDF — id คงที่ตามบัญชี+รอบ ส่งซ้ำไม่เกิดไฟล์ซ้ำ */
  uploadStatement: function (file, accountId, from, to) {
    var acc = App.acc(accountId);
    return this.readDataUrl(file).then(function (url) {
      return Api.call('uploadFile', { file: {
        id: 'ST_' + accountId + '_' + from + '_' + to, kind: 'statement', account_id: accountId,
        date_from: from, date_to: to, mime: 'application/pdf', data: url.split(',')[1],
        name: (acc ? KK.accountName(acc) : accountId) + '_' + from + '_' + to + '.pdf'
      } });
    });
  }
};
