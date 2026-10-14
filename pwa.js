/* pwa.js — registrasi service worker + tombol "Instal Aplikasi" (HP & Windows) */
(function () {
  'use strict';
  var deferred = null;
  function btns() { return [].slice.call(document.querySelectorAll('[data-install]')); }
  function show(on) { btns().forEach(function (b) { b.hidden = !on; }); }
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; show(!standalone); });
  window.addEventListener('appinstalled', function () { deferred = null; show(false); });
  document.addEventListener('DOMContentLoaded', function () {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
    if (ios) show(true);                         // iOS: tampilkan petunjuk manual
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-install]'); if (!b) return;
      e.preventDefault();
      if (deferred) { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; show(false); }); }
      else alert(ios ? 'Untuk memasang di iPhone/iPad: ketuk tombol Bagikan, lalu pilih "Tambah ke Layar Utama".' : 'Untuk memasang: buka menu browser (⋮) lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama".');
    });
  });
})();
