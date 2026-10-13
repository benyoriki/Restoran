/* ==========================================================================
   cart.js — keranjang pelanggan (state) + tampilan keranjang & checkout
   Keranjang disimpan per meja di LocalStorage perangkat pelanggan.
   Keranjang TIDAK dikosongkan sebelum pesanan berhasil disimpan.
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, esc = App.esc, rp = App.rp, ic = App.ic;
  var MAX_QTY = 99;

  var Cart = {
    context: 'NONE', items: [],
    key: function () { return 'qmo:cart:' + Cart.context; },
    setContext: function (ctx) { Cart.context = ctx || 'NONE'; Cart.load(); },
    load: function () {
      try { var v = JSON.parse(localStorage.getItem(Cart.key()) || '[]'); Cart.items = Array.isArray(v) ? v.filter(function (i) { return i && i.menuId && i.qty > 0; }) : []; }
      catch (e) { Cart.items = []; }
    },
    save: function () { try { localStorage.setItem(Cart.key(), JSON.stringify(Cart.items)); } catch (e) { App.toast('Keranjang tidak dapat disimpan di browser ini.', 'warn'); } },
    get: function (id) { return Cart.items.filter(function (i) { return i.menuId === id; })[0] || null; },
    qty: function (id) { var i = Cart.get(id); return i ? i.qty : 0; },
    count: function () { return Cart.items.reduce(function (s, i) { return s + i.qty; }, 0); },

    /** Tambah qty (default +1). Mengembalikan {ok, message}. */
    add: function (id, qty, note) {
      var cur = Cart.get(id);
      return Cart.set(id, (cur ? cur.qty : 0) + (qty || 1), note != null && note !== '' ? note : (cur ? cur.note : ''));
    },
    /** Set qty absolut (0 = hapus) */
    set: function (id, qty, note) {
      qty = Math.floor(Number(qty));
      if (!isFinite(qty) || qty < 0) return { ok: false, message: 'Jumlah tidak valid.' };
      var m = Store.getMenu(id);
      if (qty === 0) { Cart.remove(id); return { ok: true }; }
      if (!m || m.active === false) return { ok: false, message: 'Menu tidak tersedia.' };
      if (Menu.isSoldOut(m)) return { ok: false, message: m.name + ' sedang habis.' };
      if (qty > MAX_QTY) return { ok: false, message: 'Maksimal ' + MAX_QTY + ' porsi per menu.' };
      if (qty > m.stock) return { ok: false, message: 'Stok ' + m.name + ' tinggal ' + m.stock + '.' };
      var cur = Cart.get(id);
      if (cur) { cur.qty = qty; if (note != null) cur.note = note; } else Cart.items.push({ menuId: id, qty: qty, note: note || '' });
      Cart.save(); return { ok: true };
    },
    setQty: function (id, qty) { return Cart.set(id, qty); },
    setNote: function (id, note) { var c = Cart.get(id); if (c) { c.note = note; Cart.save(); } },
    remove: function (id) { Cart.items = Cart.items.filter(function (i) { return i.menuId !== id; }); Cart.save(); },
    clear: function () { Cart.items = []; Cart.save(); },

    /** Baris keranjang beserta masalah (menu dihapus/habis/stok kurang) */
    lines: function () {
      return Cart.items.map(function (i) {
        var m = Store.getMenu(i.menuId), issue = '';
        if (!m || m.active === false) issue = 'Menu sudah tidak tersedia.';
        else if (Menu.isSoldOut(m)) issue = 'Menu habis.';
        else if (i.qty > m.stock) issue = 'Stok tinggal ' + m.stock + '.';
        return { menu: m, qty: i.qty, note: i.note, issue: issue, menuId: i.menuId };
      });
    },
    valid: function () { return Cart.lines().filter(function (l) { return l.menu; }); },
    calc: function () { return Pricing.calc(Cart.valid().filter(function (l) { return !l.issue; }).map(function (l) { return { menu: l.menu, qty: l.qty, note: l.note }; })); },

    /* riwayat pesanan pada perangkat ini */
    myOrders: function () { try { return JSON.parse(localStorage.getItem('qmo:my-orders') || '[]'); } catch (e) { return []; } },
    addMyOrder: function (id) {
      var l = Cart.myOrders().filter(function (x) { return x !== id; }); l.unshift(id);
      try { localStorage.setItem('qmo:my-orders', JSON.stringify(l.slice(0, 40))); } catch (e) {}
    },
    customer: function () { try { return JSON.parse(localStorage.getItem('qmo:cust') || '{}'); } catch (e) { return {}; } },
    saveCustomer: function (c) { try { localStorage.setItem('qmo:cust', JSON.stringify(c)); } catch (e) {} }
  };

  /* ==========================================================================
     Tampilan keranjang (sheet layar penuh di HP)
     ========================================================================== */
  var CartUI = {
    open: function (opts) {
      opts = opts || {};
      var cm = global.CustomerMenu ? global.CustomerMenu.state : { type: 'dinein', tableCode: '' };
      var form = { note: '', allergy: '', name: Cart.customer().name || '', phone: Cart.customer().phone || '' };
      var submitting = false, view = 'cart', lastOrder = null;
      var m = App.modal({ title: false, body: '<div id="cartRoot"></div>', size: 'sm', sheet: true, noFocus: true, onClose: function () { if (opts.onChange) opts.onChange(); } });
      m.el.querySelector('.dialog').classList.add('cart-sheet');
      var root = $('#cartRoot', m.el);

      function tableLabel() { if (cm.type === 'takeaway') return 'Bungkus'; var t = cm.tableCode ? Store.getTableByCode(cm.tableCode) : null; return t ? t.name : 'Pilih meja'; }

      function paint() {
        if (view === 'success') return paintSuccess();
        var lines = Cart.valid(), calc = Cart.calc(), s = Store.getSettings();
        var head = '<header class="cs-head"><button class="icon-btn" data-close aria-label="Kembali">' + ic('arrow-left') + '</button><h2>Keranjang Pesanan</h2>' + (lines.length ? '<button class="link-danger" data-act="clear">Kosongkan</button>' : '<span></span>') + '</header>';
        if (!lines.length) {
          root.innerHTML = head + '<div class="cs-body">' + App.UI.empty('shopping-cart', 'Keranjang masih kosong', 'Pilih menu favorit Anda lalu kirim pesanan dari sini.', '<button class="btn btn-primary" data-close>Lihat Menu</button>') + '</div>';
          App.refreshIcons(); return;
        }
        var hasIssue = lines.some(function (l) { return l.issue; });
        var items = lines.map(function (l) {
          var mm = l.menu, pi = Menu.priceInfo(mm), unit = Pricing.calc([{ menu: mm, qty: 1 }]).lines[0].price;
          return '<li class="cs-item' + (l.issue ? ' has-issue' : '') + '" data-id="' + mm.id + '"><img src="' + esc(App.foodImg(mm)) + '" alt="">' +
            '<div class="cs-info"><div class="cs-row"><b>' + esc(mm.name) + '</b><button class="icon-btn sm danger" data-act="remove" data-id="' + mm.id + '" aria-label="Hapus ' + esc(mm.name) + '">' + ic('trash-2') + '</button></div>' +
            '<small class="muted">' + rp(unit) + (unit < mm.price ? ' <s>' + rp(mm.price) + '</s>' : '') + '</small>' +
            (l.issue ? '<div class="issue">' + ic('triangle-alert') + esc(l.issue) + ' Kurangi jumlah atau hapus.</div>' : '') +
            '<div class="cs-row"><div class="stepper"><button data-act="dec" data-id="' + mm.id + '" aria-label="Kurangi">' + ic('minus') + '</button><b>' + l.qty + '</b><button data-act="inc" data-id="' + mm.id + '" aria-label="Tambah">' + ic('plus') + '</button></div><b class="line-total">' + rp(unit * l.qty) + '</b></div>' +
            '<input class="item-note" data-note="' + mm.id + '" type="text" maxlength="100" placeholder="Catatan item (mis. tidak pedas)" value="' + esc(l.note || '') + '" aria-label="Catatan untuk ' + esc(mm.name) + '"></div></li>';
        }).join('');
        var discRows = calc.discounts.map(function (d) { return '<div class="sum-row disc"><span>' + esc(d.name) + '</span><b>-' + rp(d.amount) + '</b></div>'; }).join('');
        var summary = '<div class="summary"><div class="sum-row"><span>Subtotal</span><b>' + rp(calc.subtotal) + '</b></div>' + discRows +
          (calc.service ? '<div class="sum-row"><span>' + esc(s.service.label || 'Biaya layanan') + ' (' + s.service.rate + '%)</span><b>' + rp(calc.service) + '</b></div>' : '') +
          (calc.tax ? '<div class="sum-row"><span>' + esc(s.tax.label || 'Pajak') + ' (' + s.tax.rate + '%)</span><b>' + rp(calc.tax) + '</b></div>' : '') +
          '<div class="sum-row total"><span>Total</span><b>' + rp(calc.total) + '</b></div></div>';
        root.innerHTML = head +
          '<div class="cs-body"><div class="cs-table"><span class="chip chip-table">' + ic(cm.type === 'takeaway' ? 'shopping-bag' : 'armchair') + '<b>' + esc(tableLabel()) + '</b></span></div>' +
          '<ul class="cs-list">' + items + '</ul>' +
          '<label class="lbl" for="fNote">Catatan untuk dapur (opsional)</label><textarea id="fNote" rows="2" maxlength="200" placeholder="Contoh: tidak pedas, tanpa bawang, sambal dipisah">' + esc(form.note) + '</textarea>' +
          '<label class="lbl" for="fAllergy">' + ic('shield-alert') + ' Catatan alergi (informasi untuk staf)</label><input id="fAllergy" type="text" maxlength="120" placeholder="Contoh: alergi kacang / udang" value="' + esc(form.allergy) + '">' +
          '<details class="opt"' + (form.name || form.phone ? ' open' : '') + '><summary>Data pemesan (opsional)</summary><div class="opt-grid"><input id="fName" type="text" maxlength="50" placeholder="Nama (opsional)" value="' + esc(form.name) + '" autocomplete="name"><input id="fPhone" type="tel" maxlength="20" placeholder="No. HP (opsional)" value="' + esc(form.phone) + '" autocomplete="tel"></div><small class="muted">Tidak wajib. Hanya dipakai staf bila perlu menghubungi Anda.</small></details>' +
          summary +
          '<p class="demo-note">' + ic('info') + 'Mode demo: pesanan tersimpan di browser ini dan belum tersinkron ke perangkat dapur lain.</p></div>' +
          '<footer class="cs-foot"><button class="btn btn-primary btn-block btn-lg" data-act="submit"' + (hasIssue || submitting ? ' disabled' : '') + '>' + ic(submitting ? 'loader' : 'send') + (submitting ? 'Mengirim…' : 'Kirim Pesanan') + '</button>' + (hasIssue ? '<small class="text-danger ta-c">Perbaiki item bermasalah sebelum mengirim.</small>' : '') + '</footer>';
        App.refreshIcons();
      }

      function paintSuccess() {
        var o = lastOrder;
        root.innerHTML = '<div class="success"><div class="success-ic">' + ic('check') + '</div><h2>Pesanan Berhasil!</h2><p class="muted">Nomor Pesanan</p><div class="order-no">' + esc(o.number) + '</div>' +
          '<p class="muted">' + esc(o.tableName) + ' · ' + App.fmtDate(o.createdAt) + ' · ' + App.fmtTime(o.createdAt) + '</p>' +
          '<p class="success-msg">Pesanan Anda telah dikirim ke dapur. Silakan menunggu, pesanan akan segera diproses.</p>' +
          '<div class="success-sum">' + o.items.map(function (i) { return '<div><span>' + i.qty + '× ' + esc(i.name) + '</span><b>' + rp(i.price * i.qty) + '</b></div>'; }).join('') + '<div class="t"><span>Total</span><b>' + rp(o.total) + '</b></div></div>' +
          '<p class="muted small">Bayar di kasir' + (global.QRIS && QRIS.cfg().enabled ? ' atau langsung lewat QRIS' : '') + '. Status pembayaran: <b>' + esc(Orders.PAY[o.payStatus]) + '</b>.</p>' +
          (global.QRIS && QRIS.cfg().enabled && o.payStatus === 'unpaid' ? '<button class="btn btn-primary btn-block" data-act="qris" data-id="' + o.id + '">' + ic('qr-code') + 'Bayar dengan QRIS</button>' : '') +
          '<a class="btn btn-outline btn-block" href="order.html?id=' + o.id + '">Lihat Pesanan Saya</a><button class="btn btn-ghost btn-block" data-close>' + ic('rotate-ccw') + 'Pesan Lagi</button></div>';
        App.refreshIcons();
      }

      function readForm() {
        var g = function (id) { var e = $('#' + id, root); return e ? e.value : null; };
        if (g('fNote') !== null) form.note = g('fNote'); if (g('fAllergy') !== null) form.allergy = g('fAllergy');
        if (g('fName') !== null) form.name = g('fName'); if (g('fPhone') !== null) form.phone = g('fPhone');
      }

      root.addEventListener('input', function (e) {
        if (e.target.matches('[data-note]')) Cart.setNote(e.target.getAttribute('data-note'), e.target.value);
        else readForm();
      });
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'qris') { QRIS.open(id); return; }
        readForm();
        if (act === 'inc') { var r = Cart.add(id, 1); if (!r.ok) App.toast(r.message, 'warn'); paint(); }
        else if (act === 'dec') { Cart.setQty(id, Cart.qty(id) - 1); paint(); }
        else if (act === 'remove') { Cart.remove(id); paint(); }
        else if (act === 'clear') { App.confirm({ title: 'Kosongkan keranjang?', message: 'Semua item di keranjang akan dihapus.', confirmText: 'Kosongkan', danger: true }).then(function (ok) { if (ok) { Cart.clear(); paint(); } }); }
        else if (act === 'submit') submit();
      });

      function submit() {
        if (submitting) return;
        if (cm.type !== 'takeaway' && !cm.tableCode) { App.toast('Pilih nomor meja terlebih dahulu.', 'warn'); m.close(); if (global.CustomerMenu) global.CustomerMenu.pickTable(true); return; }
        var lines = Cart.valid();
        if (!lines.length) { App.toast('Keranjang masih kosong.', 'warn'); return; }
        submitting = true; paint();
        // beri jeda singkat agar status "Mengirim…" terlihat dan mencegah klik ganda
        setTimeout(function () {
          try {
            var res = Orders.create({
              type: cm.type, tableCode: cm.tableCode,
              items: lines.map(function (l) { return { menuId: l.menuId, qty: l.qty, note: l.note }; }),
              note: form.note, allergy: form.allergy, customer: { name: form.name, phone: form.phone }
            }, { source: 'qr', by: 'Pelanggan' });
            Cart.saveCustomer({ name: form.name.trim(), phone: form.phone.trim() });
            Cart.addMyOrder(res.id);
            Cart.clear();            // dikosongkan HANYA setelah pesanan tersimpan
            lastOrder = res; view = 'success'; submitting = false; paint();
            App.toast('Pesanan berhasil dikirim.');
          } catch (err) {
            submitting = false; paint();
            App.toast(err.message || 'Pesanan gagal dikirim. Keranjang Anda tetap aman.', 'error', 6000);
          }
        }, 350);
      }
      paint();
      return m;
    }
  };

  global.Cart = Cart; global.CartUI = CartUI;
})(window);
