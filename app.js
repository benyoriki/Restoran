/* ==========================================================================
   app.js — utilitas bersama (format, tema, UI kit, auth demo, grafik, CSV)
   Dimuat setelah storage.js pada semua halaman.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- DOM & format ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function rp(n) {
    n = Math.round(Number(n) || 0);
    return (n < 0 ? '-Rp ' : 'Rp ') + Math.abs(n).toLocaleString('id-ID');
  }
  function num(n) { return Math.round(Number(n) || 0).toLocaleString('id-ID'); }
  function compact(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(1).replace('.', ',').replace(',0', '') + ' M';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' jt';
    if (a >= 1e3) return s + Math.round(a / 1e3) + ' rb';
    return s + Math.round(a);
  }
  var dfDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  var dfTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
  function fmtDate(ts) { return dfDate.format(new Date(ts)); }
  function fmtTime(ts) { return dfTime.format(new Date(ts)).replace('.', ':'); }
  function fmtDateTime(ts) { return fmtDate(ts) + ', ' + fmtTime(ts); }
  function pad(n) { return ('0' + n).slice(-2); }
  function isoDate(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s, endOfDay) { if (!s) return null; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime(); }
  function ago(ts) {
    var m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' mnt';
    var h = Math.floor(m / 60); return h + ' j ' + (m % 60) + ' mnt';
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 200); }; }
  function delegate(root, type, sel, fn) {
    root.addEventListener(type, function (e) {
      var t = e.target.closest ? e.target.closest(sel) : null;
      if (t && root.contains(t)) fn.call(t, e, t);
    });
  }

  /* ---------- rentang tanggal ---------- */
  var Range = {
    PRESETS: [['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7d', '7 hari terakhir'], ['month', 'Bulan ini'], ['custom', 'Rentang khusus']],
    compute: function (key, from, to) {
      var n = new Date(), d0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(), day = 86400000;
      var r;
      if (key === 'yesterday') r = { from: d0 - day, to: d0 - 1 };
      else if (key === '7d') r = { from: d0 - 6 * day, to: d0 + day - 1 };
      else if (key === 'month') r = { from: new Date(n.getFullYear(), n.getMonth(), 1).getTime(), to: d0 + day - 1 };
      else if (key === 'year') r = { from: new Date(n.getFullYear(), 0, 1).getTime(), to: d0 + day - 1 };
      else if (key === 'custom') {
        var f = parseISO(from) , t = parseISO(to, true);
        if (f == null) f = d0; if (t == null) t = d0 + day - 1;
        if (t < f) { var x = f; f = t; t = x; }
        r = { from: f, to: t };
      } else if (key === 'all') r = { from: 0, to: Date.now() + day * 3650 };
      else r = { from: d0, to: d0 + day - 1 };
      r.key = key;
      r.label = (key === 'today' ? 'Hari ini' : key === 'yesterday' ? 'Kemarin' : key === '7d' ? '7 hari terakhir' : key === 'month' ? 'Bulan ini' : key === 'year' ? 'Tahun ini' : key === 'all' ? 'Semua waktu' : fmtDate(r.from) + ' – ' + fmtDate(r.to));
      return r;
    },
    has: function (r, ts) { return ts >= r.from && ts <= r.to; },
    days: function (r) { return Math.max(1, Math.round((r.to - r.from) / 86400000)); }
  };

  /* ---------- ikon (Lucide) ---------- */
  function ic(name, cls) { return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"></i>'; }
  var icTimer;
  function refreshIcons() {
    clearTimeout(icTimer);
    icTimer = setTimeout(function () { try { if (global.lucide) global.lucide.createIcons(); } catch (e) { console.warn(e); } }, 0);
  }

  /* ---------- tema ---------- */
  var Theme = {
    KEY: 'qmo:theme',
    get: function () { try { return localStorage.getItem(Theme.KEY); } catch (e) { return null; } },
    apply: function (t) { document.documentElement.setAttribute('data-theme', t); var m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0f1512' : '#10b981'); },
    set: function (t) { try { localStorage.setItem(Theme.KEY, t); } catch (e) {} Theme.apply(t); Theme.sync(); },
    current: function () { return document.documentElement.getAttribute('data-theme') || 'light'; },
    toggle: function () { Theme.set(Theme.current() === 'dark' ? 'light' : 'dark'); },
    sync: function () {
      $$('[data-theme-toggle]').forEach(function (b) {
        var dark = Theme.current() === 'dark';
        b.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
        b.setAttribute('title', dark ? 'Mode terang' : 'Mode gelap');
        b.innerHTML = ic(dark ? 'sun' : 'moon');
      });
      refreshIcons();
    },
    init: function (defaultTheme) {
      var saved = Theme.get();
      Theme.apply(saved || defaultTheme || 'light');
      document.addEventListener('click', function (e) { if (e.target.closest('[data-theme-toggle]')) Theme.toggle(); });
      Theme.sync();
    }
  };

  /* ---------- toast ---------- */
  function toast(msg, type, ms) {
    var box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var el = document.createElement('div');
    type = type || 'success';
    var icon = { success: 'circle-check', error: 'circle-alert', info: 'info', warn: 'triangle-alert' }[type] || 'info';
    el.className = 'toast toast-' + type; el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = ic(icon) + '<span>' + esc(msg) + '</span>';
    box.appendChild(el); refreshIcons();
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 250); }, ms || (type === 'error' ? 5000 : 3000));
  }
  function fail(e, fallback) {
    console.error(e);
    toast((e && e.message) || fallback || 'Terjadi kesalahan.', 'error');
  }

  /* ---------- modal, konfirmasi, form ---------- */
  var modalStack = [];
  function modal(opts) {
    var ov = document.createElement('div');
    ov.className = 'overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    var size = opts.size || 'md';
    ov.innerHTML = '<div class="dialog dialog-' + size + (opts.sheet ? ' sheet' : '') + '">' +
      (opts.title !== false ? '<header class="dialog-head"><h3>' + esc(opts.title || '') + '</h3><button class="icon-btn" data-close aria-label="Tutup">' + ic('x') + '</button></header>' : '') +
      '<div class="dialog-body"></div>' + (opts.footer ? '<footer class="dialog-foot"></footer>' : '') + '</div>';
    var body = $('.dialog-body', ov), foot = $('.dialog-foot', ov);
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    if (foot) { if (typeof opts.footer === 'string') foot.innerHTML = opts.footer; else foot.appendChild(opts.footer); }
    document.body.appendChild(ov); document.body.classList.add('no-scroll');
    refreshIcons();
    var api = {
      el: ov, body: body, foot: foot,
      close: function (result) {
        if (api.closed) return; api.closed = true;
        ov.classList.remove('in'); modalStack = modalStack.filter(function (m) { return m !== api; });
        if (!modalStack.length) document.body.classList.remove('no-scroll');
        setTimeout(function () { ov.remove(); }, 180);
        if (opts.onClose) opts.onClose(result);
      }
    };
    ov.addEventListener('mousedown', function (e) { if (e.target === ov && opts.dismissible !== false) api.close(); });
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) api.close(); });
    modalStack.push(api);
    requestAnimationFrame(function () { ov.classList.add('in'); var f = $('input,select,textarea,button.btn-primary', body); if (f && !opts.noFocus) { try { f.focus({ preventScroll: true }); } catch (e) {} } });
    return api;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalStack.length) { var m = modalStack[modalStack.length - 1]; m.close(); }
  });

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: o.title || 'Konfirmasi', size: 'sm', dismissible: true,
        body: '<div class="confirm"><div class="confirm-ic ' + (o.danger ? 'danger' : '') + '">' + ic(o.danger ? 'trash-2' : 'circle-help') + '</div><p>' + (o.html ? o.message : esc(o.message || 'Lanjutkan tindakan ini?')) + '</p></div>',
        footer: '<button class="btn btn-ghost" data-no>' + esc(o.cancelText || 'Batal') + '</button><button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-yes>' + esc(o.confirmText || 'Ya, lanjutkan') + '</button>',
        onClose: function () { if (!done) resolve(false); }, noFocus: true
      });
      $('[data-no]', m.el).onclick = function () { done = true; m.close(); resolve(false); };
      $('[data-yes]', m.el).onclick = function () { done = true; m.close(); resolve(true); };
      $('[data-no]', m.el).focus();
    });
  }

  /** Form modal generik. fields: [{name,label,type,required,options,min,max,step,placeholder,hint,cols,show,prefix,suffix}] */
  function formModal(o) {
    var vals = Object.assign({}, o.values || {});
    var fields = o.fields;
    var imgState = {};
    var form = document.createElement('form'); form.noValidate = true; form.className = 'form-grid';
    function optsOf(f) { return typeof f.options === 'function' ? f.options(collect()) : (f.options || []); }
    function fieldHtml(f) {
      var id = 'f_' + f.name, v = vals[f.name];
      var label = f.label ? '<label for="' + id + '">' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>' : '';
      var ctrl = '';
      var dis = f.disabled ? ' disabled' : '';
      if (f.type === 'textarea') ctrl = '<textarea id="' + id + '" name="' + f.name + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.placeholder || '') + '"' + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '') + dis + '>' + esc(v == null ? '' : v) + '</textarea>';
      else if (f.type === 'select') ctrl = '<select id="' + id + '" name="' + f.name + '"' + dis + '>' + (f.placeholder ? '<option value="">' + esc(f.placeholder) + '</option>' : '') + optsOf(f).map(function (op) { return '<option value="' + esc(op.value) + '"' + (String(v) === String(op.value) ? ' selected' : '') + '>' + esc(op.label) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'checkbox') ctrl = '<label class="switch"><input type="checkbox" id="' + id + '" name="' + f.name + '"' + (v ? ' checked' : '') + dis + '><span class="slider"></span><span class="switch-text">' + esc(f.text || f.label) + '</span></label>';
      else if (f.type === 'multiselect') ctrl = '<div class="checklist" data-multi="' + f.name + '">' + optsOf(f).map(function (op) { return '<label class="check"><input type="checkbox" value="' + esc(op.value) + '"' + ((v || []).indexOf(op.value) >= 0 ? ' checked' : '') + '><span>' + esc(op.label) + '</span></label>'; }).join('') + '</div>';
      else if (f.type === 'image') {
        ctrl = '<div class="img-field" data-img="' + f.name + '"><div class="img-prev">' + (v ? '<img src="' + esc(v) + '" alt="Pratinjau foto">' : '<span>' + ic('image') + '<small>Belum ada foto</small></span>') + '</div><div class="img-actions"><label class="btn btn-soft btn-sm">' + ic('upload') + (v ? ' Ganti foto' : ' Pilih foto') + '<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>' + (v ? '<button type="button" class="btn btn-ghost btn-sm" data-img-remove>' + ic('trash-2') + ' Hapus</button>' : '') + '</div><small class="hint">JPG/PNG/WebP, maks. 5 MB. Otomatis diperkecil agar hemat penyimpanan.</small></div>';
      } else {
        var t = f.type || 'text';
        var inner = '<input id="' + id + '" name="' + f.name + '" type="' + t + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(f.placeholder || '') + '"' +
          (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step != null ? ' step="' + f.step + '"' : '') + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '') + (t === 'number' ? ' inputmode="decimal"' : '') + dis + ' autocomplete="off">';
        ctrl = (f.prefix || f.suffix) ? '<div class="input-group">' + (f.prefix ? '<span class="addon">' + esc(f.prefix) + '</span>' : '') + inner + (f.suffix ? '<span class="addon">' + esc(f.suffix) + '</span>' : '') + '</div>' : inner;
      }
      return '<div class="field' + (f.cols === 2 ? ' span2' : '') + '" data-field="' + f.name + '"><div class="field-in">' + (f.type === 'checkbox' ? '' : label) + ctrl + (f.hint ? '<small class="hint">' + esc(f.hint) + '</small>' : '') + '<small class="err" role="alert"></small></div></div>';
    }
    function render() {
      form.innerHTML = fields.map(fieldHtml).join('') + '<div class="form-error span2" role="alert" hidden></div>';
      applyShow(); refreshIcons();
    }
    function collect() {
      var out = Object.assign({}, vals);
      fields.forEach(function (f) {
        var el = form.elements ? form.elements[f.name] : null;
        if (f.type === 'checkbox') out[f.name] = el ? el.checked : !!vals[f.name];
        else if (f.type === 'multiselect') { var w = $('[data-multi="' + f.name + '"]', form); if (w) out[f.name] = $$('input:checked', w).map(function (i) { return i.value; }); }
        else if (f.type === 'image') out[f.name] = imgState[f.name] !== undefined ? imgState[f.name] : vals[f.name];
        else if (el) out[f.name] = el.value;
      });
      return out;
    }
    function applyShow() {
      var cur = collect();
      fields.forEach(function (f) {
        var w = $('[data-field="' + f.name + '"]', form);
        if (w) w.hidden = f.show ? !f.show(cur) : false;
      });
    }
    render();
    var api;
    form.addEventListener('input', function (e) {
      Object.assign(vals, collect());
      var dyn = fields.some(function (f) { return typeof f.options === 'function'; });
      var deps = fields.some(function (f) { return f.rerender && f.rerender.indexOf(e.target.name) >= 0; });
      if (dyn && deps) { render(); } else applyShow();
      var w = e.target.closest('.field'); if (w) { w.classList.remove('invalid'); var er = $('.err', w); if (er) er.textContent = ''; }
    });
    form.addEventListener('change', function (e) {
      if (e.target.type === 'file' && e.target.files[0]) {
        var wrap = e.target.closest('[data-img]'), name = wrap.getAttribute('data-img');
        wrap.classList.add('loading');
        ImageStore.put(e.target.files[0], { maxDim: (fields.filter(function (f) { return f.name === name; })[0] || {}).maxDim }).then(function (data) {
          imgState[name] = data; vals[name] = data; render();
        }).catch(function (err) { wrap.classList.remove('loading'); toast(err.message, 'error'); e.target.value = ''; });
      }
    });
    form.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-img-remove]');
      if (rm) { var name = rm.closest('[data-img]').getAttribute('data-img'); imgState[name] = ''; vals[name] = ''; render(); }
    });
    function submit() {
      var cur = collect(), ok = true, first = null;
      $$('.field', form).forEach(function (w) { w.classList.remove('invalid'); var er = $('.err', w); if (er) er.textContent = ''; });
      fields.forEach(function (f) {
        if (f.show && !f.show(cur)) return;
        var msg = '', v = cur[f.name];
        var empty = v == null || v === '' || (Array.isArray(v) && !v.length);
        if (f.required && empty && f.type !== 'checkbox') msg = (f.label || f.name) + ' wajib diisi.';
        else if (!empty && f.type === 'number') {
          var n = parseFloat(v);
          if (isNaN(n)) msg = 'Masukkan angka yang valid.';
          else if (f.min != null && n < f.min) msg = 'Minimal ' + f.min + '.';
          else if (f.max != null && n > f.max) msg = 'Maksimal ' + f.max + '.';
        } else if (!empty && f.pattern && !new RegExp(f.pattern).test(v)) msg = f.patternMsg || 'Format tidak valid.';
        else if (!empty && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) msg = 'Email tidak valid.';
        if (!msg && f.validate) msg = f.validate(cur) || '';
        if (msg) { ok = false; var w = $('[data-field="' + f.name + '"]', form); if (w) { w.classList.add('invalid'); $('.err', w).textContent = msg; if (!first) first = w; } }
      });
      if (o.validate) { var g = o.validate(cur); if (g) { ok = false; var fe = $('.form-error', form); fe.textContent = g; fe.hidden = false; } }
      if (!ok) { if (first) { var inp = $('input,select,textarea', first); if (inp) inp.focus(); } return; }
      fields.forEach(function (f) {
        if (f.type === 'number' && cur[f.name] !== '' && cur[f.name] != null) cur[f.name] = parseFloat(cur[f.name]);
        if (f.type === 'number' && (cur[f.name] === '' || cur[f.name] == null)) cur[f.name] = null;
        if (typeof cur[f.name] === 'string' && f.type !== 'textarea') cur[f.name] = cur[f.name].trim();
      });
      var btn = $('[data-submit]', api.el); btn.disabled = true;
      Promise.resolve().then(function () { return o.onSubmit(cur); }).then(function (res) {
        if (res !== false) api.close(true); else btn.disabled = false;
      }).catch(function (err) {
        btn.disabled = false; var fe = $('.form-error', form); fe.textContent = (err && err.message) || 'Gagal menyimpan.'; fe.hidden = false;
      });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    api = modal({
      title: o.title, size: o.size || 'md', body: form,
      footer: '<button class="btn btn-ghost" data-close type="button">Batal</button><button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-submit type="button">' + esc(o.submitText || 'Simpan') + '</button>'
    });
    $('[data-submit]', api.el).onclick = submit;
    return api;
  }

  /* ---------- state kosong / loading / error ---------- */
  var UI = {
    empty: function (icon, title, text, action) {
      return '<div class="state"><div class="state-ic">' + ic(icon || 'inbox') + '</div><h4>' + esc(title) + '</h4>' + (text ? '<p>' + esc(text) + '</p>' : '') + (action || '') + '</div>';
    },
    error: function (msg, retryAct) {
      return '<div class="state state-error"><div class="state-ic">' + ic('triangle-alert') + '</div><h4>Terjadi masalah</h4><p>' + esc(msg || 'Data tidak dapat dimuat.') + '</p>' + (retryAct ? '<button class="btn btn-soft" data-act="' + retryAct + '">' + ic('refresh-cw') + ' Coba lagi</button>' : '') + '</div>';
    },
    loading: function (n) {
      var s = ''; for (var i = 0; i < (n || 3); i++) s += '<div class="skeleton"></div>';
      return '<div class="skeleton-wrap" aria-busy="true" aria-label="Memuat">' + s + '</div>';
    },
    badge: function (text, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(text) + '</span>'; }
  };

  /** Tabel responsif: di HP berubah jadi kartu. cols: [{label,key,render,align,cls,primary}] */
  function table(cols, rows, o) {
    o = o || {};
    if (!rows.length) return UI.empty(o.icon || 'inbox', o.emptyTitle || 'Belum ada data', o.emptyText || '', o.emptyAction);
    return '<div class="table-wrap"><table class="tbl' + (o.cls ? ' ' + o.cls : '') + '"><thead><tr>' +
      cols.map(function (c) { return '<th class="' + (c.align === 'right' ? 'ta-r ' : c.align === 'center' ? 'ta-c ' : '') + (c.cls || '') + '">' + (c.label || '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr' + (o.rowAttr ? ' ' + o.rowAttr(r, i) : '') + '>' + cols.map(function (c) {
          var v = c.render ? c.render(r, i) : esc(r[c.key]);
          return '<td data-label="' + esc(c.label || '') + '" class="' + (c.align === 'right' ? 'ta-r ' : c.align === 'center' ? 'ta-c ' : '') + (c.primary ? 'td-primary ' : '') + (c.cls || '') + '">' + v + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- foto makanan (foto unggahan atau ilustrasi pengganti) ---------- */
  var thumbCache = {};
  function foodImg(m) {
    if (m && m.image) return m.image;
    var key = (m && (m.id + m.emoji)) || 'x';
    if (thumbCache[key]) return thumbCache[key];
    var c = (m && m.colors) || ['#cfd8d3', '#7c8c85'], e = (m && m.emoji) || '🍽️';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="200" cy="150" r="108" fill="rgba(255,255,255,.16)"/><circle cx="200" cy="150" r="84" fill="rgba(255,255,255,.14)"/><text x="200" y="198" font-size="120" text-anchor="middle">' + e + '</text></svg>';
    return (thumbCache[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }

  /* ---------- autentikasi DEMO (bukan untuk produksi) ---------- */
  var ROLE_NAMES = { owner: 'Owner', cashier: 'Kasir' };
  var PERMS = {
    owner: '*',
    cashier: ['dashboard', 'orders', 'manual', 'kitchen', 'pay', 'orders.cancel']
  };
  var Auth = {
    KEY: 'qmo:session', TTL: 12 * 3600 * 1000,
    roleName: function (r) { return ROLE_NAMES[r] || r; },
    current: function () {
      try {
        var s = JSON.parse(localStorage.getItem(Auth.KEY) || 'null');
        if (!s || Date.now() - s.at > Auth.TTL || !PERMS[s.role]) return null;
        return s;
      } catch (e) { return null; }
    },
    login: function (username, pin) {
      var u = Store.getUsers().filter(function (x) { return x.active !== false && x.username.toLowerCase() === String(username || '').trim().toLowerCase(); })[0];
      if (!u || !PERMS[u.role] || String(u.pin) !== String(pin)) throw new Error('Username atau PIN salah.');
      var s = { userId: u.id, name: u.name, username: u.username, role: u.role, at: Date.now() };
      try { localStorage.setItem(Auth.KEY, JSON.stringify(s)); } catch (e) { throw new Error('Browser menolak penyimpanan sesi.'); }
      return s;
    },
    logout: function () { try { localStorage.removeItem(Auth.KEY); } catch (e) {} },
    can: function (perm) {
      var s = Auth.current(); if (!s) return false;
      var p = PERMS[s.role]; if (!p) return false;
      if (p === '*') return true;
      if (!perm) return true;
      return p.indexOf(perm) >= 0;
    },
    home: function (role) { return 'admin.html'; },
    /** Guard halaman: arahkan ke login bila belum masuk / tidak berhak. */
    require: function (perm) {
      var s = Auth.current();
      if (!s) { location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.hash)); return null; }
      if (perm && !Auth.can(perm)) { location.replace(Auth.home(s.role) + (Auth.home(s.role) === location.pathname.split('/').pop() ? '#denied' : '')); return null; }
      return s;
    }
  };

  /* ---------- grafik SVG ringan ---------- */
  var Charts = {
    bars: function (data, o) {
      o = o || {}; var W = 640, H = o.height || 240, L = 46, B = 28, T = 12, R = 8;
      var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
      var step = Math.pow(10, Math.floor(Math.log10(max))); var top = Math.ceil(max / step) * step; if (top < max) top = max;
      var iw = W - L - R, ih = H - B - T, bw = iw / Math.max(data.length, 1);
      var g = '';
      for (var i = 0; i <= 4; i++) {
        var y = T + ih - (ih * i / 4), val = top * i / 4;
        g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="ch-grid"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" class="ch-ax" text-anchor="end">' + compact(val) + '</text>';
      }
      var every = Math.ceil(data.length / (o.maxLabels || 12));
      var bars = data.map(function (d, i) {
        var h = ih * d.value / top, x = L + i * bw + bw * 0.16, w = bw * 0.68;
        return '<g><rect x="' + x + '" y="' + (T + ih - h) + '" width="' + w + '" height="' + Math.max(h, d.value ? 1 : 0) + '" rx="3" class="ch-bar"><title>' + esc(d.label) + ': ' + esc(o.fmt ? o.fmt(d.value) : d.value) + '</title></rect>' +
          (i % every === 0 ? '<text x="' + (x + w / 2) + '" y="' + (H - 8) + '" class="ch-ax" text-anchor="middle">' + esc(d.label) + '</text>' : '') + '</g>';
      }).join('');
      return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Grafik batang') + '" preserveAspectRatio="xMidYMid meet">' + g + bars + '</svg>';
    },
    donut: function (data, o) {
      o = o || {}; var total = data.reduce(function (s, d) { return s + d.value; }, 0);
      var R = 54, C = 2 * Math.PI * R, off = 0, segs = '';
      if (!total) segs = '<circle cx="70" cy="70" r="' + R + '" class="ch-ring-empty"/>';
      else data.forEach(function (d) {
        if (!d.value) return; var len = C * d.value / total;
        segs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + d.color + '" stroke-width="18" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"><title>' + esc(d.label) + ': ' + d.value + '</title></circle>'; off += len;
      });
      var legend = data.map(function (d) { return '<li><i style="background:' + d.color + '"></i><span>' + esc(d.label) + '</span><b>' + (total ? Math.round(d.value * 100 / total) : 0) + '%</b></li>'; }).join('');
      return '<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="' + esc(o.label || 'Grafik donat') + '">' + segs + '<text x="70" y="66" text-anchor="middle" class="ch-big">' + esc(o.center != null ? o.center : total) + '</text><text x="70" y="84" text-anchor="middle" class="ch-ax">' + esc(o.sub || 'total') + '</text></svg><ul class="legend">' + legend + '</ul></div>';
    },
    hbars: function (data, o) {
      o = o || {}; var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
      return '<ul class="hbars">' + data.map(function (d) {
        return '<li><div class="hb-top"><span>' + esc(d.label) + '</span><b>' + esc(o.fmt ? o.fmt(d.value) : d.value) + '</b></div><div class="hb-track"><div class="hb-fill" style="width:' + Math.max(2, d.value * 100 / max) + '%"></div></div></li>';
      }).join('') + '</ul>';
    }
  };
  var PALETTE = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

  /* ---------- CSV, unduh, cetak ---------- */
  function csvCell(v) { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadBlob(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csv(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    downloadBlob(name, new Blob([text], { type: 'text/csv;charset=utf-8' }));
    toast('File ' + name + ' diunduh.', 'success');
  }
  function printHtml(html, title) {
    var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    var d = f.contentWindow.document; d.open(); d.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + esc(title || 'Cetak') + '</title></head><body>' + html + '</body></html>'); d.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Tidak dapat membuka dialog cetak.', 'error'); } setTimeout(function () { f.remove(); }, 2000); }, 350);
  }

  /* ---------- suara notifikasi ---------- */
  var Sound = {
    ctx: null,
    unlock: function () { try { if (!Sound.ctx) Sound.ctx = new (global.AudioContext || global.webkitAudioContext)(); if (Sound.ctx.state === 'suspended') Sound.ctx.resume(); return true; } catch (e) { return false; } },
    beep: function () {
      if (!Sound.unlock()) return;
      var c = Sound.ctx, t = c.currentTime;
      [880, 1174].forEach(function (f, i) {
        var o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.18); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
        o.connect(g); g.connect(c.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.18);
      });
    }
  };

  /* ---------- url dasar & tautan ---------- */
  function baseUrl() {
    var s = Store.getSettings();
    var b = (s.baseUrl || '').trim();
    if (b) return b.replace(/\/+$/, '') + '/';
    var p = location.href.split('#')[0].split('?')[0];
    return p.slice(0, p.lastIndexOf('/') + 1);
  }
  function tableUrl(code) { return baseUrl() + 'menu.html?table=' + encodeURIComponent(code); }
  function waLink(number, text) { var n = String(number || '').replace(/\D/g, ''); if (n.indexOf('0') === 0) n = '62' + n.slice(1); return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : ''); }

  /* ---------- penanganan error global ---------- */
  var lastErr = 0;
  global.addEventListener('error', function (e) {
    console.error(e.error || e.message);
    if (Date.now() - lastErr > 4000) { lastErr = Date.now(); toast('Terjadi kesalahan tak terduga. Muat ulang halaman bila masalah berlanjut.', 'error'); }
  });
  global.addEventListener('unhandledrejection', function (e) {
    console.error(e.reason);
    if (Date.now() - lastErr > 4000) { lastErr = Date.now(); toast((e.reason && e.reason.message) || 'Terjadi kesalahan tak terduga.', 'error'); }
  });

  /* registri tampilan dashboard admin (dipakai dashboard.js + modul lain) */
  global.Admin = { views: {}, register: function (id, def) { def.id = id; Admin.views[id] = def; } };

  global.App = {
    $: $, $$: $$, esc: esc, rp: rp, num: num, compact: compact, fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, isoDate: isoDate, parseISO: parseISO, ago: ago, pad: pad,
    debounce: debounce, delegate: delegate, Range: Range, ic: ic, refreshIcons: refreshIcons, Theme: Theme, toast: toast, fail: fail,
    modal: modal, confirm: confirmDialog, formModal: formModal, UI: UI, table: table, foodImg: foodImg, Auth: Auth, ROLE_NAMES: ROLE_NAMES,
    Charts: Charts, PALETTE: PALETTE, csv: csv, downloadBlob: downloadBlob, printHtml: printHtml, Sound: Sound, baseUrl: baseUrl, tableUrl: tableUrl, waLink: waLink
  };

  document.addEventListener('DOMContentLoaded', function () {
    Theme.init(document.documentElement.getAttribute('data-default-theme'));
    // Banner jika localStorage tidak tersedia
    if (!Store.storageAvailable) toast('LocalStorage dinonaktifkan di browser ini. Data hanya tersimpan sementara.', 'warn', 8000);
    refreshIcons();
  });
})(window);
