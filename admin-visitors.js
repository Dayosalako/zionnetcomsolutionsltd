/*!
 * Zion Netcom — Admin "Visitors" tab
 * ------------------------------------------------------------------
 * Renders visitor analytics inside admin.html (tab id: tab-visitors).
 * Reads the page_views / visitor_identities / payments tables from Supabase.
 * Requires the Supabase admin login (row-level security blocks everyone else).
 *
 * Depends on globals already defined by admin.html:  getDB(), toast() (optional)
 */
(function () {
  'use strict';

  var PAGE_SIZE = 1000, MAX_PAGES = 20;           // up to 20,000 page views per load
  var LIVE_MS = 5 * 60 * 1000;                    // "online now" = active in last 5 minutes
  var REFRESH_MS = 60 * 1000;

  var st = {
    range: 30, site: 'all', filter: 'all', q: '', limit: 100,
    open: {}, rows: [], ids: [], pays: [], visitors: [], list: [],
    built: false, loaded: false, loading: false, capped: false, updated: 0, timer: null
  };

  // ───────────────────────── helpers ─────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-NG'); }
  function naira(n) { return '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function dur(s) {
    if (s == null) return '—';
    s = Math.round(s);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60); return m + 'm ' + (s % 60) + 's';
  }
  function ago(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + ' min ago';
    if (d < 86400000) return Math.floor(d / 3600000) + ' h ago';
    if (d < 7 * 86400000) return Math.floor(d / 86400000) + ' d ago';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fullDate(ts) {
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function ymd(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function flag(cc) {
    if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
    return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(0); }));
  }
  function tip(msg, ok) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    if (!ok) console.warn(msg);
  }

  var PAGE_NAMES = {
    '/': 'Home', '/services': 'Solutions', '/projects': 'Projects', '/about': 'About',
    '/contact': 'Contact', '/blog': 'Blog', '/post': 'Blog post', '/reviews': 'Reviews',
    '/store': 'Store', '/payment': 'Make Payment'
  };
  function pageKey(r) { return r.page_path === '/post' ? '/post' + (r.page_query || '') : r.page_path; }
  function pageLabel(r) {
    if (r.page_path === '/post') {
      var t = (r.page_title || '').replace(/\s*[|–—-]\s*Zion Netcom.*$/i, '').trim();
      return 'Blog post' + (t ? ': ' + t : '');
    }
    return PAGE_NAMES[r.page_path] || r.page_path;
  }

  function sourceOf(r) {
    if (r.utm_source) return r.utm_source.charAt(0).toUpperCase() + r.utm_source.slice(1);
    var h = (r.referrer_host || '').toLowerCase();
    if (!h) return 'Direct';
    if (/(^|\.)google\./.test(h)) return 'Google';
    if (/bing\.com/.test(h)) return 'Bing';
    if (/duckduckgo|yahoo\./.test(h)) return 'Search engine';
    if (/facebook\.|fb\.com|fb\.me/.test(h)) return 'Facebook';
    if (/instagram\./.test(h)) return 'Instagram';
    if (/(^|\.)t\.co$|twitter\.|(^|\.)x\.com$/.test(h)) return 'X / Twitter';
    if (/linkedin\.|lnkd\.in/.test(h)) return 'LinkedIn';
    if (/whatsapp\.|wa\.me/.test(h)) return 'WhatsApp';
    if (/youtube\.|youtu\.be/.test(h)) return 'YouTube';
    if (/tiktok\./.test(h)) return 'TikTok';
    return h;
  }

  function rangeStart() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (st.range - 1));
    return d;
  }

  // ───────────────────────── data ─────────────────────────
  async function paged(make) {
    var out = [], capped = false;
    for (var p = 0; p < MAX_PAGES; p++) {
      var res = await make(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1);
      if (res.error) throw res.error;
      var d = res.data || [];
      out = out.concat(d);
      if (d.length < PAGE_SIZE) return { rows: out, capped: false };
    }
    return { rows: out, capped: true };
  }

  var VIEW_COLS = 'id,created_at,site,visitor_id,session_id,is_new_visitor,page_path,page_query,page_title,' +
    'referrer_host,utm_source,device_type,browser,os,country,country_code,region,city,duration_seconds,scroll_depth';

  async function load(silent) {
    if (st.loading) return;
    var db = window.getDB && window.getDB();
    if (!db) { return showMsg('Supabase is not available.', 'fa-triangle-exclamation'); }
    var sess = await db.auth.getSession();
    if (!sess.data || !sess.data.session) { return showGate(); }

    st.loading = true;
    if (!silent) showMsg('Loading visitors…', 'fa-circle-notch fa-spin');
    try {
      var since = rangeStart().toISOString();
      var v = await paged(function (a, b) {
        return db.from('page_views').select(VIEW_COLS).gte('created_at', since)
          .order('created_at', { ascending: false }).order('id').range(a, b);
      });
      st.rows = v.rows; st.capped = v.capped;

      var idr = await paged(function (a, b) {
        return db.from('visitor_identities').select('visitor_id,name,email,phone,source,created_at')
          .order('created_at', { ascending: false }).order('id').range(a, b);
      });
      st.ids = idr.rows;

      try {   // payments are optional — the dashboard still works without them
        var pr = await paged(function (a, b) {
          return db.from('payments').select('email,amount,status,created_at')
            .order('created_at', { ascending: false }).order('id').range(a, b);
        });
        st.pays = pr.rows;
      } catch (e) { st.pays = []; }

      st.loaded = true; st.updated = Date.now();
      compute(); render();
    } catch (err) {
      var m = (err && err.message) || 'Unknown error';
      var missing = /does not exist|schema cache|PGRST205|42P01/i.test(m + ' ' + (err && err.code));
      showMsg(missing
        ? 'The visitor tables were not found. Open Supabase → SQL Editor and run <b>database/visitors-setup.sql</b>, then press Refresh.'
        : 'Could not load visitors: ' + esc(m), 'fa-triangle-exclamation');
    } finally { st.loading = false; }
  }

  // ───────────────────────── analysis ─────────────────────────
  function compute() {
    var rows = st.rows.filter(function (r) { return st.site === 'all' || (r.site || '—') === st.site; });
    var now = Date.now();

    // identities per visitor (newest first)  &  payments per email
    var idBy = {};
    st.ids.forEach(function (i) { (idBy[i.visitor_id] = idBy[i.visitor_id] || []).push(i); });
    var paidBy = {};
    st.pays.forEach(function (p) {
      if (!p.email || (p.status && p.status !== 'success')) return;
      var k = p.email.trim().toLowerCase();
      paidBy[k] = (paidBy[k] || 0) + Number(p.amount || 0);
    });

    var V = {}, S = {};
    rows.forEach(function (r) {                       // rows are newest → oldest
      var v = V[r.visitor_id];
      if (!v) v = V[r.visitor_id] = { id: r.visitor_id, views: [], sessions: {}, isNew: false };
      v.views.push(r); v.sessions[r.session_id] = 1;
      if (r.is_new_visitor) v.isNew = true;
      (S[r.session_id] = S[r.session_id] || []).push(r);
    });

    var visitors = Object.keys(V).map(function (k) {
      var v = V[k], last = v.views[0], first = v.views[v.views.length - 1];
      v.last = new Date(last.created_at).getTime();
      v.first = new Date(first.created_at).getTime();
      v.loc = last; v.nSessions = Object.keys(v.sessions).length;
      var ids = idBy[k] || [];
      v.name = ''; v.email = ''; v.phone = ''; v.sources = [];
      ids.forEach(function (i) {
        if (!v.name && i.name) v.name = i.name;
        if (!v.email && i.email) v.email = i.email;
        if (!v.phone && i.phone) v.phone = i.phone;
        if (v.sources.indexOf(i.source) < 0) v.sources.push(i.source);
      });
      v.known = !!(v.name || v.email || v.phone);
      v.paid = v.email ? (paidBy[v.email.trim().toLowerCase()] || 0) : 0;
      v.live = (now - v.last) <= LIVE_MS;
      return v;
    }).sort(function (a, b) { return b.last - a.last; });

    // sessions → traffic source (from the FIRST page of each session)
    var srcCount = {};
    Object.keys(S).forEach(function (sid) {
      var first = S[sid][S[sid].length - 1];
      var s = sourceOf(first);
      srcCount[s] = (srcCount[s] || 0) + 1;
    });

    st.data = { rows: rows, visitors: visitors, nSessions: Object.keys(S).length, srcCount: srcCount };
    st.visitors = visitors;
  }

  function counts(arr, keyFn, valFn) {           // distinct-visitor counts by key
    var m = {};
    arr.forEach(function (v) {
      var k = keyFn(v); if (!k) return;
      m[k] = (m[k] || 0) + (valFn ? valFn(v) : 1);
    });
    return Object.keys(m).map(function (k) { return { label: k, count: m[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // ───────────────────────── rendering ─────────────────────────
  function css() {
    if ($('zv-style')) return;
    var s = document.createElement('style'); s.id = 'zv-style';
    s.textContent =
      '.zv-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px}' +
      '.zv-bar h2{font-family:var(--disp);font-size:1.05rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.zv-bar h2>i{color:var(--cyan)}' +
      '.zv-live{font-family:var(--mono);font-size:.68rem;color:var(--green);display:inline-flex;align-items:center;gap:7px;background:rgba(34,197,94,.1);padding:4px 11px;border-radius:20px;font-weight:600}' +
      '.zv-live i{width:7px;height:7px;border-radius:50%;background:var(--green);animation:zvp 1.6s infinite}' +
      '@keyframes zvp{0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}' +
      '.zv-r{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.zv-r select,.zv-search{padding:8px 11px;background:var(--el);border:1px solid var(--br);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono)}' +
      '.zv-search{min-width:250px}.zv-search:focus,.zv-r select:focus{border-color:var(--cyan);outline:none}' +
      '.zv-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px}' +
      '@media(min-width:640px){.zv-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
      '@media(min-width:1000px){.zv-stats{grid-template-columns:repeat(6,minmax(0,1fr))}}' +
      '.zv-stats .sv{font-size:1.35rem}.zv-stats .sl{line-height:1.5}' +
      '.zv-hint{font-size:.7rem;color:var(--muted);font-family:var(--mono);margin-top:3px;text-transform:none;letter-spacing:0}' +
      '.zv-bars{display:flex;align-items:flex-end;gap:3px;height:150px;padding-top:8px}' +
      '.zv-b{flex:1;position:relative;height:100%;display:flex;align-items:flex-end;min-width:2px;cursor:default}' +
      '.zv-b .v{position:absolute;bottom:0;left:0;right:0;background:rgba(56,182,255,.28);border-radius:3px 3px 0 0;transition:height .3s}' +
      '.zv-b .u{position:absolute;bottom:0;left:18%;right:18%;background:var(--cyan);border-radius:3px 3px 0 0;transition:height .3s}' +
      '.zv-b:hover .v{background:rgba(56,182,255,.5)}' +
      '.zv-ax{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.62rem;color:var(--muted);margin-top:7px}' +
      '.zv-lg{display:flex;gap:16px;font-family:var(--mono);font-size:.64rem;color:var(--text2);margin-top:10px}' +
      '.zv-lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}' +
      '.zv-g2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.zv-g2>*{min-width:0}@media(max-width:860px){.zv-g2{grid-template-columns:minmax(0,1fr)}}' +
      '.zv-bl-row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:6px 0;font-size:.83rem;align-items:center}' +
      '.zv-bl-l{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.zv-bl-n{font-family:var(--mono);font-size:.76rem;color:var(--cyan)}' +
      '.zv-bl-bar{grid-column:1/3;height:4px;background:var(--el);border-radius:3px;overflow:hidden}' +
      '.zv-bl-bar i{display:block;height:100%;background:var(--cyan);border-radius:3px;opacity:.75}' +
      '.zv-tw{overflow-x:auto}#zv-list .zv-tw table{min-width:640px}.zv-g2 .dtbl td,.zv-g2 .dtbl th{padding-left:8px;padding-right:8px}' +
      '.zv-chips{display:flex;gap:6px;flex-wrap:wrap}' +
      '.zv-chip{font-family:var(--mono);font-size:.68rem;font-weight:600;padding:6px 12px;border-radius:20px;border:1px solid var(--br);background:transparent;color:var(--text2);cursor:pointer;transition:all .2s}' +
      '.zv-chip:hover{border-color:var(--cyan);color:var(--cyan)}.zv-chip.on{background:var(--cyan);color:var(--bg);border-color:var(--cyan)}' +
      '.zv-vr{cursor:pointer}.zv-vr td{vertical-align:middle}' +
      '.zv-who{display:flex;align-items:center;gap:11px;min-width:190px}' +
      '.zv-av{width:34px;height:34px;flex:0 0 34px;border-radius:50%;background:var(--el);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.8rem;border:1px solid var(--br)}' +
      '.zv-av.k{color:var(--cyan);border-color:var(--brh);background:rgba(56,182,255,.1)}' +
      '.zv-nm{color:var(--text);font-weight:600;font-size:.85rem;line-height:1.3}' +
      '.zv-sub{font-size:.72rem;color:var(--muted);line-height:1.4}' +
      '.zv-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}' +
      '.zv-j td{background:rgba(56,182,255,.035)!important;padding:0!important;border-bottom:1px solid var(--br)!important}' +
      '.zv-jin{padding:14px 16px 16px 60px}@media(max-width:700px){.zv-jin{padding-left:14px}}' +
      '.zv-jt{width:100%;border-collapse:collapse;min-width:520px}' +
      '.zv-jt th{font-family:var(--mono);font-size:.6rem;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);text-align:left;padding:5px 10px 5px 0;font-weight:600}' +
      '.zv-jt td{font-size:.79rem;color:var(--text2);padding:5px 10px 5px 0;border:none;background:none}' +
      '.zv-contact{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:.82rem}' +
      '.zv-contact a{color:var(--cyan);text-decoration:none}.zv-contact a:hover{text-decoration:underline}' +
      '.zv-more{text-align:center;padding-top:14px}' +
      '.zv-note{font-size:.76rem;color:var(--yellow);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:6px;padding:9px 13px;margin-bottom:14px}' +
      '.zv-err{color:var(--red);font-size:.8rem;margin-top:10px}';
    document.head.appendChild(s);
  }

  function showMsg(html, icon) {
    var body = $('zv-body'); if (!body) return;
    body.innerHTML = '<div class="card"><div class="empty"><i class="fas ' + icon + '"></i>' + html + '</div></div>';
  }

  function build() {
    var root = $('zv-root'); if (!root) return false;
    css();
    root.innerHTML =
      '<div class="zv-bar">' +
        '<h2><i class="fas fa-chart-column"></i> Visitors &amp; Customers ' +
          '<span class="zv-live" id="zv-live" style="display:none"><i></i><b id="zv-live-n">0</b>&nbsp;online now</span></h2>' +
        '<div class="zv-r">' +
          '<select id="zv-site" style="display:none" title="Website"></select>' +
          '<select id="zv-range" title="Time period">' +
            '<option value="1">Today</option><option value="7">Last 7 days</option>' +
            '<option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select>' +
          '<button class="btn btn-o btn-sm" id="zv-refresh"><i class="fas fa-rotate"></i> Refresh</button>' +
          '<button class="btn btn-o btn-sm" id="zv-export"><i class="fas fa-download"></i> CSV</button>' +
        '</div>' +
      '</div>' +
      '<div id="zv-body"></div>';

    $('zv-range').addEventListener('change', function () { st.range = +this.value; st.limit = 100; load(); });
    $('zv-site').addEventListener('change', function () { st.site = this.value; st.limit = 100; compute(); render(); });
    $('zv-refresh').addEventListener('click', function () { load(); });
    $('zv-export').addEventListener('click', exportCsv);

    // event delegation for everything inside the body
    $('zv-body').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-f]');
      if (chip) { st.filter = chip.getAttribute('data-f'); st.limit = 100; renderList(); return; }
      if (e.target.closest('#zv-more')) { st.limit += 100; renderList(); return; }
      if (e.target.closest('a')) return;                       // let mailto:/tel: links work
      var row = e.target.closest('[data-i]');
      if (row) {
        var v = st.list[+row.getAttribute('data-i')];
        if (v) { st.open[v.id] = !st.open[v.id]; renderList(); }
      }
    });
    $('zv-body').addEventListener('input', function (e) {
      if (e.target.id === 'zv-q') { st.q = e.target.value; st.limit = 100; renderList(); }
    });
    st.built = true;
    return true;
  }

  function showGate() {
    var body = $('zv-body'); if (!body) return;
    body.innerHTML =
      '<div class="card" style="max-width:520px">' +
        '<h3><i class="fas fa-lock"></i> Sign in to view visitors</h3>' +
        '<p style="color:var(--text2);font-size:.86rem;margin-bottom:14px;line-height:1.7">' +
          'Visitor and customer data is protected by your Supabase account. Sign in with the same admin email &amp; password you use for the Blog tab.</p>' +
        '<div style="display:grid;gap:10px">' +
          '<input type="email" id="zv-email" placeholder="Admin email" autocomplete="username">' +
          '<input type="password" id="zv-pass" placeholder="Password" autocomplete="current-password">' +
          '<button class="btn btn-p btn-sm" id="zv-login" style="justify-self:start"><i class="fas fa-right-to-bracket"></i> Sign in</button>' +
          '<div class="zv-err" id="zv-lerr" style="display:none"></div>' +
        '</div></div>';
    $('zv-login').addEventListener('click', doLogin);
    $('zv-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    var db = window.getDB && window.getDB(), err = $('zv-lerr'), btn = $('zv-login');
    var email = $('zv-email').value.trim(), pass = $('zv-pass').value;
    err.style.display = 'none';
    if (!email || !pass) { err.textContent = 'Enter your email and password.'; err.style.display = 'block'; return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';
    var res = await db.auth.signInWithPassword({ email: email, password: pass });
    if (res.error) {
      err.textContent = 'Invalid email or password.'; err.style.display = 'block';
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Sign in';
    } else { load(); }
  }

  function render() {
    var body = $('zv-body'), D = st.data;
    if (!body || !D) return;
    var hadFocus = document.activeElement && document.activeElement.id === 'zv-q';
    var selStart = hadFocus ? document.activeElement.selectionStart : 0;

    // site selector (only when more than one site is reporting in)
    var sites = {}; st.rows.forEach(function (r) { sites[r.site || '—'] = 1; });
    var sk = Object.keys(sites), ss = $('zv-site');
    if (sk.length > 1) {
      ss.innerHTML = '<option value="all">All sites</option>' + sk.sort().map(function (s) {
        return '<option value="' + esc(s) + '"' + (s === st.site ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('');
      ss.value = st.site; ss.style.display = '';
    } else { ss.style.display = 'none'; if (st.site !== 'all') { st.site = 'all'; } }

    var V = D.visitors, rows = D.rows;
    var live = V.filter(function (v) { return v.live; }).length;
    $('zv-live').style.display = ''; $('zv-live-n').textContent = live;

    if (!rows.length) {
      body.innerHTML =
        '<div class="card"><div class="empty"><i class="fas fa-chart-column"></i>' +
        '<div style="color:var(--text2);margin-bottom:6px"><b>No visits recorded in this period yet.</b></div>' +
        '<div style="font-size:.82rem;max-width:460px;margin:0 auto;line-height:1.7">Visits appear here as soon as real visitors open your pages. ' +
        'Your own visits are ignored while you\'re signed in to admin or opened a page with <code>?notrack=1</code>. ' +
        'To test, open your site in a private window on your phone (using mobile data).</div></div></div>';
      return;
    }

    var timed = rows.filter(function (r) { return r.duration_seconds != null; });
    var avg = timed.length ? timed.reduce(function (a, r) { return a + r.duration_seconds; }, 0) / timed.length : null;
    var nNew = V.filter(function (v) { return v.isNew; }).length;
    var nKnown = V.filter(function (v) { return v.known; }).length;
    var nPaid = V.filter(function (v) { return v.paid > 0; }).length;

    var html = '';
    if (st.capped) html += '<div class="zv-note"><i class="fas fa-circle-info"></i> Showing the most recent ' + num(PAGE_SIZE * MAX_PAGES) + ' page views. Choose a shorter period for complete numbers.</div>';

    html += '<div class="zv-stats">' +
      stat(num(V.length), 'Visitors', nNew + ' new · ' + (V.length - nNew) + ' returning') +
      stat(num(rows.length), 'Page views', (V.length ? (rows.length / V.length).toFixed(1) : 0) + ' per visitor') +
      stat(num(D.nSessions), 'Visits (sessions)', '') +
      stat(dur(avg), 'Avg. time on page', '') +
      stat(num(nKnown), 'Known customers', 'enquired or paid') +
      stat(num(nPaid), 'Paying customers', '') + '</div>';

    html += '<div class="card"><h3><i class="fas fa-chart-simple"></i> ' + (st.range === 1 ? 'Visits today, by hour' : 'Visits per day') + '</h3>' + chart(rows) + '</div>';

    // pages
    var pg = {};
    rows.forEach(function (r) {
      var k = pageKey(r), g = pg[k] || (pg[k] = { label: pageLabel(r), views: 0, vis: {}, t: 0, tn: 0 });
      g.views++; g.vis[r.visitor_id] = 1;
      if (r.duration_seconds != null) { g.t += r.duration_seconds; g.tn++; }
    });
    var pages = Object.keys(pg).map(function (k) { return pg[k]; }).sort(function (a, b) { return b.views - a.views; }).slice(0, 12);
    var ptbl = '<div class="zv-tw"><table class="dtbl"><thead><tr><th>Page</th><th>Views</th><th>Visitors</th><th>Avg. time</th></tr></thead><tbody>' +
      pages.map(function (g) {
        return '<tr><td style="color:var(--text)">' + esc(g.label) + '</td><td>' + num(g.views) + '</td><td>' + num(Object.keys(g.vis).length) + '</td><td>' + (g.tn ? dur(g.t / g.tn) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var srcs = Object.keys(D.srcCount).map(function (k) { return { label: k, count: D.srcCount[k] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
    var places = counts(V, function (v) {
      var l = v.loc; if (!l.country && !l.city) return '';
      return (flag(l.country_code) ? flag(l.country_code) + ' ' : '') + (l.city ? l.city + ', ' : '') + (l.country || '');
    }).slice(0, 8);
    var devs = counts(V, function (v) { return v.loc.device_type ? v.loc.device_type.charAt(0).toUpperCase() + v.loc.device_type.slice(1) : ''; });
    var brs = counts(V, function (v) { return v.loc.browser; }).slice(0, 5);

    html += '<div class="zv-g2">' +
      '<div class="card"><h3><i class="fas fa-file-lines"></i> Most viewed pages</h3>' + ptbl + '</div>' +
      '<div class="card"><h3><i class="fas fa-arrow-right-to-bracket"></i> Where visits come from</h3>' + barlist(srcs, D.nSessions, 'visits') + '</div>' +
      '<div class="card"><h3><i class="fas fa-location-dot"></i> Where visitors are</h3>' + barlist(places, V.length, 'visitors') + '</div>' +
      '<div class="card"><h3><i class="fas fa-mobile-screen"></i> Devices &amp; browsers</h3>' + barlist(devs, V.length, 'visitors') +
        '<div style="height:10px"></div>' + barlist(brs, V.length, 'visitors') + '</div>' +
      '</div>';

    // visitors list (chips + search + table are re-rendered by renderList)
    html += '<div class="card"><h3><i class="fas fa-users"></i> Everyone who visited</h3>' +
      '<div class="zv-bar" style="margin-bottom:12px"><div class="zv-chips" id="zv-chips"></div>' +
      '<input class="zv-search" id="zv-q" type="search" placeholder="Search name, email, city…" value="' + esc(st.q) + '"></div>' +
      '<div id="zv-list"></div></div>';

    body.innerHTML = html;
    renderList();

    if (hadFocus) { var q = $('zv-q'); q.focus(); try { q.setSelectionRange(selStart, selStart); } catch (e) {} }
  }

  function stat(v, l, hint) {
    return '<div class="stat-sm"><div class="sv">' + esc(v) + '</div><div class="sl">' + esc(l) + '</div>' +
      (hint ? '<div class="zv-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function barlist(items, total, unit) {
    if (!items.length) return '<div style="color:var(--muted);font-size:.83rem;padding:8px 0">Not enough data yet.</div>';
    var max = items[0].count || 1;
    return items.map(function (it) {
      return '<div class="zv-bl-row" title="' + esc(it.label) + ' — ' + it.count + ' ' + unit + '"><span class="zv-bl-l">' + esc(it.label) +
        '</span><span class="zv-bl-n">' + num(it.count) + ' · ' + pct(it.count, total) + '%</span>' +
        '<div class="zv-bl-bar"><i style="width:' + Math.max(3, it.count / max * 100) + '%"></i></div></div>';
    }).join('');
  }

  function chart(rows) {
    var hourly = st.range === 1, B = [], idx = {}, start = rangeStart();
    if (hourly) {
      for (var h = 0; h < 24; h++) { B.push({ key: h, label: (h < 10 ? '0' : '') + h + ':00', views: 0, vis: {} }); idx[h] = B[h]; }
    } else {
      for (var i = 0; i < st.range; i++) {
        var d = new Date(start); d.setDate(d.getDate() + i);
        var b = { key: ymd(d), label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), short: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), views: 0, vis: {} };
        B.push(b); idx[b.key] = b;
      }
    }
    rows.forEach(function (r) {
      var d = new Date(r.created_at), b = idx[hourly ? d.getHours() : ymd(d)];
      if (b) { b.views++; b.vis[r.visitor_id] = 1; }
    });
    var max = Math.max.apply(null, B.map(function (b) { return b.views; })) || 1;
    var bars = B.map(function (b) {
      var vn = Object.keys(b.vis).length;
      return '<div class="zv-b" title="' + esc(b.label) + ' — ' + b.views + ' views · ' + vn + ' visitors">' +
        '<div class="v" style="height:' + (b.views ? Math.max(4, b.views / max * 100) : 0) + '%"></div>' +
        '<div class="u" style="height:' + (vn ? Math.max(3, vn / max * 100) : 0) + '%"></div></div>';
    }).join('');
    var ax = hourly ? ['00:00', '06:00', '12:00', '18:00', '23:00'] :
      [B[0].short, B[Math.floor(B.length / 2)].short, B[B.length - 1].short];
    return '<div class="zv-bars">' + bars + '</div><div class="zv-ax">' + ax.map(function (a) { return '<span>' + esc(a) + '</span>'; }).join('') + '</div>' +
      '<div class="zv-lg"><span><i style="background:rgba(56,182,255,.35)"></i>Page views</span><span><i style="background:var(--cyan)"></i>Unique visitors</span></div>';
  }

  function filtered() {
    var q = st.q.trim().toLowerCase();
    return st.visitors.filter(function (v) {
      if (st.filter === 'known' && !v.known) return false;
      if (st.filter === 'paid' && !(v.paid > 0)) return false;
      if (st.filter === 'returning' && v.isNew && v.nSessions < 2) return false;
      if (st.filter === 'new' && !v.isNew) return false;
      if (!q) return true;
      var hay = [v.name, v.email, v.phone, v.loc.city, v.loc.country, v.loc.region, v.loc.browser, v.loc.os, v.id.slice(0, 6)]
        .concat(v.views.slice(0, 40).map(function (r) { return pageLabel(r) + ' ' + r.page_path; })).join(' ').toLowerCase();
      return hay.indexOf(q) > -1;
    });
  }

  function renderList() {
    var box = $('zv-list'); if (!box) return;
    var all = st.visitors;
    var c = {
      all: all.length,
      known: all.filter(function (v) { return v.known; }).length,
      paid: all.filter(function (v) { return v.paid > 0; }).length,
      returning: all.filter(function (v) { return !(v.isNew && v.nSessions < 2); }).length,
      new: all.filter(function (v) { return v.isNew; }).length
    };
    $('zv-chips').innerHTML = [['all', 'Everyone'], ['known', 'Known customers'], ['paid', 'Paid'], ['returning', 'Returning'], ['new', 'New']].map(function (f) {
      return '<button class="zv-chip' + (st.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' (' + num(c[f[0]]) + ')</button>';
    }).join('');

    st.list = filtered();
    if (!st.list.length) {
      box.innerHTML = '<div class="empty"><i class="fas fa-user-slash"></i>' + (st.filter === 'known' || st.filter === 'paid'
        ? 'No identified customers in this period yet. Visitors appear here once they send an enquiry on the Contact page or make a payment.'
        : 'No visitors match.') + '</div>';
      return;
    }
    var shown = st.list.slice(0, st.limit);
    var out = '<div class="zv-tw"><table class="dtbl"><thead><tr><th>Visitor</th><th>Location</th><th>Device</th><th>Pages</th><th>Last visit</th></tr></thead><tbody>';
    shown.forEach(function (v, i) {
      var l = v.loc, open = !!st.open[v.id];
      var title = v.name || v.email || ('Visitor ' + v.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase());
      var badges = '';
      if (v.paid > 0) badges += '<span class="badge bg">Paid ' + esc(naira(v.paid)) + '</span>';
      if (v.sources.indexOf('contact') > -1) badges += '<span class="badge bb">Enquiry</span>';
      if (v.sources.indexOf('payment') > -1 && !(v.paid > 0)) badges += '<span class="badge bb">Payment</span>';
      if (v.isNew) badges += '<span class="badge by">New</span>';
      if (v.live) badges += '<span class="badge bg">Online</span>';
      var place = [l.city, l.country].filter(Boolean).join(', ') || '—';
      out += '<tr class="zv-vr" data-i="' + i + '">' +
        '<td><div class="zv-who"><div class="zv-av' + (v.known ? ' k' : '') + '"><i class="fas ' + (v.known ? 'fa-user-check' : 'fa-user') + '"></i></div>' +
          '<div><div class="zv-nm">' + esc(title) + '</div>' + (v.name && v.email ? '<div class="zv-sub">' + esc(v.email) + '</div>' : '') +
          (badges ? '<div class="zv-badges">' + badges + '</div>' : '') + '</div></div></td>' +
        '<td>' + (flag(l.country_code) ? flag(l.country_code) + ' ' : '') + esc(place) + '</td>' +
        '<td>' + esc([l.device_type, l.browser].filter(Boolean).join(' · ') || '—') + '<div class="zv-sub">' + esc(l.os || '') + '</div></td>' +
        '<td>' + num(v.views.length) + '<div class="zv-sub">' + v.nSessions + (v.nSessions === 1 ? ' visit' : ' visits') + '</div></td>' +
        '<td title="' + esc(fullDate(v.last)) + '">' + esc(ago(v.last)) + '<div class="zv-sub"><i class="fas fa-chevron-' + (open ? 'up' : 'down') + '"></i></div></td></tr>';
      if (open) out += '<tr class="zv-j"><td colspan="5">' + journey(v) + '</td></tr>';
    });
    out += '</tbody></table></div>';
    if (st.list.length > shown.length) {
      out += '<div class="zv-more"><button class="btn btn-o btn-sm" id="zv-more">Show more (' + num(st.list.length - shown.length) + ' remaining)</button></div>';
    }
    box.innerHTML = out;
  }

  function journey(v) {
    var c = '';
    if (v.email || v.phone) {
      c = '<div class="zv-contact">' +
        (v.email ? '<span><i class="fas fa-envelope" style="color:var(--muted)"></i>&nbsp; <a href="mailto:' + esc(v.email) + '">' + esc(v.email) + '</a></span>' : '') +
        (v.phone ? '<span><i class="fas fa-phone" style="color:var(--muted)"></i>&nbsp; <a href="tel:' + esc(v.phone.replace(/[^\d+]/g, '')) + '">' + esc(v.phone) + '</a></span>' : '') +
        '</div>';
    }
    var views = v.views.slice(0, 60);
    var t = '<div class="zv-tw"><table class="zv-jt"><thead><tr><th>When</th><th>Page</th><th>Time on page</th><th>Scrolled</th><th>Came from</th></tr></thead><tbody>' +
      views.map(function (r) {
        return '<tr><td>' + esc(fullDate(new Date(r.created_at).getTime())) + '</td><td style="color:var(--text)">' + esc(pageLabel(r)) + '</td><td>' +
          dur(r.duration_seconds) + '</td><td>' + (r.scroll_depth != null ? r.scroll_depth + '%' : '—') + '</td><td>' + esc(sourceOf(r)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var more = v.views.length > views.length ? '<div class="zv-sub" style="margin-top:6px">Showing the latest ' + views.length + ' of ' + v.views.length + ' page views.</div>' : '';
    return '<div class="zv-jin">' + c + t + more + '</div>';
  }

  // ───────────────────────── CSV export ─────────────────────────
  function csvCell(x) {
    x = x == null ? '' : String(x);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;           // stop spreadsheet formula injection
    return '"' + x.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    if (!st.visitors.length) { tip('Nothing to export yet.'); return; }
    var head = ['Name', 'Email', 'Phone', 'Paid (NGN)', 'Country', 'Region', 'City', 'Device', 'Browser', 'OS', 'Visits', 'Page views', 'First seen', 'Last seen', 'Pages viewed'];
    var lines = [head.map(csvCell).join(',')];
    (filtered()).forEach(function (v) {
      var l = v.loc;
      var pages = v.views.map(function (r) { return pageLabel(r); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' | ');
      lines.push([v.name, v.email, v.phone, v.paid || '', l.country, l.region, l.city, l.device_type, l.browser, l.os, v.nSessions, v.views.length,
        new Date(v.first).toISOString(), new Date(v.last).toISOString(), pages].map(csvCell).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zion-visitors-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ───────────────────────── entry point ─────────────────────────
  function init() {
    if (!st.built && !build()) return;
    if (!st.loaded || Date.now() - st.updated > 30000) load(st.loaded);   // silent when we already have data
    if (!st.timer) {
      st.timer = setInterval(function () {
        var p = $('tab-visitors');
        if (p && p.classList.contains('active') && st.loaded && !document.hidden) load(true);
      }, REFRESH_MS);
    }
  }

  window.ZVisitors = { init: init, _state: st, _compute: compute, _render: render };
})();
