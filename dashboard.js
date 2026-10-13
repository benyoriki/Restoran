/* ==========================================================================
   dashboard.js — kerangka admin (sidebar, topbar, router hash) + halaman Dashboard
   Modul lain mendaftarkan tampilan lewat Admin.register(id, {title, sub, perm, render}).
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, $$ = App.$$, esc = App.esc, rp = App.rp, ic = App.ic, Charts = App.Charts;

  var NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
    { group: 'orders', label: 'Pesanan', icon: 'receipt', children: [['orders', 'Manajemen Pesanan'], ['orders-qr', 'Pesanan QR'], ['manual', 'Pesanan Manual']] },
    { id: 'kitchen', label: 'Dashboard Dapur', icon: 'chef-hat', href: 'kitchen.html', perm: 'kitchen' },
    { group: 'menu', label: 'Menu Makanan', icon: 'utensils-crossed', children: [['menus', 'Menu Makanan'], ['categories', 'Kategori Menu'], ['stock', 'Manajemen Stok'], ['promos', 'Promo dan Diskon']] },
    { group: 'tables', label: 'Meja & QR', icon: 'armchair', children: [['tables', 'Manajemen Meja'], ['qr', 'QR Code']] },
    { group: 'cash', label: 'Keuangan', icon: 'wallet', children: [['cash-in', 'Kas Masuk'], ['cash-out', 'Kas Keluar'], ['transactions', 'Riwayat Transaksi']] },
    { group: 'reports', label: 'Laporan', icon: 'chart-column', children: [['report-sales', 'Laporan Penjualan'], ['report-finance', 'Laporan Keuangan']] },
    { id: 'customers', label: 'Pelanggan', icon: 'users' },
    { group: 'settings', label: 'Pengaturan', icon: 'settings', children: [['settings-restaurant', 'Pengaturan Restoran'], ['settings-system', 'Pengaturan Sistem'], ['backup', 'Backup dan Pemulihan Data']] }
  ];
  var ICONS = { orders: 'receipt', 'orders-qr': 'qr-code', manual: 'square-pen', menus: 'utensils-crossed', categories: 'tags', stock: 'boxes', promos: 'badge-percent', tables: 'armchair', qr: 'qr-code', 'cash-in': 'arrow-down-left', 'cash-out': 'arrow-up-right', transactions: 'list', 'report-sales': 'trending-up', 'report-finance': 'landmark', 'settings-restaurant': 'store', 'settings-system': 'sliders-horizontal', backup: 'database-backup' };

  function allowed(id) { var v = Admin.views[id]; return !!v && (!v.perm || App.Auth.can(v.perm)); }

  var Shell = {
    cur: null, ctx: null,
    init: function () {
      var s = App.Auth.require('dashboard'); if (!s) return;
      Shell.session = s; Shell.root = $('#adminRoot');
      try { Shell.collapsedGroups = JSON.parse(localStorage.getItem('qmo:nav') || '{}'); } catch (e) { Shell.collapsedGroups = {}; }
      Shell.build(); Shell.bind();
      window.addEventListener('hashchange', Shell.route);
      Store.subscribe(App.debounce(function (evt) {
        Shell.updateBadges();
        var a = document.activeElement;
        if (document.querySelector('.overlay')) return;
        if (a && Shell.body && Shell.body.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
        if (Shell.ctx && Shell.cur !== 'settings-restaurant') Shell.ctx.rerender(true);
      }, 400));
      setInterval(function () { if (Shell.cur === 'dashboard' && !document.querySelector('.overlay')) Shell.ctx.rerender(true); }, 60000);
      Shell.route();
    },

    sidebarHtml: function () {
      var r = Store.getSettings().restaurant, u = Shell.session;
      var nav = NAV.map(function (n) {
        if (n.group) {
          var kids = n.children.filter(function (c) { return allowed(c[0]); });
          if (!kids.length) return '';
          var open = !Shell.collapsedGroups[n.group];
          return '<div class="nav-group' + (open ? ' open' : '') + '" data-group="' + n.group + '"><button class="nav-item nav-parent" data-act="group" data-g="' + n.group + '" aria-expanded="' + open + '">' + ic(n.icon) + '<span>' + n.label + '</span>' + ic('chevron-down', 'chev') + '</button><div class="nav-sub">' +
            kids.map(function (c) { return '<a class="nav-item sub" href="#/' + c[0] + '" data-route="' + c[0] + '">' + ic(ICONS[c[0]] || 'circle') + '<span>' + c[1] + '</span>' + (c[0] === 'orders-qr' ? '<em class="count" data-badge="pending" hidden></em>' : '') + '</a>'; }).join('') + '</div></div>';
        }
        if (n.href) { if (n.perm && !App.Auth.can(n.perm)) return ''; return '<a class="nav-item" href="' + n.href + '">' + ic(n.icon) + '<span>' + n.label + '</span><em class="count" data-badge="kitchen" hidden></em></a>'; }
        if (!allowed(n.id)) return '';
        return '<a class="nav-item" href="#/' + n.id + '" data-route="' + n.id + '">' + ic(n.icon) + '<span>' + n.label + '</span></a>';
      }).join('');
      var logo = r.logo ? '<img src="' + esc(r.logo) + '" alt="">' : ic('qr-code');
      return '<div class="sb-head"><a class="brand" href="index.html" title="Beranda"><span class="brand-mark">' + ic('qr-code') + '</span><span class="brand-txt"><b>QR Menu<span>&amp;</span>Order</b><small>Admin Panel</small></span></a><button class="icon-btn sb-close" data-act="close-drawer" aria-label="Tutup menu">' + ic('x') + '</button></div>' +
        '<div class="sb-rest"><span class="sb-logo">' + logo + '</span><div><b>' + esc(r.name) + '</b><small>' + esc(r.tagline || '') + '</small></div></div>' +
        '<nav class="sb-nav" aria-label="Menu admin">' + nav + '</nav><div class="sb-foot"><div class="sb-user"><span class="avatar">' + esc((u.name || '?').charAt(0).toUpperCase()) + '</span><div><b>' + esc(u.name) + '</b><small>' + esc(App.Auth.roleName(u.role)) + '</small></div></div><button class="nav-item logout" data-act="logout">' + ic('log-out') + '<span>Logout</span></button></div>';
    },

    build: function () {
      var u = Shell.session;
      var bottom = [['dashboard', 'layout-dashboard', 'Beranda'], ['orders', 'receipt', 'Pesanan'], ['manual', 'square-pen', 'Kasir'], ['menus', 'utensils-crossed', 'Menu']].filter(function (b) { return allowed(b[0]); });
      Shell.root.innerHTML = '<div class="admin' + (localStorage.getItem('qmo:sbc') === '1' ? ' collapsed' : '') + '" id="adminShell"><aside class="sidebar" id="sidebar" aria-label="Sidebar">' + Shell.sidebarHtml() + '</aside><div class="backdrop" data-act="close-drawer"></div>' +
        '<div class="admin-main"><header class="topbar"><button class="icon-btn" data-act="toggle-sb" aria-label="Buka/tutup sidebar">' + ic('panel-left') + '</button><div class="tb-title"><h1 id="pageTitle">Dashboard</h1><p id="pageSub"></p></div><div class="tb-actions" id="viewActions"></div><button class="icon-btn" data-theme-toggle></button><a class="icon-btn" href="menu.html?table=MEJA-01" target="_blank" rel="noopener" title="Lihat menu pelanggan" aria-label="Lihat menu pelanggan">' + ic('smartphone') + '</a></header>' +
        '<div id="sampleBanner"></div><main id="view" class="view" tabindex="-1"></main></div>' +
        '<nav class="admin-bottom" aria-label="Navigasi cepat">' + bottom.map(function (b) { return '<a href="#/' + b[0] + '" data-route="' + b[0] + '">' + ic(b[1]) + '<span>' + b[2] + '</span></a>'; }).join('') + '<button data-act="open-drawer">' + ic('menu') + '<span>Lainnya</span></button></nav></div>';
      Shell.body = $('#view'); App.Theme.sync(); App.refreshIcons(); Shell.updateBadges(); Shell.sampleBanner();
    },
    refresh: function () { var sb = $('#sidebar'); if (sb) { sb.innerHTML = Shell.sidebarHtml(); App.refreshIcons(); Shell.markActive(); Shell.updateBadges(); } Shell.sampleBanner(); },
    sampleBanner: function () {
      var el = $('#sampleBanner'); if (!el) return;
      var dismissed = false; try { dismissed = sessionStorage.getItem('qmo:sb') === '1'; } catch (e) {}
      if (!Store.isSample() || dismissed) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="sample-banner">' + ic('flask-conical') + '<span><b>Data contoh.</b> Menu, harga, pesanan, dan transaksi di bawah adalah simulasi — bukan data restoran asli. Ganti lewat dashboard.</span>' + (App.Auth.can('backup') ? '<a class="btn btn-sm btn-soft" href="#/backup">Kelola data</a>' : '') + '<button class="icon-btn sm" data-act="dismiss-banner" aria-label="Tutup">' + ic('x') + '</button></div>'; App.refreshIcons();
    },
    updateBadges: function () {
      var orders = Store.getOrders(), pending = orders.filter(function (o) { return o.status === 'pending'; }).length;
      $$('[data-badge="pending"]').forEach(function (b) { b.textContent = pending; b.hidden = !pending; });
      $$('[data-badge="kitchen"]').forEach(function (b) { b.textContent = pending; b.hidden = !pending; });
    },
    markActive: function () {
      $$('[data-route]').forEach(function (a) { var on = a.getAttribute('data-route') === Shell.cur; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      var cur = $('.sb-nav .active'); if (cur) { var g = cur.closest('.nav-group'); if (g) g.classList.add('open'); }
    },
    bind: function () {
      var shell = $('#adminShell');
      shell.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (b && !b.closest('#view')) {
          var act = b.getAttribute('data-act');
          if (act === 'group') { var g = b.getAttribute('data-g'), grp = b.closest('.nav-group'), open = !grp.classList.contains('open'); grp.classList.toggle('open', open); Shell.collapsedGroups[g] = !open; b.setAttribute('aria-expanded', open); try { localStorage.setItem('qmo:nav', JSON.stringify(Shell.collapsedGroups)); } catch (x) {} return; }
          if (act === 'toggle-sb') { if (window.matchMedia('(min-width:1024px)').matches) { shell.classList.toggle('collapsed'); try { localStorage.setItem('qmo:sbc', shell.classList.contains('collapsed') ? '1' : '0'); } catch (x) {} } else shell.classList.toggle('drawer-open'); return; }
          if (act === 'open-drawer') { shell.classList.add('drawer-open'); return; }
          if (act === 'close-drawer') { shell.classList.remove('drawer-open'); return; }
          if (act === 'logout') { App.confirm({ title: 'Keluar?', message: 'Anda akan keluar dari dashboard.', confirmText: 'Logout' }).then(function (ok) { if (ok) { App.Auth.logout(); location.href = 'login.html'; } }); return; }
          if (act === 'dismiss-banner') { try { sessionStorage.setItem('qmo:sb', '1'); } catch (x) {} Shell.sampleBanner(); return; }
          // tombol aksi pada topbar → teruskan ke tampilan aktif
          if (b.closest('#viewActions') && Shell.body.onclick) { Shell.body.onclick.call(Shell.body, { target: b, preventDefault: function () {} }); return; }
        }
        if (e.target.closest('.sb-nav a[href^="#/"]')) shell.classList.remove('drawer-open');
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shell.classList.remove('drawer-open'); });
    },

    route: function () {
      var h = location.hash.replace(/^#\/?/, '') || 'dashboard';
      if (h === 'denied') { App.toast('Anda tidak memiliki izin untuk halaman tersebut.', 'warn'); history.replaceState(null, '', location.pathname + '#/dashboard'); h = 'dashboard'; }
      var id = h.split('?')[0];
      Shell.show(Admin.views[id] ? id : 'dashboard', true);
    },
    navigate: function (id) { location.hash = '#/' + id; },
    show: function (id, fresh) {
      var v = Admin.views[id];
      if (!allowed(id)) { App.toast('Anda tidak memiliki izin untuk halaman ini.', 'warn'); if (id !== 'dashboard') return Shell.navigate('dashboard'); return; }
      Shell.cur = id; $('#pageTitle').textContent = v.title; $('#pageSub').textContent = v.sub || '';
      document.title = v.title + ' — QR Menu & Order';
      var scroll = fresh ? 0 : window.scrollY;
      var ctx = { fresh: fresh, rerender: function (quiet) { Shell.show(id, false); }, actions: function (html) { $('#viewActions').innerHTML = html || ''; App.refreshIcons(); }, navigate: Shell.navigate, refreshShell: Shell.refresh };
      Shell.ctx = ctx;
      $('#viewActions').innerHTML = '';
      Shell.markActive();
      var run = function () {
        try { v.render(Shell.body, ctx); }
        catch (e) { console.error(e); Shell.body.innerHTML = App.UI.error('Tampilan gagal dimuat: ' + e.message, 'retry'); Shell.body.onclick = function (ev) { if (ev.target.closest('[data-act="retry"]')) ctx.rerender(); }; App.refreshIcons(); }
        window.scrollTo(0, scroll);
      };
      if (fresh) { Shell.body.innerHTML = App.UI.loading(3); Shell.body.onclick = Shell.body.oninput = Shell.body.onchange = null; requestAnimationFrame(run); }
      else run();
    }
  };
  global.AdminShell = Shell;

  /* ==========================================================================
     Halaman Dashboard
     ========================================================================== */
  var ds = { range: 'today', from: '', to: '' };
  function pct(cur, prev) { if (!prev) return cur ? { t: 'baru', up: true } : null; var p = Math.round((cur - prev) * 100 / prev); return { t: (p >= 0 ? '+' : '') + p + '%', up: p >= 0 }; }

  Admin.register('dashboard', {
    title: 'Dashboard', sub: 'Ringkasan penjualan dan aktivitas restoran', perm: 'dashboard',
    render: function (root, ctx) {
      var r = App.Range.compute(ds.range, ds.from, ds.to), len = r.to - r.from + 1;
      var prev = { from: r.from - len, to: r.from - 1 };
      var s = Finance.summary(r), sp = Finance.summary(prev);
      var showCash = App.Auth.can('cash') || App.Auth.can('transactions');
      var orders = Store.getOrders().filter(function (o) { return App.Range.has(r, o.createdAt); });
      var tables = Store.getTables(), activeTables = tables.filter(function (t) { return t.active; }).length;
      var rank = Reports.menuRank(orders).filter(function (x) { return x.qty > 0; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
      var low = Store.getMenus().filter(function (m) { return m.active !== false && Menu.isLow(m) || (m.active !== false && m.stock <= 0); }).sort(function (a, b) { return a.stock - b.stock; }).slice(0, 5);
      var recent = Store.getOrders().slice(0, 6);
      ctx.actions('');
      var opts = App.Range.PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (ds.range === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('');
      var stat = function (icon, color, label, val, delta, sub) {
        return '<div class="stat"><span class="stat-ic ' + color + '">' + ic(icon) + '</span><div><small>' + label + '</small><b>' + val + '</b>' + (delta ? '<em class="' + (delta.up ? 'up' : 'down') + '">' + ic(delta.up ? 'trending-up' : 'trending-down') + delta.t + ' vs periode lalu</em>' : (sub ? '<em>' + sub + '</em>' : '')) + '</div></div>';
      };
      var row1 = '<div class="stat-grid five">' + stat('banknote', 'emerald', 'Total Penjualan', rp(s.orderValue), pct(s.orderValue, sp.orderValue)) + stat('receipt', 'green', 'Total Pesanan', s.orderCount, pct(s.orderCount, sp.orderCount)) +
        stat('clock', 'amber', 'Menunggu', s.pending, null, 'perlu diterima dapur') + stat('flame', 'blue', 'Diproses', s.processing + s.ready, null, 'dimasak / siap saji') + stat('circle-check', 'emerald', 'Selesai', s.done) + '</div>';
      var row2 = showCash ? '<div class="stat-grid five">' + stat('badge-dollar-sign', 'emerald', 'Pendapatan Bersih', rp(s.netSales), null, s.paidCount + ' pesanan dibayar · setelah pajak') + stat('arrow-down-left', 'green', 'Kas Masuk', rp(s.cashIn)) + stat('arrow-up-right', 'red', 'Kas Keluar', rp(s.cashOut)) +
        stat('wallet', 'blue', 'Saldo Kas', rp(s.balanceAll), null, 'semua waktu') + stat('armchair', 'slate', 'Meja Aktif', activeTables + ' / ' + tables.length) + '</div>' :
        '<div class="stat-grid five">' + stat('clock', 'amber', 'Belum Dibayar', rp(s.unpaidValue), null, s.unpaidCount + ' pesanan') + stat('banknote', 'emerald', 'Dibayar', rp(s.receipts), null, s.paidCount + ' pesanan') + stat('armchair', 'slate', 'Meja Aktif', activeTables + ' / ' + tables.length) + '</div>';
      var chartData = len <= 86400000 * 1.01 ? Reports.byHour(orders).map(function (h) { return { label: h.label + ':00', value: h.value }; }) : Reports.byPeriod(orders, 'day', r).map(function (p) { return { label: p.label, value: p.sales }; });
      var chart = '<section class="card"><div class="card-head"><h3>Grafik Penjualan</h3><small class="muted">' + esc(r.label) + ' · ' + (len <= 86400000 * 1.01 ? 'per jam' : 'per hari') + '</small></div>' + (chartData.some(function (d) { return d.value; }) ? Charts.bars(chartData, { fmt: rp, label: 'Grafik penjualan', maxLabels: 12 }) : App.UI.empty('chart-column', 'Belum ada penjualan', 'Tidak ada pesanan pada rentang ini.')) + '</section>';
      var top = '<section class="card"><div class="card-head"><h3>Menu Terlaris</h3></div>' + (rank.length ? '<ul class="rank">' + rank.map(function (x, i) { return '<li><span class="rank-n">' + (i + 1) + '</span><span class="rank-name">' + esc(x.name) + '</span><b>' + x.qty + ' porsi</b></li>'; }).join('') + '</ul>' : App.UI.empty('utensils-crossed', 'Belum ada data')) + '</section>';
      var dist = [{ label: 'Menunggu', value: s.pending, color: '#f59e0b' }, { label: 'Diproses', value: s.processing, color: '#fb923c' }, { label: 'Siap / diantar', value: s.ready, color: '#3b82f6' }, { label: 'Selesai', value: s.done, color: '#10b981' }, { label: 'Dibatalkan', value: s.cancelled, color: '#ef4444' }];
      var distCard = '<section class="card"><div class="card-head"><h3>Distribusi Status Pesanan</h3></div>' + Charts.donut(dist, { center: dist.reduce(function (a, d) { return a + d.value; }, 0), sub: 'pesanan' }) + '</section>';
      var lowCard = '<section class="card"><div class="card-head"><h3>Stok Menipis</h3>' + (App.Auth.can('stock') ? '<a class="link" href="#/stock">Kelola</a>' : '') + '</div>' + (low.length ? '<ul class="rank">' + low.map(function (m) { return '<li><span class="rank-name">' + esc(m.name) + '</span><b class="' + (m.stock <= 0 ? 'text-danger' : 'text-warn') + '">' + (m.stock <= 0 ? 'Habis' : 'Sisa ' + m.stock) + '</b></li>'; }).join('') + '</ul>' : App.UI.empty('package-check', 'Stok aman', 'Tidak ada menu dengan stok menipis.')) + '</section>';
      var recentCard = '<section class="card span-2"><div class="card-head"><h3>Pesanan Terbaru</h3><a class="link" href="#/orders">Lihat semua</a></div>' + App.table([
        { label: 'No.', primary: true, render: function (o) { return '<b>' + esc(o.number) + '</b>'; } },
        { label: 'Meja', render: function (o) { return esc(o.tableName); } },
        { label: 'Waktu', render: function (o) { return App.fmtTime(o.createdAt) + '<small class="sub">' + App.fmtDate(o.createdAt) + '</small>'; } },
        { label: 'Total', align: 'right', render: function (o) { return rp(o.total); } },
        { label: 'Status', render: function (o) { return Orders.statusBadge(o); } },
        { label: 'Bayar', render: function (o) { return Orders.payBadge(o); } }
      ], recent, { icon: 'receipt', emptyTitle: 'Belum ada pesanan', emptyText: 'Pesanan dari QR atau kasir akan tampil di sini.' }) + '</section>';
      root.innerHTML = '<div class="dash-toolbar"><div class="range-pick">' + ic('calendar') + '<select id="drange" aria-label="Rentang tanggal">' + opts + '</select></div>' +
        (ds.range === 'custom' ? '<label class="inline-f">Dari <input type="date" id="dfrom" value="' + esc(ds.from || App.isoDate(r.from)) + '"></label><label class="inline-f">Sampai <input type="date" id="dto" value="' + esc(ds.to || App.isoDate(r.to)) + '"></label>' : '') +
        '<span class="muted">' + esc(r.label) + '</span></div>' + row1 + row2 +
        '<div class="grid-2-1">' + chart + top + '</div><div class="grid-3">' + distCard + lowCard + '<section class="card"><div class="card-head"><h3>Ringkasan Cepat</h3></div><ul class="rank"><li><span class="rank-name">Rata-rata nilai pesanan</span><b>' + rp(s.avgOrder) + '</b></li><li><span class="rank-name">Pesanan belum dibayar</span><b>' + s.unpaidCount + '</b></li><li><span class="rank-name">Pembatalan</span><b>' + s.cancelled + '</b></li><li><span class="rank-name">Transaksi kas tercatat</span><b>' + s.txCount + '</b></li></ul></section></div>' + recentCard +
        '<p class="muted small">Total penjualan = nilai pesanan tidak dibatalkan. Pendapatan bersih & kas hanya menghitung pesanan yang <b>sudah dibayar</b>. Penjualan bukan laba bersih.</p>';
      App.refreshIcons();
      root.onchange = function (e) {
        if (e.target.id === 'drange') { ds.range = e.target.value; ctx.rerender(); }
        else if (e.target.id === 'dfrom') { ds.from = e.target.value; ctx.rerender(); }
        else if (e.target.id === 'dto') { ds.to = e.target.value; ctx.rerender(); }
      };
      root.onclick = null; root.oninput = null;
    }
  });

  document.addEventListener('DOMContentLoaded', Shell.init);
})(window);
