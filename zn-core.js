/*!
 * Zion Netcom — lightweight visitor tracker
 * ------------------------------------------------------------------
 * Records one row per page view into Supabase (table: page_views) so you
 * can see who visits, from where, on what device, and which pages they read.
 *
 *  • No cookies. An anonymous random ID is kept in the visitor's browser.
 *  • The visitor's IP address is NEVER saved (only country/region/city).
 *  • Bots, your own visits and localhost are ignored automatically.
 *
 * Opt yourself out on any device:   open any page with  ?notrack=1
 * Opt back in:                       open any page with  ?notrack=0
 *
 * Link a visit to a real customer (already wired into contact + payment):
 *   ZNTrack.identify({ name, email, phone, source: 'contact' | 'payment' });
 */
(function () {
  'use strict';

  var SB_URL = 'https://qzloankwskebbralmvqw.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bG9hbmt3c2tlYmJyYWxtdnF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMTkyMjgsImV4cCI6MjEwMjU5NTIyOH0.s8lftAO67o_SRS6S734kiByY-aA4AvMQ3uI_WrOHGLw';
  var GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';

  // ---------- safe storage (works even if the browser blocks it) ----------
  var mem = {};
  function store(kind) {
    return {
      get: function (k) { try { return window[kind].getItem(k); } catch (e) { return mem[kind + k] || null; } },
      set: function (k, v) { try { window[kind].setItem(k, v); } catch (e) { mem[kind + k] = v; } }
    };
  }
  var ls = store('localStorage'), ss = store('sessionStorage');

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  // ---------- opt-out switch:  ?notrack=1 / ?notrack=0 ----------
  try {
    var qp = new URLSearchParams(location.search).get('notrack');
    if (qp === '1') ls.set('zn_notrack', '1');
    if (qp === '0') ls.set('zn_notrack', '0');
  } catch (e) {}

  // ---------- decide whether to track this visit ----------
  var ua = navigator.userAgent || '';
  var host = location.hostname;
  var skip =
    ls.get('zn_notrack') === '1' ||                       // you opted out on this device
    ls.get('zn-admin-auth') === 'true' ||                 // you're signed in to admin here
    location.protocol === 'file:' ||
    host === 'localhost' || host === '127.0.0.1' || host === '' ||
    navigator.webdriver === true ||
    /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|preview|facebookexternalhit|whatsapp|telegram|monitor/i.test(ua);

  // anonymous IDs are only created for visitors we actually track
  var visitorId = null, isNew = false, sessionId = null;
  if (!skip) {
    visitorId = ls.get('zn_vid');
    if (!visitorId) { visitorId = uuid(); ls.set('zn_vid', visitorId); isNew = true; }
    sessionId = ss.get('zn_sid');
    if (!sessionId) { sessionId = uuid(); ss.set('zn_sid', sessionId); }
  }

  // ---------- low-level: talk to Supabase ----------
  var headers = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  function post(path, body) {
    try {
      return fetch(SB_URL + '/rest/v1/' + path, {
        method: 'POST', headers: headers, body: JSON.stringify(body), keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------- public API (does nothing on skipped/opted-out browsers) ----------
  window.ZNTrack = {
    identify: function (info) {
      if (skip || !info) return;
      var email = (info.email || '').toString().trim().slice(0, 200);
      var name = (info.name || '').toString().trim().slice(0, 200);
      var phone = (info.phone || '').toString().trim().slice(0, 50);
      if (!email && !name && !phone) return;
      var src = ['contact', 'payment', 'review'].indexOf(info.source) > -1 ? info.source : 'other';
      post('visitor_identities', {
        visitor_id: visitorId, name: name || null, email: email || null, phone: phone || null, source: src
      });
    }
  };

  if (skip) return;

  // ---------- small helpers ----------
  function clip(s, n) { s = (s == null ? '' : String(s)); return s ? s.slice(0, n) : null; }

  function parseUA(u) {
    var device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(u) ? 'tablet'
               : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(u) ? 'mobile' : 'desktop';
    var browser =
      /Edg(e|A|iOS)?\//.test(u) ? 'Edge' :
      /OPR\/|Opera/.test(u) ? 'Opera' :
      /SamsungBrowser/.test(u) ? 'Samsung Internet' :
      /UCBrowser|UCWEB/.test(u) ? 'UC Browser' :
      /Firefox|FxiOS/.test(u) ? 'Firefox' :
      /Chrome|CriOS/.test(u) ? 'Chrome' :
      /Safari/.test(u) ? 'Safari' : 'Other';
    var os =
      /Windows Phone/.test(u) ? 'Windows Phone' :
      /Windows/.test(u) ? 'Windows' :
      /Android/.test(u) ? 'Android' :
      /iPhone|iPad|iPod/.test(u) ? 'iOS' :
      /Mac OS X|Macintosh/.test(u) ? 'macOS' :
      /CrOS/.test(u) ? 'ChromeOS' :
      /Linux/.test(u) ? 'Linux' : 'Other';
    return { device: device, browser: browser, os: os };
  }

  // clean URL:  /about.html -> /about ,  /index.html or / -> /
  function cleanPath(p) {
    p = (p || '/').replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  }

  function refHost() {
    try {
      if (!document.referrer) return null;
      var h = new URL(document.referrer).hostname.replace(/^www\./, '');
      return h === host.replace(/^www\./, '') ? null : h;   // ignore internal navigation
    } catch (e) { return null; }
  }

  // ---------- location (cached per browser session) ----------
  function getGeo() {
    return new Promise(function (resolve) {
      var cached = ss.get('zn_geo');
      if (cached) { try { return resolve(JSON.parse(cached)); } catch (e) {} }

      var done = false;
      function finish(g) { if (done) return; done = true; resolve(g || {}); }
      var timer = setTimeout(function () { finish({}); }, 2500);   // never hold up tracking

      try {
        fetch(GEO_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
          clearTimeout(timer);
          // GeoJS returns flat fields; tolerate the nested shape too
          var c = j.country, rg = j.region;
          var g = {
            country: clip(typeof c === 'object' && c ? c.name : c, 80),
            country_code: clip(typeof c === 'object' && c ? c.code : j.country_code, 4),
            region: clip(typeof rg === 'object' && rg ? rg.name : rg, 80),
            city: clip(j.city, 80)
          };
          ss.set('zn_geo', JSON.stringify(g));
          finish(g);
        }).catch(function () { clearTimeout(timer); finish({}); });
      } catch (e) { clearTimeout(timer); finish({}); }
    });
  }

  // ---------- record the page view ----------
  var viewId = uuid();
  var q = new URLSearchParams(location.search);

  getGeo().then(function (geo) {
    var d = parseUA(ua);
    var tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    var query = location.search.replace(/[?&](notrack)=[^&]*/g, '').replace(/^&/, '?');
    if (query === '?') query = '';

    post('page_views', {
      id: viewId,
      site: clip(host.replace(/^www\./, ''), 120),
      visitor_id: visitorId,
      session_id: sessionId,
      is_new_visitor: isNew,
      page_path: cleanPath(location.pathname),
      page_query: clip(query, 300),
      page_title: clip(document.title, 300),
      referrer: clip(document.referrer, 500),
      referrer_host: clip(refHost(), 200),
      utm_source: clip(q.get('utm_source'), 100),
      utm_medium: clip(q.get('utm_medium'), 100),
      utm_campaign: clip(q.get('utm_campaign'), 100),
      device_type: d.device, browser: d.browser, os: d.os,
      screen_w: window.screen ? screen.width : null,
      screen_h: window.screen ? screen.height : null,
      language: clip(navigator.language, 20),
      timezone: clip(tz, 60),
      country: geo.country || null,
      country_code: geo.country_code || null,
      region: geo.region || null,
      city: geo.city || null
    });
  });

  // ---------- time on page + scroll depth ----------
  var visibleMs = 0, shownAt = document.visibilityState === 'visible' ? Date.now() : 0, maxScroll = 0, sent = 0;

  function calcScroll() {
    var de = document.documentElement, b = document.body;
    var h = Math.max(de.scrollHeight, b ? b.scrollHeight : 0) - window.innerHeight;
    var y = window.pageYOffset || de.scrollTop || 0;
    var pct = h <= 0 ? 100 : Math.round((y / h) * 100);
    if (pct > maxScroll) maxScroll = Math.min(pct, 100);
  }
  window.addEventListener('scroll', calcScroll, { passive: true });

  function report() {
    var secs = Math.round((visibleMs + (shownAt ? Date.now() - shownAt : 0)) / 1000);
    if (secs < 1 || secs === sent) return;
    sent = secs;
    calcScroll();
    post('rpc/record_time', { p_id: viewId, p_secs: secs, p_scroll: maxScroll });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (shownAt) { visibleMs += Date.now() - shownAt; shownAt = 0; }
      report();
    } else { shownAt = Date.now(); }
  });
  window.addEventListener('pagehide', function () {
    if (shownAt) { visibleMs += Date.now() - shownAt; shownAt = 0; }
    report();
  });
})();
