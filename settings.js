/* ==========================================================================
   settings.js — Pengaturan Restoran, Pengaturan Sistem, Backup & Pemulihan
   ========================================================================== */
(function (global) {
  'use strict';
  var App = global.App, $ = App.$, $$ = App.$$, esc = App.esc, rp = App.rp, ic = App.ic;

  /* ---------- Pengaturan Restoran ---------- */
  var tab = 'info';
  var imgDraft = null;   // {logo, cover}

  Admin.register('settings-restaurant', {
    title: 'Pengaturan Restoran', sub: 'Identitas, pajak, nomor pesanan, struk, dan pembayaran', perm: 'settings.restaurant',
    render: function (root, ctx) {
      var s = Store.getSettings(), r = s.restaurant;
      if (ctx.fresh) { imgDraft = null; tab = 'info'; global.__setDraft = null; }
      if (!imgDraft) imgDraft = { logo: r.logo || '', cover: r.cover || '' };
      var tabs = [['info', 'Informasi'], ['tax', 'Pajak & Biaya'], ['order', 'Pesanan & Dapur'], ['receipt', 'Struk'], ['pay', 'Pembayaran'], ['look', 'Tampilan']];
      var T = function (id, html) { return '<div class="tab-panel" data-panel="' + id + '"' + (tab === id ? '' : ' hidden') + '>' + html + '</div>'; };
      var F = function (label, input, hint, span2) { return '<div class="field' + (span2 ? ' span2' : '') + '"><label>' + label + '</label>' + input + (hint ? '<small class="hint">' + hint + '</small>' : '') + '<small class="err" role="alert"></small></div>'; };
      var imgBox = function (key, label) {
        var v = imgDraft[key];
        return '<div class="field"><label>' + label + '</label><div class="img-field" data-img="' + key + '"><div class="img-prev">' + (v ? '<img src="' + esc(v) + '" alt="' + label + '">' : '<span>' + ic('image') + '<small>Belum ada gambar</small></span>') + '</div><div class="img-actions"><label class="btn btn-soft btn-sm">' + ic('upload') + (v ? 'Ganti' : 'Pilih gambar') + '<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>' + (v ? '<button type="button" class="btn btn-ghost btn-sm" data-act="img-rm" data-key="' + key + '">' + ic('trash-2') + 'Hapus</button>' : '') + '</div></div></div>';
      };
      var sw = function (name, checked, text) { return '<label class="switch"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '><span class="slider"></span><span class="switch-text">' + text + '</span></label>'; };
      var inp = function (name, val, extra) { return '<input name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + ' autocomplete="off">'; };

      var info = '<div class="form-grid">' + F('Nama restoran', inp('name', r.name, 'maxlength="60" required'), '', true) + F('Slogan / lokasi singkat', inp('tagline', r.tagline, 'maxlength="60"')) + F('Nomor WhatsApp', inp('whatsapp', r.whatsapp, 'inputmode="tel" placeholder="6281234567890"'), 'Format internasional tanpa +, mis. 62812…') +
        F('Alamat', '<textarea name="address" rows="2" maxlength="200">' + esc(r.address) + '</textarea>', '', true) + F('Link Google Maps', inp('maps', r.maps, 'type="url" placeholder="https://maps.app.goo.gl/…"'), '', true) + F('Jam operasional', inp('hours', r.hours, 'maxlength="60"')) + F('Teks footer', inp('footer', r.footer, 'maxlength="120"')) + imgBox('logo', 'Logo restoran') + imgBox('cover', 'Foto sampul') + '</div>';
      var tax = '<div class="form-grid">' + '<div class="field span2">' + sw('taxEnabled', s.tax.enabled, 'Kenakan pajak pada pesanan') + '</div>' + F('Nama pajak', inp('taxLabel', s.tax.label, 'maxlength="20"')) + F('Tarif pajak (%)', inp('taxRate', s.tax.rate, 'type="number" min="0" max="100" step="0.1"')) +
        '<div class="field span2">' + sw('svcEnabled', s.service.enabled, 'Kenakan biaya layanan') + '</div>' + F('Nama biaya layanan', inp('svcLabel', s.service.label, 'maxlength="20"')) + F('Tarif biaya layanan (%)', inp('svcRate', s.service.rate, 'type="number" min="0" max="100" step="0.1"')) +
        '<div class="notice info span2">' + ic('info') + '<span>Pajak dihitung dari (subtotal setelah diskon + biaya layanan). Keduanya opsional dan hanya berlaku untuk pesanan baru. Mata uang: Rupiah (IDR).</span></div></div>';
      var order = '<div class="form-grid">' + F('Prefix nomor pesanan', inp('prefix', s.orderPrefix, 'maxlength="6"'), 'Contoh: # atau AKS-') +
        F('Format nomor', '<select name="format"><option value="seq"' + (s.orderFormat === 'seq' ? ' selected' : '') + '>Berurutan (#00123)</option><option value="date"' + (s.orderFormat === 'date' ? ' selected' : '') + '>Tanggal + urut harian (1012-001)</option></select>') +
        F('Jumlah digit (format berurutan)', inp('digits', s.orderDigits, 'type="number" min="3" max="8"')) + F('Contoh hasil', '<input id="orderPreview" readonly value="">') +
        '<div class="field span2">' + sw('kSound', s.kitchen.sound !== false, 'Bunyi notifikasi dapur aktif secara default') + '</div>' + F('Peringatan pesanan terlalu lama (menit)', inp('late', s.kitchen.lateMinutes, 'type="number" min="3" max="120"'), 'Kartu dapur ditandai merah setelah melewati batas ini.') + '</div>';
      var receipt = '<div class="form-grid">' + F('Judul struk', inp('rHeader', s.receipt.header, 'maxlength="40"')) + F('Lebar kertas', '<select name="rWidth"><option value="58mm"' + (s.receipt.width === '58mm' ? ' selected' : '') + '>58 mm</option><option value="80mm"' + (s.receipt.width === '80mm' ? ' selected' : '') + '>80 mm</option></select>') + F('Pesan penutup', inp('rFooter', s.receipt.footer, 'maxlength="100"'), '', true) + '<div class="field span2">' + sw('rTax', s.receipt.showTax !== false, 'Tampilkan baris pajak pada struk') + '</div></div>';
      var qs = s.qris || {};
      var pay = '<div class="card flat qris-set"><h3>' + ic('qr-code') + ' QRIS</h3><div class="form-grid"><div class="field span2">' + sw('qrisOn', qs.enabled !== false, 'Aktifkan pembayaran QRIS untuk pelanggan') + '</div>' +
        F('Nama merchant', inp('qrisMerchant', qs.merchant || '', 'maxlength="60"')) + F('NMID', inp('qrisNmid', qs.nmid || '', 'maxlength="30"')) +
        '<div class="field span2">' + sw('qrisDyn', qs.dynamic !== false, 'Isi nominal otomatis (QRIS dinamis)') + '<small class="hint">Nominal pesanan otomatis masuk ke QR. Jika aplikasi pembayaran menolak, matikan opsi ini (pelanggan mengetik nominal sendiri).</small></div>' +
        F('Kode QRIS statis (payload)', '<textarea name="qrisPayload" rows="4" spellcheck="false">' + esc(qs.payload || '') + '</textarea>', 'Teks hasil pindai QRIS statis merchant Anda (diawali 000201). Divalidasi otomatis (CRC).', true) + '</div></div>' +
        '<p class="muted">Pembayaran <b>dicatat manual</b> oleh kasir. QRIS tidak terhubung otomatis ke penyedia pembayaran, jadi kasir harus memastikan dana masuk di aplikasi merchant (GoPay Merchant) sebelum menekan Catat Pembayaran.</p><ul class="pay-list">' + s.paymentMethods.map(function (m, i) {
        return '<li><input name="pmName' + i + '" value="' + esc(m.name) + '" maxlength="24" aria-label="Nama metode"><label class="switch sm"><input type="checkbox" name="pmOn' + i + '"' + (m.active ? ' checked' : '') + (m.id === 'cash' ? ' disabled' : '') + ' aria-label="Aktif"><span class="slider"></span></label>' + (['cash', 'transfer', 'qris', 'other'].indexOf(m.id) < 0 ? '<button type="button" class="icon-btn sm danger" data-act="pm-del" data-i="' + i + '" aria-label="Hapus">' + ic('trash-2') + '</button>' : '<span class="muted sm">bawaan</span>') + '</li>';
      }).join('') + '</ul><button type="button" class="btn btn-soft btn-sm" data-act="pm-add">' + ic('plus') + 'Tambah metode lain</button>';
      var d = s.developer, dark = App.Theme.current() === 'dark';
      var look = '<div class="form-grid"><div class="field span2"><label>Tema tampilan</label><div class="seg"><button type="button" class="' + (!dark ? 'on' : '') + '" data-act="theme" data-v="light">' + ic('sun') + 'Terang</button><button type="button" class="' + (dark ? 'on' : '') + '" data-act="theme" data-v="dark">' + ic('moon') + 'Gelap</button></div><small class="hint">Preferensi tema tersimpan di browser ini.</small></div>' +
        '<div class="field span2"><label>Informasi pengembang</label><div class="dev-card"><b>' + esc(d.name) + '</b> — ' + esc(d.handle) + '<br><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.url) + '</a></div></div></div>';
      root.innerHTML = '<form id="setForm" novalidate class="card settings-card"><div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="' + (tab === t[0] ? 'on' : '') + '" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        T('info', info) + T('tax', tax) + T('order', order) + T('receipt', receipt) + T('pay', pay) + T('look', look) +
        '<div class="form-foot"><span id="setMsg" class="muted"></span><button type="submit" class="btn btn-primary">' + ic('save') + 'Simpan Pengaturan</button></div></form>';
      App.refreshIcons();
      var form = $('#setForm', root);
      function preview() {
        var f = form.elements; var fake = { orderPrefix: f.prefix.value, orderFormat: f.format.value, orderDigits: Math.max(3, Math.min(8, parseInt(f.digits.value, 10) || 5)) };
        $('#orderPreview', root).value = Orders.formatNumber(123, 7, fake);
      }
      preview();
      form.addEventListener('input', preview);
      form.addEventListener('change', function (e) {
        if (e.target.type === 'file' && e.target.files[0]) {
          var key = e.target.closest('[data-img]').getAttribute('data-img');
          ImageStore.put(e.target.files[0], { maxDim: key === 'logo' ? 400 : 1200, maxBytes: key === 'logo' ? 60 * 1024 : 180 * 1024 }).then(function (d) { imgDraft[key] = d; saveDraftFields(); ctx.rerender(); }).catch(function (er) { App.toast(er.message, 'error'); });
        }
      });
      var draftFields = null;
      function saveDraftFields() { draftFields = $$('input,select,textarea', form).filter(function (x) { return x.name; }).map(function (x) { return [x.name, x.type === 'checkbox' ? x.checked : x.value]; }); }
      if (global.__setDraft) { global.__setDraft.forEach(function (p) { var el = form.elements[p[0]]; if (el) { if (el.type === 'checkbox') el.checked = p[1]; else el.value = p[1]; } }); global.__setDraft = null; preview(); }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = form.elements, errs = 0;
        $$('.field', form).forEach(function (w) { w.classList.remove('invalid'); $('.err', w).textContent = ''; });
        function bad(name, msg) { errs++; var w = f[name].closest('.field'); w.classList.add('invalid'); $('.err', w).textContent = msg; }
        if (!f.name.value.trim()) bad('name', 'Nama restoran wajib diisi.');
        var tr = parseFloat(f.taxRate.value), sr = parseFloat(f.svcRate.value);
        if (isNaN(tr) || tr < 0 || tr > 100) bad('taxRate', 'Tarif pajak 0–100.');
        if (isNaN(sr) || sr < 0 || sr > 100) bad('svcRate', 'Tarif layanan 0–100.');
        var late = parseInt(f.late.value, 10); if (isNaN(late) || late < 3) bad('late', 'Minimal 3 menit.');
        if (f.maps.value.trim() && !/^https?:\/\//i.test(f.maps.value.trim())) bad('maps', 'Tautan harus diawali http:// atau https://');
        if (f.whatsapp.value.trim() && !/^\+?[0-9]{8,15}$/.test(f.whatsapp.value.trim().replace(/[\s-]/g, ''))) bad('whatsapp', 'Nomor WhatsApp tidak valid.');
        if (errs) { var first = $('.field.invalid', form); var p = first.closest('.tab-panel'); if (p && p.hidden) { tab = p.getAttribute('data-panel'); saveDraftFields(); global.__setDraft = draftFields; ctx.rerender(); } App.toast('Periksa kolom yang ditandai.', 'warn'); return; }
        var cur = Store.getSettings();
        cur.restaurant = { name: f.name.value.trim(), tagline: f.tagline.value.trim(), logo: imgDraft.logo, cover: imgDraft.cover, address: f.address.value.trim(), whatsapp: f.whatsapp.value.replace(/[\s-]/g, '').replace(/^\+/, ''), maps: f.maps.value.trim(), hours: f.hours.value.trim(), footer: f.footer.value.trim() };
        cur.tax = { enabled: f.taxEnabled.checked, rate: tr, label: f.taxLabel.value.trim() || 'Pajak' };
        cur.service = { enabled: f.svcEnabled.checked, rate: sr, label: f.svcLabel.value.trim() || 'Biaya layanan' };
        cur.orderPrefix = f.prefix.value; cur.orderFormat = f.format.value; cur.orderDigits = Math.max(3, Math.min(8, parseInt(f.digits.value, 10) || 5));
        cur.kitchen = { sound: f.kSound.checked, lateMinutes: late };
        cur.receipt = { header: f.rHeader.value.trim(), width: f.rWidth.value, footer: f.rFooter.value.trim(), showTax: f.rTax.checked };
        var qp = (f.qrisPayload.value || '').trim();
        if (qp) { var qv = QRIS.validate(qp); if (!qv.ok) { App.toast('QRIS: ' + qv.error, 'error'); return; } }
        cur.qris = { enabled: f.qrisOn.checked && !!qp, merchant: f.qrisMerchant.value.trim(), nmid: f.qrisNmid.value.trim(), dynamic: f.qrisDyn.checked, payload: qp };
        cur.paymentMethods = cur.paymentMethods.map(function (m, i) { return { id: m.id, name: (f['pmName' + i].value.trim() || m.name), active: m.id === 'cash' ? true : f['pmOn' + i].checked }; });
        try { Store.saveSettings(cur); imgDraft = null; App.toast('Pengaturan disimpan.'); ctx.rerender(); ctx.refreshShell && ctx.refreshShell(); } catch (er) { App.fail(er); }
      });
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'tab') { saveDraftFields(); global.__setDraft = draftFields; tab = b.getAttribute('data-v'); ctx.rerender(); }
        else if (act === 'img-rm') { saveDraftFields(); global.__setDraft = draftFields; imgDraft[b.getAttribute('data-key')] = ''; ctx.rerender(); }
        else if (act === 'theme') { App.Theme.set(b.getAttribute('data-v')); saveDraftFields(); global.__setDraft = draftFields; ctx.rerender(); }
        else if (act === 'pm-add') {
          App.formModal({ title: 'Tambah Metode Pembayaran', size: 'sm', values: { name: '' }, fields: [{ name: 'name', label: 'Nama metode', required: true, maxlength: 24, placeholder: 'mis. Kartu Debit' }], onSubmit: function (c) { var cur = Store.getSettings(); cur.paymentMethods.push({ id: 'pm_' + Date.now().toString(36), name: c.name, active: true }); Store.saveSettings(cur); App.toast('Metode ditambahkan.'); imgDraft = null; ctx.rerender(); } });
        } else if (act === 'pm-del') {
          var i = +b.getAttribute('data-i'), cur = Store.getSettings(), m = cur.paymentMethods[i];
          App.confirm({ title: 'Hapus metode?', message: 'Metode "' + m.name + '" dihapus dari daftar. Transaksi lama tetap tersimpan.', confirmText: 'Hapus', danger: true }).then(function (ok) { if (ok) { cur.paymentMethods.splice(i, 1); Store.saveSettings(cur); imgDraft = null; ctx.rerender(); } });
        }
      };
    }
  });

  /* ---------- Pengaturan Sistem ---------- */
  Admin.register('settings-system', {
    title: 'Pengaturan Sistem', sub: 'Paket langganan (demo), pengguna & hak akses, kesiapan Firebase', perm: 'settings.system',
    render: function (root, ctx) {
      var s = Store.getSettings(), sub = s.subscription, plan = s.plans.filter(function (p) { return p.id === sub.plan; })[0] || s.plans[0];
      var users = Store.getUsers();
      var usage = function (label, used, max) { var pct = Math.min(100, Math.round(used * 100 / max)); return '<div class="usage"><div><span>' + label + '</span><b>' + used + ' / ' + max + '</b></div><div class="bar"><i style="width:' + pct + '%" class="' + (pct > 90 ? 'hot' : '') + '"></i></div></div>'; };
      var plansTbl = App.table([
        { label: 'Paket', primary: true, render: function (p) { return '<b>' + esc(p.name) + '</b>' + (p.id === sub.plan ? ' <span class="badge success">Dipakai</span>' : '') + (p.featured ? ' <span class="badge warn">Unggulan</span>' : ''); } },
        { label: 'Harga / bulan', align: 'right', render: function (p) { return rp(p.price); } },
        { label: 'Meja', align: 'right', render: function (p) { return p.maxTables; } },
        { label: 'Menu', align: 'right', render: function (p) { return p.maxMenus; } },
        { label: 'Pengguna', align: 'right', render: function (p) { return p.maxUsers; } },
        { label: 'Laporan', render: function (p) { return esc(p.reports); } },
        { label: 'Aksi', align: 'center', render: function (p) { return '<div class="row-actions"><button class="icon-btn sm" data-act="plan-edit" data-id="' + p.id + '" aria-label="Edit paket">' + ic('pencil') + '</button><button class="btn btn-soft btn-sm" data-act="plan-use" data-id="' + p.id + '">Pakai</button></div>'; } }
      ], s.plans);
      var usersTbl = App.table([
        { label: 'Nama', primary: true, render: function (u) { return '<b>' + esc(u.name) + '</b><small class="sub">@' + esc(u.username) + '</small>'; } },
        { label: 'Role', render: function (u) { return '<span class="badge info">' + esc(App.ROLE_NAMES[u.role] || u.role) + '</span>'; } },
        { label: 'Status', align: 'center', render: function (u) { return u.active === false ? '<span class="badge muted">Nonaktif</span>' : '<span class="badge success">Aktif</span>'; } },
        { label: 'Aksi', align: 'center', render: function (u) { return '<button class="icon-btn sm" data-act="user-edit" data-id="' + u.id + '" aria-label="Edit pengguna">' + ic('pencil') + '</button>'; } }
      ], users);
      root.innerHTML = '<div class="notice warn">' + ic('shield-alert') + '<span><b>Mode demo:</b> login dan hak akses di versi LocalStorage hanya simulasi di browser dan <b>tidak aman untuk produksi</b>. Pada versi Firebase, verifikasi dilakukan oleh Firebase Authentication + aturan keamanan database.</span></div>' +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Langganan (konfigurasi contoh)</h3><span class="badge warn">Demo</span></div><div class="kv-grid"><div><small>Paket aktif</small><b>' + esc(plan.name) + '</b></div><div><small>Status</small><b>' + esc(sub.status === 'demo' ? 'Demo' : sub.status) + '</b></div><div><small>Berakhir</small><b>' + (sub.endDate ? App.fmtDate(App.parseISO(sub.endDate)) : '—') + '</b></div></div>' +
        usage('Meja', Store.getTables().length, plan.maxTables) + usage('Menu', Store.getMenus().length, plan.maxMenus) + usage('Pengguna', users.length, plan.maxUsers) +
        '<div class="field"><label for="subEnd">Tanggal berakhir langganan (contoh)</label><input id="subEnd" type="date" value="' + esc(sub.endDate || '') + '"></div><button class="btn btn-soft" data-act="sub-save">Simpan</button>' +
        '<p class="muted small">Tidak ada pembayaran langganan atau isolasi multi-restoran (multi-tenant) pada prototype ini. Batas paket belum dipaksakan.</p></section>' +
        '<section class="card"><div class="card-head"><h3>Penyimpanan &amp; Data</h3></div><div class="kv-grid"><div><small>Adapter data</small><b>' + esc(Store.adapterName) + '</b></div><div><small>Versi skema</small><b>v' + Store.SCHEMA_VERSION + '</b></div><div><small>Terpakai</small><b>' + (Store.usedBytes() / 1024).toFixed(0) + ' KB</b></div></div>' +
        '<ul class="check-list"><li class="ok">' + ic('circle-check') + 'Lapisan data terpusat (Store) — siap diganti adapter Firebase</li><li class="ok">' + ic('circle-check') + 'ID unik & snapshot harga pada pesanan</li><li class="todo">' + ic('circle-dashed') + 'Firebase Authentication + role (belum aktif)</li><li class="todo">' + ic('circle-dashed') + 'Firestore/Realtime DB untuk sinkron antar perangkat (belum aktif)</li><li class="todo">' + ic('circle-dashed') + 'Firebase Storage untuk foto menu (belum aktif)</li><li class="todo">' + ic('circle-dashed') + 'Aturan keamanan & isolasi tenant (belum dibuat)</li></ul><p class="muted small">Lihat README.md bagian “Migrasi ke Firebase”.</p></section></div>' +
        '<section class="card"><div class="card-head"><h3>Paket Berlangganan</h3><small class="muted">Dipakai di halaman Home</small></div>' + plansTbl + '</section>' +
        '<section class="card"><div class="card-head"><h3>Pengguna &amp; Hak Akses (demo)</h3></div>' + usersTbl + '<p class="muted small">Owner: semua fitur · Admin: semua kecuali pengaturan sistem · Kasir: pesanan manual, pembayaran, struk · Staf dapur: hanya dashboard dapur.</p></section>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
        if (act === 'sub-save') { var cur = Store.getSettings(); cur.subscription.endDate = $('#subEnd', root).value; Store.saveSettings(cur); App.toast('Tersimpan.'); keep(); }
        else if (act === 'plan-use') { var c2 = Store.getSettings(); c2.subscription.plan = id; Store.saveSettings(c2); App.toast('Paket contoh diubah.'); keep(); }
        else if (act === 'plan-edit') {
          var cs = Store.getSettings(), p = cs.plans.filter(function (x) { return x.id === id; })[0];
          App.formModal({
            title: 'Edit Paket ' + p.name, size: 'md', values: Object.assign({}, p, { featuresText: p.features.join('\n') }),
            fields: [
              { name: 'name', label: 'Nama paket', required: true, maxlength: 24 }, { name: 'price', label: 'Harga per bulan', type: 'number', required: true, min: 0, step: 1000, prefix: 'Rp' },
              { name: 'maxTables', label: 'Batas meja', type: 'number', required: true, min: 1 }, { name: 'maxMenus', label: 'Batas menu', type: 'number', required: true, min: 1 }, { name: 'maxUsers', label: 'Batas pengguna', type: 'number', required: true, min: 1 },
              { name: 'reports', label: 'Fitur laporan', maxlength: 60 }, { name: 'featuresText', label: 'Daftar fitur (satu per baris)', type: 'textarea', rows: 5, cols: 2 }, { name: 'featured', type: 'checkbox', text: 'Tandai sebagai paket unggulan' }
            ],
            onSubmit: function (v) {
              cs.plans = cs.plans.map(function (x) { return x.id === id ? Object.assign({}, x, { name: v.name, price: v.price, maxTables: v.maxTables, maxMenus: v.maxMenus, maxUsers: v.maxUsers, reports: v.reports, features: v.featuresText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean), featured: !!v.featured }) : (v.featured ? Object.assign({}, x, { featured: false }) : x); });
              Store.saveSettings(cs); App.toast('Paket diperbarui.'); keep();
            }
          });
        } else if (act === 'user-edit') {
          var u = Store.get('users', id);
          App.formModal({
            title: 'Edit Pengguna', size: 'sm', values: Object.assign({}, u), fields: [
              { name: 'name', label: 'Nama', required: true, maxlength: 40 }, { name: 'role', label: 'Role', type: 'select', options: Object.keys(App.ROLE_NAMES).map(function (k) { return { value: k, label: App.ROLE_NAMES[k] }; }) },
              { name: 'pin', label: 'PIN demo (4–8 angka)', required: true, pattern: '^[0-9]{4,8}$', patternMsg: 'PIN harus 4–8 angka.', hint: 'Hanya untuk simulasi — jangan pakai PIN yang Anda gunakan di tempat lain.' }, { name: 'active', type: 'checkbox', text: 'Akun aktif' }
            ],
            validate: function (v) { if (u.id === (App.Auth.current() || {}).userId && (v.role !== 'owner' || !v.active)) return 'Anda tidak dapat menurunkan atau menonaktifkan akun Anda sendiri.'; var owners = Store.getUsers().filter(function (x) { return x.id !== u.id && x.role === 'owner' && x.active !== false; }); if (u.role === 'owner' && (v.role !== 'owner' || !v.active) && !owners.length) return 'Harus ada minimal satu Owner aktif.'; },
            onSubmit: function (v) { Store.saveUser(Object.assign({}, u, { name: v.name, role: v.role, pin: v.pin, active: !!v.active })); App.toast('Pengguna disimpan.'); keep(); }
          });
        }
      };
    }
  });

  /* ---------- Backup & Pemulihan ---------- */
  Admin.register('backup', {
    title: 'Backup dan Pemulihan Data', sub: 'Unduh cadangan JSON atau pulihkan dari file', perm: 'backup',
    render: function (root, ctx) {
      var last = null; try { last = localStorage.getItem('qmo:lastBackup'); } catch (e) {}
      var d = Store.exportData().data, used = Store.usedBytes(), quota = 5 * 1024 * 1024, pct = Math.min(100, Math.round(used * 100 / quota));
      ctx.actions('');
      root.innerHTML = '<div class="grid-2"><section class="card"><div class="card-head"><h3>' + ic('download') + ' Backup ke JSON</h3></div><p class="muted">Menyimpan menu, meja, pesanan, transaksi, promo, pengguna, dan pengaturan ke satu file.</p><div class="kv-grid"><div><small>Menu</small><b>' + d.menus.length + '</b></div><div><small>Pesanan</small><b>' + d.orders.length + '</b></div><div><small>Transaksi</small><b>' + d.transactions.length + '</b></div></div><p class="muted small">Backup terakhir: ' + (last ? App.fmtDateTime(+last) : 'belum pernah') + '</p><button class="btn btn-primary" data-act="export">' + ic('download') + 'Unduh Backup</button></section>' +
        '<section class="card"><div class="card-head"><h3>' + ic('upload') + ' Pulihkan dari JSON</h3></div><p class="muted">File akan divalidasi dulu. Data saat ini <b>diganti</b> setelah Anda konfirmasi.</p><label class="btn btn-soft">' + ic('file-up') + 'Pilih File Backup<input id="impFile" type="file" accept="application/json,.json" hidden></label><div id="impResult"></div></section></div>' +
        '<div class="grid-2"><section class="card"><div class="card-head"><h3>Penyimpanan Browser</h3></div><div class="usage"><div><span>Terpakai (perkiraan)</span><b>' + (used / 1024).toFixed(0) + ' KB / ±5 MB</b></div><div class="bar"><i style="width:' + pct + '%" class="' + (pct > 80 ? 'hot' : '') + '"></i></div></div><p class="muted small">Foto menu diperkecil otomatis agar hemat. Pada versi Firebase, foto disimpan di Firebase Storage.</p></section>' +
        '<section class="card danger-zone"><div class="card-head"><h3>Data Contoh &amp; Reset</h3></div>' + (Store.isSample() ? '<div class="notice info">' + ic('flask-conical') + '<span>Saat ini memakai <b>data contoh</b> (menu, pesanan, dan transaksi simulasi).</span></div>' : '') + '<div class="btn-stack"><button class="btn btn-soft" data-act="sample">' + ic('flask-conical') + 'Muat Ulang Data Contoh</button><button class="btn btn-danger" data-act="empty">' + ic('eraser') + 'Mulai dengan Data Kosong</button></div><p class="muted small">Keduanya mengganti seluruh data. Unduh backup lebih dulu bila perlu.</p></section></div>';
      App.refreshIcons();
      var keep = function () { ctx.rerender(); };
      root.onchange = function (e) {
        if (e.target.id !== 'impFile' || !e.target.files[0]) return;
        var file = e.target.files[0], box = $('#impResult', root);
        if (file.size > 8 * 1024 * 1024) { box.innerHTML = '<div class="notice danger">' + ic('circle-alert') + '<span>File terlalu besar (maks. 8 MB).</span></div>'; App.refreshIcons(); return; }
        var fr = new FileReader();
        fr.onerror = function () { box.innerHTML = '<div class="notice danger">' + ic('circle-alert') + '<span>File tidak dapat dibaca.</span></div>'; App.refreshIcons(); };
        fr.onload = function () {
          var obj; try { obj = JSON.parse(fr.result); } catch (er) { box.innerHTML = '<div class="notice danger">' + ic('circle-alert') + '<span>File bukan JSON yang valid.</span></div>'; App.refreshIcons(); return; }
          var v = Store.validateImport(obj);
          if (!v.ok) { box.innerHTML = '<div class="notice danger">' + ic('circle-alert') + '<span><b>Backup ditolak:</b><br>' + v.errors.map(esc).join('<br>') + '</span></div>'; App.refreshIcons(); return; }
          box.innerHTML = '<div class="notice info">' + ic('circle-check') + '<span>File valid: ' + v.summary.menus + ' menu, ' + v.summary.orders + ' pesanan, ' + v.summary.transactions + ' transaksi, ' + v.summary.tables + ' meja.</span></div><button class="btn btn-danger" data-act="do-import">' + ic('rotate-ccw') + 'Ganti Data Saat Ini</button>';
          App.refreshIcons();
          $('[data-act="do-import"]', box).onclick = function () {
            App.confirm({ title: 'Ganti semua data?', message: 'Seluruh data saat ini akan diganti dengan isi file "' + file.name + '". Tindakan ini tidak dapat dibatalkan.', confirmText: 'Ya, ganti data', danger: true }).then(function (ok) {
              if (!ok) return; try { Store.importData(obj); App.toast('Data berhasil dipulihkan.'); keep(); ctx.refreshShell && ctx.refreshShell(); } catch (er2) { App.fail(er2); }
            });
          };
        };
        fr.readAsText(file);
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'export') {
          var data = Store.exportData(); App.downloadBlob('qr-menu-order-backup-' + App.isoDate(Date.now()) + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          try { localStorage.setItem('qmo:lastBackup', String(Date.now())); } catch (er) {} App.toast('Backup diunduh.'); keep();
        } else if (act === 'sample') App.confirm({ title: 'Muat ulang data contoh?', message: 'Semua data saat ini diganti dengan data contoh.', confirmText: 'Ya, ganti', danger: true }).then(function (ok) { if (ok) { try { Store.resetSample(); App.toast('Data contoh dimuat.'); keep(); ctx.refreshShell && ctx.refreshShell(); } catch (er) { App.fail(er); } } });
        else if (act === 'empty') App.confirm({ title: 'Mulai dengan data kosong?', message: 'Menu, meja, pesanan, transaksi, dan promo akan dihapus. Kategori dasar, akun demo, dan identitas restoran dipertahankan.', confirmText: 'Hapus & mulai kosong', danger: true }).then(function (ok) { if (ok) { try { Store.resetEmpty(); App.toast('Data dikosongkan. Tambahkan menu dan meja Anda.'); keep(); ctx.refreshShell && ctx.refreshShell(); } catch (er) { App.fail(er); } } });
      };
    }
  });
})(window);
