/* ==========================================================================
   qr.js — QR Code (qrcode-generator) + Manajemen Meja + halaman QR Code
   QR berisi tautan NYATA ke menu.html?table=KODE (berdasarkan Base URL).
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, $$ = App.$$, esc = App.esc, rp = App.rp, ic = App.ic;

  var QR = {
    make: function (text) {
      if (typeof global.qrcode !== 'function') throw new Error('Library QR belum termuat (vendor/qrcode.js).');
      var q = global.qrcode(0, 'M'); q.addData(text); q.make(); return q;
    },
    /** Data URL (SVG) agar tajam di layar & cetak */
    svg: function (text, o) {
      o = o || {}; var q = QR.make(text), n = q.getModuleCount(), m = o.margin == null ? 2 : o.margin, size = n + m * 2, p = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) p += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + p + '" fill="' + (o.color || '#111') + '"/></svg>';
    },
    dataUrl: function (text, o) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(QR.svg(text, o)); },
    /** Canvas PNG berisi QR + label meja */
    canvas: function (text, label, sub, restName) {
      var q = QR.make(text), n = q.getModuleCount(), cell = Math.max(6, Math.floor(560 / n)), qs = cell * n, pad = 40;
      var W = qs + pad * 2, H = qs + pad * 2 + 150, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#e11d2e'; x.fillRect(0, 0, W, 14);
      x.fillStyle = '#111'; x.textAlign = 'center'; x.font = '700 26px Inter,Arial,sans-serif'; x.fillText(restName || '', W / 2, 62, W - 40);
      for (var r = 0; r < n; r++) for (var cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect(pad + cc * cell, 84 + r * cell, cell, cell);
      x.font = '800 44px Inter,Arial,sans-serif'; x.fillStyle = '#9b0f1a'; x.fillText(label, W / 2, 84 + qs + 56);
      x.font = '500 20px Inter,Arial,sans-serif'; x.fillStyle = '#444'; x.fillText(sub || 'Scan QR untuk memesan dari meja', W / 2, 84 + qs + 90);
      return c;
    },
    downloadPng: function (text, label, fileName) {
      try {
        var c = QR.canvas(text, label, null, Store.getSettings().restaurant.name);
        c.toBlob(function (b) { if (!b) { App.toast('Gagal membuat PNG.', 'error'); return; } App.downloadBlob(fileName + '.png', b); App.toast('QR ' + label + ' diunduh (PNG).'); }, 'image/png');
      } catch (e) { App.fail(e); }
    },
    printCards: function (items) {
      var r = Store.getSettings().restaurant;
      var css = '<style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}.card{border:2px solid #e11d2e;border-radius:14px;padding:8mm 6mm;text-align:center;break-inside:avoid;page-break-inside:avoid}.card h1{font-size:18px;margin:0 0 2px}.card p{margin:0;font-size:12px;color:#444}.card img{width:62mm;height:62mm;margin:5mm auto}.scan{font-weight:800;font-size:20px;letter-spacing:.5px}.meja{display:inline-block;background:#e11d2e;color:#fff;font-weight:800;font-size:26px;padding:3px 18px;border-radius:10px;margin-top:3mm}.steps{font-size:11px;color:#555;margin-top:4mm}.url{font-size:9px;color:#777;word-break:break-all;margin-top:3mm}</style>';
      var html = css + '<div class="grid">' + items.map(function (it) {
        return '<div class="card"><h1>' + esc(r.name) + '</h1><p>' + esc(r.tagline || '') + '</p><img alt="QR ' + esc(it.label) + '" src="' + QR.dataUrl(it.url) + '"><div class="scan">SCAN QR · PESAN DARI MEJA</div><div class="meja">' + esc(it.label.toUpperCase()) + '</div><div class="steps">Pilih menu → Pesan → Tunggu → Nikmati</div><div class="url">' + esc(it.url) + '</div></div>';
      }).join('') + '</div>';
      App.printHtml(html, 'QR Meja');
    },
    warnBase: function () {
      var b = App.baseUrl();
      if (/^file:/i.test(b)) return 'Alamat saat ini memakai file:// sehingga QR tidak akan terbuka di HP. Atur Base URL ke alamat publik (mis. GitHub Pages).';
      if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|\.local/i.test(b)) return 'Base URL masih alamat lokal. QR hanya dapat dibuka dari perangkat di jaringan yang sama. Atur Base URL ke alamat publik sebelum mencetak.';
      return '';
    }
  };
  global.QR = QR;

  /* ---------- helper meja ---------- */
  function tableStats(t) {
    var orders = Store.getOrders().filter(function (o) { return o.tableCode === t.code; });
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var today = orders.filter(function (o) { return o.createdAt >= d0.getTime() && o.status !== 'cancelled'; }).length;
    var active = orders.filter(function (o) { return Orders.ACTIVE.indexOf(o.status) >= 0 || (o.status === 'done' && o.payStatus === 'unpaid'); }).length;
    return { total: orders.length, today: today, active: active };
  }
  function tableStatus(t) {
    if (!t.active) return { label: 'Tidak Aktif', cls: 'muted' };
    return tableStats(t).active ? { label: 'Terisi', cls: 'warn' } : { label: 'Aktif', cls: 'success' };
  }
  function nextTableNo() {
    var max = 0; Store.getTables().forEach(function (t) { var m = /(\d+)$/.exec(t.code); if (m) max = Math.max(max, +m[1]); });
    return max + 1;
  }

  function tableForm(t, done) {
    var isNew = !t, n = nextTableNo(), pad = ('0' + n).slice(-2);
    var v = t ? Object.assign({}, t) : { name: 'Meja ' + pad, code: 'MEJA-' + pad, capacity: 4, active: true };
    App.formModal({
      title: isNew ? 'Tambah Meja' : 'Edit Meja', size: 'sm', values: v,
      fields: [
        { name: 'name', label: 'Nama / nomor meja', required: true, maxlength: 30, placeholder: 'Meja 09' },
        { name: 'code', label: 'Kode untuk QR', required: true, pattern: '^[A-Za-z0-9\\-_]{2,24}$', patternMsg: 'Hanya huruf, angka, minus (-), atau garis bawah (_).', hint: 'Dipakai pada tautan QR: menu.html?table=KODE. Mengubah kode akan mengubah isi QR — cetak ulang QR-nya.' },
        { name: 'capacity', label: 'Kapasitas (orang)', type: 'number', min: 1, max: 50, step: 1 },
        { name: 'active', type: 'checkbox', text: 'Meja aktif (dapat dipesan)' }
      ],
      onSubmit: function (c) {
        Store.saveTable(Object.assign({}, t || {}, { name: c.name, code: c.code.toUpperCase(), capacity: c.capacity || 4, active: !!c.active }));
        App.toast('Meja disimpan.'); done();
      }
    });
  }

  /* ---------- Manajemen Meja ---------- */
  Admin.register('tables', {
    title: 'Manajemen Meja', sub: 'Atur meja dan QR Code untuk setiap meja', perm: 'tables',
    render: function (root, ctx) {
      var tables = Store.getTables();
      ctx.actions('<button class="btn btn-soft" data-act="print-all">' + ic('printer') + '<span>Cetak Semua QR</span></button><button class="btn btn-primary" data-act="add">' + ic('plus') + '<span>Tambah Meja</span></button>');
      var warn = QR.warnBase();
      var cards = tables.map(function (t) {
        var st = tableStatus(t), stat = tableStats(t), url = App.tableUrl(t.code);
        return '<article class="table-card' + (t.active ? '' : ' off') + '"><header><h3>' + esc(t.name) + '</h3><span class="badge ' + st.cls + '">' + st.label + '</span>' +
          '<div class="menu-pop"><button class="icon-btn sm" data-act="menu" aria-haspopup="true" aria-label="Opsi ' + esc(t.name) + '">' + ic('ellipsis-vertical') + '</button><div class="pop" hidden><button data-act="edit" data-id="' + t.id + '">' + ic('pencil') + 'Edit</button><button data-act="toggle" data-id="' + t.id + '">' + ic(t.active ? 'eye-off' : 'eye') + (t.active ? 'Nonaktifkan' : 'Aktifkan') + '</button><button class="danger" data-act="del" data-id="' + t.id + '">' + ic('trash-2') + 'Hapus</button></div></div></header>' +
          '<button class="qr-box" data-act="preview" data-id="' + t.id + '" aria-label="Perbesar QR ' + esc(t.name) + '"><img src="' + QR.dataUrl(url) + '" alt="QR Code ' + esc(t.name) + '"></button>' +
          '<div class="tc-meta"><span>' + ic('receipt') + stat.today + ' pesanan hari ini</span><span>' + ic('users') + t.capacity + ' kursi</span></div>' +
          '<div class="tc-btns"><button class="btn btn-soft btn-sm" data-act="dl" data-id="' + t.id + '">' + ic('download') + 'Download</button><button class="btn btn-soft btn-sm" data-act="print" data-id="' + t.id + '">' + ic('printer') + 'Cetak</button></div></article>';
      }).join('');
      root.innerHTML = (warn ? '<div class="notice warn">' + ic('triangle-alert') + '<span>' + esc(warn) + ' <a href="#/qr">Atur Base URL</a></span></div>' : '') +
        (tables.length ? '<div class="table-grid-cards">' + cards + '</div>' : '<div class="card">' + App.UI.empty('armchair', 'Belum ada meja', 'Tambahkan meja pertama untuk membuat QR Code.', '<button class="btn btn-primary" data-act="add">Tambah Meja</button>') + '</div>');
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      var closePops = function () { $$('.pop', root).forEach(function (p) { p.hidden = true; }); };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) { closePops(); return; }
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), t = id ? Store.get('tables', id) : null;
        if (act === 'menu') { var pop = $('.pop', b.parentNode), was = pop.hidden; closePops(); pop.hidden = !was; return; }
        closePops();
        if (act === 'add') tableForm(null, keep);
        else if (act === 'edit') tableForm(t, keep);
        else if (act === 'toggle') { t.active = !t.active; Store.saveTable(t); App.toast(t.active ? t.name + ' diaktifkan.' : t.name + ' dinonaktifkan.'); keep(); }
        else if (act === 'del') App.confirm({ title: 'Hapus meja?', message: t.name + ' akan dihapus. QR yang sudah dicetak untuk meja ini tidak akan berfungsi lagi. Riwayat pesanan tetap tersimpan.', confirmText: 'Hapus', danger: true }).then(function (ok) { if (ok) { Store.deleteTable(id); App.toast('Meja dihapus.'); keep(); } });
        else if (act === 'dl') QR.downloadPng(App.tableUrl(t.code), t.name, 'qr-' + t.code.toLowerCase());
        else if (act === 'print') QR.printCards([{ label: t.name, url: App.tableUrl(t.code) }]);
        else if (act === 'print-all') QR.printCards(Store.getTables().filter(function (x) { return x.active; }).map(function (x) { return { label: x.name, url: App.tableUrl(x.code) }; }));
        else if (act === 'preview') previewQR(t);
      };
    }
  });

  function previewQR(t) {
    var url = App.tableUrl(t.code);
    var body = '<div class="qr-prev"><img src="' + QR.dataUrl(url) + '" alt="QR ' + esc(t.name) + '"><h3>' + esc(t.name) + '</h3><div class="url-box"><code>' + esc(url) + '</code><button class="icon-btn sm" data-copy aria-label="Salin tautan">' + ic('copy') + '</button></div><div class="btn-row"><a class="btn btn-soft" href="' + esc(url) + '" target="_blank" rel="noopener">' + ic('external-link') + 'Buka Tautan</a><button class="btn btn-soft" data-dl>' + ic('download') + 'PNG</button><button class="btn btn-primary" data-pr>' + ic('printer') + 'Cetak</button></div></div>';
    var m = App.modal({ title: 'QR Code · ' + t.name, body: body, size: 'sm' });
    $('[data-dl]', m.el).onclick = function () { QR.downloadPng(url, t.name, 'qr-' + t.code.toLowerCase()); };
    $('[data-pr]', m.el).onclick = function () { QR.printCards([{ label: t.name, url: url }]); };
    $('[data-copy]', m.el).onclick = function () { copy(url); };
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { App.toast('Tautan disalin.'); }, function () { App.toast('Gagal menyalin tautan.', 'error'); });
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); App.toast('Tautan disalin.'); } catch (e) { App.toast('Gagal menyalin tautan.', 'error'); } ta.remove(); }
  }

  /* ---------- QR Code (pembuat QR khusus + base URL) ---------- */
  var sel = { code: null };
  Admin.register('qr', {
    title: 'QR Code', sub: 'Buat, unduh, dan cetak QR untuk meja tertentu', perm: 'qr',
    render: function (root, ctx) {
      var tables = Store.getTables(), s = Store.getSettings();
      var options = tables.map(function (t) { return { code: t.code, name: t.name + (t.active ? '' : ' (nonaktif)'), label: t.name }; }).concat([{ code: 'BUNGKUS', name: 'Pesanan bungkus (tanpa meja)', label: 'Bungkus' }]);
      if (!sel.code || !options.some(function (o) { return o.code === sel.code; })) sel.code = options[0].code;
      var cur = options.filter(function (o) { return o.code === sel.code; })[0];
      var url = sel.code === 'BUNGKUS' ? App.baseUrl() + 'menu.html?type=takeaway' : App.tableUrl(sel.code);
      var warn = QR.warnBase();
      ctx.actions('<button class="btn btn-soft" data-act="print-all">' + ic('printer') + '<span>Cetak Semua QR</span></button>');
      root.innerHTML = '<div class="grid-2 qr-page"><section class="card"><div class="card-head"><h3>Pengaturan Alamat (Base URL)</h3></div>' +
        '<p class="muted">QR berisi alamat lengkap menu. Saat website dipublikasikan (GitHub Pages atau domain sendiri), isi alamat folder aplikasi di sini, lalu cetak ulang QR.</p>' +
        '<div class="field"><label for="baseUrl">Base URL</label><input id="baseUrl" type="url" placeholder="https://username.github.io/qr-menu-order/" value="' + esc(s.baseUrl || '') + '"><small class="hint">Kosongkan untuk memakai alamat halaman saat ini: <code>' + esc(App.baseUrl()) + '</code></small><small class="err" id="baseErr" role="alert"></small></div>' +
        '<div class="btn-row"><button class="btn btn-primary" data-act="save-base">' + ic('save') + 'Simpan Base URL</button><button class="btn btn-ghost" data-act="reset-base">Pakai otomatis</button></div>' +
        (warn ? '<div class="notice warn">' + ic('triangle-alert') + '<span>' + esc(warn) + '</span></div>' : '<div class="notice info">' + ic('circle-check') + '<span>Base URL terlihat publik. Pindai QR dengan HP untuk memastikan menu terbuka.</span></div>') +
        '<div class="field"><label for="qrSel">Pilih meja</label><select id="qrSel">' + options.map(function (o) { return '<option value="' + esc(o.code) + '"' + (o.code === sel.code ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></div></section>' +
        '<section class="card qr-big"><div class="card-head"><h3>Pratinjau · ' + esc(cur.label) + '</h3></div><div class="qr-prev"><img src="' + QR.dataUrl(url) + '" alt="QR Code ' + esc(cur.label) + '"><div class="url-box"><code>' + esc(url) + '</code><button class="icon-btn sm" data-act="copy" aria-label="Salin tautan">' + ic('copy') + '</button></div>' +
        '<div class="btn-row"><a class="btn btn-soft" href="' + esc(url) + '" target="_blank" rel="noopener">' + ic('external-link') + 'Uji Buka Tautan</a><button class="btn btn-soft" data-act="dl">' + ic('download') + 'Unduh PNG</button><button class="btn btn-primary" data-act="print">' + ic('printer') + 'Cetak</button></div></div></section></div>';
      App.refreshIcons();
      root.onchange = function (e) { if (e.target.id === 'qrSel') { sel.code = e.target.value; ctx.rerender(); } };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'save-base') {
          var v = $('#baseUrl', root).value.trim(), err = $('#baseErr', root);
          if (v && !/^https?:\/\/[^\s]+$/i.test(v)) { err.textContent = 'Masukkan alamat yang diawali http:// atau https://'; return; }
          err.textContent = ''; var ss = Store.getSettings(); ss.baseUrl = v; Store.saveSettings(ss); App.toast('Base URL disimpan. Cetak ulang QR bila alamat berubah.'); ctx.rerender();
        } else if (act === 'reset-base') { var s2 = Store.getSettings(); s2.baseUrl = ''; Store.saveSettings(s2); App.toast('Base URL otomatis dipakai.'); ctx.rerender(); }
        else if (act === 'copy') copy(url);
        else if (act === 'dl') QR.downloadPng(url, cur.label, 'qr-' + sel.code.toLowerCase());
        else if (act === 'print') QR.printCards([{ label: cur.label, url: url }]);
        else if (act === 'print-all') QR.printCards(Store.getTables().filter(function (x) { return x.active; }).map(function (x) { return { label: x.name, url: App.tableUrl(x.code) }; }));
      };
    }
  });
})(window);
