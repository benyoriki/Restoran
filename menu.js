/* ==========================================================================
   menu.js — logika menu, promo & harga + halaman menu pelanggan
   + tampilan admin: Menu Makanan, Kategori, Stok, Promo
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, $$ = App.$$, esc = App.esc, rp = App.rp, ic = App.ic;

  /* ==========================================================================
     Menu helpers
     ========================================================================== */
  var Menu = {
    isSoldOut: function (m) { return !m.available || m.stock <= 0; },
    isLow: function (m) { return m.stock > 0 && m.stock <= m.minStock; },
    manualUnit: function (m) { return (m.promoPrice != null && m.promoPrice > 0 && m.promoPrice < m.price) ? m.promoPrice : m.price; },
    visible: function () { return Store.getMenus().filter(function (m) { return m.active !== false; }); },
    categoryName: function (id) { var c = Store.get('categories', id); return c ? c.name : '-'; },
    /** Harga yang ditampilkan di menu pelanggan (promo tanpa minimal belanja ikut dihitung) */
    priceInfo: function (m, ts) {
      var unit = Menu.manualUnit(m), label = unit < m.price ? 'Promo' : '', promo = null, best = 0;
      Store.getPromos().forEach(function (p) {
        if (!Promo.isActive(p, ts) || p.scope === 'all' || p.minPurchase > 0 || !Promo.appliesTo(p, m)) return;
        var d = Promo.unitDiscount(p, unit);
        if (d > best) { best = d; promo = p; }
      });
      if (promo) { unit = unit - best; label = promo.label || 'Promo'; }
      return { base: m.price, final: Math.max(0, unit), label: label, promoId: promo ? promo.id : null, onPromo: unit < m.price };
    }
  };

  /* ==========================================================================
     Promo & perhitungan harga
     - Promo "per menu/kategori": diskon dihitung per unit (persen, nominal per item, atau harga khusus).
     - Promo "seluruh pesanan": persen atau nominal sekali per pesanan.
     - Dalam satu pesanan: tiap baris memakai promo terbaik; satu promo seluruh pesanan terbaik.
     - Maksimal diskon: per item (promo menu/kategori) atau per pesanan (promo seluruh pesanan).
     - Promo yang berakhir/nonaktif/belum mulai tidak pernah dipakai.
     ========================================================================== */
  var Promo = {
    isActive: function (p, ts) {
      if (!p.active) return false;
      var d = App.isoDate(ts || Date.now());
      if (p.startDate && d < p.startDate) return false;
      if (p.endDate && d > p.endDate) return false;
      return true;
    },
    status: function (p, ts) {
      if (!p.active) return { key: 'off', label: 'Nonaktif', cls: 'muted' };
      var d = App.isoDate(ts || Date.now());
      if (p.endDate && d > p.endDate) return { key: 'ended', label: 'Berakhir', cls: 'danger' };
      if (p.startDate && d < p.startDate) return { key: 'scheduled', label: 'Terjadwal', cls: 'info' };
      return { key: 'active', label: 'Aktif', cls: 'success' };
    },
    appliesTo: function (p, m) {
      if (p.scope === 'menu') return (p.targetIds || []).indexOf(m.id) >= 0;
      if (p.scope === 'category') return (p.targetIds || []).indexOf(m.categoryId) >= 0;
      return false;
    },
    unitDiscount: function (p, unit) {
      var d = 0;
      if (p.type === 'percent') d = Math.round(unit * p.value / 100);
      else if (p.type === 'nominal') d = p.value;
      else if (p.type === 'special') d = unit - p.value;
      if (p.maxDiscount > 0) d = Math.min(d, p.maxDiscount);
      return Math.max(0, Math.min(d, unit));
    },
    describe: function (p) {
      var v = p.type === 'percent' ? p.value + '%' : p.type === 'nominal' ? rp(p.value) + (p.scope === 'all' ? '' : '/item') : 'Harga ' + rp(p.value);
      return v;
    },
    scopeText: function (p) {
      if (p.scope === 'all') return 'Seluruh pesanan';
      var names = (p.targetIds || []).map(function (id) {
        var x = p.scope === 'menu' ? Store.get('menus', id) : Store.get('categories', id); return x ? x.name : '?';
      });
      return (p.scope === 'menu' ? 'Menu: ' : 'Kategori: ') + (names.join(', ') || '-');
    }
  };

  var Pricing = {
    /** lines: [{menu, qty, note}] → rincian harga lengkap (tidak mengubah data) */
    calc: function (lines, settings, ts) {
      settings = settings || Store.getSettings();
      var promos = Store.getPromos().filter(function (p) { return Promo.isActive(p, ts); });
      var out = lines.map(function (l) {
        var unit = Menu.manualUnit(l.menu);
        return { menuId: l.menu.id, name: l.menu.name, basePrice: l.menu.price, price: unit, qty: l.qty, note: l.note || '', discount: 0, promoId: null, promoName: '' };
      });
      var gross = out.reduce(function (s, x) { return s + x.price * x.qty; }, 0);
      var discounts = {};
      // 1) promo per menu / kategori
      out.forEach(function (x, i) {
        var m = lines[i].menu, best = 0, bp = null;
        promos.forEach(function (p) {
          if (p.scope === 'all' || gross < (p.minPurchase || 0) || !Promo.appliesTo(p, m)) return;
          var d = Promo.unitDiscount(p, x.price);
          if (d > best) { best = d; bp = p; }
        });
        if (bp) {
          x.discount = best * x.qty; x.promoId = bp.id; x.promoName = bp.name;
          discounts[bp.id] = discounts[bp.id] || { promoId: bp.id, name: bp.name, amount: 0 };
          discounts[bp.id].amount += x.discount;
        }
      });
      var afterLines = gross - out.reduce(function (s, x) { return s + x.discount; }, 0);
      // 2) promo seluruh pesanan (pilih yang terbaik)
      var bestAll = null, bestAmt = 0;
      promos.forEach(function (p) {
        if (p.scope !== 'all' || gross < (p.minPurchase || 0)) return;
        var d = p.type === 'percent' ? Math.round(afterLines * p.value / 100) : p.type === 'nominal' ? p.value : 0;
        if (p.maxDiscount > 0) d = Math.min(d, p.maxDiscount);
        d = Math.max(0, Math.min(d, afterLines));
        if (d > bestAmt) { bestAmt = d; bestAll = p; }
      });
      if (bestAll) discounts[bestAll.id] = { promoId: bestAll.id, name: bestAll.name, amount: bestAmt };
      var list = Object.keys(discounts).map(function (k) { return discounts[k]; });
      var discount = Math.min(gross, list.reduce(function (s, d) { return s + d.amount; }, 0));
      var net = Math.max(0, gross - discount);
      var service = settings.service && settings.service.enabled ? Math.round(net * settings.service.rate / 100) : 0;
      var tax = settings.tax && settings.tax.enabled ? Math.round((net + service) * settings.tax.rate / 100) : 0;
      return { lines: out, subtotal: gross, discount: discount, discounts: list, net: net, service: service, tax: tax, total: net + service + tax };
    }
  };

  global.Menu = Menu; global.Promo = Promo; global.Pricing = Pricing;

  /* ==========================================================================
     HALAMAN MENU PELANGGAN (menu.html)
     ========================================================================== */
  var CM = {
    state: { tab: 'menu', cat: 'all', q: '', searchOpen: false, tableCode: null, type: 'dinein' },

    resolveTable: function (param) {
      if (!param) return null;
      var t = Store.getTableByCode(param);
      if (!t && /^\d+$/.test(param)) t = Store.getTableByCode('MEJA-' + ('0' + param).slice(-2));
      return t;
    },

    init: function () {
      var root = $('#app'); CM.root = root;
      var params = new URLSearchParams(location.search), st = CM.state;
      var tp = params.get('table');
      if (params.get('type') === 'takeaway' || (tp || '').toUpperCase() === 'BUNGKUS') { st.type = 'takeaway'; st.tableCode = ''; }
      else if (tp) {
        var t = CM.resolveTable(tp);
        if (t && t.active) { st.tableCode = t.code; }
        else { st.tableCode = null; st.tableProblem = t ? 'Meja "' + t.name + '" sedang tidak aktif.' : 'Meja "' + tp + '" tidak ditemukan.'; }
      }
      Cart.setContext(st.type === 'takeaway' ? 'BUNGKUS' : (st.tableCode || 'NONE'));
      CM.bind(); CM.render();
      Store.subscribe(App.debounce(function () { if (!document.querySelector('.overlay')) CM.render(); else CM.updateBadges(); }, 250));
      if (!st.tableCode && st.type !== 'takeaway') CM.pickTable(true);
    },

    tableLabel: function () {
      var st = CM.state; if (st.type === 'takeaway') return 'Bungkus';
      var t = st.tableCode ? Store.getTableByCode(st.tableCode) : null; return t ? t.name : 'Pilih meja';
    },

    bind: function () {
      var root = CM.root;
      App.delegate(root, 'click', '[data-act]', function (e, el) {
        var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
        if (act === 'tab') CM.setTab(el.getAttribute('data-tab'));
        else if (act === 'cat') { CM.state.cat = el.getAttribute('data-cat'); CM.render(); }
        else if (act === 'add') { e.stopPropagation(); CM.add(id); }
        else if (act === 'inc') { e.stopPropagation(); CM.add(id); }
        else if (act === 'dec') { e.stopPropagation(); Cart.setQty(id, Cart.qty(id) - 1); CM.render(); }
        else if (act === 'detail') CM.detail(id);
        else if (act === 'search') { CM.state.searchOpen = !CM.state.searchOpen; if (CM.state.searchOpen) CM.state.tab = 'menu'; CM.render(); var i = $('#q'); if (i) i.focus(); }
        else if (act === 'cart') CartUI.open({ onChange: CM.render });
        else if (act === 'table') CM.pickTable(false);
        else if (act === 'reorder') CM.reorder(id);
        else if (act === 'clearq') { CM.state.q = ''; CM.render(); }
        else if (act === 'theme') App.Theme.toggle();
      });
      root.addEventListener('input', function (e) {
        if (e.target.id === 'q') { CM.state.q = e.target.value; CM.renderGrid(); }
      });
    },

    setTab: function (tab) {
      var st = CM.state;
      if (tab === 'cart') { CartUI.open({ onChange: CM.render }); return; }
      st.tab = tab; CM.render(); window.scrollTo({ top: 0 });
    },

    add: function (id) {
      var m = Store.getMenu(id); if (!m) return;
      var r = Cart.add(id, 1);
      if (!r.ok) App.toast(r.message, 'warn');
      CM.render();
    },

    /* ---------- render ---------- */
    render: function () {
      var s = Store.getSettings(), st = CM.state, r = s.restaurant;
      var count = Cart.count();
      document.title = r.name + ' — Menu Digital';
      var logo = r.logo ? '<img src="' + esc(r.logo) + '" alt="Logo ' + esc(r.name) + '">' : '<span class="logo-ph">' + ic('chef-hat') + '</span>';
      var head = '<header class="cust-head"><div class="cust-brand">' + '<span class="cust-logo">' + logo + '</span>' +
        '<div><h1>' + esc(r.name) + '</h1><p>' + ic('map-pin') + esc(r.tagline || '') + '</p></div></div>' +
        '<div class="cust-actions"><button class="icon-btn" data-act="search" aria-label="Cari menu">' + ic('search') + '</button>' +
        '<button class="icon-btn cart-btn" data-act="cart" aria-label="Keranjang">' + ic('shopping-cart') + '<span class="count" id="cartBadge"' + (count ? '' : ' hidden') + '>' + count + '</span></button></div></header>';
      var tbl = '<div class="cust-sub"><button class="chip chip-table" data-act="table">' + ic(st.type === 'takeaway' ? 'shopping-bag' : 'armchair') + '<b>' + esc(CM.tableLabel()) + '</b>' + ic('chevron-down') + '</button>' +
        '<span class="open-now">' + ic('clock') + esc(r.hours || '') + '</span></div>';
      var body = '';
      if (st.tab === 'menu') body = CM.menuTab();
      else if (st.tab === 'home') body = CM.homeTab();
      else if (st.tab === 'history') body = CM.historyTab();
      else if (st.tab === 'more') body = CM.moreTab();
      var nav = [['home', 'house', 'Beranda'], ['menu', 'utensils-crossed', 'Menu'], ['cart', 'shopping-cart', 'Keranjang'], ['history', 'history', 'Riwayat'], ['more', 'menu', 'Lainnya']];
      var bottom = '<nav class="bottom-nav" aria-label="Navigasi utama">' + nav.map(function (n) {
        return '<button data-act="tab" data-tab="' + n[0] + '" class="' + (st.tab === n[0] ? 'on' : '') + '" ' + (st.tab === n[0] ? 'aria-current="page"' : '') + '>' + ic(n[1]) + '<span>' + n[2] + '</span>' + (n[0] === 'cart' ? '<em class="count" id="navBadge"' + (count ? '' : ' hidden') + '>' + count + '</em>' : '') + '</button>';
      }).join('') + '</nav>';
      var bar = '';
      if (count && st.tab !== 'history') {
        var calc = Cart.calc();
        bar = '<button class="cart-bar" data-act="cart"><span class="cb-l">' + ic('shopping-bag') + '<b>' + count + ' item</b></span><span class="cb-r">Lihat keranjang · ' + rp(calc.total) + '</span></button>';
      }
      var keepQ = CM.root.querySelector('#q'), hadFocus = keepQ && document.activeElement === keepQ;
      CM.root.innerHTML = '<div class="cust-shell">' + head + tbl + body + '</div>' + bar + bottom;
      if (hadFocus) { var nq = $('#q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }
      App.refreshIcons();
    },

    updateBadges: function () {
      var c = Cart.count();
      ['cartBadge', 'navBadge'].forEach(function (id) { var el = document.getElementById(id); if (el) { el.textContent = c; el.hidden = !c; } });
    },

    menuTab: function () {
      var st = CM.state, cats = Store.getCategories().filter(function (c) { return c.active !== false; });
      var menus = Menu.visible();
      var hasPromo = menus.some(function (m) { return Menu.priceInfo(m).onPromo; });
      var hasPop = menus.some(function (m) { return m.featured; });
      var pills = [['all', 'Semua Menu']];
      if (hasPop) pills.push(['popular', 'Populer']);
      if (hasPromo) pills.push(['promo', 'Promo']);
      cats.forEach(function (c) { if (menus.some(function (m) { return m.categoryId === c.id; })) pills.push([c.id, c.name]); });
      var search = '<div class="search-bar"' + (st.searchOpen || st.q ? '' : ' hidden') + '>' + ic('search') + '<input id="q" type="search" placeholder="Cari makanan atau minuman…" value="' + esc(st.q) + '" aria-label="Cari menu" autocomplete="off">' + (st.q ? '<button class="icon-btn sm" data-act="clearq" aria-label="Hapus pencarian">' + ic('x') + '</button>' : '') + '</div>';
      var pillsHtml = '<div class="cat-pills" role="tablist">' + pills.map(function (p) {
        return '<button role="tab" aria-selected="' + (st.cat === p[0]) + '" class="pill ' + (st.cat === p[0] ? 'on' : '') + '" data-act="cat" data-cat="' + p[0] + '">' + esc(p[1]) + '</button>';
      }).join('') + '</div>';
      return search + pillsHtml + '<main id="grid" class="food-grid">' + CM.gridHtml() + '</main><p class="demo-note">' + ic('info') + 'Mode demo: pesanan tersimpan di browser ini.</p>';
    },
    renderGrid: function () { var g = $('#grid'); if (g) { g.innerHTML = CM.gridHtml(); App.refreshIcons(); } },

    filtered: function () {
      var st = CM.state, q = st.q.trim().toLowerCase();
      return Menu.visible().filter(function (m) {
        if (st.cat === 'popular' && !m.featured) return false;
        if (st.cat === 'promo' && !Menu.priceInfo(m).onPromo) return false;
        if (st.cat !== 'all' && st.cat !== 'popular' && st.cat !== 'promo' && m.categoryId !== st.cat) return false;
        if (q && (m.name + ' ' + (m.desc || '') + ' ' + Menu.categoryName(m.categoryId)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    },

    cardHtml: function (m) {
      var pi = Menu.priceInfo(m), sold = Menu.isSoldOut(m), q = Cart.qty(m.id), low = Menu.isLow(m);
      var badges = '';
      if (sold) badges += '<span class="tag tag-sold">Habis</span>';
      else {
        if (pi.onPromo) badges += '<span class="tag tag-promo">' + esc(pi.label || 'Promo') + '</span>';
        else if (m.featured) badges += '<span class="tag tag-pop">Populer</span>';
        if (low) badges += '<span class="tag tag-low">Sisa ' + m.stock + '</span>';
      }
      var ctrl;
      if (sold) ctrl = '<span class="soldout-txt">Tidak tersedia</span>';
      else if (q > 0) ctrl = '<div class="stepper" role="group" aria-label="Jumlah ' + esc(m.name) + '"><button data-act="dec" data-id="' + m.id + '" aria-label="Kurangi">' + ic('minus') + '</button><b>' + q + '</b><button data-act="inc" data-id="' + m.id + '" aria-label="Tambah">' + ic('plus') + '</button></div>';
      else ctrl = '<button class="add-btn" data-act="add" data-id="' + m.id + '" aria-label="Tambah ' + esc(m.name) + ' ke keranjang">' + ic('plus') + '</button>';
      return '<article class="food-card' + (sold ? ' is-sold' : '') + '" data-act="detail" data-id="' + m.id + '" tabindex="0">' +
        '<div class="food-img"><img loading="lazy" src="' + esc(App.foodImg(m)) + '" alt="' + esc(m.name) + '">' + (badges ? '<div class="tags">' + badges + '</div>' : '') + '</div>' +
        '<div class="food-body"><h3>' + esc(m.name) + '</h3><p>' + esc(m.desc || '') + '</p>' +
        '<div class="food-foot"><div class="price">' + (pi.onPromo ? '<s>' + rp(pi.base) + '</s>' : '') + '<b>' + rp(pi.final) + '</b></div>' + ctrl + '</div></div></article>';
    },
    gridHtml: function () {
      var list = CM.filtered();
      if (!list.length) return '<div class="grid-empty">' + App.UI.empty('search-x', 'Menu tidak ditemukan', 'Coba kata kunci atau kategori lain.', '<button class="btn btn-soft" data-act="cat" data-cat="all">Tampilkan semua menu</button>') + '</div>';
      return list.map(CM.cardHtml).join('');
    },

    homeTab: function () {
      var s = Store.getSettings(), r = s.restaurant, menus = Menu.visible();
      var promos = menus.filter(function (m) { return Menu.priceInfo(m).onPromo && !Menu.isSoldOut(m); }).slice(0, 4);
      var pops = menus.filter(function (m) { return m.featured && !Menu.isSoldOut(m); }).slice(0, 6);
      var h = '<section class="home-hero"><div><span class="chip chip-soft">' + ic('sparkles') + 'Selamat datang</span><h2>Pesan langsung dari meja Anda</h2><p>Pilih menu, kirim pesanan, dan dapur kami langsung menyiapkannya.</p><button class="btn btn-primary" data-act="tab" data-tab="menu">' + ic('utensils-crossed') + 'Lihat Menu</button></div></section>';
      if (promos.length) h += '<h3 class="sec-title">' + ic('badge-percent') + 'Sedang Promo</h3><div class="food-grid">' + promos.map(CM.cardHtml).join('') + '</div>';
      if (pops.length) h += '<h3 class="sec-title">' + ic('flame') + 'Menu Populer</h3><div class="food-grid">' + pops.map(CM.cardHtml).join('') + '</div>';
      h += '<section class="info-card"><h3>' + esc(r.name) + '</h3><p>' + ic('map-pin') + esc(r.address) + '</p><p>' + ic('clock') + esc(r.hours) + '</p><div class="btn-row">' +
        (r.maps ? '<a class="btn btn-soft" target="_blank" rel="noopener" href="' + esc(r.maps) + '">' + ic('map') + 'Buka Google Maps</a>' : '') +
        (r.whatsapp ? '<a class="btn btn-soft" target="_blank" rel="noopener" href="' + esc(App.waLink(r.whatsapp)) + '">' + ic('message-circle') + 'WhatsApp</a>' : '') + '</div></section>';
      return h;
    },

    historyTab: function () {
      var ids = Cart.myOrders(), orders = ids.map(function (id) { return Store.getOrder(id); }).filter(Boolean);
      if (!orders.length) return '<div class="pad">' + App.UI.empty('receipt', 'Belum ada riwayat', 'Pesanan yang Anda kirim dari perangkat ini akan tampil di sini.', '<button class="btn btn-primary" data-act="tab" data-tab="menu">Mulai Pesan</button>') + '</div>';
      return '<div class="pad"><h3 class="sec-title">' + ic('history') + 'Riwayat Pesanan</h3><div class="hist-list">' + orders.map(function (o) {
        return '<article class="hist-card"><div class="hist-top"><div><b>' + esc(o.number) + '</b><small>' + esc(o.tableName) + ' · ' + App.fmtDateTime(o.createdAt) + '</small></div><div class="hist-badges">' + Orders.statusBadge(o) + Orders.payBadge(o) + '</div></div>' +
          '<ul class="hist-items">' + o.items.map(function (i) { return '<li>' + i.qty + '× ' + esc(i.name) + '</li>'; }).join('') + '</ul>' +
          '<div class="hist-foot"><b>' + rp(o.total) + '</b><div class="btn-row"><a class="btn btn-ghost btn-sm" href="order.html?id=' + o.id + '">' + ic('eye') + 'Lihat</a><button class="btn btn-soft btn-sm" data-act="reorder" data-id="' + o.id + '">' + ic('rotate-ccw') + 'Pesan lagi</button></div></div></article>';
      }).join('') + '</div></div>';
    },

    moreTab: function () {
      var s = Store.getSettings(), r = s.restaurant, dark = App.Theme.current() === 'dark';
      var row = function (icon, text, extra) { return '<li>' + ic(icon) + '<span>' + text + '</span>' + (extra || '') + '</li>'; };
      return '<div class="pad"><h3 class="sec-title">' + ic('menu') + 'Lainnya</h3><ul class="more-list">' +
        (r.maps ? '<li><a href="' + esc(r.maps) + '" target="_blank" rel="noopener">' + ic('map-pin') + '<span>Lokasi di Google Maps</span>' + ic('external-link') + '</a></li>' : '') +
        (r.whatsapp ? '<li><a href="' + esc(App.waLink(r.whatsapp, 'Halo ' + r.name)) + '" target="_blank" rel="noopener">' + ic('message-circle') + '<span>Hubungi via WhatsApp</span>' + ic('external-link') + '</a></li>' : '') +
        row('clock', esc(r.hours || '-')) + row('map', esc(r.address || '-')) +
        '<li><button data-act="theme">' + ic(dark ? 'sun' : 'moon') + '<span>Mode ' + (dark ? 'terang' : 'gelap') + '</span></button></li>' +
        '<li><a href="index.html">' + ic('house') + '<span>Tentang QR Menu &amp; Order</span>' + ic('chevron-right') + '</a></li>' +
        '<li><a href="login.html">' + ic('log-in') + '<span>Masuk staf restoran</span>' + ic('chevron-right') + '</a></li></ul>' +
        '<p class="demo-note">' + ic('info') + 'Ini adalah versi prototype. Data pesanan disimpan di browser perangkat ini dan belum tersinkron ke perangkat lain.</p>' +
        '<p class="foot-note">' + esc(r.footer || '') + '<br>Powered by QR Menu &amp; Order · <a href="https://benyoriki.com" target="_blank" rel="noopener">@benyoriki</a></p></div>';
    },

    /* ---------- detail menu ---------- */
    detail: function (id) {
      var m = Store.getMenu(id); if (!m) return;
      var pi = Menu.priceInfo(m), sold = Menu.isSoldOut(m), low = Menu.isLow(m);
      var existing = Cart.get(id), qty = existing ? existing.qty : 1, note = existing ? existing.note : '';
      var stockTxt = sold ? '<span class="stock out">Habis</span>' : low ? '<span class="stock low">Stok menipis · sisa ' + m.stock + '</span>' : '<span class="stock ok">Stok tersedia</span>';
      var body = '<div class="detail"><div class="detail-img"><img src="' + esc(App.foodImg(m)) + '" alt="' + esc(m.name) + '"></div><div class="detail-body">' +
        '<div class="detail-top"><div><small class="cat-name">' + esc(Menu.categoryName(m.categoryId)) + '</small><h3>' + esc(m.name) + '</h3></div><div class="price big">' + (pi.onPromo ? '<s>' + rp(pi.base) + '</s>' : '') + '<b>' + rp(pi.final) + '</b></div></div>' +
        '<p class="detail-desc">' + esc(m.desc || '') + '</p><div class="detail-meta">' + stockTxt + (pi.onPromo ? '<span class="tag tag-promo">' + esc(pi.label) + '</span>' : '') + '</div>' +
        (sold ? '' : '<label class="lbl" for="dNote">Catatan khusus (opsional)</label><textarea id="dNote" rows="2" maxlength="140" placeholder="Contoh: tidak pedas, tanpa bawang">' + esc(note) + '</textarea>' +
          '<div class="detail-qty"><div class="stepper lg"><button id="dDec" aria-label="Kurangi">' + ic('minus') + '</button><b id="dQty">' + qty + '</b><button id="dInc" aria-label="Tambah">' + ic('plus') + '</button></div></div>') +
        '</div></div>';
      var foot = sold ? '<button class="btn btn-ghost btn-block" data-close>Tutup</button>' : '<button class="btn btn-primary btn-block btn-lg" id="dAdd"></button>';
      var mod = App.modal({ title: false, body: body, footer: foot, size: 'sm', sheet: true });
      if (sold) return;
      var q = qty;
      function paint() {
        $('#dQty', mod.el).textContent = q;
        $('#dAdd', mod.el).innerHTML = (existing ? 'Perbarui keranjang' : 'Tambah ke keranjang') + ' · ' + rp(pi.final * q);
      }
      paint();
      $('#dInc', mod.el).onclick = function () { if (q + 1 > m.stock) { App.toast('Stok ' + m.name + ' tinggal ' + m.stock + '.', 'warn'); return; } q++; paint(); };
      $('#dDec', mod.el).onclick = function () { if (q > 1) { q--; paint(); } };
      $('#dAdd', mod.el).onclick = function () {
        var r = Cart.set(id, q, $('#dNote', mod.el).value.trim());
        if (!r.ok) { App.toast(r.message, 'warn'); return; }
        mod.close(); App.toast(m.name + ' masuk keranjang', 'success'); CM.render();
      };
      var close = $('.dialog-head', mod.el); if (close) close.remove();
    },

    /* ---------- pilih meja ---------- */
    pickTable: function (forced) {
      var st = CM.state, tables = Store.getTables().filter(function (t) { return t.active; });
      var body = '<div class="pick-table">' + (st.tableProblem ? '<div class="notice warn">' + ic('triangle-alert') + '<span>' + esc(st.tableProblem) + ' Pilih meja Anda di bawah.</span></div>' : '<p class="muted">Pilih nomor meja tempat Anda duduk. Biasanya terisi otomatis saat memindai QR di meja.</p>') +
        '<div class="table-grid">' + tables.map(function (t) { return '<button class="tbl-btn' + (t.code === st.tableCode ? ' on' : '') + '" data-code="' + esc(t.code) + '">' + esc(t.name) + '</button>'; }).join('') + '</div>' +
        '<button class="btn btn-soft btn-block" data-takeaway>' + ic('shopping-bag') + 'Pesan untuk dibungkus</button></div>';
      var m = App.modal({ title: 'Pilih Meja', body: body, size: 'sm', sheet: true, dismissible: !forced || !!st.tableCode || st.type === 'takeaway' });
      function apply(code, type) {
        if (Cart.count() && (st.tableCode !== code || st.type !== type) && Cart.context !== (type === 'takeaway' ? 'BUNGKUS' : code)) {
          // keranjang dipisah per meja; keranjang meja lama tidak ikut pindah
        }
        st.tableCode = code; st.type = type; st.tableProblem = null;
        Cart.setContext(type === 'takeaway' ? 'BUNGKUS' : code);
        m.close(); CM.render();
      }
      App.delegate(m.el, 'click', '[data-code]', function (e, el) { apply(el.getAttribute('data-code'), 'dinein'); });
      $('[data-takeaway]', m.el).onclick = function () { apply('', 'takeaway'); };
    },

    reorder: function (orderId) {
      var o = Store.getOrder(orderId); if (!o) return;
      var added = 0, skipped = [];
      o.items.forEach(function (i) {
        var r = Cart.add(i.menuId, i.qty, i.note);
        if (r.ok) added++; else skipped.push(i.name);
      });
      CM.state.tab = 'menu'; CM.render();
      if (added) App.toast(added + ' item dimasukkan ke keranjang' + (skipped.length ? '. Tidak tersedia: ' + skipped.join(', ') : '.'), skipped.length ? 'warn' : 'success', 4500);
      else App.toast('Item pesanan sebelumnya sedang tidak tersedia.', 'error');
      if (added) CartUI.open({ onChange: CM.render });
    }
  };
  global.CustomerMenu = CM;

  /* ==========================================================================
     TAMPILAN ADMIN
     ========================================================================== */
  var mstate = { q: '', cat: '', status: '', sort: 'name' };

  function menuForm(m, done) {
    var cats = Store.getCategories();
    if (!cats.length) { App.toast('Buat kategori menu terlebih dahulu.', 'warn'); return; }
    var isNew = !m;
    var v = m ? Object.assign({}, m) : { name: '', desc: '', categoryId: cats[0].id, price: '', promoPrice: '', stock: 20, minStock: 5, available: true, featured: false, active: true, image: '' };
    App.formModal({
      title: isNew ? 'Tambah Menu' : 'Edit Menu', size: 'lg', values: v,
      fields: [
        { name: 'image', type: 'image', label: 'Foto menu', cols: 2, maxDim: 800 },
        { name: 'name', label: 'Nama menu', required: true, maxlength: 80, cols: 2 },
        { name: 'desc', label: 'Deskripsi', type: 'textarea', rows: 2, maxlength: 200, cols: 2 },
        { name: 'categoryId', label: 'Kategori', type: 'select', required: true, options: cats.map(function (c) { return { value: c.id, label: c.name }; }) },
        { name: 'price', label: 'Harga', type: 'number', required: true, min: 0, step: 500, prefix: 'Rp' },
        { name: 'promoPrice', label: 'Harga promo (opsional)', type: 'number', min: 0, step: 500, prefix: 'Rp', hint: 'Harus lebih kecil dari harga normal.', validate: function (c) { var pp = parseFloat(c.promoPrice); if (c.promoPrice !== '' && !isNaN(pp) && pp >= parseFloat(c.price)) return 'Harga promo harus lebih kecil dari harga normal.'; } },
        { name: 'stock', label: 'Stok', type: 'number', required: true, min: 0, step: 1 },
        { name: 'minStock', label: 'Batas stok minimum', type: 'number', required: true, min: 0, step: 1, hint: 'Muncul peringatan "menipis" di bawah angka ini.' },
        { name: 'available', type: 'checkbox', text: 'Tersedia (bila dimatikan tampil "Habis")' },
        { name: 'featured', type: 'checkbox', text: 'Menu unggulan / populer' },
        { name: 'active', type: 'checkbox', text: 'Aktif (tampil di menu pelanggan)' }
      ],
      onSubmit: function (c) {
        var item = Object.assign({}, m || {}, {
          name: c.name, desc: c.desc, categoryId: c.categoryId, price: c.price, promoPrice: c.promoPrice == null ? null : c.promoPrice,
          stock: Math.round(c.stock), minStock: Math.round(c.minStock), available: !!c.available, featured: !!c.featured, active: !!c.active, image: c.image || ''
        });
        if (isNew) { item.emoji = '🍽️'; item.colors = ['#cfe3d8', '#5f8f78']; }
        Store.saveMenu(item);
        App.toast(isNew ? 'Menu ditambahkan.' : 'Menu diperbarui.');
        done();
      }
    });
  }

  Admin.register('menus', {
    title: 'Menu Makanan', sub: 'Kelola menu, harga, foto, dan stok', perm: 'menus',
    render: function (root, ctx) {
      var cats = Store.getCategories();
      var list = Store.getMenus().filter(function (m) {
        var q = mstate.q.trim().toLowerCase();
        if (q && (m.name + ' ' + (m.desc || '')).toLowerCase().indexOf(q) < 0) return false;
        if (mstate.cat && m.categoryId !== mstate.cat) return false;
        if (mstate.status === 'active' && m.active === false) return false;
        if (mstate.status === 'inactive' && m.active !== false) return false;
        if (mstate.status === 'soldout' && !Menu.isSoldOut(m)) return false;
        if (mstate.status === 'low' && !Menu.isLow(m)) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (mstate.sort === 'price-asc') return a.price - b.price;
        if (mstate.sort === 'price-desc') return b.price - a.price;
        if (mstate.sort === 'cat') return Menu.categoryName(a.categoryId).localeCompare(Menu.categoryName(b.categoryId)) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
      ctx.actions('<button class="btn btn-primary" data-act="add">' + ic('plus') + '<span>Tambah Menu</span></button>');
      var tbl = App.table([
        { label: 'Foto', render: function (m) { return '<img class="thumb" src="' + esc(App.foodImg(m)) + '" alt="' + esc(m.name) + '">'; }, cls: 'col-thumb' },
        { label: 'Nama Menu', primary: true, render: function (m) { return '<b>' + esc(m.name) + '</b>' + (m.featured ? ' <span class="badge warn" title="Menu unggulan">' + ic('star') + '</span>' : '') + '<small class="sub">' + esc(m.desc || '') + '</small>'; } },
        { label: 'Kategori', render: function (m) { return esc(Menu.categoryName(m.categoryId)); } },
        { label: 'Harga', align: 'right', render: function (m) { return (Menu.manualUnit(m) < m.price ? '<s class="muted">' + rp(m.price) + '</s> <b>' + rp(Menu.manualUnit(m)) + '</b>' : '<b>' + rp(m.price) + '</b>'); } },
        { label: 'Stok', align: 'right', render: function (m) { return '<span class="' + (m.stock <= 0 ? 'text-danger' : Menu.isLow(m) ? 'text-warn' : '') + '">' + m.stock + '</span>'; } },
        { label: 'Status', align: 'center', render: function (m) { return m.active === false ? '<span class="badge muted">Nonaktif</span>' : Menu.isSoldOut(m) ? '<span class="badge danger">Habis</span>' : '<span class="badge success">Aktif</span>'; } },
        { label: 'Aksi', align: 'center', render: function (m) { return '<div class="row-actions"><button class="icon-btn sm" data-act="edit" data-id="' + m.id + '" title="Edit" aria-label="Edit ' + esc(m.name) + '">' + ic('pencil') + '</button><button class="icon-btn sm danger" data-act="del" data-id="' + m.id + '" title="Hapus" aria-label="Hapus ' + esc(m.name) + '">' + ic('trash-2') + '</button></div>'; } }
      ], list, { icon: 'utensils-crossed', emptyTitle: 'Menu tidak ditemukan', emptyText: 'Ubah filter pencarian atau tambahkan menu baru.' });
      root.innerHTML = '<div class="card"><div class="toolbar">' +
        '<div class="search-in">' + ic('search') + '<input id="mq" type="search" placeholder="Cari menu…" value="' + esc(mstate.q) + '" aria-label="Cari menu"></div>' +
        '<select id="mcat" aria-label="Filter kategori"><option value="">Semua Kategori</option>' + cats.map(function (c) { return '<option value="' + c.id + '"' + (mstate.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<select id="mstatus" aria-label="Filter status">' + [['', 'Semua Status'], ['active', 'Aktif'], ['inactive', 'Nonaktif'], ['soldout', 'Habis'], ['low', 'Stok menipis']].map(function (o) { return '<option value="' + o[0] + '"' + (mstate.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<select id="msort" aria-label="Urutkan">' + [['name', 'Urutkan: Nama'], ['price-asc', 'Harga terendah'], ['price-desc', 'Harga tertinggi'], ['cat', 'Kategori']].map(function (o) { return '<option value="' + o[0] + '"' + (mstate.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' + tbl +
        '<p class="table-foot">' + list.length + ' menu ditampilkan dari ' + Store.getMenus().length + '</p></div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.oninput = App.debounce(function (e) { if (e.target.id === 'mq') { mstate.q = e.target.value; keep(); var i = $('#mq', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
      root.onchange = function (e) {
        if (e.target.id === 'mcat') mstate.cat = e.target.value; else if (e.target.id === 'mstatus') mstate.status = e.target.value; else if (e.target.id === 'msort') mstate.sort = e.target.value; else return;
        keep();
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'add') menuForm(null, keep);
        else if (act === 'edit') menuForm(Store.getMenu(id), keep);
        else if (act === 'del') {
          var m = Store.getMenu(id);
          App.confirm({ title: 'Hapus menu?', message: 'Menu "' + m.name + '" akan dihapus permanen. Riwayat pesanan lama tidak terpengaruh.', confirmText: 'Hapus', danger: true }).then(function (ok) {
            if (!ok) return; try { Store.deleteMenu(id); App.toast('Menu dihapus.'); keep(); } catch (er) { App.fail(er); }
          });
        }
      };
      ctx.addAction = function () { menuForm(null, keep); };
    }
  });

  /* ---------- kategori ---------- */
  var CAT_ICONS = ['drumstick', 'package', 'fish', 'wheat', 'flame', 'leaf', 'cup-soda', 'cookie', 'soup', 'salad', 'beef', 'egg', 'ice-cream-cone', 'pizza', 'sandwich', 'coffee', 'utensils'];
  Admin.register('categories', {
    title: 'Kategori Menu', sub: 'Atur kelompok menu dan urutan tampil', perm: 'categories',
    render: function (root, ctx) {
      var cats = Store.getCategories();
      ctx.actions('<button class="btn btn-primary" data-act="add">' + ic('plus') + '<span>Tambah Kategori</span></button>');
      var tbl = App.table([
        { label: 'Urutan', align: 'center', render: function (c, i) { return '<div class="row-actions"><button class="icon-btn sm" data-act="up" data-id="' + c.id + '" aria-label="Naikkan"' + (i === 0 ? ' disabled' : '') + '>' + ic('arrow-up') + '</button><button class="icon-btn sm" data-act="down" data-id="' + c.id + '" aria-label="Turunkan"' + (i === cats.length - 1 ? ' disabled' : '') + '>' + ic('arrow-down') + '</button></div>'; } },
        { label: 'Kategori', primary: true, render: function (c) { return '<span class="cat-ic">' + ic(c.icon || 'utensils') + '</span> <b>' + esc(c.name) + '</b>'; } },
        { label: 'Jumlah Menu', align: 'right', render: function (c) { return Store.getMenus().filter(function (m) { return m.categoryId === c.id; }).length; } },
        { label: 'Status', align: 'center', render: function (c) { return '<label class="switch sm"><input type="checkbox" data-act="toggle" data-id="' + c.id + '"' + (c.active !== false ? ' checked' : '') + ' aria-label="Aktif"><span class="slider"></span></label>'; } },
        { label: 'Aksi', align: 'center', render: function (c) { return '<div class="row-actions"><button class="icon-btn sm" data-act="edit" data-id="' + c.id + '" aria-label="Edit">' + ic('pencil') + '</button><button class="icon-btn sm danger" data-act="del" data-id="' + c.id + '" aria-label="Hapus">' + ic('trash-2') + '</button></div>'; } }
      ], cats, { icon: 'tags', emptyTitle: 'Belum ada kategori', emptyText: 'Tambahkan kategori pertama Anda.' });
      root.innerHTML = '<div class="card">' + tbl + '</div>'; App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      function form(c) {
        var isNew = !c;
        App.formModal({
          title: isNew ? 'Tambah Kategori' : 'Edit Kategori', size: 'sm', values: c || { name: '', icon: 'utensils', active: true },
          fields: [{ name: 'name', label: 'Nama kategori', required: true, maxlength: 40 }, { name: 'icon', label: 'Ikon', type: 'select', options: CAT_ICONS.map(function (i) { return { value: i, label: i }; }) }, { name: 'active', type: 'checkbox', text: 'Aktif' }],
          onSubmit: function (v) { Store.saveCategory(Object.assign({}, c || {}, { name: v.name, icon: v.icon, active: !!v.active })); App.toast('Kategori disimpan.'); keep(); }
        });
      }
      function move(id, dir) {
        var l = Store.getCategories(), i = l.findIndex(function (x) { return x.id === id; }), j = i + dir;
        if (j < 0 || j >= l.length) return;
        var t = l[i]; l[i] = l[j]; l[j] = t;
        l.forEach(function (c, k) { c.sort = k; Store.saveCategory(c); }); keep();
      }
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b || b.type === 'checkbox') return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'add') form(null); else if (act === 'edit') form(Store.get('categories', id));
        else if (act === 'up') move(id, -1); else if (act === 'down') move(id, 1);
        else if (act === 'del') {
          var c = Store.get('categories', id);
          App.confirm({ title: 'Hapus kategori?', message: 'Kategori "' + c.name + '" akan dihapus.', confirmText: 'Hapus', danger: true }).then(function (ok) {
            if (!ok) return; try { Store.deleteCategory(id); App.toast('Kategori dihapus.'); keep(); } catch (er) { App.fail(er); }
          });
        }
      };
      root.onchange = function (e) {
        if (e.target.getAttribute('data-act') === 'toggle') { var c = Store.get('categories', e.target.getAttribute('data-id')); c.active = e.target.checked; Store.saveCategory(c); App.toast(c.active ? 'Kategori diaktifkan.' : 'Kategori dinonaktifkan.'); }
      };
    }
  });

  /* ---------- stok ---------- */
  var sstate = { f: 'all', q: '' };
  Admin.register('stock', {
    title: 'Manajemen Stok', sub: 'Pantau dan sesuaikan persediaan menu', perm: 'stock',
    render: function (root, ctx) {
      var all = Store.getMenus(), low = all.filter(Menu.isLow), out = all.filter(function (m) { return m.stock <= 0; });
      var list = all.filter(function (m) {
        if (sstate.f === 'low' && !Menu.isLow(m)) return false; if (sstate.f === 'out' && m.stock > 0) return false;
        var q = sstate.q.trim().toLowerCase(); return !q || m.name.toLowerCase().indexOf(q) >= 0;
      });
      ctx.actions('');
      var cards = '<div class="stat-grid three"><div class="stat"><span class="stat-ic emerald">' + ic('boxes') + '</span><div><small>Total Menu</small><b>' + all.length + '</b></div></div><div class="stat"><span class="stat-ic amber">' + ic('triangle-alert') + '</span><div><small>Stok Menipis</small><b>' + low.length + '</b></div></div><div class="stat"><span class="stat-ic red">' + ic('package-x') + '</span><div><small>Stok Habis</small><b>' + out.length + '</b></div></div></div>';
      var tbl = App.table([
        { label: 'Menu', primary: true, render: function (m) { return '<div class="cell-flex"><img class="thumb sm" src="' + esc(App.foodImg(m)) + '" alt=""><div><b>' + esc(m.name) + '</b><small class="sub">' + esc(Menu.categoryName(m.categoryId)) + '</small></div></div>'; } },
        { label: 'Stok', align: 'right', render: function (m) { return '<b class="' + (m.stock <= 0 ? 'text-danger' : Menu.isLow(m) ? 'text-warn' : '') + '">' + m.stock + '</b>'; } },
        { label: 'Minimum', align: 'right', render: function (m) { return m.minStock; } },
        { label: 'Status', align: 'center', render: function (m) { return m.stock <= 0 ? '<span class="badge danger">Habis</span>' : Menu.isLow(m) ? '<span class="badge warn">Menipis</span>' : '<span class="badge success">Aman</span>'; } },
        { label: 'Ubah Stok', align: 'center', render: function (m) { return '<div class="row-actions"><button class="icon-btn sm" data-act="minus" data-id="' + m.id + '" aria-label="Kurangi 1">' + ic('minus') + '</button><button class="btn btn-soft btn-sm" data-act="adjust" data-id="' + m.id + '">Atur</button><button class="icon-btn sm" data-act="plus" data-id="' + m.id + '" aria-label="Tambah 1">' + ic('plus') + '</button></div>'; } }
      ], list, { icon: 'boxes', emptyTitle: 'Tidak ada menu pada filter ini' });
      root.innerHTML = cards + '<div class="card"><div class="toolbar"><div class="search-in">' + ic('search') + '<input id="sq" type="search" placeholder="Cari menu…" value="' + esc(sstate.q) + '" aria-label="Cari"></div>' +
        '<div class="seg" role="tablist">' + [['all', 'Semua'], ['low', 'Menipis'], ['out', 'Habis']].map(function (o) { return '<button class="' + (sstate.f === o[0] ? 'on' : '') + '" data-act="f" data-f="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div>' + tbl + '</div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      function setStock(id, n) { var m = Store.getMenu(id); m.stock = Math.max(0, Math.round(n)); Store.saveMenu(m); }
      root.oninput = App.debounce(function (e) { if (e.target.id === 'sq') { sstate.q = e.target.value; keep(); var i = $('#sq', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'f') { sstate.f = b.getAttribute('data-f'); keep(); }
        else if (act === 'plus') { setStock(id, Store.getMenu(id).stock + 1); keep(); }
        else if (act === 'minus') { var m = Store.getMenu(id); if (m.stock <= 0) { App.toast('Stok sudah 0.', 'warn'); return; } setStock(id, m.stock - 1); keep(); }
        else if (act === 'adjust') {
          var mm = Store.getMenu(id);
          App.formModal({
            title: 'Atur stok · ' + mm.name, size: 'sm', values: { mode: 'add', qty: '' },
            fields: [{ name: 'mode', label: 'Tindakan', type: 'select', options: [{ value: 'add', label: 'Tambah stok (restock)' }, { value: 'sub', label: 'Kurangi stok' }, { value: 'set', label: 'Set jumlah stok' }] }, { name: 'qty', label: 'Jumlah', type: 'number', required: true, min: 0, step: 1, hint: 'Stok saat ini: ' + mm.stock }],
            validate: function (v) { if (v.mode === 'sub' && parseInt(v.qty, 10) > mm.stock) return 'Pengurangan melebihi stok saat ini. Stok tidak boleh negatif.'; },
            onSubmit: function (v) { var q = Math.round(v.qty); setStock(id, v.mode === 'add' ? mm.stock + q : v.mode === 'sub' ? mm.stock - q : q); App.toast('Stok diperbarui.'); keep(); }
          });
        }
      };
    }
  });

  /* ---------- promo ---------- */
  Admin.register('promos', {
    title: 'Promo dan Diskon', sub: 'Atur diskon persen, nominal, atau harga khusus', perm: 'promos',
    render: function (root, ctx) {
      var list = Store.getPromos();
      ctx.actions('<button class="btn btn-primary" data-act="add">' + ic('plus') + '<span>Buat Promo</span></button>');
      var tbl = App.table([
        { label: 'Promo', primary: true, render: function (p) { return '<b>' + esc(p.name) + '</b><small class="sub">' + esc(Promo.scopeText(p)) + '</small>'; } },
        { label: 'Diskon', render: function (p) { return '<b>' + esc(Promo.describe(p)) + '</b>' + (p.maxDiscount > 0 ? '<small class="sub">maks. ' + rp(p.maxDiscount) + '</small>' : ''); } },
        { label: 'Syarat', render: function (p) { return p.minPurchase > 0 ? 'Min. belanja ' + rp(p.minPurchase) : '—'; } },
        { label: 'Periode', render: function (p) { return (p.startDate || '…') + ' → ' + (p.endDate || '…'); } },
        { label: 'Status', align: 'center', render: function (p) { var s = Promo.status(p); return '<span class="badge ' + s.cls + '">' + s.label + '</span>'; } },
        { label: 'Aktif', align: 'center', render: function (p) { return '<label class="switch sm"><input type="checkbox" data-act="toggle" data-id="' + p.id + '"' + (p.active ? ' checked' : '') + ' aria-label="Aktifkan promo"><span class="slider"></span></label>'; } },
        { label: 'Aksi', align: 'center', render: function (p) { return '<div class="row-actions"><button class="icon-btn sm" data-act="edit" data-id="' + p.id + '" aria-label="Edit">' + ic('pencil') + '</button><button class="icon-btn sm danger" data-act="del" data-id="' + p.id + '" aria-label="Hapus">' + ic('trash-2') + '</button></div>'; } }
      ], list, { icon: 'badge-percent', emptyTitle: 'Belum ada promo', emptyText: 'Buat promo pertama untuk menarik pelanggan.' });
      root.innerHTML = '<div class="notice info">' + ic('info') + '<span>Promo yang sudah berakhir otomatis tidak dipakai pada pesanan baru. Diskon tidak pernah membuat harga menjadi negatif.</span></div><div class="card">' + tbl + '</div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      function form(p) {
        var isNew = !p;
        var v = p ? Object.assign({}, p) : { name: '', label: '', type: 'percent', value: '', scope: 'category', targetIds: [], minPurchase: 0, maxDiscount: 0, startDate: App.isoDate(Date.now()), endDate: '', active: true };
        App.formModal({
          title: isNew ? 'Buat Promo' : 'Edit Promo', size: 'lg', values: v,
          fields: [
            { name: 'name', label: 'Nama promo', required: true, maxlength: 80, cols: 2 },
            { name: 'label', label: 'Label di menu pelanggan', maxlength: 14, placeholder: 'Contoh: Promo 20%', hint: 'Singkat, tampil sebagai badge pada kartu menu.' },
            { name: 'type', label: 'Jenis diskon', type: 'select', options: [{ value: 'percent', label: 'Persentase (%)' }, { value: 'nominal', label: 'Nominal (Rp)' }, { value: 'special', label: 'Harga khusus (Rp)' }] },
            { name: 'value', label: 'Nilai diskon', type: 'number', required: true, min: 0.01, step: 'any', hint: 'Persen: 1–100 · Nominal: potongan Rp · Harga khusus: harga akhir per item.' },
            { name: 'scope', label: 'Berlaku untuk', type: 'select', options: [{ value: 'all', label: 'Seluruh pesanan' }, { value: 'category', label: 'Kategori tertentu' }, { value: 'menu', label: 'Menu tertentu' }], rerender: ['scope'] },
            { name: 'targetIds', label: 'Pilih target', type: 'multiselect', cols: 2, show: function (c) { return c.scope !== 'all'; }, rerender: ['scope'], options: function (c) { return c.scope === 'menu' ? Store.getMenus().map(function (m) { return { value: m.id, label: m.name }; }) : Store.getCategories().map(function (x) { return { value: x.id, label: x.name }; }); } },
            { name: 'minPurchase', label: 'Minimal pembelian', type: 'number', min: 0, step: 1000, prefix: 'Rp' },
            { name: 'maxDiscount', label: 'Maksimal diskon (0 = tanpa batas)', type: 'number', min: 0, step: 1000, prefix: 'Rp' },
            { name: 'startDate', label: 'Tanggal mulai', type: 'date' },
            { name: 'endDate', label: 'Tanggal berakhir', type: 'date', hint: 'Kosongkan bila tanpa batas waktu.' },
            { name: 'active', type: 'checkbox', text: 'Promo aktif' }
          ],
          onSubmit: function (c) {
            var item = Object.assign({}, p || {}, {
              name: c.name, label: c.label || 'Promo', type: c.type, value: c.value, scope: c.scope, targetIds: c.scope === 'all' ? [] : (c.targetIds || []),
              minPurchase: c.minPurchase || 0, maxDiscount: c.maxDiscount || 0, startDate: c.startDate || '', endDate: c.endDate || '', active: !!c.active
            });
            Store.savePromo(item); App.toast('Promo disimpan.'); keep();
          }
        });
      }
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b || b.type === 'checkbox') return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'add') form(null); else if (act === 'edit') form(Store.get('promos', id));
        else if (act === 'del') {
          var p = Store.get('promos', id);
          App.confirm({ title: 'Hapus promo?', message: 'Promo "' + p.name + '" akan dihapus.', confirmText: 'Hapus', danger: true }).then(function (ok) { if (ok) { Store.deletePromo(id); App.toast('Promo dihapus.'); keep(); } });
        }
      };
      root.onchange = function (e) {
        if (e.target.getAttribute('data-act') === 'toggle') { var p = Store.get('promos', e.target.getAttribute('data-id')); p.active = e.target.checked; Store.savePromo(p); App.toast(p.active ? 'Promo diaktifkan.' : 'Promo dinonaktifkan.'); keep(); }
      };
    }
  });
})(window);
