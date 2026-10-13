/* ==========================================================================
   orders.js — mesin pesanan + pembayaran + tampilan:
   - Admin: Manajemen Pesanan, Pesanan QR, Pesanan Manual (Kasir)
   - Halaman order.html (lacak pesanan pelanggan)
   - Halaman kitchen.html (dashboard dapur)
   Status pesanan dan status pembayaran DIPISAH.
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, $$ = App.$$, esc = App.esc, rp = App.rp, ic = App.ic;

  var STATUS = { pending: 'Menunggu konfirmasi', confirmed: 'Dikonfirmasi', cooking: 'Diproses dapur', ready: 'Siap disajikan', serving: 'Sedang diantar', done: 'Selesai', cancelled: 'Dibatalkan' };
  var PAY = { unpaid: 'Belum dibayar', paid: 'Dibayar', refunded: 'Pengembalian dana', cancelled: 'Dibatalkan' };
  var NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['cooking', 'cancelled'], cooking: ['ready', 'cancelled'], ready: ['serving', 'done', 'cancelled'], serving: ['done', 'cancelled'], done: [], cancelled: [] };
  var ACTIVE = ['pending', 'confirmed', 'cooking', 'ready', 'serving'];
  var STATUS_CLS = { pending: 'warn', confirmed: 'info', cooking: 'orange', ready: 'blue', serving: 'blue', done: 'success', cancelled: 'danger' };
  var PAY_CLS = { unpaid: 'warn', paid: 'success', refunded: 'purple', cancelled: 'muted' };

  function payMethodName(id) {
    var m = Store.getSettings().paymentMethods.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : (id || '-');
  }

  var Orders = {
    STATUS: STATUS, PAY: PAY, NEXT: NEXT, ACTIVE: ACTIVE, payMethodName: payMethodName,
    statusBadge: function (o) { return '<span class="badge ' + STATUS_CLS[o.status] + '">' + STATUS[o.status] + '</span>'; },
    payBadge: function (o) { return '<span class="badge ' + PAY_CLS[o.payStatus] + '">' + PAY[o.payStatus] + '</span>'; },

    formatNumber: function (seq, daySeq, s) {
      s = s || Store.getSettings();
      if (s.orderFormat === 'date') {
        var d = new Date(); return (s.orderPrefix || '') + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' + ('000' + daySeq).slice(-3);
      }
      var digits = s.orderDigits || 5; return (s.orderPrefix || '') + ('0000000000' + seq).slice(-digits);
    },

    /**
     * Membuat pesanan baru.
     * payload: {type:'dinein'|'takeaway', tableCode, items:[{menuId,qty,note}], note, allergy, customer:{name,phone}, promoOff?}
     * ctx: {source:'qr'|'manual', by}
     * Melempar Error (pesan bahasa Indonesia) bila tidak valid. Stok dikurangi secara atomik.
     */
    create: function (payload, ctx) {
      ctx = ctx || {};
      var s = Store.getSettings();
      if (!payload || !Array.isArray(payload.items) || !payload.items.length) throw new Error('Keranjang kosong. Pilih minimal satu menu.');
      var type = payload.type === 'takeaway' ? 'takeaway' : 'dinein', table = null;
      if (type === 'dinein') {
        table = Store.getTableByCode(payload.tableCode);
        if (!table) throw new Error('Meja tidak ditemukan. Pilih nomor meja yang benar.');
        if (!table.active) throw new Error(table.name + ' sedang tidak aktif.');
      }
      // gabungkan baris menu yang sama & validasi
      var merged = {}, order = [];
      payload.items.forEach(function (it) {
        var q = Math.floor(Number(it.qty));
        if (!isFinite(q) || q < 1 || q > 99) throw new Error('Jumlah pesanan harus 1–99.');
        if (!merged[it.menuId]) { merged[it.menuId] = { menuId: it.menuId, qty: 0, note: '' }; order.push(it.menuId); }
        merged[it.menuId].qty += q; if (it.note) merged[it.menuId].note = String(it.note).slice(0, 100);
      });
      var lines = [];
      order.forEach(function (id) {
        var it = merged[id], m = Store.getMenu(id);
        if (!m || m.active === false) throw new Error('Salah satu menu sudah tidak tersedia. Muat ulang menu.');
        if (Menu.isSoldOut(m)) throw new Error(m.name + ' sedang habis dan tidak bisa dipesan.');
        if (it.qty > m.stock) throw new Error('Stok ' + m.name + ' tinggal ' + m.stock + '. Kurangi jumlah pesanan.');
        lines.push({ menu: m, qty: it.qty, note: it.note });
      });
      var calc = Pricing.calc(lines, s);
      var now = Date.now();
      return Store.atomic(['orders', 'menus', 'meta'], function () {
        var n = Store.nextOrderSeq();
        var o = {
          id: Store.uid('ord'), number: Orders.formatNumber(n.seq, n.daySeq, s), seq: n.seq,
          type: type, tableCode: table ? table.code : '', tableName: table ? table.name : 'Bungkus',
          source: ctx.source === 'manual' ? 'manual' : 'qr', status: 'pending', payStatus: 'unpaid',
          items: calc.lines.map(function (l) { return { menuId: l.menuId, name: l.name, basePrice: l.basePrice, price: l.price, qty: l.qty, note: l.note, discount: l.discount, promoId: l.promoId, promoName: l.promoName }; }),
          subtotal: calc.subtotal, discount: calc.discount, discounts: calc.discounts, service: calc.service, tax: calc.tax, total: calc.total,
          customer: { name: ((payload.customer || {}).name || '').trim().slice(0, 50), phone: ((payload.customer || {}).phone || '').trim().slice(0, 20) },
          note: (payload.note || '').trim().slice(0, 200), allergy: (payload.allergy || '').trim().slice(0, 120),
          payMethod: '', paidAt: null, paidAmount: 0, createdAt: now, updatedAt: now, createdBy: ctx.by || '',
          history: [{ status: 'pending', at: now, by: ctx.by || '' }]
        };
        Store.saveOrder(o);
        lines.forEach(function (l) { var mm = Store.getMenu(l.menu.id); mm.stock = mm.stock - l.qty; if (mm.stock < 0) throw new Error('Stok ' + mm.name + ' tidak mencukupi.'); Store.saveMenu(mm); });
        return o;
      });
    },

    /** Ubah status pesanan (validasi alur). Pembatalan memakai Orders.cancel. */
    updateStatus: function (id, status, by) {
      var o = Store.getOrder(id); if (!o) throw new Error('Pesanan tidak ditemukan.');
      if (status === 'cancelled') throw new Error('Gunakan fitur pembatalan dengan alasan.');
      if (NEXT[o.status].indexOf(status) < 0) throw new Error('Status tidak dapat diubah dari "' + STATUS[o.status] + '" ke "' + STATUS[status] + '".');
      var now = Date.now(); o.status = status; o.updatedAt = now; o.history.push({ status: status, at: now, by: by || '' });
      Store.saveOrder(o); return o;
    },

    /** Catat pembayaran manual. Tidak boleh ganda; menghasilkan SATU transaksi kas masuk. */
    pay: function (id, info, by) {
      var o = Store.getOrder(id); if (!o) throw new Error('Pesanan tidak ditemukan.');
      if (o.status === 'cancelled') throw new Error('Pesanan yang dibatalkan tidak dapat dibayar.');
      if (o.payStatus === 'paid') throw new Error('Pesanan ini sudah tercatat dibayar.');
      if (o.payStatus !== 'unpaid') throw new Error('Status pembayaran tidak memungkinkan pembayaran baru.');
      var method = info.method;
      if (!Store.getSettings().paymentMethods.some(function (m) { return m.id === method && m.active; })) throw new Error('Metode pembayaran tidak valid.');
      var received = info.received != null && info.received !== '' ? Number(info.received) : o.total;
      if (method === 'cash' && received < o.total) throw new Error('Uang diterima kurang dari total tagihan (' + rp(o.total) + ').');
      return Store.atomic(['orders', 'transactions'], function () {
        var now = Date.now();
        o.payStatus = 'paid'; o.payMethod = method; o.paidAt = now; o.paidAmount = o.total; o.received = method === 'cash' ? received : o.total; o.change = method === 'cash' ? received - o.total : 0; o.payRef = info.ref || ''; o.updatedAt = now;
        o.history.push({ status: 'paid', at: now, by: by || '', note: payMethodName(method) });
        Store.saveOrder(o);
        var exists = Store.getTransactions().some(function (t) { return t.orderId === o.id && t.kind === 'sale' && t.status === 'posted'; });
        if (!exists) Store.saveTransaction({ id: Store.uid('trx'), type: 'in', kind: 'sale', category: 'Penjualan', amount: o.total, desc: 'Pembayaran ' + o.number + ' (' + o.tableName + ')', method: method, ref: o.number, status: 'posted', at: now, by: by || '', orderId: o.id });
        return o;
      });
    },

    /** Batalkan pesanan. Stok dikembalikan; bila sudah dibayar → pengembalian dana otomatis tercatat. */
    cancel: function (id, reason, by) {
      var o = Store.getOrder(id); if (!o) throw new Error('Pesanan tidak ditemukan.');
      if (o.status === 'cancelled') throw new Error('Pesanan sudah dibatalkan.');
      if (o.status === 'done') throw new Error('Pesanan yang sudah selesai tidak dapat dibatalkan. Gunakan pengembalian dana bila perlu.');
      reason = (reason || '').trim(); if (!reason) throw new Error('Alasan pembatalan wajib diisi.');
      return Store.atomic(['orders', 'menus', 'transactions'], function () {
        var now = Date.now(), wasPaid = o.payStatus === 'paid';
        o.status = 'cancelled'; o.cancelReason = reason; o.cancelledBy = by || ''; o.updatedAt = now;
        o.history.push({ status: 'cancelled', at: now, by: by || '', reason: reason });
        if (wasPaid) {
          o.payStatus = 'refunded'; o.refundedAt = now;
          Store.saveTransaction({ id: Store.uid('trx'), type: 'out', kind: 'refund', category: 'Pengembalian dana', amount: o.total, desc: 'Refund ' + o.number + ' — ' + reason, method: o.payMethod, ref: o.number, status: 'posted', at: now, by: by || '', orderId: o.id });
        } else o.payStatus = 'cancelled';
        Store.saveOrder(o);
        o.items.forEach(function (i) { var m = Store.getMenu(i.menuId); if (m) { m.stock += i.qty; Store.saveMenu(m); } });
        return o;
      });
    },

    /** Pengembalian dana untuk pesanan yang sudah dibayar dan selesai. */
    refund: function (id, reason, by) {
      var o = Store.getOrder(id); if (!o) throw new Error('Pesanan tidak ditemukan.');
      if (o.payStatus !== 'paid') throw new Error('Hanya pesanan berstatus "Dibayar" yang dapat dikembalikan dananya.');
      reason = (reason || '').trim(); if (!reason) throw new Error('Alasan pengembalian dana wajib diisi.');
      return Store.atomic(['orders', 'transactions'], function () {
        var now = Date.now(); o.payStatus = 'refunded'; o.refundedAt = now; o.refundReason = reason; o.updatedAt = now;
        o.history.push({ status: 'refunded', at: now, by: by || '', reason: reason });
        Store.saveOrder(o);
        Store.saveTransaction({ id: Store.uid('trx'), type: 'out', kind: 'refund', category: 'Pengembalian dana', amount: o.total, desc: 'Refund ' + o.number + ' — ' + reason, method: o.payMethod, ref: o.number, status: 'posted', at: now, by: by || '', orderId: o.id });
        return o;
      });
    },

    /** Struk (HTML siap cetak) */
    receiptHtml: function (o) {
      var s = Store.getSettings(), r = s.restaurant, rc = s.receipt;
      var rows = o.items.map(function (i) { return '<tr><td>' + i.qty + '× ' + esc(i.name) + (i.note ? '<br><small>↳ ' + esc(i.note) + '</small>' : '') + '</td><td class="r">' + rp(i.price * i.qty) + '</td></tr>'; }).join('');
      var line = function (l, v, b) { return '<tr' + (b ? ' class="b"' : '') + '><td>' + l + '</td><td class="r">' + v + '</td></tr>'; };
      return '<style>@page{margin:4mm}body{font:12px/1.4 "Courier New",monospace;width:' + (rc.width || '80mm') + ';margin:0 auto;color:#000}h1{font-size:15px;text-align:center;margin:0}p{margin:2px 0;text-align:center}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}.b td{font-weight:bold;border-top:1px dashed #000;padding-top:4px}hr{border:0;border-top:1px dashed #000;margin:6px 0}small{color:#444}</style>' +
        '<h1>' + esc(r.name) + '</h1><p>' + esc(r.address) + '</p>' + (r.whatsapp ? '<p>WA ' + esc(r.whatsapp) + '</p>' : '') + '<hr><p><b>' + esc(rc.header || 'Struk') + '</b></p>' +
        '<table>' + line('No.', esc(o.number)) + line('Tanggal', App.fmtDateTime(o.createdAt)) + line('Meja', esc(o.tableName)) + line('Kasir', esc(o.createdBy || '-')) + '</table><hr>' +
        '<table>' + rows + '</table><hr><table>' + line('Subtotal', rp(o.subtotal)) + (o.discount ? line('Diskon', '-' + rp(o.discount)) : '') + (o.service ? line('Layanan', rp(o.service)) : '') + (o.tax && rc.showTax !== false ? line('Pajak', rp(o.tax)) : '') + line('TOTAL', rp(o.total), true) +
        (o.payStatus === 'paid' ? line('Bayar (' + esc(payMethodName(o.payMethod)) + ')', rp(o.received || o.total)) + (o.change ? line('Kembali', rp(o.change)) : '') : '') + '</table><hr>' +
        '<p><b>' + (o.payStatus === 'paid' ? 'LUNAS' : 'BELUM DIBAYAR') + '</b></p><p>' + esc(rc.footer || '') + '</p>';
    },
    printReceipt: function (o) { App.printHtml(Orders.receiptHtml(o), 'Struk ' + o.number); },
    downloadReceipt: function (o) { App.downloadBlob('struk-' + o.number.replace(/[^\w-]/g, '') + '.html', new Blob(['<!doctype html><html lang="id"><meta charset="utf-8"><title>Struk ' + esc(o.number) + '</title><body>' + Orders.receiptHtml(o) + '</body></html>'], { type: 'text/html' })); },

    itemsText: function (o) { return o.items.map(function (i) { return i.qty + '× ' + i.name; }).join(', '); },
    isLate: function (o) { var late = (Store.getSettings().kitchen.lateMinutes || 15) * 60000; return ['pending', 'confirmed', 'cooking'].indexOf(o.status) >= 0 && Date.now() - o.createdAt > late; }
  };
  global.Orders = Orders;

  /* ==========================================================================
     Komponen bersama: detail pesanan (modal)
     ========================================================================== */
  function who() { var s = App.Auth.current(); return s ? s.name : 'Sistem'; }
  function can(p) { return App.Auth.can(p); }

  function orderDetail(id, after) {
    var o = Store.getOrder(id); if (!o) { App.toast('Pesanan tidak ditemukan.', 'error'); return; }
    var steps = o.history.map(function (h) {
      var label = h.status === 'paid' ? 'Pembayaran dicatat' : h.status === 'refunded' ? 'Pengembalian dana' : STATUS[h.status];
      return '<li><i></i><div><b>' + esc(label) + '</b><small>' + App.fmtDateTime(h.at) + (h.by ? ' · ' + esc(h.by) : '') + (h.reason ? ' · ' + esc(h.reason) : '') + (h.note ? ' · ' + esc(h.note) : '') + '</small></div></li>';
    }).join('');
    var items = o.items.map(function (i) { return '<tr><td>' + i.qty + '× ' + esc(i.name) + (i.note ? '<small class="sub">Catatan: ' + esc(i.note) + '</small>' : '') + '</td><td class="ta-r">' + rp(i.price * i.qty) + '</td></tr>'; }).join('');
    var body = '<div class="od"><div class="od-head"><div><h4>' + esc(o.number) + '</h4><small class="muted">' + esc(o.tableName) + ' · ' + (o.source === 'qr' ? 'Pesanan QR' : 'Pesanan manual') + ' · ' + App.fmtDateTime(o.createdAt) + '</small></div><div class="hist-badges">' + Orders.statusBadge(o) + Orders.payBadge(o) + '</div></div>' +
      (o.note ? '<div class="notice info">' + ic('message-square') + '<span><b>Catatan:</b> ' + esc(o.note) + '</span></div>' : '') +
      (o.allergy ? '<div class="notice warn">' + ic('shield-alert') + '<span><b>Alergi:</b> ' + esc(o.allergy) + '</span></div>' : '') +
      (o.customer && (o.customer.name || o.customer.phone) ? '<p class="muted">' + ic('user') + ' ' + esc(o.customer.name || '-') + (o.customer.phone ? ' · ' + esc(o.customer.phone) : '') + '</p>' : '') +
      '<table class="mini-tbl">' + items + '<tr class="sep"><td>Subtotal</td><td class="ta-r">' + rp(o.subtotal) + '</td></tr>' + (o.discount ? '<tr><td>Diskon</td><td class="ta-r text-success">-' + rp(o.discount) + '</td></tr>' : '') + (o.service ? '<tr><td>Biaya layanan</td><td class="ta-r">' + rp(o.service) + '</td></tr>' : '') + (o.tax ? '<tr><td>Pajak</td><td class="ta-r">' + rp(o.tax) + '</td></tr>' : '') + '<tr class="total"><td>Total</td><td class="ta-r">' + rp(o.total) + '</td></tr></table>' +
      (o.payStatus === 'paid' ? '<p class="muted">Dibayar via <b>' + esc(payMethodName(o.payMethod)) + '</b> pada ' + App.fmtDateTime(o.paidAt) + (o.change ? ' · kembalian ' + rp(o.change) : '') + '</p>' : '') +
      (o.cancelReason ? '<p class="text-danger">Alasan pembatalan: ' + esc(o.cancelReason) + '</p>' : '') +
      '<h5>Riwayat status</h5><ul class="timeline">' + steps + '</ul></div>';
    var foot = '<button class="btn btn-ghost" data-close>Tutup</button><button class="btn btn-soft" data-act="print">' + ic('printer') + 'Struk</button>';
    var m = App.modal({ title: 'Detail Pesanan', body: body, footer: foot, size: 'md' });
    $('[data-act="print"]', m.el).onclick = function () { Orders.printReceipt(Store.getOrder(id)); };
  }

  /** Dialog pembayaran: pilih metode, hitung kembalian tunai */
  function payDialog(id, done) {
    var o = Store.getOrder(id); if (!o) return;
    var methods = Store.getSettings().paymentMethods.filter(function (m) { return m.active; });
    App.formModal({
      title: 'Catat Pembayaran · ' + o.number, size: 'sm', submitText: 'Simpan Pembayaran', values: { method: methods[0] ? methods[0].id : 'cash', received: o.total, ref: '' },
      fields: [
        { name: 'method', label: 'Metode pembayaran', type: 'select', options: methods.map(function (m) { return { value: m.id, label: m.name }; }), hint: 'Pencatatan manual. Untuk QRIS, pastikan dana sudah masuk di aplikasi merchant sebelum menyimpan (tombol QRIS ada di daftar pesanan).' },
        { name: 'received', label: 'Uang diterima (tunai)', type: 'number', min: 0, step: 500, prefix: 'Rp', show: function (c) { return c.method === 'cash'; }, hint: 'Total tagihan ' + rp(o.total) },
        { name: 'ref', label: 'Nomor referensi (opsional)', maxlength: 40, show: function (c) { return c.method !== 'cash'; } }
      ],
      onSubmit: function (c) {
        var res = Orders.pay(id, { method: c.method, received: c.received, ref: c.ref }, who());
        App.toast(res.change ? 'Pembayaran dicatat. Kembalian ' + rp(res.change) : 'Pembayaran dicatat.');
        if (done) done(res);
        App.confirm({ title: 'Cetak struk?', message: 'Pembayaran ' + res.number + ' berhasil. Cetak struk sekarang?', confirmText: 'Cetak', cancelText: 'Nanti' }).then(function (ok) { if (ok) Orders.printReceipt(res); });
      }
    });
  }

  function cancelDialog(id, done) {
    var o = Store.getOrder(id); if (!o) return;
    App.formModal({
      title: 'Batalkan Pesanan ' + o.number, size: 'sm', danger: true, submitText: 'Batalkan Pesanan', values: { reason: '' },
      fields: [{ name: 'reason', label: 'Alasan pembatalan', type: 'textarea', required: true, maxlength: 140, rows: 3, hint: o.payStatus === 'paid' ? 'Pesanan sudah dibayar: pengembalian dana ' + rp(o.total) + ' akan dicatat otomatis di kas keluar.' : 'Stok menu akan dikembalikan.' }],
      onSubmit: function (c) { Orders.cancel(id, c.reason, who()); App.toast('Pesanan dibatalkan.'); if (done) done(); }
    });
  }
  global.OrderUI = { detail: orderDetail, pay: payDialog, cancel: cancelDialog };

  /* ==========================================================================
     ADMIN: Manajemen Pesanan / Pesanan QR
     ========================================================================== */
  var ostate = { q: '', status: '', pay: '', range: 'today', from: '', to: '', source: '' };

  function ordersView(fixedSource, title) {
    return function (root, ctx) {
      var r = App.Range.compute(ostate.range, ostate.from, ostate.to);
      var src = fixedSource || ostate.source;
      var list = Store.getOrders().filter(function (o) {
        if (!App.Range.has(r, o.createdAt)) return false;
        if (src && o.source !== src) return false;
        if (ostate.status === 'active' ? ACTIVE.indexOf(o.status) < 0 : (ostate.status && o.status !== ostate.status)) return false;
        if (ostate.pay && o.payStatus !== ostate.pay) return false;
        var q = ostate.q.trim().toLowerCase();
        if (q && (o.number + ' ' + o.tableName + ' ' + (o.customer.name || '') + ' ' + Orders.itemsText(o)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      var acts = '';
      if (can('manual')) acts += '<button class="btn btn-primary" data-act="new-manual">' + ic('plus') + '<span>Pesanan Baru</span></button>';
      if (fixedSource === 'qr') acts = '<button class="btn btn-soft" data-act="simulate" title="Buat pesanan QR contoh untuk menguji alur dapur">' + ic('flask-conical') + '<span>Simulasi Pesanan</span></button><a class="btn btn-soft" href="menu.html?table=MEJA-01" target="_blank" rel="noopener">' + ic('external-link') + '<span>Buka Menu Pelanggan</span></a>';
      ctx.actions(acts);
      var tbl = App.table([
        { label: 'No. Pesanan', primary: true, render: function (o) { return '<b>' + esc(o.number) + '</b><small class="sub">' + (o.source === 'qr' ? 'QR' : 'Manual') + '</small>'; } },
        { label: 'Meja', render: function (o) { return esc(o.tableName); } },
        { label: 'Waktu', render: function (o) { return App.fmtDate(o.createdAt) + '<small class="sub">' + App.fmtTime(o.createdAt) + '</small>'; } },
        { label: 'Item', cls: 'col-items', render: function (o) { return '<span class="clamp">' + esc(Orders.itemsText(o)) + '</span>'; } },
        { label: 'Total', align: 'right', render: function (o) { return '<b>' + rp(o.total) + '</b>'; } },
        { label: 'Status', render: function (o) { return Orders.statusBadge(o); } },
        { label: 'Pembayaran', render: function (o) { return Orders.payBadge(o); } },
        { label: 'Aksi', align: 'center', render: function (o) {
          var b = '<button class="icon-btn sm" data-act="view" data-id="' + o.id + '" title="Detail" aria-label="Detail">' + ic('eye') + '</button>';
          if (o.payStatus === 'unpaid' && o.status !== 'cancelled' && can('pay')) b += '<button class="icon-btn sm ok" data-act="pay" data-id="' + o.id + '" title="Catat pembayaran" aria-label="Catat pembayaran">' + ic('banknote') + '</button>';
          if (o.payStatus === 'unpaid' && o.status !== 'cancelled' && can('pay') && global.QRIS && QRIS.cfg().enabled) b += '<button class="icon-btn sm" data-act="qris" data-id="' + o.id + '" title="Tampilkan QRIS" aria-label="Tampilkan QRIS">' + ic('qr-code') + '</button>';
          if (o.status !== 'cancelled' && o.status !== 'done' && can('orders.cancel')) b += '<button class="icon-btn sm danger" data-act="cancel" data-id="' + o.id + '" title="Batalkan" aria-label="Batalkan">' + ic('ban') + '</button>';
          if (o.payStatus === 'paid' && o.status === 'done' && can('orders.cancel')) b += '<button class="icon-btn sm" data-act="refund" data-id="' + o.id + '" title="Kembalikan dana" aria-label="Kembalikan dana">' + ic('undo-2') + '</button>';
          return '<div class="row-actions">' + b + '</div>';
        } }
      ], list.slice(0, 300), { icon: 'receipt', emptyTitle: 'Belum ada pesanan', emptyText: 'Tidak ada pesanan pada filter ini.' });
      var opt = function (arr, cur) { return arr.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };
      root.innerHTML = '<div class="card"><div class="toolbar">' +
        '<div class="search-in">' + ic('search') + '<input id="oq" type="search" placeholder="Cari no. pesanan, meja, menu…" value="' + esc(ostate.q) + '" aria-label="Cari pesanan"></div>' +
        '<select id="orange" aria-label="Rentang tanggal">' + opt(App.Range.PRESETS.concat([['all', 'Semua waktu']]), ostate.range) + '</select>' +
        '<select id="ostatus" aria-label="Status pesanan">' + opt([['', 'Semua Status'], ['active', 'Sedang aktif']].concat(Object.keys(STATUS).map(function (k) { return [k, STATUS[k]]; })), ostate.status) + '</select>' +
        '<select id="opay" aria-label="Status pembayaran">' + opt([['', 'Semua Pembayaran']].concat(Object.keys(PAY).map(function (k) { return [k, PAY[k]]; })), ostate.pay) + '</select>' +
        (fixedSource ? '' : '<select id="osrc" aria-label="Sumber">' + opt([['', 'Semua Sumber'], ['qr', 'QR'], ['manual', 'Manual']], ostate.source) + '</select>') + '</div>' +
        (ostate.range === 'custom' ? '<div class="toolbar"><label class="inline-f">Dari <input type="date" id="ofrom" value="' + esc(ostate.from) + '"></label><label class="inline-f">Sampai <input type="date" id="oto" value="' + esc(ostate.to) + '"></label></div>' : '') +
        tbl + '<p class="table-foot">' + list.length + ' pesanan · total ' + rp(list.filter(function (o) { return o.status !== 'cancelled'; }).reduce(function (s, o) { return s + o.total; }, 0)) + (list.length > 300 ? ' (menampilkan 300 terbaru)' : '') + '</p></div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.oninput = App.debounce(function (e) { if (e.target.id === 'oq') { ostate.q = e.target.value; keep(); var i = $('#oq', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
      root.onchange = function (e) {
        var id = e.target.id, v = e.target.value;
        if (id === 'orange') ostate.range = v; else if (id === 'ostatus') ostate.status = v; else if (id === 'opay') ostate.pay = v; else if (id === 'osrc') ostate.source = v; else if (id === 'ofrom') ostate.from = v; else if (id === 'oto') ostate.to = v; else return;
        keep();
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'view') orderDetail(id);
        else if (act === 'pay') payDialog(id, keep);
        else if (act === 'qris') QRIS.open(id);
        else if (act === 'cancel') cancelDialog(id, keep);
        else if (act === 'refund') {
          var o = Store.getOrder(id);
          App.formModal({ title: 'Kembalikan Dana · ' + o.number, size: 'sm', danger: true, submitText: 'Kembalikan Dana', values: { reason: '' }, fields: [{ name: 'reason', label: 'Alasan', type: 'textarea', required: true, maxlength: 140, rows: 3, hint: 'Pengembalian ' + rp(o.total) + ' dicatat sebagai kas keluar dan pesanan tidak dihitung sebagai pendapatan.' }], onSubmit: function (c) { Orders.refund(id, c.reason, who()); App.toast('Pengembalian dana dicatat.'); keep(); } });
        } else if (act === 'new-manual') ctx.navigate('manual');
        else if (act === 'simulate') simulate(keep);
      };
    };
  }

  /** Simulasi pesanan QR (untuk menguji alur tanpa dua perangkat) */
  function simulate(done) {
    try {
      var tables = Store.getTables().filter(function (t) { return t.active; }), menus = Menu.visible().filter(function (m) { return !Menu.isSoldOut(m) && m.stock > 2; });
      if (!tables.length || !menus.length) throw new Error('Butuh minimal satu meja aktif dan menu tersedia.');
      var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
      var items = [], used = {}; for (var i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { var m = pick(menus); if (!used[m.id]) { used[m.id] = 1; items.push({ menuId: m.id, qty: 1 + Math.floor(Math.random() * 2), note: '' }); } }
      var o = Orders.create({ type: 'dinein', tableCode: pick(tables).code, items: items, note: 'Pesanan simulasi' }, { source: 'qr', by: 'Simulasi' });
      App.toast('Pesanan simulasi ' + o.number + ' dibuat. Cek halaman Dapur.'); if (done) done();
    } catch (e) { App.fail(e); }
  }

  Admin.register('orders', { title: 'Manajemen Pesanan', sub: 'Semua pesanan QR dan manual', perm: 'orders', render: ordersView(null) });
  Admin.register('orders-qr', { title: 'Pesanan QR', sub: 'Pesanan yang dikirim pelanggan dari meja', perm: 'orders', render: ordersView('qr') });

  /* ==========================================================================
     ADMIN: Pesanan Manual (Kasir)
     ========================================================================== */
  var man = { type: 'dinein', table: '', cart: [], q: '', cat: '', note: '', payMethod: 'cash', received: '', payNow: true, customer: '', promoCode: '' };

  Admin.register('manual', {
    title: 'Pesanan Manual (Kasir)', sub: 'Masukkan pesanan, catat pembayaran, kirim ke dapur', perm: 'manual',
    render: function (root, ctx) {
      var s = Store.getSettings(), tables = Store.getTables().filter(function (t) { return t.active; });
      var cats = Store.getCategories().filter(function (c) { return c.active !== false; });
      var menus = Menu.visible().filter(function (m) {
        if (man.cat && m.categoryId !== man.cat) return false;
        var q = man.q.trim().toLowerCase(); return !q || m.name.toLowerCase().indexOf(q) >= 0;
      });
      // sinkronkan keranjang kasir dengan data menu terbaru
      var lines = [], problems = [];
      man.cart.forEach(function (c) {
        var m = Store.getMenu(c.menuId);
        if (!m || m.active === false) { problems.push('Menu tidak tersedia.'); return; }
        if (Menu.isSoldOut(m) || c.qty > m.stock) problems.push(m.name + ': stok tinggal ' + m.stock + '.');
        lines.push({ menu: m, qty: c.qty, note: c.note });
      });
      var calc = Pricing.calc(lines, s);
      var payMethods = s.paymentMethods.filter(function (m) { return m.active; });
      if (!payMethods.some(function (m) { return m.id === man.payMethod; })) man.payMethod = payMethods[0] ? payMethods[0].id : 'cash';
      ctx.actions('<button class="btn btn-soft" data-act="reset">' + ic('rotate-ccw') + '<span>Pesanan Baru</span></button>');

      var picker = '<section class="card pos-menu"><div class="toolbar"><div class="search-in">' + ic('search') + '<input id="mq2" type="search" placeholder="Cari menu…" value="' + esc(man.q) + '" aria-label="Cari menu"></div><select id="mcat2" aria-label="Kategori"><option value="">Semua Kategori</option>' + cats.map(function (c) { return '<option value="' + c.id + '"' + (man.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="pos-grid">' + (menus.length ? menus.map(function (m) {
          var pi = Menu.priceInfo(m), sold = Menu.isSoldOut(m);
          return '<button class="pos-item' + (sold ? ' sold' : '') + '" data-act="add" data-id="' + m.id + '"' + (sold ? ' disabled' : '') + '><img src="' + esc(App.foodImg(m)) + '" alt=""><div><b>' + esc(m.name) + '</b><small>' + rp(pi.final) + (sold ? ' · habis' : ' · stok ' + m.stock) + '</small></div><span class="plus">' + ic('plus') + '</span></button>';
        }).join('') : App.UI.empty('search-x', 'Menu tidak ditemukan')) + '</div></section>';

      var cartHtml = '<section class="card pos-cart"><div class="card-head"><h3>Daftar Pesanan</h3>' + (man.cart.length ? '<button class="link-danger" data-act="clear">Kosongkan</button>' : '') + '</div>' +
        '<div class="field"><label for="mType">Jenis pesanan</label><div class="seg full"><button class="' + (man.type === 'dinein' ? 'on' : '') + '" data-act="type" data-v="dinein">' + ic('armchair') + 'Makan di tempat</button><button class="' + (man.type === 'takeaway' ? 'on' : '') + '" data-act="type" data-v="takeaway">' + ic('shopping-bag') + 'Bungkus</button></div></div>' +
        (man.type === 'dinein' ? '<div class="field"><label for="mTable">Meja</label><select id="mTable"><option value="">Pilih meja…</option>' + tables.map(function (t) { return '<option value="' + t.code + '"' + (man.table === t.code ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></div>' : '') +
        '<ul class="pos-lines">' + (calc.lines.length ? calc.lines.map(function (l) {
          return '<li><div class="pl-top"><b>' + esc(l.name) + '</b><span>' + rp(l.price * l.qty) + '</span></div><div class="pl-ctrl"><div class="stepper"><button data-act="dec" data-id="' + l.menuId + '" aria-label="Kurangi">' + ic('minus') + '</button><b>' + l.qty + '</b><button data-act="inc" data-id="' + l.menuId + '" aria-label="Tambah">' + ic('plus') + '</button></div><button class="icon-btn sm danger" data-act="rm" data-id="' + l.menuId + '" aria-label="Hapus">' + ic('trash-2') + '</button></div><input class="item-note" data-note="' + l.menuId + '" placeholder="Catatan item" maxlength="100" value="' + esc(l.note) + '" aria-label="Catatan item"></li>';
        }).join('') : '<li class="empty-line">' + ic('shopping-basket') + 'Belum ada item. Pilih menu di sebelah kiri.</li>') + '</ul>' +
        '<div class="field"><label for="mNote">Catatan pesanan</label><input id="mNote" maxlength="200" placeholder="Catatan umum untuk dapur" value="' + esc(man.note) + '"></div>' +
        '<div class="summary"><div class="sum-row"><span>Subtotal</span><b>' + rp(calc.subtotal) + '</b></div>' + calc.discounts.map(function (d) { return '<div class="sum-row disc"><span>' + esc(d.name) + '</span><b>-' + rp(d.amount) + '</b></div>'; }).join('') +
        (calc.service ? '<div class="sum-row"><span>' + esc(s.service.label) + ' (' + s.service.rate + '%)</span><b>' + rp(calc.service) + '</b></div>' : '') + (calc.tax ? '<div class="sum-row"><span>' + esc(s.tax.label) + ' (' + s.tax.rate + '%)</span><b>' + rp(calc.tax) + '</b></div>' : '') + '<div class="sum-row total"><span>Total</span><b>' + rp(calc.total) + '</b></div></div>' +
        (problems.length ? '<div class="notice warn">' + ic('triangle-alert') + '<span>' + esc(problems.join(' ')) + '</span></div>' : '') +
        (can('pay') ? '<div class="field"><label>Metode pembayaran</label><div class="radio-row">' + payMethods.map(function (m) { return '<label class="radio"><input type="radio" name="pm" value="' + m.id + '"' + (man.payMethod === m.id ? ' checked' : '') + '><span>' + esc(m.name) + '</span></label>'; }).join('') + '</div></div>' +
          (man.payMethod === 'cash' && man.payNow ? '<div class="field"><label for="mRecv">Uang diterima</label><div class="input-group"><span class="addon">Rp</span><input id="mRecv" type="number" min="0" step="500" inputmode="numeric" value="' + esc(man.received) + '" placeholder="' + calc.total + '"></div>' + (man.received !== '' && Number(man.received) >= calc.total ? '<small class="hint ok">Kembalian ' + rp(Number(man.received) - calc.total) + '</small>' : '') + '</div>' : '') : '') +
        '<div class="pos-actions"><button class="btn btn-soft" data-act="save"' + (man.cart.length ? '' : ' disabled') + '>' + ic('save') + 'Simpan Pesanan</button>' + (can('pay') ? '<button class="btn btn-primary" data-act="savepay"' + (man.cart.length ? '' : ' disabled') + '>' + ic('banknote') + 'Simpan &amp; Bayar</button>' : '') + '</div></section>';
      root.innerHTML = '<div class="pos">' + picker + cartHtml + '</div>';
      App.refreshIcons();

      function sync() { ctx.rerender(); }
      function addItem(id, d) {
        var m = Store.getMenu(id), c = man.cart.filter(function (x) { return x.menuId === id; })[0], q = (c ? c.qty : 0) + d;
        if (q <= 0) { man.cart = man.cart.filter(function (x) { return x.menuId !== id; }); return sync(); }
        if (q > m.stock) { App.toast('Stok ' + m.name + ' tinggal ' + m.stock + '.', 'warn'); return; }
        if (q > 99) return;
        if (c) c.qty = q; else man.cart.push({ menuId: id, qty: q, note: '' });
        sync();
      }
      function submit(withPay) {
        if (man.type === 'dinein' && !man.table) { App.toast('Pilih meja atau ubah ke pesanan bungkus.', 'warn'); return; }
        if (problems.length) { App.toast('Perbaiki item bermasalah dulu.', 'warn'); return; }
        try {
          var o = Orders.create({ type: man.type, tableCode: man.table, items: man.cart.map(function (c) { return { menuId: c.menuId, qty: c.qty, note: c.note }; }), note: man.note }, { source: 'manual', by: who() });
          // kasir langsung menerima: pesanan manual otomatis dikonfirmasi ke antrean dapur
          Orders.updateStatus(o.id, 'confirmed', who());
          if (withPay) {
            if (man.payMethod === 'cash' && man.received !== '' && Number(man.received) < o.total) { App.toast('Pesanan ' + o.number + ' tersimpan, tetapi uang diterima kurang. Catat pembayaran dari daftar pesanan.', 'warn', 6000); }
            else { o = Orders.pay(o.id, { method: man.payMethod, received: man.received === '' ? undefined : Number(man.received) }, who()); }
          }
          App.toast('Pesanan ' + o.number + ' tersimpan dan dikirim ke dapur.');
          var saved = Store.getOrder(o.id);
          man.cart = []; man.note = ''; man.received = ''; sync();
          App.confirm({ title: 'Pesanan tersimpan', message: 'Pesanan ' + saved.number + ' (' + saved.tableName + ') total ' + rp(saved.total) + '. Cetak struk sekarang?', confirmText: 'Cetak Struk', cancelText: 'Tutup' }).then(function (ok) { if (ok) Orders.printReceipt(saved); });
        } catch (e) { App.fail(e); }
      }
      root.oninput = function (e) {
        if (e.target.id === 'mq2') { man.q = e.target.value; App.debounce(function () { sync(); var i = $('#mq2', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250)(); }
        else if (e.target.id === 'mNote') man.note = e.target.value;
        else if (e.target.id === 'mRecv') { man.received = e.target.value; }
        else if (e.target.matches('[data-note]')) { var c = man.cart.filter(function (x) { return x.menuId === e.target.getAttribute('data-note'); })[0]; if (c) c.note = e.target.value; }
      };
      root.onchange = function (e) {
        if (e.target.id === 'mcat2') { man.cat = e.target.value; sync(); }
        else if (e.target.id === 'mTable') man.table = e.target.value;
        else if (e.target.name === 'pm') { man.payMethod = e.target.value; sync(); }
        else if (e.target.id === 'mRecv') { sync(); }
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'add' || act === 'inc') addItem(id, 1); else if (act === 'dec') addItem(id, -1);
        else if (act === 'rm') { man.cart = man.cart.filter(function (x) { return x.menuId !== id; }); sync(); }
        else if (act === 'clear' || act === 'reset') { man.cart = []; man.note = ''; man.received = ''; man.table = ''; sync(); }
        else if (act === 'type') { man.type = b.getAttribute('data-v'); sync(); }
        else if (act === 'save') submit(false); else if (act === 'savepay') submit(true);
      };
    }
  });

  /* ==========================================================================
     HALAMAN order.html — lacak pesanan pelanggan
     ========================================================================== */
  var OrderPage = {
    init: function () {
      var root = $('#app'), id = new URLSearchParams(location.search).get('id');
      var st = { id: id };
      function render() {
        var s = Store.getSettings(), r = s.restaurant, o = st.id ? Store.getOrder(st.id) : null;
        var logo = r.logo ? '<img src="' + esc(r.logo) + '" alt="">' : '<span class="logo-ph">' + ic('chef-hat') + '</span>';
        var head = '<header class="cust-head"><div class="cust-brand"><span class="cust-logo">' + logo + '</span><div><h1>' + esc(r.name) + '</h1><p>Status Pesanan</p></div></div><div class="cust-actions"><button class="icon-btn" data-theme-toggle></button></div></header>';
        var body;
        if (!st.id) {
          var ids = Cart.myOrders(), os = ids.map(function (i) { return Store.getOrder(i); }).filter(Boolean);
          body = '<div class="pad"><h2 class="sec-title">' + ic('receipt') + 'Pesanan Saya</h2>' + (os.length ? '<div class="hist-list">' + os.map(function (x) { return '<a class="hist-card link" href="order.html?id=' + x.id + '"><div class="hist-top"><div><b>' + esc(x.number) + '</b><small>' + esc(x.tableName) + ' · ' + App.fmtDateTime(x.createdAt) + '</small></div><div class="hist-badges">' + Orders.statusBadge(x) + '</div></div><div class="hist-foot"><span>' + esc(Orders.itemsText(x)) + '</span><b>' + rp(x.total) + '</b></div></a>'; }).join('') + '</div>' : App.UI.empty('receipt', 'Belum ada pesanan', 'Pesanan dari perangkat ini akan muncul di sini.')) + '<a class="btn btn-primary btn-block" href="menu.html">' + ic('utensils-crossed') + 'Ke Menu</a></div>';
        } else if (!o) {
          body = '<div class="pad">' + App.UI.error('Pesanan tidak ditemukan di browser ini. Data prototype hanya tersimpan di perangkat yang membuat pesanan.') + '<a class="btn btn-primary btn-block" href="menu.html">Kembali ke Menu</a></div>';
        } else {
          var flow = ['pending', 'confirmed', 'cooking', 'ready', 'serving', 'done'];
          var idx = flow.indexOf(o.status), cancelled = o.status === 'cancelled';
          var tl = flow.map(function (k, i) {
            var cls = cancelled ? '' : i < idx ? 'done' : i === idx ? 'cur' : '';
            var h = o.history.filter(function (x) { return x.status === k; })[0];
            return '<li class="' + cls + '"><i>' + (i < idx && !cancelled ? ic('check') : '') + '</i><div><b>' + STATUS[k] + '</b>' + (h ? '<small>' + App.fmtTime(h.at) + '</small>' : '') + '</div></li>';
          }).join('');
          body = '<div class="pad"><div class="track-card"><div class="hist-top"><div><small class="muted">Nomor Pesanan</small><div class="order-no sm">' + esc(o.number) + '</div><small class="muted">' + esc(o.tableName) + ' · ' + App.fmtDateTime(o.createdAt) + '</small></div><div class="hist-badges col">' + Orders.statusBadge(o) + Orders.payBadge(o) + '</div></div>' +
            (cancelled ? '<div class="notice danger">' + ic('ban') + '<span>Pesanan dibatalkan' + (o.cancelReason ? ': ' + esc(o.cancelReason) : '') + '</span></div>' : '<ol class="track">' + tl + '</ol>') + '</div>' +
            '<div class="card flat"><h3>Rincian</h3><ul class="hist-items big">' + o.items.map(function (i) { return '<li><span>' + i.qty + '× ' + esc(i.name) + (i.note ? '<small>' + esc(i.note) + '</small>' : '') + '</span><b>' + rp(i.price * i.qty) + '</b></li>'; }).join('') + '</ul>' +
            '<div class="summary"><div class="sum-row"><span>Subtotal</span><b>' + rp(o.subtotal) + '</b></div>' + (o.discount ? '<div class="sum-row disc"><span>Diskon</span><b>-' + rp(o.discount) + '</b></div>' : '') + (o.service ? '<div class="sum-row"><span>Layanan</span><b>' + rp(o.service) + '</b></div>' : '') + (o.tax ? '<div class="sum-row"><span>Pajak</span><b>' + rp(o.tax) + '</b></div>' : '') + '<div class="sum-row total"><span>Total</span><b>' + rp(o.total) + '</b></div></div>' +
            '<p class="muted small">Pembayaran dapat dilakukan di kasir atau lewat QRIS. Status pembayaran: <b>' + PAY[o.payStatus] + '</b>' + (o.payStatus === 'paid' ? ' via ' + esc(payMethodName(o.payMethod)) : '') + '.</p>' +
            (global.QRIS && QRIS.cfg().enabled && o.payStatus === 'unpaid' && o.status !== 'cancelled' ? '<button class="btn btn-primary btn-block" data-act="qris" data-id="' + o.id + '">' + ic('qr-code') + 'Bayar dengan QRIS</button>' : '') + '</div>' +
            '<div class="btn-row stack"><button class="btn btn-soft btn-block" data-act="reorder">' + ic('rotate-ccw') + 'Pesan Lagi</button><a class="btn btn-ghost btn-block" href="menu.html' + (o.tableCode ? '?table=' + encodeURIComponent(o.tableCode) : '?type=takeaway') + '">' + ic('utensils-crossed') + 'Kembali ke Menu</a></div>' +
            '<p class="demo-note">' + ic('info') + 'Status diperbarui otomatis bila dapur memakai browser yang sama (mode simulasi). Pada versi Firebase, status tersinkron antar perangkat.</p></div>';
        }
        root.innerHTML = '<div class="cust-shell">' + head + body + '</div>';
        App.Theme.sync(); App.refreshIcons();
      }
      render();
      Store.subscribe(App.debounce(render, 200));
      setInterval(render, 20000);
      root.addEventListener('click', function (e) {
        var qb = e.target.closest('[data-act="qris"]'); if (qb) { QRIS.open(qb.getAttribute('data-id')); return; }
        if (e.target.closest('[data-act="reorder"]')) {
          var o = Store.getOrder(st.id); if (!o) return;
          var qs = new URLSearchParams(); if (o.tableCode) qs.set('table', o.tableCode); else qs.set('type', 'takeaway');
          Cart.setContext(o.tableCode || 'BUNGKUS'); var added = 0;
          o.items.forEach(function (i) { if (Cart.add(i.menuId, i.qty, i.note).ok) added++; });
          App.toast(added ? 'Item dimasukkan ke keranjang.' : 'Item tidak tersedia saat ini.', added ? 'success' : 'error');
          if (added) setTimeout(function () { location.href = 'menu.html?' + qs.toString(); }, 600);
        }
      });
    }
  };
  global.OrderPage = OrderPage;

  /* ==========================================================================
     HALAMAN kitchen.html — dashboard dapur
     ========================================================================== */
  var Kitchen = {
    st: { source: '', q: '', sound: true, history: false },
    seen: null,
    COLS: [
      { id: 'new', title: 'Pesanan Baru', cls: 'c-red', statuses: ['pending'] },
      { id: 'proc', title: 'Sedang Diproses', cls: 'c-amber', statuses: ['confirmed', 'cooking'] },
      { id: 'ready', title: 'Siap Disajikan', cls: 'c-blue', statuses: ['ready', 'serving'] },
      { id: 'done', title: 'Selesai', cls: 'c-green', statuses: ['done'] }
    ],
    init: function () {
      var root = $('#app'); Kitchen.root = root;
      var s = Store.getSettings(); Kitchen.st.sound = s.kitchen.sound !== false;
      try { var sv = JSON.parse(localStorage.getItem('qmo:kitchen') || '{}'); if (sv.sound != null) Kitchen.st.sound = sv.sound; } catch (e) {}
      Kitchen.seen = {}; Store.getOrders().forEach(function (o) { Kitchen.seen[o.id] = 1; });
      Kitchen.shell(); Kitchen.render();
      Store.subscribe(App.debounce(function () { Kitchen.render(true); }, 150));
      setInterval(function () { Kitchen.tickClock(); Kitchen.render(false, true); }, 30000);
      setInterval(Kitchen.tickClock, 1000);
      document.addEventListener('fullscreenchange', Kitchen.shell);
    },
    can: function (perm) { return App.Auth.can(perm) || App.Auth.can('kitchen'); },
    shell: function () {
      var u = App.Auth.current(), fs = !!document.fullscreenElement, st = Kitchen.st;
      var back = (u ? '<a class="btn btn-soft btn-sm k-back" href="admin.html" title="Kembali ke dashboard" aria-label="Kembali ke dashboard">' + ic('arrow-left') + '<span>Dashboard</span></a>' : '') + '<button class="btn btn-soft btn-sm k-logout" data-act="logout" title="Keluar" aria-label="Logout">' + ic('log-out') + '<span>Keluar</span></button>';
      Kitchen.root.innerHTML = '<div class="k-shell"><header class="k-head"><div class="k-title"><span class="k-logo">' + ic('chef-hat') + '</span><div><h1>Papan Pesanan Masuk</h1><small>' + esc(Store.getSettings().restaurant.name) + '</small></div></div>' +
        '<div class="k-tools"><div class="k-filters"><div class="search-in sm">' + ic('search') + '<input id="kq" type="search" placeholder="Cari meja / no. pesanan" value="' + esc(st.q) + '" aria-label="Cari pesanan"></div><select id="ksrc" aria-label="Sumber pesanan"><option value="">Semua sumber</option><option value="qr"' + (st.source === 'qr' ? ' selected' : '') + '>QR</option><option value="manual"' + (st.source === 'manual' ? ' selected' : '') + '>Manual</option></select></div>' +
        '<button class="icon-btn' + (st.sound ? ' on' : '') + '" data-act="sound" title="Bunyi notifikasi" aria-pressed="' + st.sound + '" aria-label="Bunyi notifikasi">' + ic(st.sound ? 'volume-2' : 'volume-x') + '</button>' +
        '<button class="icon-btn" data-act="history" title="Riwayat pesanan" aria-label="Riwayat pesanan">' + ic('history') + '</button>' +
        '<button class="icon-btn" data-act="fs" title="Layar penuh" aria-label="Layar penuh">' + ic(fs ? 'minimize' : 'maximize') + '</button>' +
        '<button class="icon-btn" data-theme-toggle></button>' + back +
        '<div class="k-clock"><b id="kclock"></b><small id="kdate"></small></div></div></header><main class="k-board" id="kboard"></main></div>';
      Kitchen.bind(); Kitchen.tickClock(); App.Theme.sync(); App.refreshIcons(); Kitchen.render();
    },
    tickClock: function () { var c = $('#kclock'), d = $('#kdate'); if (c) { var n = new Date(); c.textContent = App.pad(n.getHours()) + ':' + App.pad(n.getMinutes()); d.textContent = App.fmtDate(n); } },
    bind: function () {
      var root = Kitchen.root;
      root.querySelector('.k-shell').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'logout') { App.confirm({ title: 'Keluar?', message: 'Anda akan keluar dari dashboard dapur.', confirmText: 'Logout' }).then(function (ok) { if (ok) { App.Auth.logout(); location.href = 'login.html'; } }); return; }
        if (act === 'sound') {
          Kitchen.st.sound = !Kitchen.st.sound; try { localStorage.setItem('qmo:kitchen', JSON.stringify({ sound: Kitchen.st.sound })); } catch (x) {}
          if (Kitchen.st.sound) { App.Sound.unlock(); App.Sound.beep(); } Kitchen.shell();
        } else if (act === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () { App.toast('Layar penuh tidak didukung browser ini.', 'warn'); }); else App.toast('Layar penuh tidak didukung browser ini.', 'warn'); }
        else if (act === 'history') Kitchen.history();
        else if (act === 'advance') Kitchen.advance(id, b.getAttribute('data-to'));
        else if (act === 'detail') OrderUI.detail(id);
        else if (act === 'cancel') cancelDialog(id, function () { Kitchen.render(); });
      });
      root.querySelector('.k-shell').addEventListener('input', App.debounce(function (e) {
        if (e.target.id === 'kq') { Kitchen.st.q = e.target.value; Kitchen.render(); }
      }, 200));
      root.querySelector('.k-shell').addEventListener('change', function (e) { if (e.target.id === 'ksrc') { Kitchen.st.source = e.target.value; Kitchen.render(); } });
    },
    advance: function (id, to) {
      try {
        var o = Orders.updateStatus(id, to, App.Auth.current() ? App.Auth.current().name : 'Dapur');
        App.toast(o.number + ' → ' + STATUS[to]); Kitchen.render();
      } catch (e) { App.fail(e); }
    },
    visible: function (o) {
      var st = Kitchen.st, q = st.q.trim().toLowerCase();
      if (st.source && o.source !== st.source) return false;
      if (q && (o.number + ' ' + o.tableName).toLowerCase().indexOf(q) < 0) return false;
      return true;
    },
    cardHtml: function (o, col) {
      var late = Orders.isLate(o);
      var btn = '', canAct = Kitchen.can('kitchen');
      var B = function (to, label, cls, icon) { return '<button class="k-btn ' + cls + '" data-act="advance" data-id="' + o.id + '" data-to="' + to + '">' + ic(icon) + label + '</button>'; };
      if (canAct) {
        if (o.status === 'pending') btn = B('confirmed', 'Terima Pesanan', 'g', 'check');
        else if (o.status === 'confirmed') btn = B('cooking', 'Mulai Memasak', 'a', 'flame');
        else if (o.status === 'cooking') btn = B('ready', 'Tandai Siap', 'b', 'bell-ring');
        else if (o.status === 'ready') btn = '<div class="k-btn-row">' + B('serving', 'Antar', 'b', 'truck') + B('done', 'Selesai', 'g', 'check-check') + '</div>';
        else if (o.status === 'serving') btn = B('done', 'Selesai', 'g', 'check-check');
      }
      var extra = (o.note ? '<div class="k-note">' + ic('message-square') + esc(o.note) + '</div>' : '') + (o.allergy ? '<div class="k-note warn">' + ic('shield-alert') + 'Alergi: ' + esc(o.allergy) + '</div>' : '');
      return '<article class="k-card' + (late ? ' late' : '') + '" data-status="' + o.status + '"><div class="k-top"><div><b class="k-no">' + esc(o.number) + '</b><small>' + esc(o.tableName) + ' · ' + App.fmtTime(o.createdAt) + '</small></div><div class="k-meta"><span class="src ' + o.source + '">' + (o.source === 'qr' ? 'QR' : 'Manual') + '</span>' +
        (can('orders.cancel') && ['pending', 'confirmed', 'cooking', 'ready', 'serving'].indexOf(o.status) >= 0 ? '<button class="icon-btn sm" data-act="cancel" data-id="' + o.id + '" title="Batalkan pesanan" aria-label="Batalkan">' + ic('x') + '</button>' : '') + '</div></div>' +
        '<ul class="k-items">' + o.items.map(function (i) { return '<li><b>' + i.qty + 'x</b> ' + esc(i.name) + (i.note ? '<small>' + esc(i.note) + '</small>' : '') + '</li>'; }).join('') + '</ul>' + extra +
        '<div class="k-foot"><span class="k-wait' + (late ? ' late' : '') + '">' + ic(late ? 'triangle-alert' : 'clock') + (o.status === 'done' ? 'selesai' : App.ago(o.createdAt)) + (late ? ' · terlalu lama' : '') + '</span><span class="k-status">' + STATUS[o.status] + '</span></div>' + btn + '</article>';
    },
    render: function (fromStore, quiet) {
      var board = $('#kboard'); if (!board) return;
      var all = Store.getOrders();
      // bunyi untuk pesanan baru
      if (fromStore && Kitchen.st.sound) {
        var fresh = all.filter(function (o) { return !Kitchen.seen[o.id] && o.status === 'pending'; });
        if (fresh.length) { App.Sound.beep(); App.toast(fresh.length + ' pesanan baru masuk', 'info'); }
      }
      all.forEach(function (o) { Kitchen.seen[o.id] = 1; });
      var startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0); startOfDay = startOfDay.getTime();
      var list = all.filter(Kitchen.visible);
      board.innerHTML = Kitchen.COLS.map(function (c) {
        var os = list.filter(function (o) { return c.statuses.indexOf(o.status) >= 0 && (c.id !== 'done' || o.updatedAt >= startOfDay); });
        os.sort(function (a, b) { return c.id === 'done' ? b.updatedAt - a.updatedAt : a.createdAt - b.createdAt; });
        if (c.id === 'done') os = os.slice(0, 12);
        return '<section class="k-col ' + c.cls + '" aria-label="' + c.title + '"><header><h2>' + c.title + ' <span>(' + os.length + ')</span></h2></header><div class="k-list">' + (os.length ? os.map(function (o) { return Kitchen.cardHtml(o, c); }).join('') : '<div class="k-empty">' + ic('inbox') + 'Tidak ada pesanan</div>') + '</div></section>';
      }).join('');
      App.refreshIcons();
    },
    history: function () {
      var rows = Store.getOrders().filter(function (o) { return o.status === 'done' || o.status === 'cancelled'; }).slice(0, 80);
      var body = App.table([
        { label: 'No.', primary: true, render: function (o) { return '<b>' + esc(o.number) + '</b>'; } },
        { label: 'Meja', render: function (o) { return esc(o.tableName); } },
        { label: 'Waktu', render: function (o) { return App.fmtDate(o.createdAt) + ' ' + App.fmtTime(o.createdAt); } },
        { label: 'Item', render: function (o) { return '<span class="clamp">' + esc(Orders.itemsText(o)) + '</span>'; } },
        { label: 'Status', render: function (o) { return Orders.statusBadge(o); } },
        { label: '', render: function (o) { return '<button class="icon-btn sm" data-act="detail" data-id="' + o.id + '" aria-label="Detail">' + ic('eye') + '</button>'; } }
      ], rows, { icon: 'history', emptyTitle: 'Belum ada riwayat' });
      var m = App.modal({ title: 'Riwayat Pesanan Dapur', body: body, size: 'lg' });
      App.delegate(m.el, 'click', '[data-act="detail"]', function (e, el) { OrderUI.detail(el.getAttribute('data-id')); });
    }
  };
  global.Kitchen = Kitchen;
})(window);
