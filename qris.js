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
  /** Dialog pembayaran QRIS (pelanggan / kasir) */
  function open(orderId) {
    var o = Store.getOrder(orderId); if (!o) return App.toast('Pesanan tidak ditemukan.', 'error');
    if (o.payStatus === 'paid') return App.toast('Pesanan ini sudah tercatat dibayar.', 'success');
    if (o.status === 'cancelled') return App.toast('Pesanan dibatalkan.', 'error');
    if (!cfg().enabled) return App.toast('QRIS belum diaktifkan. Hubungi kasir.', 'error');
    App.modal({ title: 'Bayar dengan QRIS · ' + o.number, size: 'sm', body: cardHtml(o) });
  }
  global.QRIS = { crc16: crc16, validate: validate, dynamic: dynamic, cfg: cfg, svg: svg, cardHtml: cardHtml, open: open };
})(window);
