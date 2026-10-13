/* ==========================================================================
   reports.js — Laporan Penjualan, Laporan Keuangan, Pelanggan
   Semua angka dihitung dari data yang tersimpan (pesanan + transaksi).
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, esc = App.esc, rp = App.rp, ic = App.ic, Charts = App.Charts;

  var Reports = {
    /** Pesanan terfilter untuk laporan */
    orders: function (f) {
      var r = App.Range.compute(f.range, f.from, f.to);
      return Store.getOrders().filter(function (o) {
        if (!App.Range.has(r, o.createdAt)) return false;
        if (f.status === 'all') { /* semua */ }
        else if (f.status) { if (o.status !== f.status) return false; }
        else if (o.status === 'cancelled') return false;
        if (f.method && !(o.payStatus === 'paid' && o.payMethod === f.method)) return false;
        return true;
      });
    },
    groupKey: function (ts, g) {
      var d = new Date(ts);
      if (g === 'year') return String(d.getFullYear());
      if (g === 'month') return d.getFullYear() + '-' + App.pad(d.getMonth() + 1);
      if (g === 'week') { var m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var wd = (m.getDay() + 6) % 7; m.setDate(m.getDate() - wd); return App.isoDate(m.getTime()); }
      return App.isoDate(ts);
    },
    groupLabel: function (k, g) {
      var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      if (g === 'year') return k;
      var p = k.split('-');
      if (g === 'month') return MON[+p[1] - 1] + ' ' + p[0];
      if (g === 'week') return 'Mgg ' + (+p[2]) + ' ' + MON[+p[1] - 1];
      return (+p[2]) + ' ' + MON[+p[1] - 1];
    },
    byPeriod: function (orders, g, r) {
      var map = {};
      orders.forEach(function (o) {
        var k = Reports.groupKey(o.createdAt, g);
        var x = map[k] = map[k] || { key: k, orders: 0, sales: 0, paid: 0 };
        if (o.status !== 'cancelled') { x.orders++; x.sales += o.total; }
        if (o.payStatus === 'paid') x.paid += o.total;
      });
      // isi periode kosong agar grafik utuh (khusus harian)
      if (g === 'day' && r) { for (var t = r.from; t <= Math.min(r.to, Date.now()); t += 86400000) { var k = App.isoDate(t); if (!map[k]) map[k] = { key: k, orders: 0, sales: 0, paid: 0 }; } }
      return Object.keys(map).sort().map(function (k) { map[k].label = Reports.groupLabel(k, g); return map[k]; });
    },
    menuRank: function (orders) {
      var m = {};
      Store.getMenus().forEach(function (x) { m[x.id] = { id: x.id, name: x.name, qty: 0, revenue: 0, categoryId: x.categoryId }; });
      orders.forEach(function (o) {
        if (o.status === 'cancelled') return;
        o.items.forEach(function (i) { var e = m[i.menuId] = m[i.menuId] || { id: i.menuId, name: i.name, qty: 0, revenue: 0, categoryId: '' }; e.qty += i.qty; e.revenue += i.price * i.qty - (i.discount || 0); });
      });
      return Object.keys(m).map(function (k) { return m[k]; });
    },
    byCategory: function (orders) {
      var menus = {}; Store.getMenus().forEach(function (m) { menus[m.id] = m.categoryId; });
      var cats = {}; Store.getCategories().forEach(function (c) { cats[c.id] = c.name; });
      var out = {};
      orders.forEach(function (o) {
        if (o.status === 'cancelled') return;
        o.items.forEach(function (i) { var n = cats[menus[i.menuId]] || 'Lainnya'; out[n] = (out[n] || 0) + i.price * i.qty - (i.discount || 0); });
      });
      return Object.keys(out).map(function (k) { return { label: k, value: out[k] }; }).sort(function (a, b) { return b.value - a.value; });
    },
    byHour: function (orders) {
      var h = []; for (var i = 0; i < 24; i++) h.push({ label: App.pad(i), value: 0, orders: 0 });
      orders.forEach(function (o) { if (o.status === 'cancelled') return; var x = h[new Date(o.createdAt).getHours()]; x.value += o.total; x.orders++; });
      var first = h.findIndex(function (x) { return x.orders; }), last = -1; h.forEach(function (x, i) { if (x.orders) last = i; });
      if (first < 0) return h.slice(8, 22);
      return h.slice(Math.max(0, first - 1), Math.min(24, last + 2));
    }
  };
  global.Reports = Reports;

  var rs = { type: 'daily', range: '7d', from: '', to: '', method: '', status: '' };
  var TYPES = { daily: { label: 'Harian', g: 'day', range: '7d' }, weekly: { label: 'Mingguan', g: 'week', range: 'month' }, monthly: { label: 'Bulanan', g: 'month', range: 'year' }, yearly: { label: 'Tahunan', g: 'year', range: 'all' } };

  function opt(arr, cur) { return arr.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); }

  Admin.register('report-sales', {
    title: 'Laporan Penjualan', sub: 'Rekap penjualan, menu terlaris, kategori, dan jam ramai', perm: 'reports',
    render: function (root, ctx) {
      var T = TYPES[rs.type], r = App.Range.compute(rs.range, rs.from, rs.to);
      var orders = Reports.orders(rs), fin = Finance.summary(r);
      var periods = Reports.byPeriod(orders, T.g, r);
      var rank = Reports.menuRank(orders), top = rank.slice().sort(function (a, b) { return b.qty - a.qty; }).filter(function (x) { return x.qty > 0; }).slice(0, 8);
      var least = rank.slice().sort(function (a, b) { return a.qty - b.qty || a.name.localeCompare(b.name); }).slice(0, 8);
      var cats = Reports.byCategory(orders), hours = Reports.byHour(orders);
      var nonCancel = orders.filter(function (o) { return o.status !== 'cancelled'; });
      var sales = nonCancel.reduce(function (s, o) { return s + o.total; }, 0);
      var cancelled = Store.getOrders().filter(function (o) { return o.status === 'cancelled' && App.Range.has(r, o.createdAt); });
      ctx.actions('<button class="btn btn-soft" data-act="print">' + ic('printer') + '<span>Cetak</span></button><button class="btn btn-primary" data-act="csv">' + ic('download') + '<span>Ekspor CSV</span></button>');
      var tabs = '<div class="seg">' + Object.keys(TYPES).map(function (k) { return '<button class="' + (rs.type === k ? 'on' : '') + '" data-act="type" data-v="' + k + '">' + TYPES[k].label + '</button>'; }).join('') + '</div>';
      var filters = '<div class="toolbar no-print">' + tabs + '<select id="rrange" aria-label="Rentang">' + opt(App.Range.PRESETS.concat([['year', 'Tahun ini'], ['all', 'Semua waktu']]), rs.range) + '</select>' +
        '<select id="rmethod" aria-label="Metode pembayaran">' + opt([['', 'Semua Metode']].concat(Store.getSettings().paymentMethods.map(function (m) { return [m.id, m.name]; })), rs.method) + '</select>' +
        '<select id="rstatus" aria-label="Status">' + opt([['', 'Status: tidak dibatalkan'], ['all', 'Semua status']].concat(Object.keys(Orders.STATUS).map(function (k) { return [k, Orders.STATUS[k]]; })), rs.status) + '</select></div>' +
        (rs.range === 'custom' ? '<div class="toolbar no-print"><label class="inline-f">Dari <input type="date" id="rfrom" value="' + esc(rs.from) + '"></label><label class="inline-f">Sampai <input type="date" id="rto" value="' + esc(rs.to) + '"></label></div>' : '');
      var cards = '<div class="stat-grid four"><div class="stat"><span class="stat-ic emerald">' + ic('receipt') + '</span><div><small>Jumlah Pesanan</small><b>' + nonCancel.length + '</b></div></div>' +
        '<div class="stat"><span class="stat-ic blue">' + ic('trending-up') + '</span><div><small>Nilai Penjualan</small><b>' + rp(sales) + '</b></div></div>' +
        '<div class="stat"><span class="stat-ic amber">' + ic('calculator') + '</span><div><small>Rata-rata Pesanan</small><b>' + rp(nonCancel.length ? sales / nonCancel.length : 0) + '</b></div></div>' +
        '<div class="stat"><span class="stat-ic red">' + ic('ban') + '</span><div><small>Pembatalan</small><b>' + cancelled.length + '</b></div></div></div>';
      var perTbl = App.table([
        { label: T.label === 'Harian' ? 'Tanggal' : 'Periode', primary: true, render: function (p) { return esc(p.label); } },
        { label: 'Pesanan', align: 'right', render: function (p) { return p.orders; } },
        { label: 'Penjualan', align: 'right', render: function (p) { return rp(p.sales); } },
        { label: 'Sudah Dibayar', align: 'right', render: function (p) { return rp(p.paid); } }
      ], periods.slice().reverse(), { icon: 'calendar-x', emptyTitle: 'Tidak ada data pada periode ini' });
      var cancelTbl = App.table([
        { label: 'No.', primary: true, render: function (o) { return '<b>' + esc(o.number) + '</b>'; } },
        { label: 'Waktu', render: function (o) { return App.fmtDateTime(o.createdAt); } },
        { label: 'Meja', render: function (o) { return esc(o.tableName); } },
        { label: 'Nilai', align: 'right', render: function (o) { return rp(o.total); } },
        { label: 'Alasan', render: function (o) { return esc(o.cancelReason || '-'); } }
      ], cancelled.slice(0, 20), { icon: 'badge-check', emptyTitle: 'Tidak ada pembatalan', emptyText: 'Bagus! Tidak ada pesanan dibatalkan pada periode ini.' });
      root.innerHTML = '<div class="print-head">' + '<h2>Laporan Penjualan ' + T.label + '</h2><p>' + esc(Store.getSettings().restaurant.name) + ' · ' + esc(r.label) + '</p></div>' + filters + cards +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Penjualan per ' + (T.g === 'day' ? 'hari' : T.g === 'week' ? 'minggu' : T.g === 'month' ? 'bulan' : 'tahun') + '</h3><small class="muted">' + esc(r.label) + '</small></div>' + (periods.length ? Charts.bars(periods.map(function (p) { return { label: p.label, value: p.sales }; }), { fmt: rp, label: 'Grafik penjualan' }) : App.UI.empty('bar-chart-3', 'Belum ada data')) + '</section>' +
        '<section class="card"><div class="card-head"><h3>Rekap ' + T.label + '</h3></div>' + perTbl + '</section></div>' +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Menu Terlaris</h3></div>' + (top.length ? Charts.hbars(top.map(function (x) { return { label: x.name, value: x.qty }; }), { fmt: function (v) { return v + ' porsi'; } }) : App.UI.empty('utensils-crossed', 'Belum ada penjualan')) + '</section>' +
        '<section class="card"><div class="card-head"><h3>Menu Paling Sedikit Terjual</h3></div>' + (least.length ? Charts.hbars(least.map(function (x) { return { label: x.name, value: x.qty }; }), { fmt: function (v) { return v + ' porsi'; } }) : App.UI.empty('utensils-crossed', 'Belum ada data')) + '</section></div>' +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Rekap per Kategori</h3></div>' + (cats.length ? Charts.donut(cats.slice(0, 6).map(function (c, i) { return { label: c.label, value: c.value, color: App.PALETTE[i % App.PALETTE.length] }; }), { center: App.compact(cats.reduce(function (s, c) { return s + c.value; }, 0)), sub: 'rupiah' }) : App.UI.empty('pie-chart', 'Belum ada data')) + '</section>' +
        '<section class="card"><div class="card-head"><h3>Rekap per Jam</h3></div>' + Charts.bars(hours.map(function (h) { return { label: h.label, value: h.value }; }), { fmt: rp, label: 'Penjualan per jam', maxLabels: 14 }) + '</section></div>' +
        '<section class="card"><div class="card-head"><h3>Laporan Pembatalan</h3><small class="muted">' + cancelled.length + ' pesanan</small></div>' + cancelTbl + '</section>' +
        '<section class="card"><div class="card-head"><h3>Kas Masuk dan Keluar</h3></div><div class="kv-grid"><div><small>Kas masuk</small><b class="text-success">' + rp(fin.cashIn) + '</b></div><div><small>Kas keluar</small><b class="text-danger">' + rp(fin.cashOut) + '</b></div><div><small>Selisih periode</small><b>' + rp(fin.balancePeriod) + '</b></div><div><small>Saldo kas (semua waktu)</small><b>' + rp(fin.balanceAll) + '</b></div></div></section>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.onchange = function (e) {
        var id = e.target.id, v = e.target.value;
        if (id === 'rrange') rs.range = v; else if (id === 'rmethod') rs.method = v; else if (id === 'rstatus') rs.status = v; else if (id === 'rfrom') rs.from = v; else if (id === 'rto') rs.to = v; else return;
        keep();
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'type') { rs.type = b.getAttribute('data-v'); rs.range = TYPES[rs.type].range; keep(); }
        else if (act === 'print') window.print();
        else if (act === 'csv') {
          if (!orders.length) { App.toast('Tidak ada data untuk diekspor.', 'warn'); return; }
          var rows = [['Laporan Penjualan ' + T.label, esc2(r.label)], [], ['Periode', 'Pesanan', 'Penjualan', 'Sudah Dibayar']];
          periods.forEach(function (p) { rows.push([p.label, p.orders, p.sales, p.paid]); });
          rows.push([], ['Menu', 'Porsi terjual', 'Pendapatan']);
          rank.sort(function (a, b) { return b.qty - a.qty; }).forEach(function (x) { rows.push([x.name, x.qty, x.revenue]); });
          rows.push([], ['No. Pesanan', 'Waktu', 'Meja', 'Sumber', 'Status', 'Pembayaran', 'Metode', 'Total']);
          orders.forEach(function (o) { rows.push([o.number, App.fmtDateTime(o.createdAt), o.tableName, o.source, Orders.STATUS[o.status], Orders.PAY[o.payStatus], o.payMethod ? Orders.payMethodName(o.payMethod) : '', o.total]); });
          App.csv('laporan-penjualan-' + rs.type + '-' + App.isoDate(Date.now()) + '.csv', rows);
        }
      };
      function esc2(s) { return s; }
    }
  });

  /* ---------- Laporan Keuangan ---------- */
  var fs = { range: 'month', from: '', to: '' };
  Admin.register('report-finance', {
    title: 'Laporan Keuangan', sub: 'Pendapatan penjualan, arus kas, dan estimasi laba dipisahkan', perm: 'reports',
    render: function (root, ctx) {
      var r = App.Range.compute(fs.range, fs.from, fs.to), s = Finance.summary(r);
      ctx.actions('<button class="btn btn-soft" data-act="print">' + ic('printer') + '<span>Cetak</span></button><button class="btn btn-primary" data-act="csv">' + ic('download') + '<span>Ekspor CSV</span></button>');
      var card = function (icon, color, label, val, note, cls) { return '<div class="stat"><span class="stat-ic ' + color + '">' + ic(icon) + '</span><div><small>' + label + '</small><b class="' + (cls || '') + '">' + val + '</b>' + (note ? '<em>' + note + '</em>' : '') + '</div></div>'; };
      // arus kas harian
      var days = {}, txs = Finance.posted().filter(function (t) { return App.Range.has(r, t.at); });
      txs.forEach(function (t) { var k = App.isoDate(t.at); days[k] = (days[k] || 0) + (t.type === 'in' ? t.amount : -t.amount); });
      var flow = Object.keys(days).sort().map(function (k) { return { label: Reports.groupLabel(k, 'day'), value: Math.max(0, days[k]) , raw: days[k] }; });
      root.innerHTML = '<div class="print-head"><h2>Laporan Keuangan</h2><p>' + esc(Store.getSettings().restaurant.name) + ' · ' + esc(r.label) + '</p></div>' +
        '<div class="toolbar no-print"><select id="frange2" aria-label="Rentang">' + opt(App.Range.PRESETS.concat([['year', 'Tahun ini'], ['all', 'Semua waktu']]), fs.range) + '</select>' + (fs.range === 'custom' ? '<label class="inline-f">Dari <input type="date" id="ffrom2" value="' + esc(fs.from) + '"></label><label class="inline-f">Sampai <input type="date" id="fto2" value="' + esc(fs.to) + '"></label>' : '') + '</div>' +
        '<h3 class="sec-h">1. Pendapatan penjualan <small>(hanya pesanan yang sudah dibayar)</small></h3><div class="stat-grid four">' +
        card('banknote', 'emerald', 'Penerimaan Penjualan', rp(s.receipts), s.paidCount + ' pesanan dibayar') + card('landmark', 'slate', 'Pajak Terkumpul', rp(s.tax), 'bukan pendapatan') + card('badge-dollar-sign', 'blue', 'Pendapatan Bersih', rp(s.netSales), 'setelah pajak') +
        card('clock', 'amber', 'Belum Dibayar', rp(s.unpaidValue), s.unpaidCount + ' pesanan — belum masuk kas') + '</div>' +
        '<h3 class="sec-h">2. Arus kas</h3><div class="stat-grid four">' + card('arrow-down-left', 'emerald', 'Kas Masuk', rp(s.cashIn), 'penjualan ' + rp(s.saleIn) + ' + tambahan ' + rp(s.manualIn)) +
        card('arrow-up-right', 'red', 'Kas Keluar', rp(s.cashOut), 'operasional ' + rp(s.manualOut) + ' + refund ' + rp(s.refunds)) + card('scale', 'blue', 'Arus Kas Bersih', rp(s.balancePeriod), '', s.balancePeriod < 0 ? 'text-danger' : '') + card('wallet', 'emerald', 'Saldo Kas (semua waktu)', rp(s.balanceAll), s.txCount + ' transaksi pada periode') + '</div>' +
        '<h3 class="sec-h">3. Estimasi laba</h3><div class="card est"><div class="est-row"><span>Pendapatan bersih</span><b>' + rp(s.netSales) + '</b></div><div class="est-row"><span>Biaya operasional tercatat</span><b>-' + rp(s.manualOut) + '</b></div><div class="est-row total"><span>Estimasi laba</span><b class="' + (s.estProfit < 0 ? 'text-danger' : 'text-success') + '">' + rp(s.estProfit) + '</b></div>' +
        '<div class="notice ' + (s.profitComplete ? 'info' : 'warn') + '">' + ic('triangle-alert') + '<span>' + (s.profitComplete ? 'Ini hanya <b>estimasi</b> berdasarkan biaya yang sudah dicatat. Penjualan bukan laba bersih.' : '<b>Data biaya belum lengkap</b> (belum ada pencatatan bahan baku/biaya pada periode ini), sehingga laba ini hanya estimasi kasar dan bisa terlalu tinggi.') + '</span></div></div>' +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Kas Keluar per Kategori</h3></div>' + (s.costByCategory.length ? Charts.hbars(s.costByCategory, { fmt: rp }) : App.UI.empty('wallet', 'Belum ada kas keluar', 'Catat biaya di menu Kas Keluar.')) + '</section>' +
        '<section class="card"><div class="card-head"><h3>Kas Masuk per Metode</h3></div>' + (s.inByMethod.length ? Charts.hbars(s.inByMethod.map(function (x) { return { label: Orders.payMethodName(x.label), value: x.value }; }), { fmt: rp }) : App.UI.empty('wallet', 'Belum ada kas masuk')) + '</section></div>' +
        '<section class="card"><div class="card-head"><h3>Arus Kas Harian (selisih masuk − keluar)</h3></div>' + (flow.length ? Charts.bars(flow, { fmt: function (v) { return rp(v); }, label: 'Arus kas harian' }) : App.UI.empty('bar-chart-3', 'Belum ada transaksi')) + '<small class="muted">Hari dengan selisih negatif ditampilkan sebagai 0 pada grafik; lihat tabel transaksi untuk rinciannya.</small></section>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.onchange = function (e) { var id = e.target.id, v = e.target.value; if (id === 'frange2') fs.range = v; else if (id === 'ffrom2') fs.from = v; else if (id === 'fto2') fs.to = v; else return; keep(); };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.getAttribute('data-act') === 'print') window.print();
        else if (b.getAttribute('data-act') === 'csv') {
          App.csv('laporan-keuangan-' + App.isoDate(Date.now()) + '.csv', [['Laporan Keuangan', r.label], [], ['Penerimaan penjualan (dibayar)', s.receipts], ['Pajak terkumpul', s.tax], ['Pendapatan bersih', s.netSales], ['Pesanan belum dibayar (tidak masuk kas)', s.unpaidValue], [], ['Kas masuk', s.cashIn], ['  dari penjualan', s.saleIn], ['  tambahan manual', s.manualIn], ['Kas keluar', s.cashOut], ['  operasional manual', s.manualOut], ['  pengembalian dana', s.refunds], ['Arus kas bersih periode', s.balancePeriod], ['Saldo kas semua waktu', s.balanceAll], [], ['ESTIMASI laba (pendapatan bersih - biaya tercatat)', s.estProfit], ['Catatan', s.profitComplete ? 'Estimasi' : 'Data biaya belum lengkap']].concat([[], ['Kategori biaya', 'Nominal']], s.costByCategory.map(function (x) { return [x.label, x.value]; })));
        }
      };
    }
  });

  /* ---------- Pelanggan ---------- */
  var cs = { q: '' };
  Admin.register('customers', {
    title: 'Pelanggan', sub: 'Hanya berdasarkan data yang diisi pelanggan secara sukarela', perm: 'customers',
    render: function (root, ctx) {
      var orders = Store.getOrders(), map = {}, anon = 0;
      orders.forEach(function (o) {
        var c = o.customer || {}, name = (c.name || '').trim(), phone = (c.phone || '').trim();
        if (!name && !phone) { anon++; return; }
        var key = phone ? 'p:' + phone.replace(/\D/g, '') : 'n:' + name.toLowerCase();
        var e = map[key] = map[key] || { key: key, name: name, phone: phone, orders: [], total: 0, last: 0 };
        if (name && !e.name) e.name = name; if (phone && !e.phone) e.phone = phone;
        e.orders.push(o); if (o.status !== 'cancelled' && o.payStatus === 'paid') e.total += o.total; e.last = Math.max(e.last, o.createdAt);
      });
      var q = cs.q.trim().toLowerCase();
      var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (c) { return !q || (c.name + ' ' + c.phone).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return b.last - a.last; });
      ctx.actions('<button class="btn btn-soft" data-act="csv">' + ic('download') + '<span>Ekspor CSV</span></button>');
      var tbl = App.table([
        { label: 'Pelanggan', primary: true, render: function (c) { return '<b>' + esc(c.name || '(tanpa nama)') + '</b>'; } },
        { label: 'No. HP', render: function (c) { return esc(c.phone || '-'); } },
        { label: 'Jumlah Pesanan', align: 'right', render: function (c) { return c.orders.length; } },
        { label: 'Total Transaksi (dibayar)', align: 'right', render: function (c) { return rp(c.total); } },
        { label: 'Terakhir', render: function (c) { return App.fmtDate(c.last); } },
        { label: 'Aksi', align: 'center', render: function (c) { return '<button class="icon-btn sm" data-act="detail" data-key="' + esc(c.key) + '" aria-label="Detail">' + ic('eye') + '</button>'; } }
      ], list, { icon: 'users', emptyTitle: 'Belum ada data pelanggan', emptyText: 'Nama dan nomor HP bersifat opsional. Pelanggan yang mengisinya saat memesan akan muncul di sini.' });
      root.innerHTML = '<div class="notice info">' + ic('shield-check') + '<span>Nama dan nomor HP tidak wajib. ' + anon + ' pesanan tidak memiliki data pelanggan dan tidak ditampilkan di daftar ini.</span></div><div class="card"><div class="toolbar"><div class="search-in">' + ic('search') + '<input id="cq" type="search" placeholder="Cari nama atau nomor HP…" value="' + esc(cs.q) + '" aria-label="Cari pelanggan"></div></div>' + tbl + '</div>';
      App.refreshIcons();
      root.oninput = App.debounce(function (e) { if (e.target.id === 'cq') { cs.q = e.target.value; ctx.rerender(); var i = $('#cq', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.getAttribute('data-act') === 'detail') {
          var c = map[b.getAttribute('data-key')]; if (!c) return;
          var body = '<p class="muted">' + ic('phone') + ' ' + esc(c.phone || '-') + ' · ' + c.orders.length + ' pesanan · total dibayar ' + rp(c.total) + '</p>' + App.table([
            { label: 'No.', primary: true, render: function (o) { return '<b>' + esc(o.number) + '</b>'; } },
            { label: 'Waktu', render: function (o) { return App.fmtDateTime(o.createdAt); } },
            { label: 'Item', render: function (o) { return '<span class="clamp">' + esc(Orders.itemsText(o)) + '</span>'; } },
            { label: 'Total', align: 'right', render: function (o) { return rp(o.total); } },
            { label: 'Status', render: function (o) { return Orders.statusBadge(o) + ' ' + Orders.payBadge(o); } },
            { label: '', render: function (o) { return '<button class="icon-btn sm" data-oid="' + o.id + '" aria-label="Detail">' + ic('eye') + '</button>'; } }
          ], c.orders.sort(function (a, b2) { return b2.createdAt - a.createdAt; }));
          var m = App.modal({ title: c.name || 'Pelanggan', body: body, size: 'lg' });
          App.delegate(m.el, 'click', '[data-oid]', function (ev, el) { OrderUI.detail(el.getAttribute('data-oid')); });
        } else if (b.getAttribute('data-act') === 'csv') {
          if (!list.length) { App.toast('Tidak ada data untuk diekspor.', 'warn'); return; }
          App.csv('pelanggan-' + App.isoDate(Date.now()) + '.csv', [['Nama', 'No. HP', 'Jumlah Pesanan', 'Total Dibayar', 'Pesanan Terakhir']].concat(list.map(function (c) { return [c.name, c.phone, c.orders.length, c.total, App.isoDate(c.last)]; })));
        }
      };
    }
  });
})(window);
