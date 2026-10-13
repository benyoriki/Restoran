/* ==========================================================================
   storage.js — StorageService (lapisan data)
   --------------------------------------------------------------------------
   Seluruh aplikasi HANYA mengakses data lewat objek `Store` di file ini.
   Implementasi default memakai LocalStorage (adapter "local").
   Untuk pindah ke Firebase, cukup buat adapter baru dengan antarmuka yang sama
   (lihat README.md bagian "Migrasi ke Firebase") lalu panggil Store.use(adapter).

   PENTING (keterbatasan prototype):
   - LocalStorage hanya berlaku untuk satu browser + satu origin. Pesanan dari HP
     pelanggan TIDAK otomatis muncul di dashboard admin/dapur pada perangkat lain.
   - Sinkronisasi antar-tab di browser yang sama (mode simulasi) memakai
     BroadcastChannel + event "storage".
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'qmo:';
  var SCHEMA_VERSION = 1;
  var COLLECTIONS = ['categories', 'menus', 'tables', 'orders', 'transactions', 'promos', 'users'];
  var DOCS = ['settings', 'meta'];

  /* ---------- util kecil ---------- */
  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    var t = Date.now().toString(36);
    return (prefix || 'id') + '_' + t + rnd;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function StoreError(message, code) {
    var e = new Error(message); e.name = 'StoreError'; e.code = code || 'STORE'; return e;
  }

  /* ---------- adapter LocalStorage ---------- */
  var LocalAdapter = {
    name: 'local',
    memory: {},          // cadangan bila localStorage tidak tersedia
    usingMemory: false,
    available: (function () {
      try { var k = '__qmo_test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
      catch (e) { return false; }
    })(),
    read: function (key) {
      var raw = null;
      try { raw = this.available ? localStorage.getItem(PREFIX + key) : this.memory[key]; }
      catch (e) { raw = this.memory[key]; }
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    write: function (key, value) {
      var raw = JSON.stringify(value);
      if (!this.available) { this.memory[key] = raw; this.usingMemory = true; return; }
      try { localStorage.setItem(PREFIX + key, raw); }
      catch (e) {
        var quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
        throw StoreError(quota
          ? 'Penyimpanan browser penuh. Hapus foto besar atau data lama (Backup & Pemulihan), lalu coba lagi.'
          : 'Gagal menyimpan data ke browser: ' + (e && e.message), quota ? 'QUOTA' : 'WRITE');
      }
    },
    remove: function (key) {
      if (!this.available) { delete this.memory[key]; return; }
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    },
    keys: function () {
      var out = [];
      if (!this.available) return Object.keys(this.memory);
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
        }
      } catch (e) {}
      return out;
    },
    usedBytes: function () {
      var n = 0;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) n += (k.length + (localStorage.getItem(k) || '').length) * 2;
        }
      } catch (e) {}
      return n;
    }
  };

  var adapter = LocalAdapter;
  var cache = {};
  var listeners = [];
  var channel = null;
  try { if ('BroadcastChannel' in global) channel = new BroadcastChannel('qmo-sync'); } catch (e) {}

  function emit(evt) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](evt); } catch (e) { console.error(e); }
    }
  }
  function notifyOthers(key) {
    try { if (channel) channel.postMessage({ key: key, at: Date.now() }); } catch (e) {}
  }
  if (channel) {
    channel.onmessage = function (m) {
      cache = {};
      emit({ key: m.data && m.data.key, remote: true });
    };
  }
  global.addEventListener && global.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf(PREFIX) === 0) { cache = {}; emit({ key: e.key.slice(PREFIX.length), remote: true }); }
  });

  /* ---------- akses mentah ---------- */
  function rawRead(key, fallback) {
    if (key in cache) return clone(cache[key]);
    var v = adapter.read(key);
    if (v == null) v = fallback;
    cache[key] = clone(v);
    return clone(v);
  }
  function rawWrite(key, value) {
    adapter.write(key, value);
    cache[key] = clone(value);
    notifyOthers(key);
    emit({ key: key, remote: false });
  }

  /* ==========================================================================
     Pengaturan bawaan & data contoh
     ========================================================================== */
  function defaultSettings() {
    return {
      restaurant: {
        name: 'Ayam Kampung Sambal Merintih',
        tagline: 'Citeureup, Bogor',
        logo: '',
        cover: '',
        address: 'Jl. Sabilillah, Citeureup, Kecamatan Citeureup, Kabupaten Bogor, Jawa Barat 16810',
        whatsapp: '6281234567890',
        maps: 'https://maps.app.goo.gl/vTnnZQfxfMbfH7Ua6?g_st=ac',
        hours: 'Setiap hari 09.00 - 21.00',
        footer: 'Terima kasih sudah makan bersama kami.'
      },
      currency: 'IDR',
      tax: { enabled: true, rate: 10, label: 'Pajak' },
      service: { enabled: false, rate: 5, label: 'Biaya layanan' },
      orderPrefix: '#',
      orderFormat: 'seq',          // seq => #00123 | date => AKS-1012-001
      orderDigits: 5,
      baseUrl: '',                 // kosong = otomatis dari alamat halaman saat ini
      kitchen: { sound: true, lateMinutes: 15 },
      receipt: { header: 'Struk Pembayaran', footer: 'Terima kasih, selamat menikmati!', showTax: true, width: '80mm' },
      paymentMethods: [
        { id: 'cash', name: 'Tunai', active: true },
        { id: 'transfer', name: 'Transfer Bank', active: true },
        { id: 'qris', name: 'QRIS', active: true },
        { id: 'other', name: 'Lainnya', active: true }
      ],
      qris: { enabled: true, merchant: 'Riki Hermawan, Digital & Kreatif', nmid: 'ID1026615097429', dynamic: true, payload: '00020101021126610014COM.GO-JEK.WWW01189360091434351954690210G4351954690303UMI51440014ID.CO.QRIS.WWW0215ID10266150974290303UMI5204899953033605802ID5924RIKI HERMAWAN, Digital &6005BOGOR61051681062070703A016304F76A' },
      developer: { name: 'Riki Hermawan', handle: '@benyoriki', url: 'https://benyoriki.com', wa: '' },
      subscription: { plan: 'pro', status: 'demo', endDate: '' },
      plans: [
        { id: 'basic', name: 'Basic', price: 99000, period: 'bulan', featured: false, maxTables: 10, maxMenus: 50, maxUsers: 2, reports: 'Laporan harian', features: ['Menu digital + QR meja', 'Dashboard pesanan', 'Pesanan manual kasir', 'Laporan harian'] },
        { id: 'pro', name: 'Pro', price: 199000, period: 'bulan', featured: true, maxTables: 30, maxMenus: 200, maxUsers: 5, reports: 'Laporan lengkap + CSV', features: ['Semua fitur Basic', 'Dashboard dapur layar penuh', 'Kas masuk/keluar', 'Promo & diskon', 'Laporan lengkap + ekspor CSV'] },
        { id: 'business', name: 'Business', price: 399000, period: 'bulan', featured: false, maxTables: 100, maxMenus: 1000, maxUsers: 15, reports: 'Laporan lengkap + multi cabang*', features: ['Semua fitur Pro', 'Multi pengguna & hak akses', 'Prioritas dukungan', 'Siap integrasi multi-restoran*'] }
      ]
    };
  }

  var SEED_CATEGORIES = [
    { id: 'cat_ayam', name: 'Ayam', icon: 'drumstick' },
    { id: 'cat_paket', name: 'Paket', icon: 'package' },
    { id: 'cat_ikan', name: 'Ikan', icon: 'fish' },
    { id: 'cat_nasi', name: 'Nasi', icon: 'wheat' },
    { id: 'cat_sambal', name: 'Sambal', icon: 'flame' },
    { id: 'cat_sayur', name: 'Sayuran', icon: 'leaf' },
    { id: 'cat_minum', name: 'Minuman', icon: 'cup-soda' },
    { id: 'cat_camilan', name: 'Camilan', icon: 'cookie' }
  ];

  // [id, nama, deskripsi, kategori, harga, stok, min, emoji, warna, unggulan, habis?]
  var SEED_MENUS = [
    ['m_ayam_goreng', 'Ayam Kampung Goreng', 'Ayam kampung goreng bumbu rempah, gurih dan renyah, disajikan dengan sambal.', 'cat_ayam', 28000, 50, 10, '🍗', ['#e0a458', '#a8541f'], true],
    ['m_ayam_bakar', 'Ayam Kampung Bakar', 'Ayam kampung bakar manis pedas dengan olesan bumbu kecap.', 'cat_ayam', 30000, 40, 10, '🍖', ['#c9772f', '#6e2f10'], true],
    ['m_ayam_geprek', 'Ayam Geprek Sambal', 'Ayam krispi digeprek dengan sambal bawang pedas segar.', 'cat_ayam', 26000, 35, 8, '🔥', ['#e4572e', '#8a2410'], false],
    ['m_ayam_rica', 'Ayam Rica-rica', 'Ayam kampung dimasak pedas dengan daun jeruk dan kemangi.', 'cat_ayam', 32000, 22, 8, '🌶️', ['#d1432b', '#6b1a10'], false],
    ['m_paket_hemat', 'Paket Hemat', 'Ayam kampung + nasi putih + sambal + es teh manis.', 'cat_paket', 32000, 30, 8, '🍱', ['#e9b44c', '#9b5d1b'], true],
    ['m_paket_keluarga', 'Paket Keluarga (4 orang)', '4 potong ayam, 4 nasi, 2 sambal, lalapan, dan 4 es teh.', 'cat_paket', 120000, 12, 3, '👨‍👩‍👧‍👦', ['#f2c14e', '#a5651a'], false],
    ['m_nila_bakar', 'Ikan Nila Bakar', 'Nila segar dibakar dengan bumbu kuning dan sambal dabu-dabu.', 'cat_ikan', 35000, 0, 5, '🐟', ['#6fb3a8', '#245a54'], false, true],
    ['m_lele_goreng', 'Lele Goreng', 'Lele goreng garing dengan lalapan dan sambal terasi.', 'cat_ikan', 22000, 25, 6, '🐠', ['#c7a14a', '#6f5418'], false],
    ['m_gurame', 'Gurame Goreng', 'Gurame goreng utuh, kriuk di luar lembut di dalam.', 'cat_ikan', 55000, 4, 5, '🐡', ['#d9a55c', '#7a4a17'], false],
    ['m_nasi_putih', 'Nasi Putih', 'Nasi putih hangat pulen.', 'cat_nasi', 5000, 200, 30, '🍚', ['#f1ece0', '#bdb29a'], false],
    ['m_nasi_liwet', 'Nasi Liwet', 'Nasi liwet gurih dengan wangi serai dan daun salam.', 'cat_nasi', 8000, 60, 10, '🍛', ['#e8dcb5', '#a58d4c'], false],
    ['m_sambal_merintih', 'Sambal Merintih', 'Sambal andalan pedas nendang, level pedas bisa diatur.', 'cat_sambal', 5000, 120, 20, '🥵', ['#d62f2f', '#7a1010'], true],
    ['m_sambal_terasi', 'Sambal Terasi', 'Sambal terasi bakar khas rumahan.', 'cat_sambal', 4000, 120, 20, '🌶️', ['#b5452a', '#5e1f10'], false],
    ['m_sambal_matah', 'Sambal Matah', 'Irisan bawang, serai, dan cabai dengan minyak kelapa.', 'cat_sambal', 6000, 80, 15, '🧅', ['#e07a5f', '#8e3b26'], false],
    ['m_lalapan', 'Lalapan Segar', 'Timun, kemangi, kol, dan terong segar.', 'cat_sayur', 6000, 70, 10, '🥬', ['#7cb45b', '#2f6b25'], false],
    ['m_kangkung', 'Tumis Kangkung', 'Kangkung tumis bawang putih dan cabai.', 'cat_sayur', 12000, 30, 8, '🥗', ['#5fa14d', '#245a1c'], false],
    ['m_terong', 'Terong Balado', 'Terong goreng dengan sambal balado.', 'cat_sayur', 12000, 28, 6, '🍆', ['#9d4edd', '#4a1c78'], false],
    ['m_tahu_tempe', 'Tahu Tempe Goreng', 'Tahu dan tempe goreng hangat (4 potong).', 'cat_sayur', 8000, 60, 10, '🟨', ['#e6b54a', '#8c6416'], false],
    ['m_es_teh', 'Es Teh Manis', 'Teh manis dingin, segar.', 'cat_minum', 5000, 200, 30, '🧋', ['#d9822b', '#7a3d0b'], true],
    ['m_teh_tawar', 'Teh Tawar Hangat', 'Teh tawar hangat tanpa gula.', 'cat_minum', 3000, 200, 30, '🍵', ['#c99a4b', '#6d4b17'], false],
    ['m_es_jeruk', 'Es Jeruk', 'Jeruk peras segar dengan es batu.', 'cat_minum', 7000, 90, 15, '🍊', ['#f5a524', '#b45f06'], false],
    ['m_kelapa_muda', 'Es Kelapa Muda', 'Kelapa muda utuh dengan sirup dan es.', 'cat_minum', 12000, 40, 8, '🥥', ['#9bd4c4', '#2f7d6d'], false],
    ['m_kopi', 'Kopi Hitam', 'Kopi tubruk panas.', 'cat_minum', 6000, 100, 15, '☕', ['#7b5a3c', '#2f1d0f'], false],
    ['m_kerupuk', 'Kerupuk', 'Kerupuk putih renyah.', 'cat_camilan', 3000, 150, 20, '🥠', ['#f0d9a0', '#b08a35'], false],
    ['m_pisang_goreng', 'Pisang Goreng', 'Pisang goreng tepung crispy (5 potong).', 'cat_camilan', 10000, 35, 8, '🍌', ['#f2c94c', '#a37a10'], false],
    ['m_mendoan', 'Tempe Mendoan', 'Tempe mendoan setengah matang dengan sambal kecap.', 'cat_camilan', 8000, 45, 8, '🧇', ['#d8b45e', '#7c5d1c'], false]
  ];

  var SEED_PROMOS = function () {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var f = function (d) { var x = new Date(t.getTime() + d * 86400000); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
    return [
      { id: 'promo_minum', name: 'Diskon Minuman 20%', label: 'Promo 20%', type: 'percent', value: 20, scope: 'category', targetIds: ['cat_minum'], minPurchase: 0, maxDiscount: 3000, startDate: f(-5), endDate: f(30), active: true },
      { id: 'promo_belanja', name: 'Potongan Rp10.000 min. belanja Rp100.000', label: 'Hemat 10rb', type: 'nominal', value: 10000, scope: 'all', targetIds: [], minPurchase: 100000, maxDiscount: 0, startDate: f(-5), endDate: f(30), active: true },
      { id: 'promo_lama', name: 'Promo Akhir Bulan (berakhir)', label: 'Promo', type: 'percent', value: 15, scope: 'category', targetIds: ['cat_camilan'], minPurchase: 0, maxDiscount: 0, startDate: f(-40), endDate: f(-10), active: true }
    ];
  };

  var SEED_USERS = [
    { id: 'u_owner', name: 'Riki (Owner)', username: 'owner', role: 'owner', pin: '1234', active: true },
    { id: 'u_admin', name: 'Admin Restoran', username: 'admin', role: 'admin', pin: '1234', active: true },
    { id: 'u_kasir', name: 'Kasir Sari', username: 'kasir', role: 'cashier', pin: '1234', active: true },
    { id: 'u_dapur', name: 'Dapur Budi', username: 'dapur', role: 'kitchen', pin: '1234', active: true }
  ];

  /* RNG deterministik agar data contoh selalu konsisten */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function seedMenus() {
    var now = Date.now();
    return SEED_MENUS.map(function (r, i) {
      return {
        id: r[0], name: r[1], desc: r[2], categoryId: r[3], price: r[4], promoPrice: null,
        stock: r[5], minStock: r[6], available: !r[10], featured: !!r[9], active: true,
        image: '', emoji: r[7], colors: r[8], sort: i, createdAt: now, updatedAt: now
      };
    });
  }

  function buildSeed() {
    var now = new Date();
    var settings = defaultSettings();
    var cats = SEED_CATEGORIES.map(function (c, i) { return { id: c.id, name: c.name, icon: c.icon, sort: i, active: true }; });
    var menus = seedMenus();
    var tables = [];
    for (var i = 1; i <= 8; i++) {
      var n = ('0' + i).slice(-2);
      tables.push({ id: 'tbl_' + n, code: 'MEJA-' + n, name: 'Meja ' + n, capacity: i <= 4 ? 4 : 6, active: i !== 5, createdAt: Date.now() });
    }
    tables.push({ id: 'tbl_23', code: 'MEJA-23', name: 'Meja 23', capacity: 6, active: true, createdAt: Date.now() });
    var promos = SEED_PROMOS();
    var users = clone(SEED_USERS);
    var meta = { schema: SCHEMA_VERSION, sample: true, createdAt: Date.now(), orderCounter: 0, dayCounters: {} };

    var CUSTOMERS = [{ name: 'Andi (contoh)', phone: '081200000001' }, { name: 'Sinta (contoh)', phone: '081200000002' }, { name: 'Pak Budi (contoh)', phone: '' }, { name: 'Keluarga Rahma (contoh)', phone: '081200000004' }, { name: 'Dewi (contoh)', phone: '081200000005' }];
    var R = rng(20261012);
    var orders = [], txs = [];
    var activeTables = tables.filter(function (t) { return t.active; });
    var payIds = ['cash', 'cash', 'qris', 'transfer', 'qris'];
    var counter = 0;
    function priceOf(m) { return m.price; }
    function mkOrder(ts, opts) {
      opts = opts || {};
      var nItems = 1 + Math.floor(R() * 4), used = {}, items = [];
      for (var k = 0; k < nItems; k++) {
        var m = menus[Math.floor(R() * menus.length)];
        if (used[m.id] || m.id === 'm_nila_bakar') continue; used[m.id] = 1;
        items.push({ menuId: m.id, name: m.name, basePrice: m.price, price: priceOf(m), qty: 1 + Math.floor(R() * 3), note: '' });
      }
      if (!items.length) { var mm = menus[0]; items.push({ menuId: mm.id, name: mm.name, basePrice: mm.price, price: mm.price, qty: 1, note: '' }); }
      var subtotal = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
      var tax = Math.round(subtotal * 0.10);
      var total = subtotal + tax;
      var tbl = activeTables[Math.floor(R() * activeTables.length)];
      var takeaway = R() < 0.12;
      counter++;
      var o = {
        id: 'ord_seed_' + counter, number: settings.orderPrefix + ('00000' + counter).slice(-settings.orderDigits),
        seq: counter, type: takeaway ? 'takeaway' : 'dinein', tableCode: takeaway ? '' : tbl.code, tableName: takeaway ? 'Bungkus' : tbl.name,
        source: opts.source || (R() < 0.7 ? 'qr' : 'manual'), status: opts.status || 'done', payStatus: 'unpaid',
        items: items, subtotal: subtotal, discount: 0, discounts: [], service: 0, tax: tax, total: total,
        customer: R() < 0.3 ? CUSTOMERS[Math.floor(R() * CUSTOMERS.length)] : { name: '', phone: '' }, note: '', allergy: '', payMethod: '', paidAt: null, paidAmount: 0,
        createdAt: ts, updatedAt: ts, createdBy: 'sample',
        history: [{ status: 'pending', at: ts, by: 'sample' }]
      };
      if (o.status === 'done' || opts.paid) {
        o.payStatus = 'paid'; o.payMethod = payIds[Math.floor(R() * payIds.length)]; o.paidAt = ts + 25 * 60000; o.paidAmount = total;
        txs.push({
          id: 'trx_seed_' + counter, type: 'in', kind: 'sale', category: 'Penjualan', amount: total, desc: 'Pembayaran ' + o.number,
          method: o.payMethod, ref: o.number, status: 'posted', at: o.paidAt, by: 'sample', orderId: o.id
        });
      }
      if (o.status === 'done') {
        o.history = o.history.concat([{ status: 'confirmed', at: ts + 60000, by: 'sample' }, { status: 'cooking', at: ts + 3 * 60000, by: 'sample' }, { status: 'ready', at: ts + 14 * 60000, by: 'sample' }, { status: 'done', at: ts + 22 * 60000, by: 'sample' }]);
        o.updatedAt = ts + 22 * 60000;
      }
      return o;
    }

    /* 14 hari ke belakang */
    for (var d = 14; d >= 1; d--) {
      var base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      var perDay = 12 + Math.floor(R() * 14) + (base.getDay() === 0 || base.getDay() === 6 ? 8 : 0);
      for (var j = 0; j < perDay; j++) {
        var hr = [10, 11, 12, 12, 13, 13, 14, 16, 17, 18, 18, 19, 19, 20][Math.floor(R() * 14)];
        var ts = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hr, Math.floor(R() * 60)).getTime();
        orders.push(mkOrder(ts));
      }
      // satu pembatalan per beberapa hari
      if (d % 3 === 0) {
        var co = mkOrder(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 15, 10).getTime(), { status: 'cancelled' });
        co.payStatus = 'cancelled'; co.cancelReason = 'Pelanggan membatalkan'; co.history.push({ status: 'cancelled', at: co.createdAt + 120000, by: 'sample', reason: co.cancelReason });
        orders.push(co);
      }
      // pengeluaran harian
      var dayTs = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 8, 30).getTime();
      txs.push({ id: 'trx_out_' + d + '_a', type: 'out', kind: 'manual', category: 'Bahan baku', amount: 250000 + Math.floor(R() * 200) * 1000, desc: 'Belanja ayam kampung & bumbu', method: 'cash', ref: '', status: 'posted', at: dayTs, by: 'Kasir Sari' });
      if (d % 4 === 0) txs.push({ id: 'trx_out_' + d + '_b', type: 'out', kind: 'manual', category: 'Listrik & air', amount: 180000, desc: 'Token listrik', method: 'transfer', ref: '', status: 'posted', at: dayTs + 3600000, by: 'Admin Restoran' });
    }
    txs.push({ id: 'trx_in_modal', type: 'in', kind: 'manual', category: 'Modal', amount: 2000000, desc: 'Modal awal kas (data contoh)', method: 'cash', ref: 'MODAL-01', status: 'posted', at: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 7, 0).getTime(), by: 'Riki (Owner)' });

    /* pesanan hari ini (aktif) — mencerminkan papan dapur pada gambar referensi */
    var t0 = Date.now();
    function live(minAgo, status, table, items, src, paid) {
      var ts = t0 - minAgo * 60000;
      var its = items.map(function (x) {
        var m = menus.filter(function (z) { return z.id === x[0]; })[0];
        return { menuId: m.id, name: m.name, basePrice: m.price, price: m.price, qty: x[1], note: x[2] || '' };
      });
      var sub = its.reduce(function (s, it) { return s + it.price * it.qty; }, 0), tx = Math.round(sub * 0.10);
      counter++;
      var tbl = tables.filter(function (z) { return z.code === table; })[0];
      var o = {
        id: 'ord_seed_' + counter, number: settings.orderPrefix + ('00000' + counter).slice(-settings.orderDigits), seq: counter,
        type: 'dinein', tableCode: table, tableName: tbl ? tbl.name : table, source: src, status: status, payStatus: 'unpaid',
        items: its, subtotal: sub, discount: 0, discounts: [], service: 0, tax: tx, total: sub + tx,
        customer: { name: '', phone: '' }, note: '', allergy: '', payMethod: '', paidAt: null, paidAmount: 0,
        createdAt: ts, updatedAt: ts, createdBy: 'sample', history: [{ status: 'pending', at: ts, by: 'sample' }]
      };
      var order = ['pending', 'confirmed', 'cooking', 'ready', 'serving', 'done'], idx = order.indexOf(status);
      for (var q = 1; q <= idx; q++) o.history.push({ status: order[q], at: ts + q * 2 * 60000, by: 'sample' });
      o.updatedAt = o.history[o.history.length - 1].at;
      if (paid) {
        o.payStatus = 'paid'; o.payMethod = 'cash'; o.paidAt = o.updatedAt; o.paidAmount = o.total;
        txs.push({ id: 'trx_seed_live_' + counter, type: 'in', kind: 'sale', category: 'Penjualan', amount: o.total, desc: 'Pembayaran ' + o.number, method: 'cash', ref: o.number, status: 'posted', at: o.paidAt, by: 'sample', orderId: o.id });
      }
      return o;
    }
    orders.push(live(26, 'done', 'MEJA-02', [['m_ayam_goreng', 1], ['m_nasi_putih', 1]], 'qr', true));
    orders.push(live(18, 'ready', 'MEJA-04', [['m_paket_hemat', 1], ['m_es_teh', 1]], 'qr', false));
    orders.push(live(12, 'cooking', 'MEJA-03', [['m_ayam_bakar', 1], ['m_nasi_putih', 1], ['m_es_jeruk', 1]], 'manual', false));
    orders.push(live(7, 'confirmed', 'MEJA-06', [['m_ayam_geprek', 2, 'Sambal dipisah']], 'qr', false));
    orders.push(live(3, 'pending', 'MEJA-01', [['m_ayam_goreng', 1], ['m_nasi_putih', 2], ['m_es_teh', 1, 'Kurang manis']], 'qr', false));
    orders.push(live(1, 'pending', 'MEJA-07', [['m_lele_goreng', 2], ['m_kangkung', 1], ['m_teh_tawar', 2]], 'qr', false));

    meta.orderCounter = counter;
    return { settings: settings, categories: cats, menus: menus, tables: tables, orders: orders, transactions: txs, promos: promos, users: users, meta: meta };
  }

  /* ==========================================================================
     Validasi
     ========================================================================== */
  var V = {
    str: function (v, max) { return typeof v === 'string' && v.trim().length > 0 && (!max || v.length <= max); },
    num: function (v) { return typeof v === 'number' && isFinite(v); },
    int: function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  };
  var validators = {
    menus: function (m) {
      if (!V.str(m.name, 80)) return 'Nama menu wajib diisi (maks. 80 karakter).';
      if (!m.categoryId) return 'Kategori wajib dipilih.';
      if (!V.num(m.price) || m.price < 0) return 'Harga tidak valid.';
      if (m.promoPrice != null && (!V.num(m.promoPrice) || m.promoPrice < 0 || m.promoPrice >= m.price)) return 'Harga promo harus lebih kecil dari harga normal dan tidak negatif.';
      if (!V.int(m.stock) || m.stock < 0) return 'Stok harus bilangan bulat 0 atau lebih.';
      if (!V.int(m.minStock) || m.minStock < 0) return 'Batas stok minimum tidak valid.';
      return null;
    },
    categories: function (c) { return V.str(c.name, 40) ? null : 'Nama kategori wajib diisi (maks. 40 karakter).'; },
    tables: function (t) {
      if (!V.str(t.name, 30)) return 'Nama meja wajib diisi.';
      if (!/^[A-Za-z0-9\-_]{2,24}$/.test(t.code || '')) return 'Kode meja hanya huruf, angka, tanda minus (contoh: MEJA-01).';
      return null;
    },
    promos: function (p) {
      if (!V.str(p.name, 80)) return 'Nama promo wajib diisi.';
      if (['percent', 'nominal', 'special'].indexOf(p.type) < 0) return 'Jenis promo tidak valid.';
      if (!V.num(p.value) || p.value <= 0) return 'Nilai promo harus lebih dari 0.';
      if (p.type === 'percent' && p.value > 100) return 'Diskon persen maksimal 100.';
      if (p.type === 'special' && p.scope === 'all') return 'Harga khusus hanya untuk promo per menu atau kategori.';
      if (p.scope !== 'all' && (!p.targetIds || !p.targetIds.length)) return 'Pilih menu atau kategori yang mendapat promo.';
      if (p.startDate && p.endDate && p.endDate < p.startDate) return 'Tanggal berakhir tidak boleh sebelum tanggal mulai.';
      if (!V.num(p.minPurchase) || p.minPurchase < 0) return 'Minimal pembelian tidak valid.';
      if (!V.num(p.maxDiscount) || p.maxDiscount < 0) return 'Maksimal diskon tidak valid.';
      return null;
    },
    transactions: function (t) {
      if (['in', 'out'].indexOf(t.type) < 0) return 'Jenis transaksi tidak valid.';
      if (!V.num(t.amount) || t.amount <= 0) return 'Nominal harus lebih dari 0.';
      if (!V.num(t.at)) return 'Tanggal transaksi tidak valid.';
      if (!V.str(t.category)) return 'Kategori wajib diisi.';
      return null;
    },
    users: function (u) { return V.str(u.name) && V.str(u.username) ? null : 'Nama dan username wajib diisi.'; },
    orders: function (o) { return (o && Array.isArray(o.items) && o.items.length) ? null : 'Pesanan harus berisi minimal satu item.'; }
  };

  /* ==========================================================================
     Store — API publik
     ========================================================================== */
  var Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    uid: uid,
    clone: clone,
    StoreError: StoreError,

    use: function (a) { adapter = a; cache = {}; },
    get adapterName() { return adapter.name; },
    get storageAvailable() { return LocalAdapter.available; },
    usedBytes: function () { return adapter.usedBytes ? adapter.usedBytes() : 0; },

    /** Berlangganan perubahan data (termasuk dari tab lain). Mengembalikan fungsi unsubscribe. */
    subscribe: function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },

    /** Pastikan data awal ada. Dipanggil otomatis. */
    init: function () {
      var meta = adapter.read('meta');
      if (!meta || !adapter.read('settings')) { Store.resetSample(true); return; }
      if (meta.schema < SCHEMA_VERSION) Store._migrate(meta);
      // pastikan setiap koleksi ada
      COLLECTIONS.forEach(function (c) { if (adapter.read(c) == null) rawWrite(c, []); });
      var s = adapter.read('settings') || {};
      var def = defaultSettings(), changed = false;
      Object.keys(def).forEach(function (k) { if (!(k in s)) { s[k] = def[k]; changed = true; } });
      if (changed) rawWrite('settings', s);
    },
    _migrate: function (meta) { meta.schema = SCHEMA_VERSION; rawWrite('meta', meta); },

    resetSample: function (silent) {
      var seed = buildSeed();
      cache = {};
      COLLECTIONS.concat(DOCS).forEach(function (k) { rawWrite(k, seed[k]); });
      if (!silent) emit({ key: '*', remote: false });
      return true;
    },
    resetEmpty: function () {
      var cur = Store.getSettings();
      var def = defaultSettings();
      def.restaurant = cur.restaurant; def.paymentMethods = cur.paymentMethods; def.tax = cur.tax; def.service = cur.service;
      cache = {};
      COLLECTIONS.forEach(function (k) { rawWrite(k, []); });
      rawWrite('categories', SEED_CATEGORIES.map(function (c, i) { return { id: c.id, name: c.name, icon: c.icon, sort: i, active: true }; }));
      rawWrite('users', clone(SEED_USERS));
      rawWrite('settings', def);
      rawWrite('meta', { schema: SCHEMA_VERSION, sample: false, createdAt: Date.now(), orderCounter: 0, dayCounters: {} });
      return true;
    },
    isSample: function () { var m = rawRead('meta', {}); return !!m.sample; },
    getMeta: function () { return rawRead('meta', {}); },
    saveMeta: function (m) { rawWrite('meta', m); },

    /* ---- generik ---- */
    list: function (col) { return rawRead(col, []); },
    get: function (col, id) { return Store.list(col).filter(function (x) { return x.id === id; })[0] || null; },
    save: function (col, item) {
      var err = validators[col] && validators[col](item);
      if (err) throw StoreError(err, 'VALIDATION');
      var list = Store.list(col), now = Date.now(), idx = -1;
      if (!item.id) item.id = uid(col.slice(0, 3));
      for (var i = 0; i < list.length; i++) if (list[i].id === item.id) { idx = i; break; }
      if (idx >= 0) { item.updatedAt = now; list[idx] = item; } else { item.createdAt = item.createdAt || now; item.updatedAt = now; list.push(item); }
      rawWrite(col, list);
      return clone(item);
    },
    remove: function (col, id) {
      var list = Store.list(col), n = list.length;
      list = list.filter(function (x) { return x.id !== id; });
      if (list.length === n) return false;
      rawWrite(col, list); return true;
    },
    /** Jalankan beberapa tulis secara "atomik": bila gagal, kembalikan snapshot sebelumnya. */
    atomic: function (cols, fn) {
      var snap = {};
      cols.forEach(function (c) { snap[c] = Store.list(c); });
      try { return fn(); }
      catch (e) {
        cols.forEach(function (c) { try { rawWrite(c, snap[c]); } catch (x) {} });
        throw e;
      }
    },

    /* ---- menu ---- */
    getMenus: function () { return Store.list('menus').sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }); },
    getMenu: function (id) { return Store.get('menus', id); },
    saveMenu: function (m) { if (m.sort == null) m.sort = Store.list('menus').length; return Store.save('menus', m); },
    deleteMenu: function (id) { return Store.remove('menus', id); },
    getCategories: function () { return Store.list('categories').sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }); },
    saveCategory: function (c) { if (c.sort == null) c.sort = Store.list('categories').length; if (c.active == null) c.active = true; return Store.save('categories', c); },
    deleteCategory: function (id) {
      if (Store.list('menus').some(function (m) { return m.categoryId === id; })) throw StoreError('Kategori masih dipakai oleh menu. Pindahkan atau hapus menu tersebut dulu.', 'IN_USE');
      return Store.remove('categories', id);
    },

    /* ---- meja ---- */
    getTables: function () { return Store.list('tables').sort(function (a, b) { return a.code.localeCompare(b.code, undefined, { numeric: true }); }); },
    getTableByCode: function (code) { code = (code || '').toLowerCase(); return Store.list('tables').filter(function (t) { return t.code.toLowerCase() === code; })[0] || null; },
    saveTable: function (t) {
      var dup = Store.list('tables').filter(function (x) { return x.id !== t.id && x.code.toLowerCase() === (t.code || '').toLowerCase(); })[0];
      if (dup) throw StoreError('Kode meja "' + t.code + '" sudah dipakai.', 'VALIDATION');
      if (t.active == null) t.active = true;
      return Store.save('tables', t);
    },
    deleteTable: function (id) { return Store.remove('tables', id); },

    /* ---- pesanan ---- */
    getOrders: function () { return Store.list('orders').sort(function (a, b) { return b.createdAt - a.createdAt; }); },
    getOrder: function (id) { return Store.get('orders', id); },
    saveOrder: function (o) { return Store.save('orders', o); },
    /** Nomor urut berikutnya (disimpan di meta supaya unik walau pesanan dihapus). */
    nextOrderSeq: function () {
      var meta = rawRead('meta', {});
      meta.orderCounter = (meta.orderCounter || 0) + 1;
      var key = new Date(); key = key.getFullYear() + '-' + (key.getMonth() + 1) + '-' + key.getDate();
      meta.dayCounters = meta.dayCounters || {};
      meta.dayCounters[key] = (meta.dayCounters[key] || 0) + 1;
      rawWrite('meta', meta);
      return { seq: meta.orderCounter, daySeq: meta.dayCounters[key] };
    },

    /* ---- transaksi keuangan ---- */
    getTransactions: function () { return Store.list('transactions').sort(function (a, b) { return b.at - a.at; }); },
    saveTransaction: function (t) { return Store.save('transactions', t); },
    deleteTransaction: function (id) { return Store.remove('transactions', id); },

    /* ---- promo & pengguna ---- */
    getPromos: function () { return Store.list('promos'); },
    savePromo: function (p) { return Store.save('promos', p); },
    deletePromo: function (id) { return Store.remove('promos', id); },
    getUsers: function () { return Store.list('users'); },
    saveUser: function (u) { return Store.save('users', u); },

    /* ---- pengaturan ---- */
    getSettings: function () {
      var s = rawRead('settings', null) || defaultSettings();
      var def = defaultSettings();
      Object.keys(def).forEach(function (k) { if (s[k] == null) s[k] = def[k]; });
      return s;
    },
    saveSettings: function (s) { rawWrite('settings', s); return clone(s); },
    defaultSettings: defaultSettings,

    /* ---- backup / pemulihan ---- */
    exportData: function () {
      var out = { app: 'qr-menu-order', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: {} };
      COLLECTIONS.concat(DOCS).forEach(function (k) { out.data[k] = rawRead(k, k === 'settings' || k === 'meta' ? {} : []); });
      return out;
    },
    /** Validasi isi file backup; mengembalikan {ok, errors[], summary}. */
    validateImport: function (obj) {
      var errors = [];
      if (!obj || typeof obj !== 'object') return { ok: false, errors: ['File bukan JSON yang valid.'] };
      if (obj.app !== 'qr-menu-order') errors.push('File ini bukan backup QR Menu & Order.');
      if (typeof obj.schema !== 'number') errors.push('Versi skema tidak ditemukan.');
      else if (obj.schema > SCHEMA_VERSION) errors.push('Backup dibuat oleh versi yang lebih baru (skema ' + obj.schema + ').');
      var d = obj.data || {};
      COLLECTIONS.forEach(function (c) { if (!Array.isArray(d[c])) errors.push('Koleksi "' + c + '" tidak ada atau rusak.'); });
      if (!d.settings || typeof d.settings !== 'object') errors.push('Pengaturan tidak ditemukan.');
      if (!errors.length) {
        d.menus.forEach(function (m, i) { var e = validators.menus(m); if (e && errors.length < 6) errors.push('Menu #' + (i + 1) + ': ' + e); });
        d.orders.forEach(function (o, i) { var e = validators.orders(o); if (e && errors.length < 6) errors.push('Pesanan #' + (i + 1) + ': ' + e); });
        d.transactions.forEach(function (t, i) { var e = validators.transactions(t); if (e && errors.length < 6) errors.push('Transaksi #' + (i + 1) + ': ' + e); });
      }
      return {
        ok: !errors.length, errors: errors,
        summary: errors.length ? null : { menus: d.menus.length, orders: d.orders.length, transactions: d.transactions.length, tables: d.tables.length, promos: d.promos.length }
      };
    },
    importData: function (obj) {
      var v = Store.validateImport(obj);
      if (!v.ok) throw StoreError(v.errors.join(' '), 'IMPORT');
      var backup = Store.exportData();
      try {
        COLLECTIONS.forEach(function (c) { rawWrite(c, obj.data[c]); });
        var meta = obj.data.meta || {}; meta.schema = SCHEMA_VERSION; meta.sample = !!meta.sample;
        meta.orderCounter = Math.max(meta.orderCounter || 0, obj.data.orders.reduce(function (m, o) { return Math.max(m, o.seq || 0); }, 0));
        rawWrite('meta', meta);
        rawWrite('settings', Object.assign(defaultSettings(), obj.data.settings));
      } catch (e) {
        // kembalikan data sebelumnya bila gagal di tengah jalan
        try { COLLECTIONS.forEach(function (c) { rawWrite(c, backup.data[c]); }); rawWrite('meta', backup.data.meta); rawWrite('settings', backup.data.settings); } catch (x) {}
        throw e;
      }
      return v.summary;
    }
  };

  /* ==========================================================================
     ImageStore — kompres & simpan foto
     --------------------------------------------------------------------------
     Prototype: foto diperkecil (maks 800px, JPEG) lalu disimpan sebagai data URL.
     Firebase: ganti `put()` agar mengunggah ke Firebase Storage dan mengembalikan URL.
     ========================================================================== */
  var ImageStore = {
    MAX_INPUT_BYTES: 5 * 1024 * 1024,   // file asli maks 5 MB
    MAX_OUTPUT_BYTES: 140 * 1024,       // hasil kompres maks ±140 KB
    TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    put: function (file, opts) {
      opts = opts || {};
      var maxDim = opts.maxDim || 800;
      return new Promise(function (resolve, reject) {
        if (!file) return reject(new Error('Tidak ada file.'));
        if (ImageStore.TYPES.indexOf(file.type) < 0) return reject(new Error('Format foto harus JPG, PNG, atau WebP.'));
        if (file.size > ImageStore.MAX_INPUT_BYTES) return reject(new Error('Ukuran foto maksimal 5 MB.'));
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxDim / Math.max(w, h));
            var cw = Math.round(w * s), ch = Math.round(h * s);
            var c = document.createElement('canvas'); c.width = cw; c.height = ch;
            var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
            var q = 0.8, data = c.toDataURL('image/jpeg', q);
            while (data.length * 0.75 > (opts.maxBytes || ImageStore.MAX_OUTPUT_BYTES) && q > 0.35) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
            if (data.length * 0.75 > (opts.maxBytes || ImageStore.MAX_OUTPUT_BYTES) * 1.6) {
              // masih besar: perkecil dimensi
              var c2 = document.createElement('canvas'); c2.width = Math.round(cw * 0.7); c2.height = Math.round(ch * 0.7);
              c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); data = c2.toDataURL('image/jpeg', 0.6);
            }
            URL.revokeObjectURL(url); resolve(data);
          } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('File foto tidak dapat dibaca.')); };
        img.src = url;
      });
    }
  };

  global.Store = Store;
  global.ImageStore = ImageStore;
  global.StoreValidators = validators;
  Store.init();
})(window);
