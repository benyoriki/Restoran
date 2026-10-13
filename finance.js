/* ==========================================================================
   finance.js — perhitungan keuangan + tampilan Kas Masuk, Kas Keluar, Riwayat Transaksi
   Prinsip:
   - Pesanan yang BELUM DIBAYAR tidak pernah menjadi kas masuk.
   - Pembayaran pesanan menghasilkan tepat satu transaksi "sale" (anti ganda).
   - Pembatalan/pengembalian dana mengeluarkan transaksi "refund" dan pesanan tidak
     lagi dihitung sebagai pendapatan.
   - Penjualan ≠ laba. Estimasi laba selalu ditandai sebagai estimasi.
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, esc = App.esc, rp = App.rp, ic = App.ic;

  var IN_CATS = ['Modal', 'Setoran', 'Pendapatan lain', 'Lainnya'];
  var OUT_CATS = ['Bahan baku', 'Belanja operasional', 'Gaji / upah', 'Listrik & air', 'Biaya pengiriman', 'Lainnya'];

  var Finance = {
    IN_CATS: IN_CATS, OUT_CATS: OUT_CATS,
    posted: function () { return Store.getTransactions().filter(function (t) { return t.status === 'posted'; }); },

    /** Ringkasan untuk satu rentang waktu (ms). */
    summary: function (r) {
      var orders = Store.getOrders(), txs = Finance.posted();
      var created = orders.filter(function (o) { return App.Range.has(r, o.createdAt); });
      var valid = created.filter(function (o) { return o.status !== 'cancelled'; });
      var paid = orders.filter(function (o) { return o.payStatus === 'paid' && o.paidAt && App.Range.has(r, o.paidAt); });
      var inR = txs.filter(function (t) { return App.Range.has(r, t.at); });
      var sum = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };
      var saleIn = sum(inR.filter(function (t) { return t.type === 'in' && t.kind === 'sale'; }), function (t) { return t.amount; });
      var manualIn = sum(inR.filter(function (t) { return t.type === 'in' && t.kind === 'manual'; }), function (t) { return t.amount; });
      var manualOut = sum(inR.filter(function (t) { return t.type === 'out' && t.kind === 'manual'; }), function (t) { return t.amount; });
      var refunds = sum(inR.filter(function (t) { return t.type === 'out' && t.kind === 'refund'; }), function (t) { return t.amount; });
      var receipts = sum(paid, function (o) { return o.total; });
      var tax = sum(paid, function (o) { return o.tax || 0; });
      var all = txs.reduce(function (s, t) { return s + (t.type === 'in' ? t.amount : -t.amount); }, 0);
      var cashIn = saleIn + manualIn, cashOut = manualOut + refunds;
      var netSales = receipts - tax;
      var costRows = inR.filter(function (t) { return t.type === 'out' && t.kind === 'manual'; });
      var hasIngredient = costRows.some(function (t) { return t.category === 'Bahan baku'; });
      return {
        range: r,
        orderCount: valid.length, orderValue: sum(valid, function (o) { return o.total; }),
        avgOrder: valid.length ? Math.round(sum(valid, function (o) { return o.total; }) / valid.length) : 0,
        cancelled: created.filter(function (o) { return o.status === 'cancelled'; }).length,
        unpaidCount: valid.filter(function (o) { return o.payStatus === 'unpaid'; }).length,
        unpaidValue: sum(valid.filter(function (o) { return o.payStatus === 'unpaid'; }), function (o) { return o.total; }),
        pending: created.filter(function (o) { return o.status === 'pending'; }).length,
        processing: created.filter(function (o) { return o.status === 'confirmed' || o.status === 'cooking'; }).length,
        ready: created.filter(function (o) { return o.status === 'ready' || o.status === 'serving'; }).length,
        done: created.filter(function (o) { return o.status === 'done'; }).length,
        paidCount: paid.length, receipts: receipts, tax: tax, netSales: netSales,
        saleIn: saleIn, manualIn: manualIn, manualOut: manualOut, refunds: refunds,
        cashIn: cashIn, cashOut: cashOut, balancePeriod: cashIn - cashOut, balanceAll: all,
        txCount: inR.length,
        estProfit: netSales - manualOut, profitComplete: hasIngredient && manualOut > 0,
        costByCategory: Finance.groupSum(costRows, 'category'),
        inByMethod: Finance.groupSum(inR.filter(function (t) { return t.type === 'in'; }), 'method')
      };
    },
    groupSum: function (rows, key) {
      var m = {}; rows.forEach(function (t) { var k = t[key] || '-'; m[k] = (m[k] || 0) + t.amount; });
      return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; }).sort(function (a, b) { return b.value - a.value; });
    },
    validate: function (t) { return StoreValidators.transactions(t); },
    csvRows: function (txs) {
      var rows = [['ID Transaksi', 'Tanggal', 'Jam', 'Jenis', 'Sumber', 'Kategori', 'Nominal', 'Keterangan', 'Metode', 'Referensi', 'Status', 'Pencatat']];
      txs.forEach(function (t) {
        rows.push([t.id, App.isoDate(t.at), App.fmtTime(t.at), t.type === 'in' ? 'Kas Masuk' : 'Kas Keluar', t.kind === 'sale' ? 'Penjualan otomatis' : t.kind === 'refund' ? 'Pengembalian dana' : 'Manual', t.category, t.amount, t.desc || '', Orders.payMethodName(t.method), t.ref || '', t.status === 'posted' ? 'Tercatat' : 'Batal', t.by || '']);
      });
      return rows;
    }
  };
  global.Finance = Finance;

  /* ---------- tampilan transaksi ---------- */
  function toLocalInput(ts) { var d = new Date(ts); return d.getFullYear() + '-' + App.pad(d.getMonth() + 1) + '-' + App.pad(d.getDate()) + 'T' + App.pad(d.getHours()) + ':' + App.pad(d.getMinutes()); }

  function txForm(type, t, done) {
    var isNew = !t, s = Store.getSettings();
    var cats = type === 'in' ? IN_CATS : OUT_CATS;
    var user = App.Auth.current();
    var v = t ? Object.assign({}, t, { at: toLocalInput(t.at) }) : { category: cats[0], amount: '', desc: '', method: 'cash', ref: '', at: toLocalInput(Date.now()) };
    App.formModal({
      title: (isNew ? 'Tambah ' : 'Edit ') + (type === 'in' ? 'Kas Masuk' : 'Kas Keluar'), size: 'md', values: v,
      fields: [
        { name: 'at', label: 'Tanggal & waktu', type: 'datetime-local', required: true },
        { name: 'category', label: type === 'in' ? 'Sumber penerimaan' : 'Kategori biaya', type: 'select', required: true, options: cats.map(function (c) { return { value: c, label: c }; }) },
        { name: 'amount', label: 'Nominal', type: 'number', required: true, min: 1, step: 500, prefix: 'Rp' },
        { name: 'method', label: 'Metode pembayaran', type: 'select', options: s.paymentMethods.filter(function (m) { return m.active; }).map(function (m) { return { value: m.id, label: m.name }; }) },
        { name: 'ref', label: 'Nomor referensi (opsional)', maxlength: 40 },
        { name: 'desc', label: 'Keterangan', type: 'textarea', rows: 2, maxlength: 160, cols: 2 }
      ],
      onSubmit: function (c) {
        var at = new Date(c.at).getTime();
        var item = Object.assign({}, t || {}, { type: type, kind: 'manual', category: c.category, amount: c.amount, desc: c.desc, method: c.method, ref: c.ref, at: at, status: 'posted', by: t ? t.by : (user ? user.name : '') });
        Store.saveTransaction(item); App.toast('Transaksi disimpan.'); done();
      }
    });
  }

  var fstate = { in: { q: '', range: 'month', from: '', to: '', method: '', cat: '' }, out: { q: '', range: 'month', from: '', to: '', method: '', cat: '' }, all: { q: '', range: 'month', from: '', to: '', method: '', cat: '' } };

  function txView(kind, title) {
    return function (root, ctx) {
      var st = fstate[kind], r = App.Range.compute(st.range, st.from, st.to), s = Store.getSettings();
      var list = Store.getTransactions().filter(function (t) {
        if (kind !== 'all' && t.type !== kind) return false;
        if (!App.Range.has(r, t.at)) return false;
        if (st.method && t.method !== st.method) return false;
        if (st.cat && t.category !== st.cat) return false;
        var q = st.q.trim().toLowerCase();
        return !q || (t.id + ' ' + t.desc + ' ' + t.category + ' ' + (t.ref || '') + ' ' + (t.by || '')).toLowerCase().indexOf(q) >= 0;
      });
      var tin = list.filter(function (t) { return t.type === 'in' && t.status === 'posted'; }).reduce(function (a, t) { return a + t.amount; }, 0);
      var tout = list.filter(function (t) { return t.type === 'out' && t.status === 'posted'; }).reduce(function (a, t) { return a + t.amount; }, 0);
      var acts = '<button class="btn btn-soft" data-act="csv">' + ic('download') + '<span>Ekspor CSV</span></button>';
      if (App.Auth.can('cash')) {
        if (kind !== 'out') acts += '<button class="btn btn-primary" data-act="add-in">' + ic('plus') + '<span>Kas Masuk</span></button>';
        if (kind !== 'in') acts += '<button class="btn ' + (kind === 'out' ? 'btn-primary' : 'btn-soft') + '" data-act="add-out">' + ic('plus') + '<span>Kas Keluar</span></button>';
      }
      ctx.actions(acts);
      var allCats = (kind === 'in' ? IN_CATS.concat(['Penjualan']) : kind === 'out' ? OUT_CATS.concat(['Pengembalian dana']) : IN_CATS.concat(OUT_CATS, ['Penjualan', 'Pengembalian dana'])).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var cards = '<div class="stat-grid three">' +
        (kind !== 'out' ? '<div class="stat"><span class="stat-ic emerald">' + ic('arrow-down-left') + '</span><div><small>Total Kas Masuk</small><b>' + rp(tin) + '</b></div></div>' : '') +
        (kind !== 'in' ? '<div class="stat"><span class="stat-ic red">' + ic('arrow-up-right') + '</span><div><small>Total Kas Keluar</small><b>' + rp(tout) + '</b></div></div>' : '') +
        (kind === 'all' ? '<div class="stat"><span class="stat-ic blue">' + ic('wallet') + '</span><div><small>Selisih Periode</small><b class="' + (tin - tout < 0 ? 'text-danger' : '') + '">' + rp(tin - tout) + '</b></div></div>' : '<div class="stat"><span class="stat-ic blue">' + ic('list') + '</span><div><small>Jumlah Transaksi</small><b>' + list.length + '</b></div></div>') + '</div>';
      var tbl = App.table([
        { label: 'ID / Waktu', primary: true, render: function (t) { return '<b class="mono">' + esc(t.id.length > 18 ? t.id.slice(0, 18) + '…' : t.id) + '</b><small class="sub">' + App.fmtDate(t.at) + ' ' + App.fmtTime(t.at) + '</small>'; } },
        { label: 'Jenis', render: function (t) { return t.type === 'in' ? '<span class="badge success">Masuk</span>' : '<span class="badge danger">Keluar</span>'; } },
        { label: 'Kategori', render: function (t) { return esc(t.category) + (t.kind !== 'manual' ? '<small class="sub">otomatis</small>' : ''); } },
        { label: 'Keterangan', cls: 'col-items', render: function (t) { return '<span class="clamp">' + esc(t.desc || '-') + '</span>' + (t.ref ? '<small class="sub">Ref: ' + esc(t.ref) + '</small>' : ''); } },
        { label: 'Metode', render: function (t) { return esc(Orders.payMethodName(t.method)); } },
        { label: 'Nominal', align: 'right', render: function (t) { return '<b class="' + (t.type === 'in' ? 'text-success' : 'text-danger') + '">' + (t.type === 'in' ? '+' : '-') + rp(t.amount) + '</b>'; } },
        { label: 'Status', align: 'center', render: function (t) { return t.status === 'posted' ? '<span class="badge muted">Tercatat</span>' : '<span class="badge danger">Batal</span>'; } },
        { label: 'Aksi', align: 'center', render: function (t) {
          if (t.kind !== 'manual') return '<span class="muted lock" title="Dibuat otomatis dari pesanan, tidak dapat diubah">' + ic('lock') + '</span>' + (t.orderId ? '<button class="icon-btn sm" data-act="order" data-id="' + t.orderId + '" aria-label="Lihat pesanan">' + ic('eye') + '</button>' : '');
          if (!App.Auth.can('cash')) return '';
          return '<div class="row-actions"><button class="icon-btn sm" data-act="edit" data-id="' + t.id + '" aria-label="Edit">' + ic('pencil') + '</button><button class="icon-btn sm danger" data-act="del" data-id="' + t.id + '" aria-label="Hapus">' + ic('trash-2') + '</button></div>';
        } }
      ], list.slice(0, 400), { icon: 'wallet', emptyTitle: 'Belum ada transaksi', emptyText: 'Tidak ada transaksi pada filter ini.' });
      var opt = function (arr, cur) { return arr.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };
      root.innerHTML = cards + '<div class="card"><div class="toolbar"><div class="search-in">' + ic('search') + '<input id="fq" type="search" placeholder="Cari keterangan, ID, referensi…" value="' + esc(st.q) + '" aria-label="Cari transaksi"></div>' +
        '<select id="frange" aria-label="Rentang">' + opt(App.Range.PRESETS.concat([['year', 'Tahun ini'], ['all', 'Semua waktu']]), st.range) + '</select>' +
        '<select id="fmethod" aria-label="Metode">' + opt([['', 'Semua Metode']].concat(s.paymentMethods.map(function (m) { return [m.id, m.name]; })), st.method) + '</select>' +
        '<select id="fcat" aria-label="Kategori">' + opt([['', 'Semua Kategori']].concat(allCats.map(function (c) { return [c, c]; })), st.cat) + '</select></div>' +
        (st.range === 'custom' ? '<div class="toolbar"><label class="inline-f">Dari <input type="date" id="ffrom" value="' + esc(st.from) + '"></label><label class="inline-f">Sampai <input type="date" id="fto" value="' + esc(st.to) + '"></label></div>' : '') + tbl +
        '<p class="table-foot">' + list.length + ' transaksi · ' + esc(r.label) + '</p></div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.oninput = App.debounce(function (e) { if (e.target.id === 'fq') { st.q = e.target.value; keep(); var i = $('#fq', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
      root.onchange = function (e) {
        var id = e.target.id, v = e.target.value;
        if (id === 'frange') st.range = v; else if (id === 'fmethod') st.method = v; else if (id === 'fcat') st.cat = v; else if (id === 'ffrom') st.from = v; else if (id === 'fto') st.to = v; else return;
        keep();
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'add-in') txForm('in', null, keep); else if (act === 'add-out') txForm('out', null, keep);
        else if (act === 'edit') { var t = Store.get('transactions', id); txForm(t.type, t, keep); }
        else if (act === 'del') {
          var tr = Store.get('transactions', id);
          App.confirm({ title: 'Hapus transaksi?', message: (tr.type === 'in' ? 'Kas masuk ' : 'Kas keluar ') + rp(tr.amount) + ' (' + tr.category + ') akan dihapus dan saldo kas dihitung ulang.', confirmText: 'Hapus', danger: true }).then(function (ok) { if (ok) { Store.deleteTransaction(id); App.toast('Transaksi dihapus.'); keep(); } });
        } else if (act === 'order') OrderUI.detail(id);
        else if (act === 'csv') { if (!list.length) { App.toast('Tidak ada data untuk diekspor.', 'warn'); return; } App.csv('transaksi-' + kind + '-' + App.isoDate(Date.now()) + '.csv', Finance.csvRows(list)); }
      };
    };
  }

  Admin.register('cash-in', { title: 'Kas Masuk', sub: 'Penerimaan uang: penjualan otomatis dan pemasukan manual', perm: 'transactions', render: txView('in') });
  Admin.register('cash-out', { title: 'Kas Keluar', sub: 'Pembelian bahan, operasional, gaji, dan biaya lain', perm: 'transactions', render: txView('out') });
  Admin.register('transactions', { title: 'Riwayat Transaksi', sub: 'Semua kas masuk dan keluar', perm: 'transactions', render: txView('all') });
})(window);
