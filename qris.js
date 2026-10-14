/* ==========================================================================
   qris.js — Pembayaran QRIS
   - Membaca payload QRIS statis milik merchant (Pengaturan → Pembayaran).
   - Mengubahnya menjadi QRIS DINAMIS berisi nominal pesanan (tag 01=12, tag 54=nominal, CRC16 dihitung ulang).
   - Pelanggan memindai dengan GoPay/OVO/DANA/m-banking mana pun.
   JUJUR: aplikasi ini tidak tersambung ke penyedia pembayaran, sehingga TIDAK bisa mendeteksi
   pembayaran otomatis. Kasir wajib memastikan dana masuk di aplikasi merchant, lalu menekan "Catat Pembayaran".
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, esc = App.esc, rp = App.rp, ic = App.ic;

  function crc16(str) {
    var crc = 0xFFFF;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
  }
  function parse(p) {
    var out = [], i = 0;
    while (i < p.length) {
      var id = p.substr(i, 2), len = parseInt(p.substr(i + 2, 2), 10);
      if (!/^\d{2}$/.test(id) || isNaN(len) || i + 4 + len > p.length) throw new Error('Format QRIS tidak valid.');
      out.push({ id: id, val: p.substr(i + 4, len) }); i += 4 + len;
    }
    return out;
  }
  function build(tags) { return tags.map(function (t) { return t.id + ('0' + t.val.length).slice(-2) + t.val; }).join(''); }
  /** Validasi payload QRIS (struktur + CRC). Mengembalikan {ok, error} */
  function validate(p) {
    p = (p || '').trim();
    if (p.length < 40 || p.indexOf('000201') !== 0) return { ok: false, error: 'Payload QRIS harus diawali 000201.' };
    try { var tags = parse(p); } catch (e) { return { ok: false, error: e.message }; }
    var last = tags[tags.length - 1];
    if (!last || last.id !== '63') return { ok: false, error: 'Payload QRIS tidak berakhir dengan CRC (tag 63).' };
    if (crc16(p.slice(0, -4)) !== last.val.toUpperCase()) return { ok: false, error: 'CRC QRIS tidak cocok — payload rusak atau tidak lengkap.' };
    return { ok: true, tags: tags };
  }
  /** QRIS dinamis dengan nominal (rupiah bulat) */
  function dynamic(payload, amount) {
    var v = validate(payload); if (!v.ok) throw new Error(v.error);
    amount = Math.round(Number(amount)); if (!(amount > 0)) throw new Error('Nominal QRIS tidak valid.');
    var tags = v.tags.filter(function (t) { return t.id !== '63' && t.id !== '54'; });
    tags.forEach(function (t) { if (t.id === '01') t.val = '12'; });
    var at = -1; tags.forEach(function (t, i) { if (t.id === '53') at = i; });
    tags.splice(at + 1, 0, { id: '54', val: String(amount) });
    var body = build(tags) + '6304';
    return body + crc16(body);
  }
  function cfg() {
    var q = Store.getSettings().qris || {};
    return { enabled: q.enabled !== false && !!q.payload, payload: q.payload || '', merchant: q.merchant || '', nmid: q.nmid || '', dynamic: q.dynamic !== false };
  }
  function svg(text) {
    var q = global.qrcode(0, 'M'); q.addData(text); q.make();
    var n = q.getModuleCount(), m = 2, size = n + m * 2, p = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) p += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QRIS"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + p + '" fill="#111"/></svg>';
  }
  /** HTML kartu QRIS untuk satu pesanan */
  function cardHtml(o) {
    var c = cfg(), code;
    try { code = c.dynamic ? dynamic(c.payload, o.total) : c.payload; } catch (e) { return '<div class="notice danger">' + ic('triangle-alert') + '<span>QRIS belum dapat ditampilkan: ' + esc(e.message) + '</span></div>'; }
    return '<div class="qris-card"><div class="qris-head"><b>QRIS</b><small>QR Code Standar Pembayaran Nasional</small></div>' +
      '<p class="qris-merchant">' + esc(c.merchant) + '</p>' + (c.nmid ? '<small class="muted">NMID: ' + esc(c.nmid) + '</small>' : '') +
      '<div class="qris-qr">' + svg(code) + '</div>' +
      '<div class="qris-amount"><small>' + (c.dynamic ? 'Nominal otomatis terisi' : 'Masukkan nominal sendiri') + '</small><b>' + rp(o.total) + '</b></div>' +
      '<p class="muted small">Buka GoPay, OVO, DANA, ShopeePay, atau m-banking → Scan QR → pastikan nominal <b>' + rp(o.total) + '</b> → bayar. Setelah itu tunjukkan bukti bayar ke kasir. Status akan berubah menjadi <b>Dibayar</b> setelah kasir memastikan dana masuk.</p></div>';
  }

  /** Gambar PNG kartu QRIS (QR + merchant + nominal) untuk diunduh / dibagikan */
  function canvas(code, o) {
    var q = global.qrcode(0, 'M'); q.addData(code); q.make();
    var n = q.getModuleCount(), cell = Math.max(6, Math.floor(620 / n)), qs = cell * n, pad = 56, W = qs + pad * 2, top = 210, bottom = o.amount ? 190 : 120, H = top + qs + bottom;
    var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    x.fillStyle = '#00b4e0'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; rr(x, 24, 24, W - 48, H - 48, 36); x.fill();
    x.fillStyle = '#e8213f'; x.fillRect(24, 24, W - 48, 12);
    x.textAlign = 'center'; x.fillStyle = '#111';
    x.font = '900 54px Inter,Arial,sans-serif'; x.fillText('QRIS', W / 2, 108);
    x.font = '500 20px Inter,Arial,sans-serif'; x.fillStyle = '#555'; x.fillText('QR Code Standar Pembayaran Nasional', W / 2, 138);
    x.fillStyle = '#111'; x.font = '800 26px Inter,Arial,sans-serif'; x.fillText((o.merchant || '').toUpperCase(), W / 2, 178, W - 80);
    if (o.nmid) { x.font = '500 18px Inter,Arial,sans-serif'; x.fillStyle = '#555'; x.fillText('NMID: ' + o.nmid, W / 2, 202); }
    x.fillStyle = '#fff'; x.fillRect(pad - 12, top - 6, qs + 24, qs + 12); x.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect(pad + cc * cell, top + 6 + r * cell, cell, cell);
    var y = top + qs + 52; x.fillStyle = '#111';
    if (o.amount) { x.font = '500 22px Inter,Arial,sans-serif'; x.fillStyle = '#555'; x.fillText('Total bayar' + (o.number ? ' · ' + o.number : ''), W / 2, y); x.font = '900 48px Inter,Arial,sans-serif'; x.fillStyle = '#9b0f1a'; x.fillText(rp(o.amount), W / 2, y + 54); y += 96; }
    x.font = '500 18px Inter,Arial,sans-serif'; x.fillStyle = '#666'; x.fillText('Scan dengan GoPay, OVO, DANA, ShopeePay atau m-banking', W / 2, y, W - 80);
    return c;
  }
  function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  /** Unduh gambar QRIS pesanan (dengan nominal) */
  function download(orderId) {
    var o = Store.getOrder(orderId), c = cfg(); if (!o) return;
    var code; try { code = c.dynamic ? dynamic(c.payload, o.total) : c.payload; } catch (e) { return App.toast(e.message, 'error'); }
    canvas(code, { merchant: c.merchant, nmid: c.nmid, amount: c.dynamic ? o.total : 0, number: o.number }).toBlob(function (b) {
      if (!b) return App.toast('Gagal membuat gambar.', 'error');
      App.downloadBlob('QRIS-' + String(o.number).replace(/[^A-Za-z0-9-]/g, '') + '.png', b); App.toast('Gambar QRIS diunduh.', 'success');
    }, 'image/png');
  }
  /** Unduh QRIS statis merchant (tanpa nominal) — untuk dicetak di meja / kasir */
  function downloadStatic() {
    var c = cfg(); if (!c.payload) return App.toast('QRIS belum diisi.', 'error');
    canvas(c.payload, { merchant: c.merchant, nmid: c.nmid, amount: 0 }).toBlob(function (b) { App.downloadBlob('QRIS-statis.png', b); App.toast('Gambar QRIS diunduh.', 'success'); }, 'image/png');
  }
  /** Dialog pembayaran QRIS (pelanggan / kasir) */
  function open(orderId) {
    var o = Store.getOrder(orderId); if (!o) return App.toast('Pesanan tidak ditemukan.', 'error');
    if (o.payStatus === 'paid') return App.toast('Pesanan ini sudah tercatat dibayar.', 'success');
    if (o.status === 'cancelled') return App.toast('Pesanan dibatalkan.', 'error');
    if (!cfg().enabled) return App.toast('QRIS belum diaktifkan. Hubungi kasir.', 'error');
    var m = App.modal({ title: 'Bayar dengan QRIS · ' + o.number, size: 'sm', body: cardHtml(o), footer: '<button class="btn btn-primary btn-block" data-dl>' + ic('download') + 'Unduh Gambar QRIS</button>' });
    m.el.addEventListener('click', function (e) { if (e.target.closest('[data-dl]')) download(o.id); });
  }
  global.QRIS = { download: download, downloadStatic: downloadStatic, canvas: canvas, crc16: crc16, validate: validate, dynamic: dynamic, cfg: cfg, svg: svg, cardHtml: cardHtml, open: open };
})(window);
