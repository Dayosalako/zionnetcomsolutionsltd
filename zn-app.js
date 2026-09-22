/*!
 * Zion Netcom — app support
 * ------------------------------------------------------------------
 *  1. Registers the service worker (offline mode + installability).
 *  2. Offers "Install app":
 *       Android / Chrome / Edge / desktop → real one-tap install prompt
 *       iPhone / iPad (Safari)            → short "Share → Add to Home Screen" hint
 *
 * Polite by design: appears after a delay, never inside the installed app,
 * never on the payment page, and stays away for 14 days once dismissed.
 */
(function () {
  'use strict';

  var DELAY_MS = 12000;
  var QUIET_DAYS = 14;        // after "not now"
  var INSTALLED_DAYS = 60;    // after installing (so someone who later uninstalls can be offered it again)
  var KEY_DISMISS = 'zn_install_dismissed';
  var KEY_DONE = 'zn_installed';

  var path = location.pathname.replace(/\.html?$/i, '');
  var isAdmin = /\/admin$/.test(path);
  var isPayment = /\/payment$/.test(path);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // ---------- 1. service worker ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  // ---------- 2. install prompt ----------
  if (standalone) return;                                    // already running as an app
  if (isPayment) return;                                     // never distract someone who is paying
  var done = parseInt(lsGet(KEY_DONE) || '0', 10);
  if (done && Date.now() - done < INSTALLED_DAYS * 86400000) return;
  var dismissed = parseInt(lsGet(KEY_DISMISS) || '0', 10);
  if (dismissed && Date.now() - dismissed < QUIET_DAYS * 86400000) return;

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var inAppBrowser = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|; wv\)/i.test(ua);   // can't install from these
  var deferred = null, bar = null, timer = null;

  var COPY = isAdmin
    ? { title: 'Install Zion Admin', sub: 'Open your dashboard in one tap, straight from your home screen.', icon: 'icons/admin-icon-192.png' }
    : { title: 'Get the Zion Netcom app', sub: 'Quick access to our solutions, store, payments and support.', icon: 'icons/icon-192.png' };

  function css() {
    if (document.getElementById('zn-app-style')) return;
    var s = document.createElement('style'); s.id = 'zn-app-style';
    s.textContent =
      '.zn-ib{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translate(-50%,140%);width:min(440px,calc(100% - 24px));z-index:9990;' +
      'background:#111827;color:#E8F4F8;border:1px solid rgba(56,182,255,.35);border-radius:14px;padding:13px 14px;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 30px rgba(56,182,255,.12);' +
      'display:flex;align-items:center;gap:12px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:transform .45s cubic-bezier(.2,.9,.3,1)}' +
      '.zn-ib.on{transform:translate(-50%,0)}' +
      '@media (prefers-reduced-motion:reduce){.zn-ib{transition:none}}' +
      '.zn-ib img{width:46px;height:46px;border-radius:11px;flex:0 0 46px}' +
      '.zn-ib .t{flex:1;min-width:0}.zn-ib b{display:block;font-size:.9rem;line-height:1.3}' +
      '.zn-ib span{display:block;font-size:.76rem;color:#8BA3B8;line-height:1.45;margin-top:2px}' +
      '.zn-ib span svg{width:14px;height:14px;vertical-align:-2px;margin:0 1px;stroke:#38B6FF}' +
      '.zn-ib button{font:inherit;cursor:pointer;border-radius:8px;border:0;white-space:nowrap}' +
      '.zn-ib .go{background:#38B6FF;color:#070B14;font-weight:700;font-size:.8rem;padding:9px 15px}' +
      '.zn-ib .no{background:transparent;color:#8BA3B8;font-size:1.25rem;line-height:1;padding:6px 8px}' +
      '.zn-ib .no:hover{color:#E8F4F8}';
    document.head.appendChild(s);
  }

  function hide(remember) {
    if (bar) { bar.classList.remove('on'); var b = bar; setTimeout(function () { b.remove(); }, 500); bar = null; }
    if (remember) lsSet(KEY_DISMISS, String(Date.now()));
  }

  var SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

  function show() {
    if (bar || !document.body) return;
    if (!deferred && !(isIOS && !inAppBrowser)) return;     // nothing we can actually offer on this browser
    css();
    bar = document.createElement('div');
    bar.className = 'zn-ib'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Install app');
    var sub = deferred ? COPY.sub : 'Tap ' + SHARE_SVG + ' Share, then <b style="display:inline;font-size:inherit;color:#E8F4F8">Add to Home Screen</b>.';
    bar.innerHTML = '<img src="' + COPY.icon + '" alt="">' +
      '<div class="t"><b>' + COPY.title + '</b><span>' + sub + '</span></div>' +
      (deferred ? '<button class="go" type="button">Install</button>' : '') +
      '<button class="no" type="button" aria-label="Not now">&times;</button>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (bar) bar.classList.add('on'); }); });

    bar.querySelector('.no').addEventListener('click', function () { hide(true); });
    var go = bar.querySelector('.go');
    if (go) go.addEventListener('click', install);
  }

  function install() {
    if (!deferred) return;
    var d = deferred; deferred = null;
    hide(false);
    try {
      d.prompt();
      d.userChoice.then(function (r) {
        if (r && r.outcome === 'accepted') lsSet(KEY_DONE, String(Date.now())); else lsSet(KEY_DISMISS, String(Date.now()));
      });
    } catch (e) {}
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(show, DELAY_MS);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();                                     // we show our own, nicer prompt
    deferred = e; schedule();
  });
  window.addEventListener('appinstalled', function () { lsSet(KEY_DONE, String(Date.now())); deferred = null; hide(false); });

  if (isIOS && !inAppBrowser) schedule();

  window.ZNApp = { install: function () { if (deferred) install(); else show(); } };
})();
