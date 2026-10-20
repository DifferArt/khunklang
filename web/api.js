/*
 * ขุนคลัง — การเชื่อมต่อ: Apps Script จริง หรือโหมดทดลอง (เก็บในเครื่อง)
 * พร้อมคิวออฟไลน์: ถ้าบันทึกตอนไม่มีเน็ต จะเก็บไว้แล้วส่งให้เองเมื่อออนไลน์
 */
var Config = {
  KEY: 'kk_config',
  get: function () {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || { demo: true }; }
    catch (e) { return { demo: true }; }
  },
  set: function (cfg) {
    try { localStorage.setItem(this.KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }
};

function ApiError(message, network) {
  this.message = message;
  this.network = !!network;
}

var Api = {
  // คำสั่งที่ส่งซ้ำได้โดยไม่เกิดข้อมูลซ้ำ (addAccount ส่งซ้ำแล้วจะได้บัญชีซ้ำ จึงไม่อยู่ในนี้)
  RETRYABLE: ['ping', 'bootstrap', 'listTx', 'saveTx', 'deleteTx', 'saveSettings', 'saveTxBatch', 'saveRules',
    'updateAccounts', 'saveCategories', 'uploadFile', 'listFiles', 'getFile', 'deleteFile'],

  call: function (action, payload) {
    var cfg = Config.get();
    if (cfg.demo || !cfg.url) {
      return new Promise(function (resolve, reject) {
        try { resolve(MockApi.handle(action, payload || {})); }
        catch (e) { reject(new ApiError(e.message)); }
      });
    }
    var tries = Api.RETRYABLE.indexOf(action) >= 0 ? 3 : 1;
    var attempt = function (n) {
      // ส่งแบบ text/plain เพื่อไม่ให้เกิด CORS preflight กับ Apps Script
      return fetch(cfg.url, {
        method: 'POST',
        body: JSON.stringify({ key: cfg.key, action: action, payload: payload || {} })
      }).then(function (res) {
        return res.text().then(function (text) {
          try { return JSON.parse(text); } catch (e) {
            // Google ตอบเป็นหน้า HTML ชั่วคราว (ระบบยุ่ง/หมดเวลา) — ลองใหม่อัตโนมัติ
            var err = new ApiError('Google ตอบกลับผิดพลาดชั่วคราว ลองใหม่อีกครั้ง');
            err.transient = true;
            throw err;
          }
        });
      }, function () {
        throw new ApiError('เชื่อมต่อไม่ได้', true);
      }).then(function (data) {
        if (!data.ok) throw new ApiError(data.error || 'เกิดข้อผิดพลาด');
        return data.result;
      }).catch(function (err) {
        if (err.transient && n < tries) {
          return new Promise(function (r) { setTimeout(r, 1500 * n); }).then(function () { return attempt(n + 1); });
        }
        throw err;
      });
    };
    return attempt(1);
  }
};

/** คิวรายการที่ยังส่งไม่สำเร็จ */
var Outbox = {
  KEY: 'kk_outbox',
  list: function () {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch (e) { return []; }
  },
  save: function (items) {
    try { localStorage.setItem(this.KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
  },
  push: function (op) {
    var items = this.list().filter(function (o) { return o.id !== op.id; });
    items.push(op);
    this.save(items);
  },
  /** ส่งทีละรายการตามลำดับ หยุดเมื่อเจอปัญหาเน็ต */
  flush: function () {
    var self = this;
    var items = self.list();
    if (!items.length) return Promise.resolve(0);
    var sent = 0;
    var next = function () {
      var op = items[0];
      if (!op) return Promise.resolve(sent);
      var req = op.kind === 'delete'
        ? Api.call('deleteTx', { id: op.id })
        : Api.call('saveTx', { tx: op.tx });
      return req.then(function () {
        items.shift(); sent++; self.save(items); return next();
      }, function (err) {
        if (err.network) return sent;
        // ข้อมูลผิด (เช่น บัญชีถูกลบ) — ทิ้งรายการนั้นไป ไม่ให้ค้างคิวตลอด
        items.shift(); self.save(items);
        App.toast('ส่งรายการค้างไม่สำเร็จ: ' + err.message, true);
        return next();
      });
    };
    return next();
  }
};
