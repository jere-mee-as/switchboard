/* Switchboard · One bar (page v1.0)
   One still screen: today, sixteen apps, the bar.
     tap the bar        type to your phone: apps, people, /commands, sums, the web
     swipe sideways     next space (Home is page one; each space is a page)
     pull up            everything waiting, people first; reply right from the bar
     pull down          the notification shade
     tap the cover      the album-art player
     hold an app        options; hold and drag to reorder
   Unfolded, what's waiting sits beside home.
   Talks to the same phone bridge as v0.4 (window.SBNative) and keeps the same saved data (sb.data),
   so spaces, pins, passport, notes and reminders carry over, and /update reset still goes back. */
(() => {
  'use strict';

/*@@UTIL@@*/
  const hostOf = u => { try { const x = new URL(u); return (x.host + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, '') : '')).replace(/^www\./, ''); } catch (e) { return u; } };
  const clockS = t => clock(t).replace(/\s?([AaPp])\.?\s?[Mm]\.?$/, (m, x) => x.toLowerCase() + 'm');
  const rel = t => {
    const d = t - now();
    if (d <= 0 && d > -HOUR) return 'now';
    if (d > 0 && d < HOUR) return 'in ' + Math.max(1, Math.round(d / MIN)) + ' min';
    if (sameDay(t, now())) return d > 0 && d < 3 * HOUR ? 'in ' + (d / HOUR).toFixed(1).replace('.0', '') + ' h' : '';
    return shortDay(t);
  };

  /* ---------- bridge ---------- */
  const NATIVE = !!window.SBNative;
  function nativeBridge(n) {
    const call = (m, a) => {
      try {
        if (typeof n[m] !== 'function') return null;
        const r = n[m](...a);
        if (typeof r === 'string') { try { return JSON.parse(r); } catch (e) { return r; } }
        return r;
      } catch (e) { console.warn('bridge', m, e); return null; }
    };
    return new Proxy({}, { get: (_, m) => (m === 'preview' ? false : (...a) => call(m, a)) });
  }
  const B = NATIVE ? nativeBridge(window.SBNative) : window.SBMock;
  const buzz = k => { if (B.haptic) B.haptic(k || 'tick'); };

  /* ---------- state ---------- */
  const ACCENTS = { brass: ['#e2a63b', '#1c1406', 'Brass'], mint: ['#3cc79b', '#04170f', 'Mint'], signal: ['#5b9cf0', '#06111f', 'Signal'], orchid: ['#c985e0', '#1a0a20', 'Orchid'],
    ember: ['#ef6141', '#1f0904', 'Ember'], lime: ['#b6d936', '#141a03', 'Lime'], ice: ['#8fdcec', '#06181c', 'Ice'], rose: ['#f08aa5', '#22080f', 'Rose'] };
  const DEF = {
    v: 2, dnd: false, skin: 'auto', spaces: null, pinned: null, hidden: [], muted: [], logs: {}, notes: [], recent: [],
    seen: {}, known: [], fresh: [], passport: null, reminders: [], macros: {}, mate: null, answers: []
  };
  const D = Object.assign({}, DEF, store.get('data', {}));
  if ((D.v || 1) < 2) { D.spaces = null; D.pinned = null; D.dnd = D.status === 'dnd'; delete D.status; delete D.note; D.v = 2; }
  D.fun = Object.assign({ accent: 'brass', bot: 'Operator', motion: 'calm' }, D.fun || {});
  if (!Array.isArray(D.answers)) D.answers = [];
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set('data', D), 120); };
  const S = {
    apps: [], byKey: new Map(), byPkg: new Map(), notifs: [], media: null, events: [], contacts: [],
    battery: null, device: null, perms: {}, torch: false,
    page: store.get('obPage', 0), wide: false, sheet: null, finding: false, pool: null, reply: null, player: false,
    results: [], sent: {}, showEarlier: false, answerId: null
  };
  const isConvo = n => n.kind === 'msg' || n.kind === 'call';
  const bot = () => D.fun.bot || 'Operator';

/*@@SPACES@@*/

  /* ---------- model ---------- */
  const appOf = k => S.byKey.get(k);
  const appPkg = p => S.byPkg.get(p);
  const isHidden = k => D.hidden.includes(k);
  const visApps = () => S.apps.filter(a => !isHidden(a.key));
  const spaceOf = id => arr(D.spaces).find(s => s.id === id);
  const spaceApps = sp => {
    const l = (sp ? sp.apps : []).map(appOf).filter(a => a && !isHidden(a.key));
    return sp && sp.sort === 'custom' ? l : l.sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }));
  };
  const pinnedApps = () => arr(D.pinned).map(appOf).filter(a => a && !isHidden(a.key));
  const muted = p => D.muted.includes(p);
  const live = () => S.notifs.filter(n => n.live && !muted(n.pkg));
  function pages() {
    return [{ id: 'home', name: 'Home', apps: pinnedApps() }]
      .concat(arr(D.spaces).map(sp => ({ id: sp.id, name: sp.name, sp, apps: spaceApps(sp) })));
  }
  const curPage = () => { const p = pages(); return p[Math.min(S.page, p.length - 1)] || p[0]; };
  function pkgBadge(pkg) {
    const b = { m: 0, u: 0 };
    if (muted(pkg)) return b;
    for (const n of S.notifs) if (n.live && n.pkg === pkg) isConvo(n) ? b.m++ : b.u++;
    return b;
  }
  const convoKey = n => n.pkg + '|' + norm(n.convo || n.title || n.person || '');
  // Conversations with something still in the shade, newest first.
  function convos(all) {
    const m = new Map();
    for (const n of S.notifs) {
      if (!isConvo(n) || muted(n.pkg)) continue;
      const k = convoKey(n);
      let c = m.get(k);
      if (!c) { c = { key: k, pkg: n.pkg, name: n.convo || n.title || n.person || 'Unknown', group: !!n.group, items: [], last: null }; m.set(k, c); }
      c.items.push(n);
      if (!c.last || n.time >= c.last.time) c.last = n;
    }
    const list = [...m.values()].sort((a, b) => b.last.time - a.last.time);
    return all ? list : list.filter(c => c.items.some(n => n.live));
  }
  // Everything else, grouped by app.
  function others() {
    const m = new Map();
    for (const n of live()) {
      if (isConvo(n)) continue;
      let g = m.get(n.pkg);
      if (!g) { g = { pkg: n.pkg, items: [], last: null }; m.set(n.pkg, g); }
      g.items.push(n);
      if (!g.last || n.time >= g.last.time) g.last = n;
    }
    return [...m.values()].sort((a, b) => b.last.time - a.last.time);
  }
  const waitingCount = () => convos().length + others().reduce((s, g) => s + g.items.length, 0);
  const pageLit = p => { if (p.id === 'home') return false; const pk = new Set(p.apps.map(a => a.pkg)); return live().some(n => pk.has(n.pkg)); };
  function upcoming(days) {
    const end = startOfDay(days), t = now();
    return S.events.filter(e => e.end > t && e.start < end).sort((a, b) => a.start - b.start);
  }

/*@@SEARCH@@*/

  /* ---------- small renderers ---------- */
  const avColor = name => 'c' + (1 + (hashN(norm(name)) % 8));
  const av = (name, cls = '') => `<span class="av ${avColor(name)} ${cls}">${esc(initials(name))}</span>`;
  const opAv = () => `<span class="av op">${ic('jack', 'sm')}</span>`;
  const appIco = a => (a && a.icon ? `<img src="${esc(a.icon)}" alt="" draggable="false">` : '');
  const meAv = (cls = '') => `<span class="av ${D.passport && PIC.url.avatar ? 'pic' : avColor((D.passport || {}).name || 'You')} ${cls}" style="${avStyle()}">${esc(initials((D.passport || {}).name || 'You'))}</span>`;
  const btn = (label, act, v = '', cls = '', icon = '') => ({ label, act, v, cls, icon });
  const btnHtml = b => `<button class="bt ${b.cls || ''}" data-act="${esc(b.act)}" data-v="${esc(b.v)}">${b.icon ? ic(b.icon) : ''}${esc(b.label)}</button>`;

/*@@PICS@@*/

  /* ---------- top ---------- */
  function renderTop() {
    const d = new Date(), b = S.battery || {};
    const extra = D.dnd ? ' · <b>Do Not Disturb</b>' : (b.pct != null && b.pct <= 20 && !b.charging ? ` · <b>${b.pct}%</b>` : '');
    $('#date').innerHTML = `<span class="day">${esc(d.toLocaleDateString(undefined, { weekday: 'long' }))}</span>` +
      `<span class="dt">${esc(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))}${extra}</span>`;
    $('#me').innerHTML = meAv() + (D.dnd ? `<span class="moon">${ic('moon')}</span>` : '');
  }

  /* ---------- pages ---------- */
  function glanceHtml(p, i) {
    if (p.id === 'home') {
      if (S.perms.calendar === false) return `<button class="g-row" data-act="perm" data-v="calendar"><span class="tm">${ic('calendar', 'xs')}</span><span class="tt">Show your calendar here</span><span class="rl">Allow</span></button>`;
      const evs = upcoming(7);
      if (!evs.length) return '<div class="g-quiet">Nothing on the calendar this week.</div>';
      const show = evs.slice(0, 3), more = evs.filter(e => sameDay(e.start, now())).length - show.filter(e => sameDay(e.start, now())).length;
      return show.map(e => `<button class="g-row" data-act="event" data-v="${esc(e.id)}"><span class="tm">${e.allDay ? 'all day' : esc(clock(e.start))}</span>` +
        `<span class="tt">${esc(e.title)}</span><span class="rl">${esc(rel(e.start))}</span></button>`).join('') +
        (more > 0 ? `<button class="g-more" data-act="agenda">${plural(more, 'more event')} today</button>` : '');
    }
    const title = `<div class="g-title">${esc(p.name)}</div>`;
    const pk = new Set(p.apps.map(a => a.pkg));
    const items = live().filter(n => pk.has(n.pkg)).sort((a, b) => b.time - a.time);
    if (!items.length) return title + '<div class="g-quiet">Nothing waiting here.</div>';
    const seen = new Set(), rows = [];
    for (const n of items) {
      const k = isConvo(n) ? convoKey(n) : n.pkg;
      if (seen.has(k)) continue; seen.add(k); rows.push(n);
      if (rows.length === 3) break;
    }
    return title + rows.map(n => {
      const a = appPkg(n.pkg), who = isConvo(n) ? (n.convo || n.title) : (a ? a.label : n.title);
      return `<button class="g-row" data-act="nopen" data-v="${esc(n.id)}"><span class="gi">${appIco(a)}</span>` +
        `<span class="gt"><b>${esc(who)}</b><span>${esc(isConvo(n) && n.group && n.person ? n.person + ': ' + n.text : (isConvo(n) ? n.text : n.title + (n.text ? ' · ' + n.text : '')))}</span></span>` +
        `<span class="rl">${esc(ago(n.time))}</span></button>`;
    }).join('');
  }
  function tileHtml(a, extra = '') {
    const b = pkgBadge(a.pkg);
    const bd = b.m ? `<span class="bdg">${b.m > 99 ? '99+' : b.m}</span>` : b.u ? '<span class="bdg dot"></span>' : '';
    return `<button class="tile" data-key="${esc(a.key)}" data-act="launch" data-v="${esc(a.key)}" ${extra}><span class="ico">${appIco(a)}</span>${bd}<span class="lbl">${esc(a.label)}</span></button>`;
  }
  function gridHtml(p) {
    const list = p.apps;
    if (!list.length) {
      return `<div class="g-empty">${p.id === 'home' ? 'Nothing pinned yet. Tap the bar to find an app, then hold it to pin it here.' : `${esc(p.name)} is empty.`}` +
        `<div class="btns" style="justify-content:center"><button class="bt" data-act="${p.id === 'home' ? 'find' : 'picker'}" data-v="${esc(p.id)}">${p.id === 'home' ? 'Find apps' : 'Add apps'}</button></div></div>`;
    }
    const over = list.length > 16, shown = over ? list.slice(0, 15) : list;
    return shown.map(a => tileHtml(a)).join('') +
      (over ? `<button class="tile more" data-act="more" data-v="${esc(p.id)}"><span class="ico">+${list.length - 15}</span><span class="lbl">All ${esc(p.name)}</span></button>` : '');
  }
  function renderPages() {
    const ps = pages();
    if (S.page >= ps.length) S.page = ps.length - 1;
    $('#track').innerHTML = ps.map((p, i) => `<section class="page" data-i="${i}" aria-label="${esc(p.name)}"${i === S.page ? '' : ' aria-hidden="true"'}>` +
      `<div class="glance">${glanceHtml(p, i)}</div><div class="fill"></div><div class="grid" data-page="${esc(p.id)}">${gridHtml(p)}</div></section>`).join('');
    placeTrack();
    renderDots(ps);
  }
  function renderDots(ps = pages()) {
    $('#dots').innerHTML = `<button id="spacename" data-act="spaces" aria-label="Spaces: ${esc(ps[S.page].name)}">${esc(ps[S.page].name)}</button>` +
      `<span class="dts" aria-hidden="true">${ps.map((p, i) => `<i class="${i === S.page ? 'on' : ''} ${i !== S.page && pageLit(p) ? 'lit' : ''}"></i>`).join('')}</span>`;
  }
  const stageW = () => $('#stage').clientWidth || 1;
  function placeTrack(dx = 0) { $('#track').style.transform = `translate3d(${-S.page * stageW() + dx}px,0,0)`; }
  function goPage(i, quiet) {
    const n = pages().length;
    i = Math.max(0, Math.min(n - 1, i));
    const changed = i !== S.page;
    S.page = i; store.set('obPage', i);
    $('#track').classList.remove('drag');
    placeTrack();
    document.querySelectorAll('.page').forEach((el, k) => el.toggleAttribute('aria-hidden', k !== i));
    renderDots();
    if (changed && !quiet) { buzz(); hideAnswer(); }
  }

  /* ---------- the bar ---------- */
  function renderBar() {
    const m = S.media, c = $('#cover');
    c.hidden = !m;
    if (m) {
      const key = m.art || m.title;
      if (c.dataset.k !== key) { c.dataset.k = key; c.innerHTML = m.art ? `<img src="${esc(m.art)}" alt="">` : ic('music'); }
      c.setAttribute('aria-label', 'Now playing: ' + m.title + (m.artist ? ' by ' + m.artist : ''));
    }
    $('#slash').hidden = !!m || !!S.reply;
    const n = waitingCount(), w = $('#wait');
    w.classList.toggle('lit', n > 0);
    w.innerHTML = `<span class="lp"></span>${S.perms.notif === false ? '!' : n}${ic('up')}`;
    w.setAttribute('aria-label', n ? `${n} waiting` : 'Nothing waiting');
    const r = S.reply, chip = $('#replyChip');
    chip.hidden = !r;
    if (r) chip.innerHTML = `${ic('reply', 'xs')}<b>${esc(r.convo || r.title || r.person)}</b><button type="button" data-act="reply-cancel" aria-label="Cancel reply">${ic('x', 'xs')}</button>`;
    $('#q').placeholder = r ? 'Reply…' : 'Type to your phone';
    const typing = S.finding || !!r;
    $('#wait').hidden = typing;
    $('#clearq').hidden = !S.finding || !!r;
    $('#send').hidden = !r;
    $('#app').classList.toggle('finding', S.finding);
    $('#app').classList.toggle('replying', !!r);
  }

  /* ---------- answers: what the phone says back, just above the bar ---------- */
  function say(text, o = {}) {
    const id = o.id || 'a' + now().toString(36) + Math.random().toString(36).slice(2, 4);
    const a = Object.assign({ id, t: now(), text: text || '' }, o);
    D.answers = D.answers.filter(x => x.id !== id).concat([a]).slice(-30);
    save();
    showAnswer(id);
    return a;
  }
  function showAnswer(id) {
    const a = D.answers.find(x => x.id === id), el = $('#answer');
    if (!a) return hideAnswer();
    S.answerId = id;
    const rows = arr(a.rows).filter(Boolean);
    el.innerHTML = `<div class="an-head">${opAv()}<b>${esc(bot())}</b><small>${esc(clock(a.t))}</small><button class="x" data-act="answer-close" aria-label="Dismiss">${ic('x', 'sm')}</button></div>` +
      `<div class="an-body">${a.k ? `<div class="k">${esc(a.k)}</div>` : ''}${a.title ? `<div class="t">${esc(a.title)}</div>` : ''}${a.text ? `<div>${esc(a.text)}</div>` : ''}` +
      arr(a.lines).map(l => `<div class="ln">${esc(l)}</div>`).join('') +
      (rows.length ? `<dl class="an-rows">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>` : '') +
      (arr(a.btns).length ? `<div class="btns">${a.btns.map(btnHtml).join('')}</div>` : '') + '</div>';
    if (el.hidden) { el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  }
  function hideAnswer() { S.answerId = null; $('#answer').hidden = true; }
  // Answers that change in place (timers, updates, mate).
  const updateAnswer = (id, patch) => { const a = D.answers.find(x => x.id === id); if (a) { Object.assign(a, patch); save(); if (S.answerId === id) showAnswer(id); } };

  let toastT = 0;
  function toast(m) {
    const t = $('#toast'); t.textContent = m; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2300);
  }

  /* ---------- find: everything the bar can reach ---------- */
  const q = () => $('#q');
  function enterFind(pool) {
    if (S.reply) return;
    closeSheet(true);
    S.pool = pool || null;
    if (!S.finding) { S.finding = true; hideAnswer(); }
    renderBar(); renderFind();
  }
  function exitFind() {
    if (!S.finding) return;
    S.finding = false; S.pool = null; q().value = ''; q().blur();
    renderBar();
  }
  function setQuery(v, focus = true) {
    if (!S.finding) enterFind();
    q().value = v; renderFind();
    if (focus) { q().focus({ preventScroll: true }); try { q().setSelectionRange(v.length, v.length); } catch (e) { /* ignore */ } }
  }

  // Each result: { html, run } — the first one is the top hit (Enter runs it).
  function results(text) {
    const t = text.trim(), out = [];
    const row = (icon, title, sub, run, cls = '', right = '') => out.push({ html: `<button class="f-row ${cls}" data-r="${out.length}">${icon}<span class="rt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span>${right}</button>`, run });
    const appRow = (a, sub) => row(`<span class="ri">${appIco(a)}</span>`, esc(a.label), sub || '', () => launchApp(a), '', '', a);
    if (t.startsWith('/')) {
      const m = t.slice(1).match(/^(\S*)(\s+([\s\S]*))?$/), name = norm(m[1]), rest = m[3] || '', hasSpace = !!m[2];
      const c = cmdByName(name);
      if (c && hasSpace) {
        if (c.sug) for (const s of c.sug(rest.trim())) row(s.icon || `<span class="ri cmd">/</span>`, s.k, s.d || '', () => (s.submit ? runText(s.fill) : setQuery(s.fill)));
        out.unshift({ html: '', run: () => runText(t) });
        out[0].html = `<button class="f-row" data-r="0"><span class="ri cmd">/</span><span class="rt"><b><code>${esc(t)}</code></b><span>${esc(c.d)}</span></span><span class="rk">go</span></button>`;
        reindex(out);
        return out;
      }
      const list = CMDS.filter(x => !x.hidden && (!name || x.n.startsWith(name) || arr(x.alias).some(al => al.startsWith(name))));
      for (const x of list) row(`<span class="ri cmd">/</span>`, `<code>/${esc(x.n)}</code>${x.a ? ` <span style="color:var(--ink-3)">${esc(x.a)}</span>` : ''}`, esc(x.d), () => (x.a && x.a[0] === '<' ? setQuery('/' + x.n + ' ') : runText('/' + x.n)));
      if (!list.length) row(`<span class="ri cmd">?</span>`, `No command called <code>/${esc(name)}</code>`, 'See every command', () => setQuery('/'));
      return out;
    }
    if (isMath(t)) { const v = calc(t); if (v != null) row(`<span class="ri cmd">=</span>`, esc(fmtNum(v)), esc(t), () => { B.copy(String(+v.toPrecision(12))); toast('Copied ' + fmtNum(v)); exitFind(); }, 'calc', `<span class="rk">copy</span>`); }
    const pool = S.pool ? S.pool : visApps();
    const apps = findApps(t, 8, pool);
    apps.forEach(a => appRow(a, spaceNames(a)));
    if (!S.pool) {
      for (const p of findContacts(t, 3)) row(av(p.name, 'round').replace('class="av', 'class="ri av'), esc(p.name), esc(p.phone),
        () => { B.call(p.phone); exitFind(); }, '', `<span class="mini" role="button" data-act="sms" data-v="${esc(p.phone)}" aria-label="Text ${esc(p.name)}">${ic('chat', 'sm')}</span><span class="mini" aria-hidden="true">${ic('phone', 'sm')}</span>`);
      const sp = findSpace(t);
      if (sp) { const i = pages().findIndex(p => p.id === sp.id); row(`<span class="ri">${ic('layers', 'sm')}</span>`, esc(sp.name), 'Go to this space', () => { exitFind(); goPage(i); }); }
      if (t.length >= 3) for (const n of findNotifs(t, 2)) { const a = appPkg(n.pkg); row(`<span class="ri">${appIco(a)}</span>`, esc(n.convo || n.title), esc(n.text), () => { B.notifOpen(n.id); exitFind(); }); }
      for (const nt of findNotes(t, 2)) row(`<span class="ri">${ic('note', 'sm')}</span>`, esc(nt.text.slice(0, 80)), 'Note · ' + esc(ago(nt.t)), () => { exitFind(); notesSheet(); });
      if (isEgg(t)) out.unshift({ html: '', run: () => runText(t) });
      row(`<span class="ri">${ic('globe', 'sm')}</span>`, `Search the web for “${esc(t)}”`, '', () => { B.web(t); exitFind(); });
      row(`<span class="ri">${ic('map', 'sm')}</span>`, `Find “${esc(t)}” in Maps`, '', () => { B.maps(t); exitFind(); });
    }
    if (out[0] && !out[0].html) out[0].html = `<button class="f-row" data-r="0"><span class="ri cmd">${ic('jack', 'sm')}</span><span class="rt"><b>${esc(t)}</b><span>Say it to ${esc(bot())}</span></span></button>`;
    reindex(out);
    return out;
  }
  function reindex(out) { out.forEach((r, i) => { r.html = r.html.replace(/data-r="\d+"/, `data-r="${i}"`); }); }
  const spaceNames = a => arr(D.spaces).filter(s => s.apps.includes(a.key)).map(s => s.name).join(' · ') || (arr(D.pinned).includes(a.key) ? 'Home' : '');

  function renderFind() {
    const f = $('#find'), t = q().value;
    if (!t.trim()) {
      // Nothing typed: every app A–Z, with what you opened lately right above the bar.
      const pool = (S.pool || visApps()).slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      const groups = new Map();
      for (const a of pool) { const L = /^[a-z]/i.test(a.label) ? a.label[0].toUpperCase() : '#'; if (!groups.has(L)) groups.set(L, []); groups.get(L).push(a); }
      const title = S.pool ? esc(pages().find(p => p.id === S.poolId)?.name || 'Apps') : 'All apps';
      const recent = S.pool ? [] : D.recent.map(appOf).filter(a => a && !isHidden(a.key)).slice(0, 8);
      f.innerHTML = `<div class="f-scroll has-az" id="fscroll"><div class="f-h"><span>${title}</span><span>${pool.length}</span></div>` +
        [...groups].map(([L, list]) => `<div class="az-letter" data-l="${L}">${L}</div><div class="az-grid">${list.map(a => tileHtml(a)).join('')}</div>`).join('') +
        `</div><div id="azstrip" aria-hidden="true">${[...groups.keys()].map(L => `<span data-l="${L}">${L}</span>`).join('')}</div>` +
        `<div class="f-foot">${recent.length ? `<div class="f-h" style="padding-top:2px">Recent</div><div class="recent">${recent.map(a => tileHtml(a)).join('')}</div>` : ''}` +
        `<div class="chips">${['/timer 25m', '/remind ', '/note ', '/event ', '/flash', '/help'].map(c => `<button class="chip" data-act="fill" data-v="${esc(c)}">${esc(c.trim())}</button>`).join('')}</div></div>`;
      S.results = [];
      wireAz();
      return;
    }
    S.results = results(t);
    f.innerHTML = `<div class="f-scroll rev" id="fscroll"><div class="f-sec">${S.results.map((r, i) => (i === 0 ? r.html.replace('class="f-row', 'class="f-row hi') : r.html)).reverse().join('')}</div></div>`;
    const sc = $('#fscroll'); sc.scrollTop = sc.scrollHeight;
  }
  function runTop() {
    const t = q().value.trim();
    if (!t) return;
    if (S.results[0]) S.results[0].run(); else runText(t);
  }
  // A–Z fast scroll on the right edge.
  function wireAz() {
    const strip = $('#azstrip'), sc = $('#fscroll'); if (!strip) return;
    let last = '', bub = null;
    const at = y => { const spans = [...strip.children]; let best = spans[0]; for (const s of spans) if (s.getBoundingClientRect().top <= y) best = s; return best; };
    const go = y => {
      const s = at(y); if (!s) return; const L = s.dataset.l;
      if (!bub) { bub = document.createElement('div'); bub.id = 'azbubble'; $('#find').appendChild(bub); }
      bub.textContent = L; bub.style.top = (s.getBoundingClientRect().top - $('#find').getBoundingClientRect().top - 20) + 'px';
      if (L !== last) { last = L; buzz(); const h = sc.querySelector(`.az-letter[data-l="${CSS.escape(L)}"]`); if (h) sc.scrollTop = h.offsetTop - 8; }
    };
    const end = () => { last = ''; if (bub) { bub.remove(); bub = null; } };
    strip.addEventListener('touchstart', e => { e.preventDefault(); go(e.touches[0].clientY); }, { passive: false });
    strip.addEventListener('touchmove', e => { e.preventDefault(); go(e.touches[0].clientY); }, { passive: false });
    strip.addEventListener('touchend', end); strip.addEventListener('touchcancel', end);
    strip.addEventListener('mousedown', e => { go(e.clientY); const mv = ev => go(ev.clientY), up = () => { end(); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
  }

  /* ---------- running what was typed ---------- */
  function runText(text) {
    const t = String(text).trim();
    exitFind();
    if (!t) return;
    if (t.startsWith('/')) return runCommand(t);
    if (egg(t)) return;
    const a = findApp(t); if (a) return launchApp(a);
    say(`Nothing called “${t}” here.`, { btns: [btn('Search the web', 'cmd', '/search ' + t, 'pri')] });
  }
  function launchApp(a) {
    if (!a) return;
    B.launch(a.key); buzz();
    D.recent = [a.key].concat(D.recent.filter(k => k !== a.key)).slice(0, 8);
    D.fresh = D.fresh.filter(k => k !== a.key);
    save(); exitFind(); hideAnswer();
  }

  /* ---------- Operator: the small talk it answers ---------- */
  function greet() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'; }
  const EIGHT = ['Yes. Stamp it.', 'Permit approved.', 'Not without a change order.', 'Ask again after coffee.', 'Absolutely.', 'The inspector says no.',
    'Looks good from here.', 'Wait for the resubmittal.', 'Hard no.', "Probably. Don't quote me.", 'Unclear. Check the drawings.', 'Yes, but bring the stamped set.',
    'Revise and resubmit.', 'Without a doubt.', 'Sleep on it.', 'The schedule says yes.'];
  const EGGS = [
    [/^(hello|hey|hey operator|hello operator|hola|buenas)$/, () => { const w = waitingCount(); say(`${greet()}, ${first(D.passport.name)}. ${w ? `${plural(w, 'thing')} waiting. Pull up to see.` : 'The board is quiet.'}`); }],
    [/^(thanks|thank you|thx|ty|gracias)$/, t => say(/gracias/.test(t) ? 'De nada.' : 'Anytime.')],
    [/^(who are you|operator|what is this|whats this|what's this)$/, () => say('Operator. I patch you through to your apps, your people and your phone. /help shows the whole board.')],
    [/^(good ?night|gn|buenas noches)$/, () => say(D.dnd ? 'Night. Do Not Disturb is already on.' : 'Night. Want Do Not Disturb on?', { btns: D.dnd ? [] : [btn('Turn it on', 'cmd', '/dnd on', 'pri')] })],
    [/^ping$/, () => say('pong')],
    [/^xyzzy$/, () => say('Nothing happens.')],
    [/^(i'?m bored|bored|surprise me)$/, () => { const pool = visApps().filter(a => !arr(D.pinned).includes(a.key)); const a = pick(pool.length ? pool : visApps()); if (a) say(`How about ${a.label}?`, { btns: [btn('Open ' + a.label, 'launch', a.key, 'pri'), btn('Roll instead', 'cmd', '/roll')] }); }],
    [/^sudo\b/, () => say('Permission denied. Nice try.')],
    [/^(che|che boludo)$/, () => say('¿Qué onda? /mate is ready when you are.')]
  ];
  const eggKey = text => norm(text).replace(/[.!?¡¿,]+/g, '').replace(/\s+/g, ' ').trim();
  const isEgg = text => EGGS.some(([re]) => re.test(eggKey(text)));
  function egg(text) { const k = eggKey(text), e = EGGS.find(([re]) => re.test(k)); if (!e) return false; e[1](k); return true; }

  /* ---------- reminders, mate ---------- */
  function parseRemind(r) {
    const w = r.trim().split(/\s+/);
    const i = norm(w[0]) === 'in' ? 1 : 0;
    const d = /^\d/.test(w[i] || '') ? parseDur(w[i]) : 0;
    if (d && /[a-z]/i.test(w[i]) && w.length > i + 1) return { at: now() + d * 1000, text: w.slice(i + 1).join(' ') };
    const pw = parseWhen(r);
    if ((pw.time || pw.date != null) && pw.title) {
      const t = pw.time || [9, 0];
      let day = pw.date;
      if (day == null) day = t[0] * 60 + t[1] <= new Date().getHours() * 60 + new Date().getMinutes() ? 1 : 0;
      const dt = new Date(startOfDay(day)); dt.setHours(t[0], t[1], 0, 0);
      return { at: dt.getTime(), text: pw.title };
    }
    return null;
  }
  function addReminder(at, text) {
    const r = { id: 'r' + now().toString(36) + Math.random().toString(36).slice(2, 5), at, text: text.slice(0, 200), done: false };
    D.reminders.push(r); save();
    B.remind(r.id, r.at, r.text);
    return r;
  }
  function cancelReminder(id) { D.reminders = D.reminders.filter(x => x.id !== id); B.cancelRemind(id); save(); }
  function checkReminders() {
    let fired = null;
    for (const r of D.reminders) {
      if (r.done || r.at > now()) continue;
      r.done = true; fired = r;
      say('', { id: 'rem-' + r.id, k: 'Reminder', title: r.text, rows: [['Set for', stamp(r.at)]], btns: [btn('Snooze 10 min', 'snooze', r.id), btn('Note it', 'note', r.text)] });
    }
    D.reminders = D.reminders.filter(r => !r.done || now() - r.at < 2 * DAY);
    if (fired) { save(); buzz('long'); }
  }
  const MATE_MAX = 12;
  function mateAnswer() {
    const n = D.mate.n;
    return { k: 'Mate', title: n ? `Cebada ${n}` : 'Ready', lines: [n >= MATE_MAX ? 'Lavado. Time for fresh yerba.' : n === 0 ? 'Water around 75 °C. Never boiling.' : n >= MATE_MAX - 2 ? 'Getting washed out.' : 'Next round whenever you are.'],
      btns: n >= MATE_MAX ? [btn('Fresh yerba', 'yerba', '', 'pri')] : [btn('Cebar', 'cebar', '', 'pri'), btn('Fresh yerba', 'yerba')] };
  }

/*@@PARSE@@*/

  /* ---------- commands ---------- */
  const CMDS = [];
  const def = (n, a, d, run, o = {}) => CMDS.push(Object.assign({ n, a, d, run }, o));
  const cmdByName = n => CMDS.find(c => c.n === n || arr(c.alias).includes(n));
  const appSug = (r, pool, verb) => findApps(r, 6, pool).map(a => ({ icon: `<span class="ri">${appIco(a)}</span>`, k: esc(a.label), fill: '/' + verb + ' ' + a.label, submit: true }));
  const optSug = (verb, list, r, submit = true) => list.filter(x => norm(x).startsWith(norm(r))).map(x => ({ k: `<code>/${esc(verb)} ${esc(x)}</code>`, fill: '/' + verb + ' ' + x + (submit ? '' : ' '), submit }));
  const noApp = r => say(`Nothing installed matches “${r}”.`, { btns: [btn('Search the web', 'cmd', '/search ' + r, 'pri')] });
  const withApp = (r, fn, pool) => { const a = findApps(r, 1, pool || visApps())[0]; if (a && score(a.label, r) >= 15) fn(a); else noApp(r); };
  function runCommand(text) {
    const m = text.slice(1).match(/^(\S*)\s*([\s\S]*)$/);
    const name = norm(m[1]), rest = m[2].trim();
    const c = cmdByName(name);
    if (!c) {
      const near = CMDS.filter(x => !x.hidden && lev(x.n, name) <= 2).slice(0, 2);
      return say(`There's no /${name} command.`, { btns: near.map(x => btn('/' + x.n, 'fill', '/' + x.n + (x.a ? ' ' : ''))).concat([btn('All commands', 'cmd', '/help')]) });
    }
    if (c.a && c.a[0] === '<' && !rest) return setQuery('/' + c.n + ' ');
    try { c.run(rest, c); } catch (e) { console.error(e); say('That command failed: ' + (e && e.message ? e.message : 'unknown error')); }
  }

  // Apps and people
  def('open', '<app>', 'Open an app', r => withApp(r, launchApp), { group: 'Apps', sug: r => appSug(r, visApps(), 'open') });
  def('search', '<query>', 'Search the web', r => B.web(r), { group: 'Apps' });
  def('map', '<place>', 'Look up a place in Maps', r => B.maps(r), { group: 'Apps', alias: ['maps'] });
  def('call', '<name or number>', 'Call someone', r => {
    const p = findContacts(r, 1)[0], num = p ? p.phone : (/\d{3}/.test(r) ? r : null);
    if (!num) return say(`No favorite contact matches “${r}”. Star them in Contacts, or type the number.`);
    B.call(num);
  }, { group: 'People', sug: r => findContacts(r, 5).map(p => ({ icon: av(p.name, 'round').replace('class="av', 'class="ri av'), k: esc(p.name), d: esc(p.phone), fill: '/call ' + p.name, submit: true })) });
  def('text', '<name> <message>', 'Start a text message', r => {
    const { p, body } = splitContact(r);
    const num = p ? p.phone : (r.match(/^[+\d()\s-]{7,}/) || [])[0];
    if (!num) return say(`No favorite contact matches “${r}”.`);
    B.sms(String(num).trim(), p ? body : r.slice(num.length).trim());
  }, { group: 'People', sug: r => { const sp = splitContact(r); return sp.p && r.length > sp.p.name.length ? [] : findContacts(r, 5).map(p => ({ icon: av(p.name, 'round').replace('class="av', 'class="ri av'), k: esc(p.name), fill: '/text ' + p.name + ' ', submit: false })); } });
  // Time
  def('timer', '<10m · 1h30m · 90s>', 'Start a timer', r => {
    const s = parseDur(r);
    if (!s) return say(`I can't read “${r}” as a length of time. Try 10m, 1h30m or 90s.`);
    B.timer(s, 'Switchboard');
    D.timer = { end: now() + s * 1000, len: s }; save();
    say('', { id: 'timer', k: 'Timer', title: fmtDur(s), rows: [['Ends', clock(now() + s * 1000)]], btns: [btn('Open Clock', 'find', 'clock')] });
  }, { group: 'Time', sug: r => optSug('timer', ['5m', '10m', '15m', '25m', '45m', '1h'], r) });
  def('alarm', '<7:30 · 6am · 18:45> [label]', 'Set an alarm', r => {
    const w = r.split(/\s+/); let t = parseClock(w[0] || ''), used = 1;
    if (!t && w[1]) { t = parseClock(w[0] + w[1]); used = 2; }
    if (!t) return say(`I can't read “${r}” as a time. Try 6:30am or 18:45.`);
    const label = w.slice(used).join(' ');
    B.alarm(t[0], t[1], label || 'Switchboard');
    const d = new Date(); d.setHours(t[0], t[1], 0, 0); if (d.getTime() <= now()) d.setDate(d.getDate() + 1);
    say('', { k: 'Alarm', title: clock(d.getTime()), rows: [['Rings', dayLabel(d.getTime())]].concat(label ? [['Label', label]] : []) });
  }, { group: 'Time', sug: r => optSug('alarm', ['6am', '6:30am', '7am', '7:30am', '8am'], r) });
  def('remind', '<20m · 5pm · fri 9am> <what>', 'Remind you later', r => {
    const p = parseRemind(r);
    if (!p) return say('Try /remind 20m call Marco, /remind 5pm pick up keys, or /remind tomorrow 9am send invoice.');
    const x = addReminder(p.at, p.text);
    say('', { k: 'Reminder set', title: x.text, rows: [['When', stamp(x.at)]], btns: [btn('Cancel', 'unremind', x.id)] });
  }, { group: 'Time', sug: r => (/\s/.test(r) ? [] : optSug('remind', ['10m', '20m', '1h', 'tonight', 'tomorrow'], r, false)) });
  def('reminders', '', 'Reminders still to come', () => {
    const list = D.reminders.filter(x => !x.done).sort((a, b) => a.at - b.at);
    if (!list.length) return say('No reminders coming up. Set one with /remind.');
    say('', { k: 'Coming up', rows: list.slice(0, 8).map(x => [stamp(x.at), x.text]) });
  }, { group: 'Time' });
  def('event', '<title> <when>', 'Add to your calendar', r => {
    const w = parseWhen(r);
    if (!w.title) return say('Give it a name, like /event Dinner with Lucas fri 7pm');
    let day = w.date;
    if (day == null) day = w.time && w.time[0] * 60 + w.time[1] <= new Date().getHours() * 60 + new Date().getMinutes() ? 1 : 0;
    const d = new Date(startOfDay(day)); if (w.time) d.setHours(w.time[0], w.time[1]);
    const start = d.getTime(), allDay = !w.time, end = allDay ? startOfDay(day + 1) : start + HOUR;
    B.newEvent(w.title, start, end, allDay);
    say('', { k: 'New event', title: w.title, rows: [['When', dayLabel(start) + (allDay ? ' · all day' : ' · ' + clock(start))]], lines: ['Your calendar opens with this filled in. Save it there.'] });
  }, { group: 'Time' });
  def('week', '', 'Your week', () => agendaSheet(), { group: 'Time', alias: ['agenda', 'calendar'] });
  // Notes and sums
  def('note', '<text>', 'Save a note', r => { addNote(r); toast('Saved to notes'); }, { group: 'Notes' });
  def('notes', '', 'Your notes', () => notesSheet(), { group: 'Notes' });
  def('calc', '<sum>', 'Work something out (or just type it)', r => { const v = calc(r); say('', v == null ? { text: `I can't work out “${r}”.` } : { k: r, title: '= ' + fmtNum(v), btns: [btn('Copy', 'copy', String(+v.toPrecision(12)))] }); }, { group: 'Notes' });
  // Phone
  def('flash', '[on · off]', 'Flashlight', r => {
    const on = r ? /^(on|1|yes)$/i.test(r) : !S.torch;
    if (B.torch(on) === false) return say("This phone wouldn't switch the flashlight.");
    S.torch = on; toast(on ? 'Flashlight on' : 'Flashlight off');
  }, { group: 'Phone', alias: ['torch', 'flashlight'] });
  def('dnd', '[on · off]', 'Do Not Disturb', r => setDnd(r ? /^(on|1|yes)$/i.test(r) : !D.dnd), { group: 'Phone' });
  def('settings', '[wifi · bluetooth · display · sound · battery · apps]', 'Open system settings', r => B.settings(norm(r) || 'main'),
    { group: 'Phone', sug: r => optSug('settings', ['wifi', 'bluetooth', 'display', 'sound', 'battery', 'apps', 'home'], r) });
  def('shade', '', 'Pull down notifications', () => B.shade(), { group: 'Phone' });
  def('battery', '', 'Battery level', () => {
    const b = B.battery() || S.battery || {}; S.battery = b;
    say('', { k: 'Battery', title: (b.pct != null ? b.pct : '–') + '%', rows: [['State', b.charging ? 'Charging' : 'On battery']] });
  }, { group: 'Phone' });
  // Organize
  def('pin', '<app>', 'Pin an app to Home', r => withApp(r, pinApp), { group: 'Organize', sug: r => appSug(r, visApps().filter(a => !arr(D.pinned).includes(a.key)), 'pin') });
  def('unpin', '<app>', 'Take an app off Home', r => withApp(r, unpinApp, pinnedApps()), { group: 'Organize', sug: r => appSug(r, pinnedApps(), 'unpin') });
  def('move', '<app> to <space>', 'Put an app in a space', r => {
    const m = r.match(/^(.*)\s+to\s+(.+)$/i);
    if (!m) return say('Use /move <app> to <space>');
    const sp = findSpace(m[2]); if (!sp) return say(`There's no space called “${m[2]}”.`);
    withApp(m[1], a => { if (!sp.apps.includes(a.key)) sp.apps.push(a.key); save(); renderPages(); toast(`${a.label} is in ${sp.name}`); });
  }, { group: 'Organize' });
  def('space', '<new · rename · delete> <name>', 'Manage spaces', r => {
    const m = r.match(/^(\S+)\s*(.*)$/), verb = norm(m ? m[1] : ''), arg = m ? m[2].trim() : '';
    if (/^(new|add|create)$/.test(verb)) { if (!arg) return say('Name it, like /space new Travel'); const sp = createSpace(arg); goPage(pages().findIndex(p => p.id === sp.id)); return pickerSheet(sp.id); }
    if (verb === 'rename') {
      const mm = arg.match(/^(.*?)\s+to\s+(.+)$/i), sp = mm && findSpace(mm[1]);
      if (!sp) return say('Use /space rename <space> to <new name>');
      sp.name = mm[2].slice(0, 40); save(); renderPages(); return toast('Renamed to ' + sp.name);
    }
    if (/^(delete|remove)$/.test(verb)) { const sp = findSpace(arg); if (!sp) return say(`There's no space called “${arg}”.`); deleteSpace(sp.id); return toast(`Deleted ${sp.name}`); }
    say('Use /space new, /space rename or /space delete.');
  }, { group: 'Organize', sug: r => (/\s/.test(r) ? [] : optSug('space', ['new', 'rename', 'delete'], r, false)) });
  def('hide', '<app>', 'Hide an app everywhere', r => withApp(r, hideApp), { group: 'Organize', sug: r => appSug(r, visApps(), 'hide') });
  def('unhide', '<app>', 'Show a hidden app again', r => withApp(r, a => { D.hidden = D.hidden.filter(k => k !== a.key); save(); renderPages(); toast(a.label + ' is back'); }, S.apps.filter(a => isHidden(a.key))),
    { group: 'Organize', sug: r => appSug(r, S.apps.filter(a => isHidden(a.key)), 'unhide') });
  def('mute', '<app>', 'Stop badges from an app', r => withApp(r, a => { if (!muted(a.pkg)) D.muted.push(a.pkg); save(); renderAll(); toast('Muted ' + a.label); }), { group: 'Organize', sug: r => appSug(r, visApps(), 'mute') });
  def('unmute', '<app>', 'Show badges from an app again', r => withApp(r, a => { D.muted = D.muted.filter(p => p !== a.pkg); save(); renderAll(); toast('Unmuted ' + a.label); }), { group: 'Organize', sug: r => appSug(r, visApps().filter(a => muted(a.pkg)), 'unmute') });
  def('info', '<app>', 'App info in system settings', r => withApp(r, a => B.appInfo(a.pkg)), { group: 'Organize', sug: r => appSug(r, visApps(), 'info') });
  def('uninstall', '<app>', 'Uninstall an app', r => withApp(r, a => B.uninstall(a.pkg)), { group: 'Organize', sug: r => appSug(r, visApps(), 'uninstall') });
  // Fun
  def('roll', '[2d20 · 100]', 'Roll dice', r => {
    const m = norm(r).match(/^(\d*)d(\d+)$/) || norm(r).match(/^()(\d+)$/);
    const n = Math.min(20, Math.max(1, m && m[1] ? +m[1] : 1)), sides = Math.min(1000, Math.max(2, m ? +m[2] : 6));
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
    say('', { k: `${n}d${sides}`, title: String(rolls.reduce((a, b) => a + b, 0)), lines: n > 1 ? [rolls.join(' + ')] : [], btns: [btn('Roll again', 'cmd', '/roll ' + (r || ''))] });
  }, { group: 'Fun' });
  def('flip', '', 'Flip a coin', () => say('', { k: 'Coin', title: Math.random() < 0.5 ? 'Heads' : 'Tails', btns: [btn('Flip again', 'cmd', '/flip')] }), { group: 'Fun' });
  def('8ball', '<question>', 'Ask a yes-or-no question', r => say('', { k: r.slice(0, 80), title: pick(EIGHT) }), { group: 'Fun' });
  def('mate', '', 'Count cebadas', () => {
    if (!D.mate || now() - D.mate.t > 3 * HOUR) D.mate = { n: 0, t: now() };
    D.mate.t = now(); save();
    say('', Object.assign({ id: 'mate' }, mateAnswer()));
  }, { group: 'Fun' });
  // Launcher
  def('theme', '<auto · dark · black · light>', 'Appearance', r => {
    const k = norm(r);
    if (!['auto', 'dark', 'black', 'light'].includes(k)) return say('Pick auto, dark, black or light.');
    D.skin = k; save(); applySkin(); toast('Theme: ' + k);
  }, { group: 'Launcher', sug: r => optSug('theme', ['auto', 'dark', 'black', 'light'], r) });
  def('accent', '<brass · mint · signal · orchid · ember · lime · ice · rose>', 'Accent color', r => {
    const k = norm(r);
    if (!ACCENTS[k]) return say('Pick one of: ' + Object.keys(ACCENTS).join(', ') + '.');
    D.fun.accent = k; save(); applySkin(); toast('Accent: ' + ACCENTS[k][2]);
  }, { group: 'Launcher', sug: r => optSug('accent', Object.keys(ACCENTS), r) });
  def('name', '<your name>', 'Change the name on your passport', r => { D.passport.name = r.slice(0, 40); save(); renderTop(); toast('Name: ' + D.passport.name); }, { group: 'Launcher' });
  def('status', '<text>', 'Set the bubble on your passport', r => { D.passport.status = r.slice(0, 90); save(); toast(r ? 'Status set' : 'Status cleared'); }, { group: 'Launcher' });
  def('update', '[app · page · reset]', 'Get the newest Switchboard from GitHub', r => {
    const k = norm(r);
    if (k === 'reset') { say('Going back to the page built into the app…'); return setTimeout(() => B.resetPage(), 400); }
    startUpdate(k === 'page' ? 'page' : 'app', k === 'app');
  }, { group: 'Launcher', sug: r => optSug('update', ['app', 'page', 'reset'], r) });
  def('clear', '', "Clear what I've said", () => { D.answers = []; save(); hideAnswer(); toast('Cleared'); }, { group: 'Launcher' });
  def('help', '', 'Every command', () => helpSheet(), { group: 'Launcher' });
  def('whoami', '', '', () => youSheet(), { hidden: true });

  /* ---------- updates (same flow as v0.4, shown as one answer that changes) ---------- */
  function updCard(o) { say('', Object.assign({ id: 'upd' }, o)); }
  function startUpdate(what, appOnly) {
    S.updAppOnly = !!appOnly;
    updCard({ k: 'Update', title: 'Checking GitHub…', lines: [what === 'page' ? 'Looking for a newer page.' : 'Looking for a newer version of the app, then the page.'] });
    B.checkUpdate(what);
  }
  const UPD_ROWS = () => { const i = B.updateInfo() || {}; return [['App', i.app || B.version() || '?'], ['Page', i.onLive ? 'from GitHub' + (i.pageAt ? ', ' + stamp(i.pageAt) : '') : 'built in']]; };
  function onUpdate(u) {
    if (!u || !u.kind) return;
    const P = u.kind === 'page', E = (title, lines, extra = {}) => Object.assign({ k: P ? 'Page update' : 'App update', title, lines: lines || [], btns: [] }, extra);
    switch (u.state) {
      case 'checking': return updCard(E('Checking GitHub…'));
      case 'available': return updCard(E(`Switchboard ${u.version} is out`, ['Android asks you to confirm the install. Your spaces, passport and settings stay.'],
        { rows: [['You have', u.from], ['Size', u.size ? (u.size / 1e6).toFixed(1) + ' MB' : '–']], btns: [btn('Download and install', 'upd-install', '', 'pri'), btn('Not now', 'answer-close')] }));
      case 'current':
        if (!P && !S.updAppOnly) { updCard(E('App is up to date', ['Checking the page next…'])); return B.checkUpdate('page'); }
        return updCard(E("You're up to date", [], { rows: UPD_ROWS() }));
      case 'downloading': return updCard(E(u.pct >= 0 ? `Downloading ${u.pct}%` : 'Downloading…', [`Switchboard ${u.version || ''}`]));
      case 'installing': return updCard(E('Opening the installer…'));
      case 'confirm': return updCard(E('Tap Install on the Android screen', ['Switchboard closes for a moment while it updates, then comes right back.']));
      case 'done': return updCard(E('Installed', ['Switchboard is restarting on the new version.']));
      case 'canceled': return updCard(E('Install canceled', [], { btns: [btn('Try again', 'upd-install', '', 'pri')] }));
      case 'busy': return toast('Already downloading');
      case 'needs-permission': return updCard(E('One-time permission', ['Android opened a screen: turn on “Allow from this source” for Switchboard, come back, and tap Try again.'], { btns: [btn('Try again', 'upd-install', '', 'pri')] }));
      case 'ready': return updCard(E('New page downloaded', ['Switch now, or it switches by itself next time you come home.'], { btns: [btn('Switch now', 'upd-apply', '', 'pri')] }));
      case 'rolled-back': return say("The newest page from GitHub didn't start, so I went back to the one built into the app. Nothing was lost.");
      case 'error': return updCard(E(u.code === 'key' ? 'Needs one reinstall' : "Couldn't update", [u.msg || 'Something went wrong.'],
        { btns: u.code === 'key' ? [btn('Open releases', 'url', 'https://github.com/jere-mee-as/switchboard/releases/latest', 'pri')] : [btn('Try again', 'cmd', '/update')] }));
    }
  }
  function noteNewPage() {
    const i = B.updateInfo() || {}, sha = i.onLive ? i.pageSha : 'built-in:' + (i.app || B.version());
    const was = store.get('pageSha', null);
    store.set('pageSha', sha);
    if (was && was !== sha) setTimeout(() => toast(i.onLive ? 'Switchboard updated' : `Switchboard ${i.app || ''} is ready`), 900);
  }

  /* ---------- organizing ---------- */
  function pinApp(a) { D.pinned = arr(D.pinned); if (!D.pinned.includes(a.key)) D.pinned.push(a.key); save(); renderPages(); toast(`Pinned ${a.label} to Home`); }
  function unpinApp(a) { D.pinned = arr(D.pinned).filter(k => k !== a.key); save(); renderPages(); toast(`Took ${a.label} off Home`); }
  function hideApp(a) { if (!D.hidden.includes(a.key)) D.hidden.push(a.key); save(); renderPages(); toast(`Hid ${a.label}. /unhide brings it back.`); }
  function createSpace(name) { if (!Array.isArray(D.spaces)) D.spaces = []; const sp = { id: uid(name), name: String(name).slice(0, 40), glyph: '', apps: [] }; D.spaces.push(sp); save(); renderPages(); return sp; }
  function deleteSpace(id) { const i = pages().findIndex(p => p.id === id); D.spaces = D.spaces.filter(s => s.id !== id); save(); if (S.page >= i) S.page = Math.max(0, S.page - 1); renderPages(); }
  function addNote(text) { D.notes.push({ id: 'nt' + now().toString(36), t: now(), text: text.slice(0, 4000), pin: false }); if (D.notes.length > 500) D.notes.shift(); save(); }
  function setDnd(on) {
    const ok = B.setDnd(!!on);
    if (ok === false || ok === null) { toast('Allow Do Not Disturb access first'); B.askPerm('dnd'); return; }
    D.dnd = !!on; save(); renderTop();
    toast(on ? 'Do Not Disturb on' : 'Do Not Disturb off');
    if (S.sheet === 'you') youSheet();
  }
  function applySkin() {
    const app = $('#app');
    if (D.skin && D.skin !== 'auto') app.dataset.skin = D.skin; else delete app.dataset.skin;
    app.dataset.motion = D.fun.motion || 'calm';
    const a = ACCENTS[D.fun.accent], props = ['--brass', '--brass-ink', '--lamp', '--lamp-glow'];
    if (a && D.fun.accent !== 'brass') [a[0], a[1], a[0], a[0] + '80'].forEach((v, i) => app.style.setProperty(props[i], v));
    else props.forEach(p => app.style.removeProperty(p));
  }

  /* ---------- sheets ---------- */
  function openSheet(kind, html, o = {}) {
    if (S.finding) exitFind();
    const sh = $('#sheet');
    S.sheet = kind;
    sh.classList.toggle('above-bar', !!o.aboveBar);
    $('#app').classList.toggle('bar-up', !!o.aboveBar);
    $('#sheetBody').innerHTML = html;
    $('#sheetBody').scrollTop = 0;
    sh.style.transform = '';
    sh.classList.add('on');
    $('#scrim').classList.add('on'); $('#scrim').classList.toggle('soft', !!o.aboveBar);
    hideAnswer();
  }
  function refreshSheet(html) { const b = $('#sheetBody'), y = b.scrollTop; b.innerHTML = html; b.scrollTop = y; }
  function closeSheet(keepReply) {
    if (!S.sheet) return;
    S.sheet = null;
    const sh = $('#sheet'); sh.classList.remove('on', 'drag'); sh.style.transform = ''; $('#app').classList.remove('bar-up');
    if (!S.player) $('#scrim').classList.remove('on', 'soft');
    if (!keepReply && S.reply) { S.reply = null; q().value = ''; q().blur(); renderBar(); }
  }
  const head = (title, right = '') => `<div class="sh-title"><h2>${title}</h2>${right}</div>`;

  /* waiting: people first, then everything else, then what your phone is holding for you */
  function waitingHtml(inSide) {
    let h = inSide ? '' : head('Waiting', waitingCount() ? '<button class="bt ghost" data-act="clear-all">Clear all</button>' : '');
    if (inSide) h += `<div class="sh-title"><h2>Waiting</h2>${waitingCount() ? '<button class="bt ghost" data-act="clear-all">Clear all</button>' : ''}</div>`;
    if (S.perms.notif === false) h += `<div class="perm"><b>See everything that comes in</b>Switchboard needs notification access to show messages here and reply to them.<div class="btns"><button class="bt pri" data-act="perm" data-v="notif">Allow access</button></div></div>`;
    const cs = convos(), os = others();
    if (cs.length) {
      h += `<div class="sec-h">People <span class="n">${cs.length}</span></div>`;
      h += cs.map(c => {
        const a = appPkg(c.pkg), items = c.items.filter(n => n.live).slice(-3), sent = arr(S.sent[c.key]);
        const target = c.items.filter(n => n.live && n.canReply).sort((x, y) => y.time - x.time)[0];
        const lines = items.map(n => `<div class="cv-line">${c.group && n.person ? `<em>${esc(n.person)}:</em> ` : ''}${esc(n.text)}</div>`).join('') +
          sent.map(s => `<div class="cv-line me">${esc(s)}</div>`).join('');
        return `<div class="cv${S.reply && convoKey(S.reply) === c.key ? ' replying' : ''}">${av(c.name, 'round')}<div class="cv-main"><div class="cv-head"><b>${esc(c.name)}</b><span>${esc(a ? a.label : '')}</span><time>${esc(ago(c.last.time))}</time></div>${lines}` +
          `<div class="btns">${target ? `<button class="bt" data-act="reply" data-v="${esc(target.id)}">${ic('reply')}Reply</button>` : ''}` +
          `<button class="bt" data-act="nopen" data-v="${esc(c.last.id)}">Open</button><button class="bt ghost" data-act="cv-done" data-v="${esc(c.key)}">Done</button></div></div></div>`;
      }).join('');
    }
    if (os.length) {
      h += `<div class="sec-h">Everything else <span class="n">${os.reduce((s, g) => s + g.items.length, 0)}</span></div>`;
      h += os.map(g => {
        const a = appPkg(g.pkg), n = g.last, acts = arr(n.actions).slice(0, 2);
        return `<div class="ag"><span class="gi">${appIco(a)}</span><button class="gm" data-act="nopen" data-v="${esc(n.id)}" style="text-align:left"><div class="cv-head"><b>${esc(a ? a.label : n.pkg)}</b>${g.items.length > 1 ? `<span>${g.items.length}</span>` : ''}<time>${esc(ago(n.time))}</time></div>` +
          `<div class="cv-line" style="color:var(--ink)">${esc(n.title)}</div>${n.text ? `<div class="cv-line">${esc(n.text)}</div>` : ''}</button>` +
          `<button class="x" data-act="ag-done" data-v="${esc(g.pkg)}" aria-label="Clear ${esc(a ? a.label : '')}">${ic('x', 'sm')}</button></div>` +
          (acts.length ? `<div class="btns" style="margin:-4px 0 8px 44px">${acts.map((t, i) => `<button class="bt" data-act="naction" data-v="${esc(n.id)}" data-i="${i}">${esc(t)}</button>`).join('')}</div>` : '');
      }).join('');
    }
    // Your phone: timers, reminders and the last thing the phone told you.
    const ph = [];
    if (D.timer && D.timer.end > now()) ph.push(`<div class="ph"><span class="gi">${ic('timer')}</span><span class="tx">Timer<small>Ends ${esc(clock(D.timer.end))}</small></span><span class="mono" data-countdown="${D.timer.end}">${esc(fmtDur(Math.round((D.timer.end - now()) / 1000)))}</span></div>`);
    for (const r of D.reminders.filter(x => !x.done).sort((a, b) => a.at - b.at).slice(0, 4)) ph.push(`<div class="ph"><span class="gi">${ic('alarm')}</span><span class="tx">${esc(r.text)}<small>${esc(stamp(r.at))}</small></span><button class="bt ghost" data-act="unremind" data-v="${esc(r.id)}">Cancel</button></div>`);
    if (D.dnd) ph.push(`<div class="ph"><span class="gi">${ic('moon')}</span><span class="tx">Do Not Disturb is on</span><button class="bt ghost" data-act="cmd" data-v="/dnd off">Turn off</button></div>`);
    const lastA = D.answers.filter(a => now() - a.t < 12 * HOUR).slice(-2).reverse();
    for (const a of lastA) ph.push(`<button class="ph" data-act="answer-show" data-v="${esc(a.id)}" style="width:100%;text-align:left"><span class="gi">${ic('jack')}</span><span class="tx">${esc(a.title || a.text || a.k || '')}<small>${esc(bot())} · ${esc(ago(a.t))}</small></span></button>`);
    if (ph.length) h += `<div class="sec-h">Your phone</div>` + ph.join('');
    if (!cs.length && !os.length && S.perms.notif !== false) h += `<div class="quiet" style="padding:${ph.length ? '14px' : '4px'} 2px 8px">Nothing waiting. ${ph.length ? '' : 'The board is quiet.'}</div>`;
    // Earlier: what already left the shade in the last day.
    const old = S.notifs.filter(n => !n.live && !muted(n.pkg) && now() - n.time < DAY).sort((a, b) => b.time - a.time);
    if (old.length) {
      h += `<button class="earlier-tg" data-act="earlier">${ic(S.showEarlier ? 'chev' : 'chev-r', 'xs')}Earlier today · ${old.length}</button>`;
      if (S.showEarlier) h += old.slice(0, 20).map(n => { const a = appPkg(n.pkg); return `<button class="row" data-act="nopen" data-v="${esc(n.id)}"><span class="ri">${appIco(a)}</span><span class="rt"><b>${esc(n.convo || n.title)}</b><small>${esc(n.text || '')}</small></span><span class="rr">${esc(ago(n.time))}</span></button>`; }).join('');
    }
    return h;
  }
  function openWaiting() {
    if (S.wide) return;
    openSheet('waiting', waitingHtml(), { aboveBar: true });
  }
  function renderSide() {
    if (!S.wide) return;
    const m = S.media;
    $('#sideNow').innerHTML = m ? `<div class="nowcard"><button class="art" data-act="player" aria-label="Open the player">${m.art ? `<img src="${esc(m.art)}" alt="">` : ''}</button><div class="meta"><b>${esc(m.title)}</b><span>${esc(m.artist || '')}</span>` +
      `<div class="ctl"><button class="ctlb" data-act="media" data-v="prev" aria-label="Previous">${ic('prev')}</button><button class="ctlb play" data-act="media" data-v="toggle" aria-label="${m.playing ? 'Pause' : 'Play'}">${ic(m.playing ? 'pause' : 'play')}</button><button class="ctlb" data-act="media" data-v="next" aria-label="Next">${ic('next')}</button></div></div></div>` : '';
    const b = $('#sideBody'), y = b.scrollTop;
    b.innerHTML = waitingHtml(true);
    b.scrollTop = y;
  }
  function startReply(id) {
    const n = S.notifs.find(x => x.id === String(id));
    if (!n || !n.live || !n.canReply) return toast('That one no longer takes replies.');
    S.reply = n; renderBar(); refreshWaiting();
    q().value = ''; q().focus({ preventScroll: true });
  }
  function sendReply(text) {
    const n = S.reply; if (!n || !text.trim()) return;
    const a = appPkg(n.pkg), ok = !!B.notifReply(n.id, text);
    S.reply = null; q().value = ''; q().blur(); renderBar();
    if (ok) { const k = convoKey(n); S.sent[k] = arr(S.sent[k]).concat([text]).slice(-3); toast('Sent through ' + (a ? a.label : 'the app')); }
    else say('That notification no longer takes replies. It may have been cleared.', { btns: (a ? [btn('Open ' + a.label, 'launch', a.key, 'pri')] : []).concat([btn('Copy text', 'copy', text)]) });
    if (S.sheet === 'waiting') refreshSheet(waitingHtml());
    renderSide();
  }

  function agendaSheet() {
    let h = head('This week', `<button class="bt" data-act="fill" data-v="/event ">${ic('plus')}New</button>`);
    if (S.perms.calendar === false) h += `<div class="perm"><b>Your calendar</b>Allow calendar access to see your week here.<div class="btns"><button class="bt pri" data-act="perm" data-v="calendar">Allow</button></div></div>`;
    const evs = upcoming(8);
    if (S.perms.calendar !== false && !evs.length) h += '<div class="quiet">Nothing on the calendar this week.</div>';
    let day = '';
    for (const e of evs) {
      const k = dayKey(Math.max(e.start, startOfDay(0)));
      if (k !== day) { day = k; h += `<div class="day-h">${esc(dayLabel(Math.max(e.start, startOfDay(0))))}</div>`; }
      h += `<button class="ev" data-act="event" data-v="${esc(e.id)}"><span class="tm">${e.allDay ? 'all day' : esc(clockS(e.start))}</span><span class="bar" style="background:${safeColor(e.color)}"></span><span class="rt"><b>${esc(e.title)}</b>${e.loc ? `<small>${esc(e.loc)}</small>` : ''}</span></button>`;
    }
    openSheet('agenda', h);
  }
  function spacesSheet() {
    const ps = pages();
    let h = head('Spaces', `<button class="bt" data-act="space-new">${ic('plus')}New</button>`);
    h += ps.map((p, i) => `<div style="display:flex;align-items:center;gap:4px"><button class="row ${i === S.page ? 'on' : ''}" data-act="go" data-v="${i}">` +
      `<span class="ri">${p.id === 'home' ? ic('home', 'sm') : (p.apps[0] ? appIco(p.apps[0]) : ic('layers', 'sm'))}</span><span class="rt"><b>${esc(p.name)}</b><small>${plural(p.apps.length, 'app')}</small></span>${pageLit(p) ? '<span class="lampdot"></span>' : ''}</button>` +
      (p.id !== 'home' ? `<button class="more" data-act="space-opts" data-v="${esc(p.id)}" aria-label="${esc(p.name)} options">${ic('dots')}</button>` : '<span style="width:40px;flex:none"></span>') + '</div>').join('');
    h += '<div class="quiet">Swipe sideways on Home to move between these.</div>';
    openSheet('spaces', h);
  }
  function spaceOptsSheet(id, renaming) {
    const sp = spaceOf(id); if (!sp) return spacesSheet();
    const i = D.spaces.indexOf(sp);
    let h = head(esc(sp.name));
    if (renaming) h += `<span class="lbl-s">Name</span><div style="display:flex;gap:8px"><input class="inp" id="spName" maxlength="40" value="${esc(sp.name)}"><button class="bt pri" data-act="space-rename" data-v="${esc(id)}" style="height:46px">Save</button></div>`;
    else h += `<button class="row" data-act="space-rename-start" data-v="${esc(id)}"><span class="ri">${ic('edit', 'sm')}</span><span class="rt"><b>Rename</b></span></button>`;
    h += `<button class="row" data-act="picker" data-v="${esc(id)}"><span class="ri">${ic('grid', 'sm')}</span><span class="rt"><b>Add or remove apps</b><small>${plural(spaceApps(sp).length, 'app')}</small></span></button>`;
    h += `<span class="lbl-s">Order</span><div class="seg"><button class="${sp.sort !== 'custom' ? 'on' : ''}" data-act="space-sort" data-v="az" data-id="${esc(id)}">A–Z</button><button class="${sp.sort === 'custom' ? 'on' : ''}" data-act="space-sort" data-v="custom" data-id="${esc(id)}">Your order</button></div>`;
    h += `<div class="quiet">Hold an app and drag it to put it in your own order.</div>`;
    h += `<div class="btns" style="margin-top:14px"><button class="bt" data-act="space-move" data-v="-1" data-id="${esc(id)}" ${i === 0 ? 'disabled style="opacity:.4"' : ''}>${ic('up')}Earlier</button><button class="bt" data-act="space-move" data-v="1" data-id="${esc(id)}" ${i === D.spaces.length - 1 ? 'disabled style="opacity:.4"' : ''}>${ic('down')}Later</button>` +
      `<button class="bt ghost" data-act="space-delete" data-v="${esc(id)}" style="color:var(--call)">${ic('trash')}Delete</button></div>`;
    openSheet('space-opts', h);
    if (renaming) setTimeout(() => { const el = $('#spName'); if (el) { el.focus(); el.select(); } }, 60);
  }
  function pickerSheet(id, filter = '') {
    const sp = spaceOf(id); if (!sp) return;
    S.pickFor = id;
    const inSp = new Set(sp.apps), f = norm(filter);
    const list = visApps().filter(a => !f || score(a.label, f) > 0).sort((a, b) => (inSp.has(b.key) - inSp.has(a.key)) || a.label.localeCompare(b.label));
    const rows = list.map(a => `<button class="row" data-act="pick-toggle" data-v="${esc(a.key)}"><span class="ri">${appIco(a)}</span><span class="rt"><b>${esc(a.label)}</b></span><span class="check ${inSp.has(a.key) ? 'on' : ''}">${ic('check')}</span></button>`).join('');
    const html = head(`Apps in ${esc(sp.name)}`, `<button class="bt pri" data-act="sheet-close">Done</button>`) +
      `<input class="inp" id="pickQ" placeholder="Filter apps" value="${esc(filter)}" style="margin-bottom:8px"><div id="pickList">${rows}</div>`;
    if (S.sheet === 'picker') { $('#pickList').innerHTML = rows; return; }
    openSheet('picker', html);
    $('#pickQ').addEventListener('input', e => pickerSheet(id, e.target.value));
  }
  function appSheet(key) {
    const a = appOf(key); if (!a) return;
    const pinned = arr(D.pinned).includes(key);
    let h = `<div class="sh-title"><span class="ri" style="width:48px;height:48px;border-radius:var(--icon-r);overflow:hidden;flex:none">${appIco(a)}</span><h2>${esc(a.label)}</h2></div>`;
    h += `<span class="lbl-s">Shows on</span><div class="chipset"><button class="${pinned ? 'on' : ''}" data-act="app-pin" data-v="${esc(key)}">${ic('home', 'xs')}Home</button>` +
      arr(D.spaces).map(s => `<button class="${s.apps.includes(key) ? 'on' : ''}" data-act="app-space" data-v="${esc(key)}" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join('') + '</div>';
    h += `<div class="quiet">Hold an app on a page and drag to reorder it.</div>`;
    h += `<button class="row" data-act="app-mute" data-v="${esc(key)}"><span class="ri">${ic(muted(a.pkg) ? 'bell' : 'bell-off', 'sm')}</span><span class="rt"><b>${muted(a.pkg) ? 'Show its badges again' : 'Mute its badges'}</b></span></button>` +
      `<button class="row" data-act="app-info" data-v="${esc(key)}"><span class="ri">${ic('info', 'sm')}</span><span class="rt"><b>App info</b></span></button>` +
      `<button class="row" data-act="app-hide" data-v="${esc(key)}"><span class="ri">${ic('eye-off', 'sm')}</span><span class="rt"><b>Hide everywhere</b><small>/unhide brings it back</small></span></button>` +
      `<button class="row" data-act="app-uninstall" data-v="${esc(key)}"><span class="ri" style="color:var(--call)">${ic('trash', 'sm')}</span><span class="rt"><b>Uninstall</b></span></button>`;
    if (S.sheet === 'app') refreshSheet(h); else openSheet('app', h);
    buzz('long');
  }
  function notesSheet() {
    const list = D.notes.slice().reverse();
    let h = head('Notes', `<button class="bt" data-act="fill" data-v="/note ">${ic('plus')}New</button>`);
    h += list.length ? list.map(n => `<div class="note"><p>${esc(n.text)}<time>${esc(stamp(n.t))}</time></p><button class="icon-btn" data-act="copy" data-v="${esc(n.text)}" aria-label="Copy">${ic('copy', 'sm')}</button><button class="icon-btn" data-act="note-del" data-v="${esc(n.id)}" aria-label="Delete">${ic('trash', 'sm')}</button></div>`).join('')
      : '<div class="quiet">No notes yet. Type /note and what you want to keep.</div>';
    if (S.sheet === 'notes') refreshSheet(h); else openSheet('notes', h);
  }
  function helpSheet() {
    const groups = new Map();
    for (const c of CMDS) { if (c.hidden) continue; if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
    let h = head('Commands') + '<div class="quiet" style="padding-top:0">Type / in the bar. Anything else you type finds apps, people, sums and the web.</div><div class="cmdlist">';
    for (const [g, list] of groups) h += `<div class="sec-h">${esc(g)}</div>` + list.map(c => `<button class="cmdrow" data-act="fill" data-v="/${esc(c.n)}${c.a ? ' ' : ''}"><code>/${esc(c.n)}</code><span>${esc(c.d)}</span></button>`).join('');
    openSheet('help', h + '</div>');
  }

  /* you: passport, phone, launcher */
  const qrSvg = text => (window.SBQR ? SBQR.svg(text != null ? text : vcard(D.passport)) : '');
/*@@VCARD@@*/
  function youSheet() {
    const p = D.passport, b = S.battery || {}, dv = S.device || {}, pm = S.perms || {};
    const links = arr(p.links).filter(l => l.v);
    let h = `<div class="you-card"><div class="you-banner" style="${picCss('banner', 3, 1) || ''}"></div><div class="you-id">${meAv()}<h3>${esc(p.name)}</h3>${p.note ? `<p>${esc(p.note)}</p>` : ''}${p.status ? `<span class="status">${esc(p.status)}</span>` : ''}` +
      `<div class="btns"><button class="bt pri" data-act="qr" data-v="-1">${ic('qr')}Show my code</button><button class="bt" data-act="pp-edit">${ic('edit')}Edit</button></div></div></div>`;
    if (links.length) h += `<div class="sec-h">Links</div>` + links.map((l, i) => { const d = linkDef(l), u = linkUrl(l); return `<div style="display:flex;align-items:center;gap:4px"><button class="row" data-act="${u ? 'url' : 'copy'}" data-v="${esc(u || l.v)}"><span class="ri">${ic(d.i, 'sm')}</span><span class="rt"><b>${esc(linkShow(l))}</b><small>${esc(linkName(l))}${u ? '' : ' · tap to copy'}</small></span></button><button class="more" data-act="qr" data-v="${i}" aria-label="Code for ${esc(linkName(l))}">${ic('qr', 'sm')}</button></div>`; }).join('');
    h += `<div class="sec-h">Phone</div>` +
      `<button class="row" data-act="cmd" data-v="/dnd"><span class="ri">${ic('moon', 'sm')}</span><span class="rt"><b>Do Not Disturb</b></span><span class="toggle ${D.dnd ? 'on' : ''}"></span></button>` +
      `<button class="row" data-act="cmd" data-v="/flash"><span class="ri">${ic('bolt', 'sm')}</span><span class="rt"><b>Flashlight</b></span><span class="toggle ${S.torch ? 'on' : ''}"></span></button>` +
      `<div class="row"><span class="ri">${ic('battery', 'sm')}</span><span class="rt"><b>${b.pct != null ? b.pct + '%' : '–'}${b.charging ? ', charging' : ''}</b><small>${esc(dv.model || '')}${dv.android ? ' · Android ' + esc(dv.android) : ''}${dv.total ? ' · ' + gb(dv.free) + ' free of ' + gb(dv.total) : ''}</small></span></div>`;
    h += `<div class="sec-h">Launcher</div><div class="seg">${[['auto', 'Auto'], ['dark', 'Dark'], ['black', 'Black'], ['light', 'Light']].map(([v, l]) => `<button class="${(D.skin || 'auto') === v ? 'on' : ''}" data-act="skin" data-v="${v}">${l}</button>`).join('')}</div>` +
      `<div class="swatches" style="margin-top:10px">${Object.entries(ACCENTS).map(([k, a]) => `<button class="sw ${D.fun.accent === k ? 'on' : ''}" style="background:${a[0]}" data-act="accent" data-v="${k}" aria-label="${a[2]}"></button>`).join('')}</div>`;
    const need = [['notif', 'Notification access', 'to see and answer what comes in'], ['calendar', 'Calendar', 'for your week'], ['contacts', 'Contacts', 'to call and text favorites'], ['dnd', 'Do Not Disturb access', 'for the moon toggle']].filter(([k]) => pm[k] === false);
    if (pm.isHome === false) h += `<button class="row" data-act="set-home"><span class="ri" style="color:var(--brass)">${ic('home', 'sm')}</span><span class="rt"><b>Make Switchboard your home screen</b></span></button>`;
    h += need.map(([k, t, s]) => `<button class="row" data-act="perm" data-v="${k}"><span class="ri">${ic('shield', 'sm')}</span><span class="rt"><b>${t}</b><small>Allow ${s}</small></span></button>`).join('');
    h += `<button class="row" data-act="cmd" data-v="/update"><span class="ri">${ic('down', 'sm')}</span><span class="rt"><b>Check for updates</b><small>App ${esc(String(B.version() || '?'))} · page One bar 1.0</small></span></button>` +
      `<button class="row" data-act="cmd" data-v="/help"><span class="ri">${ic('info', 'sm')}</span><span class="rt"><b>Every command</b></span></button>`;
    if (S.sheet === 'you') refreshSheet(h); else openSheet('you', h);
  }
  function qrSheet(i) {
    const p = D.passport, links = arr(p.links).filter(l => linkUrl(l));
    const all = arr(p.links).filter(l => l.v);
    const l = i >= 0 ? all[i] : null, u = l ? linkUrl(l) : null;
    const svg = qrSvg(l ? (u || l.v) : undefined);
    if (!svg) return toast('Add your number or email first');
    let h = head(esc(p.name)) + `<div class="qrpick"><button class="${i < 0 ? 'on' : ''}" data-act="qr" data-v="-1">${ic('user', 'xs')}Contact</button>` +
      all.map((x, j) => `<button class="${i === j ? 'on' : ''}" data-act="qr" data-v="${j}">${ic(linkDef(x).i, 'xs')}${esc(linkName(x))}</button>`).join('') + '</div>' +
      `<div class="qr-big">${svg}</div><div class="qr-cap">${l ? esc(linkShow(l)) : 'Scan with any camera to save my contact'}</div>` +
      `<div class="btns" style="justify-content:center"><button class="bt" data-act="copy" data-v="${esc(l ? (u || l.v) : [p.name, p.phone, p.email].filter(Boolean).join('\n'))}">${ic('copy')}Copy</button><button class="bt ghost" data-act="you">Back</button></div>`;
    void links;
    if (S.sheet === 'qr') refreshSheet(h); else openSheet('qr', h);
  }
  function passportEditSheet() {
    if (!S.ppDraft) S.ppDraft = JSON.parse(JSON.stringify(D.passport));
    const p = S.ppDraft;
    const f = (key, label, attrs = '') => `<span class="lbl-s">${label}</span><input class="inp" data-pp="${key}" value="${esc(p[key] || '')}" ${attrs}>`;
    let h = head('Edit passport', `<button class="bt pri" data-act="pp-save">Save</button>`) +
      f('name', 'Name', 'maxlength="40"') + f('note', 'Line under your name', 'maxlength="80"') + f('status', 'Status', 'maxlength="90"') +
      f('phone', 'Phone', 'inputmode="tel"') + f('email', 'Email', 'inputmode="email"') + `<span class="lbl-s">Links (up to ${MAX_LINKS})</span>` +
      p.links.map((l, i) => `<div class="lkrow"><select data-lk="${i}" aria-label="Kind">${LINK_ORDER.map(k => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${esc(LINKS[k].n)}</option>`).join('')}</select>` +
        `<input class="inp" data-lv="${i}" value="${esc(l.v)}" placeholder="${esc(linkDef(l).ph)}"><button class="x" data-act="pp-rm" data-v="${i}" aria-label="Remove">${ic('x', 'sm')}</button></div>`).join('') +
      (p.links.length < MAX_LINKS ? `<button class="bt" data-act="pp-add">${ic('plus')}Add a link</button>` : '');
    if (S.sheet === 'pp') refreshSheet(h); else openSheet('pp', h);
  }
  function readDraft() {
    const p = S.ppDraft; if (!p) return;
    document.querySelectorAll('[data-pp]').forEach(el => { p[el.dataset.pp] = el.value.trim(); });
    document.querySelectorAll('[data-lk]').forEach(el => { p.links[+el.dataset.lk].type = el.value; });
    document.querySelectorAll('[data-lv]').forEach(el => { p.links[+el.dataset.lv].v = el.value.trim(); });
  }

  /* ---------- the player ---------- */
  const Z = () => 1;
/*@@PLAYER@@*/
  function openPlayer() {
    if (!S.media) return;
    if (S.finding) exitFind();
    S.player = true; S.playerKey = null;
    const el = $('#player'); el.style.transform = '';
    renderPlayer();
    void el.offsetWidth;
    el.classList.add('on'); $('#scrim').classList.add('on');
    clearInterval(S.plTick); S.plTick = setInterval(tickPlayer, 500);
    buzz();
  }
  function closePlayer() {
    if (!S.player) return;
    S.player = false; clearInterval(S.plTick);
    const p = $('#player'); p.classList.remove('on', 'drag'); p.style.transform = '';
    if (!S.sheet) $('#scrim').classList.remove('on');
  }

  /* ---------- taps ---------- */
  const ACT = {
    launch: v => { const a = appOf(v); if (a) launchApp(a); },
    more: v => { S.poolId = v; const p = pages().find(x => x.id === v); enterFind(p ? p.apps : null); q().focus({ preventScroll: true }); },
    find: v => { if (v && v !== 'home') { setQuery(v); } else { enterFind(); q().focus({ preventScroll: true }); } },
    'find-close': () => exitFind(),
    fill: v => { closeSheet(true); hideAnswer(); setQuery(v); },
    cmd: v => { hideAnswer(); if (S.sheet && !/^\/(dnd|flash)/.test(v)) closeSheet(); runText(v); if (S.sheet === 'you') youSheet(); },
    waiting: () => (S.sheet === 'waiting' ? closeSheet() : openWaiting()),
    agenda: () => agendaSheet(),
    you: () => { S.ppDraft = null; youSheet(); },
    spaces: () => spacesSheet(),
    go: v => { closeSheet(); goPage(+v); },
    player: () => openPlayer(),
    'player-close': () => closePlayer(),
    media: (v, el) => { B.mediaCmd(v || el.dataset.cmd); buzz(); },
    'media-open': () => { const a = S.media && appPkg(S.media.pkg); if (a) { closePlayer(); launchApp(a); } },
    'pl-skip': (v, el) => { S.plDir = el.dataset.cmd === 'next' ? 1 : -1; B.mediaCmd(el.dataset.cmd); buzz(); },
    event: v => B.openEvent(v),
    perm: v => B.askPerm(v),
    'set-home': () => B.setHome(),
    nopen: v => { B.notifOpen(v); closeSheet(); },
    naction: (v, el) => { B.notifAction(v, +el.dataset.i); },
    reply: v => startReply(v),
    'reply-cancel': () => { S.reply = null; q().value = ''; q().blur(); renderBar(); },
    'cv-done': v => { for (const n of S.notifs) if (n.live && convoKey(n) === v) B.notifDismiss(n.id); delete S.sent[v]; },
    'ag-done': v => { for (const n of S.notifs) if (n.live && n.pkg === v && !isConvo(n)) B.notifDismiss(n.id); },
    'clear-all': () => { B.dismissAll(); S.sent = {}; toast('Cleared'); },
    earlier: () => { S.showEarlier = !S.showEarlier; refreshWaiting(); },
    sms: v => { B.sms(v, ''); exitFind(); },
    'answer-close': () => hideAnswer(),
    'answer-show': v => { closeSheet(); showAnswer(v); },
    snooze: v => { const r = D.reminders.find(x => x.id === v); if (!r) return; const x = addReminder(now() + 10 * MIN, r.text); hideAnswer(); toast('Snoozed until ' + clock(x.at)); },
    unremind: v => { cancelReminder(v); toast('Reminder canceled'); hideAnswer(); refreshWaiting(); },
    note: v => { addNote(v); toast('Saved to notes'); hideAnswer(); },
    'note-del': v => { D.notes = D.notes.filter(n => n.id !== v); save(); notesSheet(); },
    cebar: () => { if (!D.mate) return; D.mate.n = Math.min(MATE_MAX, D.mate.n + 1); D.mate.t = now(); save(); updateAnswer('mate', mateAnswer()); buzz(); },
    yerba: () => { if (!D.mate) return; D.mate.n = 0; D.mate.t = now(); save(); updateAnswer('mate', mateAnswer()); },
    copy: v => { B.copy(v); toast('Copied'); },
    url: v => B.url(v),
    'upd-install': () => B.installUpdate(),
    'upd-apply': () => B.applyPage(),
    'sheet-close': () => closeSheet(),
    scrim: () => { if (S.player) closePlayer(); else closeSheet(); },
    skin: v => { D.skin = v; save(); applySkin(); youSheet(); },
    accent: v => { D.fun.accent = v; save(); applySkin(); youSheet(); },
    qr: v => qrSheet(+v),
    'pp-edit': () => { S.ppDraft = null; passportEditSheet(); },
    'pp-add': () => { readDraft(); S.ppDraft.links.push({ type: LINK_ORDER.find(k => !S.ppDraft.links.some(l => l.type === k)) || 'other', v: '', label: '' }); passportEditSheet(); },
    'pp-rm': v => { readDraft(); S.ppDraft.links.splice(+v, 1); passportEditSheet(); },
    'pp-save': () => { readDraft(); const p = S.ppDraft; p.name = p.name || 'You'; p.links = p.links.filter(l => l.v).map(normLink).filter(Boolean); D.passport = p; S.ppDraft = null; save(); renderTop(); youSheet(); toast('Passport saved'); },
    'space-new': () => { const sp = createSpace('New space'); goPage(pages().findIndex(p => p.id === sp.id), true); spaceOptsSheet(sp.id, true); },
    'space-opts': v => spaceOptsSheet(v),
    'space-rename-start': v => spaceOptsSheet(v, true),
    'space-rename': v => { const sp = spaceOf(v), el = $('#spName'); if (sp && el && el.value.trim()) { sp.name = el.value.trim().slice(0, 40); save(); renderPages(); } spaceOptsSheet(v); },
    'space-sort': (v, el) => { const sp = spaceOf(el.dataset.id); if (!sp) return; if (v === 'custom' && sp.sort !== 'custom') sp.apps = spaceApps(sp).map(a => a.key).concat(sp.apps.filter(k => !appOf(k) || isHidden(k))); sp.sort = v === 'custom' ? 'custom' : 'az'; save(); renderPages(); spaceOptsSheet(sp.id); },
    'space-move': (v, el) => { const i = D.spaces.findIndex(s => s.id === el.dataset.id), j = i + +v; if (i < 0 || j < 0 || j >= D.spaces.length) return; const [s] = D.spaces.splice(i, 1); D.spaces.splice(j, 0, s); S.page = j + 1; save(); renderPages(); spaceOptsSheet(s.id); },
    'space-delete': v => { const sp = spaceOf(v); if (!sp) return; deleteSpace(v); toast(`Deleted ${sp.name}. Its apps are still in the bar.`); spacesSheet(); },
    picker: v => pickerSheet(v),
    'pick-toggle': v => { const sp = spaceOf(S.pickFor); if (!sp) return; sp.apps = sp.apps.includes(v) ? sp.apps.filter(k => k !== v) : sp.apps.concat([v]); save(); renderPages(); const r = document.querySelector(`[data-act="pick-toggle"][data-v="${CSS.escape(v)}"] .check`); if (r) r.classList.toggle('on', sp.apps.includes(v)); },
    'app-pin': v => { const a = appOf(v); if (!a) return; arr(D.pinned).includes(v) ? unpinApp(a) : pinApp(a); appSheet(v); },
    'app-space': (v, el) => { const sp = spaceOf(el.dataset.id); if (!sp) return; sp.apps = sp.apps.includes(v) ? sp.apps.filter(k => k !== v) : sp.apps.concat([v]); save(); renderPages(); appSheet(v); },
    'app-mute': v => { const a = appOf(v); if (!a) return; D.muted = muted(a.pkg) ? D.muted.filter(p => p !== a.pkg) : D.muted.concat([a.pkg]); save(); renderAll(); appSheet(v); },
    'app-info': v => { const a = appOf(v); if (a) B.appInfo(a.pkg); },
    'app-hide': v => { const a = appOf(v); if (a) { closeSheet(); hideApp(a); } },
    'app-uninstall': v => { const a = appOf(v); if (a) B.uninstall(a.pkg); }
  };
  function refreshWaiting() { if (S.sheet === 'waiting') refreshSheet(waitingHtml()); renderSide(); }
  let quietUntil = 0;   // swallow the click that follows a swipe, a hold or a drag
  function onClick(e) {
    if (performance.now() < quietUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const r = e.target.closest('[data-r]');
    if (r && S.results[+r.dataset.r]) {
      const sms = e.target.closest('[data-act="sms"]');
      if (sms) return ACT.sms(sms.dataset.v);
      return S.results[+r.dataset.r].run();
    }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const f = ACT[el.dataset.act];
    if (f) { e.preventDefault(); f(el.dataset.v, el); }
  }

  /* ---------- gestures ---------- */
  // Home and the bar: sideways moves between spaces, up shows what's waiting, down pulls the shade.
  function homeGestures(el) {
    let g = null;
    el.addEventListener('touchstart', e => {
      if (S.sheet || S.player || e.touches.length > 1) { g = null; return; }
      if (S.finding && el.id === 'bar') { g = null; return; }
      const t = e.touches[0];
      g = { x: t.clientX, y: t.clientY, ax: null, pts: [[t.clientX, t.clientY, performance.now()]], tile: e.target.closest('#stage .tile[data-key]') };
      if (g.tile) g.lp = setTimeout(() => holdTile(g), 430);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!g) return;
      const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      g.pts.push([t.clientX, t.clientY, performance.now()]); if (g.pts.length > 6) g.pts.shift();
      if (g.drag) { e.preventDefault(); return dragTile(g, t); }
      if (!g.ax) {
        if (Math.hypot(dx, dy) < 9) return;
        clearTimeout(g.lp);
        if (g.held) { g.drag = true; startDrag(g, t); e.preventDefault(); return; }
        g.ax = Math.abs(dx) > Math.abs(dy) ? 'x' : (dy < 0 ? 'up' : 'down');
        if (g.ax === 'x') $('#track').classList.add('drag');
        if (g.ax === 'up' && !S.wide) peekWaiting(0);
      }
      e.preventDefault();
      if (g.ax === 'x') {
        const n = pages().length; let d = dx;
        if ((S.page === 0 && d > 0) || (S.page === n - 1 && d < 0)) d = d / 3;
        placeTrack(d);
      } else if (g.ax === 'up' && !S.wide) peekWaiting(-dy);
    }, { passive: false });
    const end = () => {
      if (!g) return;
      const k = g; g = null; clearTimeout(k.lp);
      if (k.drag) return dropTile(k);
      if (k.held) { k.tile.classList.remove('lift'); quietUntil = performance.now() + 450; return appSheet(k.tile.dataset.key); }
      if (!k.ax) return;
      quietUntil = performance.now() + 350;
      const a = k.pts[0], b = k.pts[k.pts.length - 1], dt = Math.max(1, b[2] - a[2]);
      const vx = (b[0] - a[0]) / dt, vy = (b[1] - a[1]) / dt, dx = b[0] - k.x, dy = b[1] - k.y;
      if (k.ax === 'x') {
        const w = stageW();
        if (dx < -w * 0.22 || vx < -0.45) goPage(S.page + 1); else if (dx > w * 0.22 || vx > 0.45) goPage(S.page - 1); else goPage(S.page, true);
      } else if (k.ax === 'up' && !S.wide) {
        if (-dy > 70 || vy < -0.5) settleWaiting(true); else settleWaiting(false);
      } else if (k.ax === 'down') {
        if (dy > 60 || vy > 0.5) B.shade();
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  // Waiting follows your finger up from the bar.
  function peekWaiting(px) {
    const sh = $('#sheet');
    if (S.sheet !== 'waiting-peek') {
      S.sheet = 'waiting-peek';
      sh.classList.add('above-bar', 'drag'); sh.classList.remove('on'); $('#app').classList.add('bar-up');
      $('#sheetBody').innerHTML = waitingHtml(); $('#sheetBody').scrollTop = 0;
    }
    const h = sh.offsetHeight + 30;
    sh.style.transform = `translate3d(0,${Math.max(0, h - px * 1.1)}px,0)`;
  }
  function settleWaiting(open) {
    const sh = $('#sheet');
    sh.classList.remove('drag');
    if (open) { S.sheet = 'waiting'; sh.style.transform = ''; sh.classList.add('on'); $('#scrim').classList.add('on', 'soft'); hideAnswer(); buzz(); }
    else { S.sheet = null; sh.style.transform = ''; $('#app').classList.remove('bar-up'); }
  }
  // Sheets and the player: pull down to put them away.
  function pullToClose(el, scroller, close) {
    let g = null;
    el.addEventListener('touchstart', e => {
      const sc = scroller(); const t = e.touches[0];
      if (e.target.closest('#azstrip, .pl-bar, .pl-art, input, select')) { g = null; return; }
      g = { y: t.clientY, x: t.clientX, top: !sc || sc.scrollTop <= 0, on: false, t: performance.now() };
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!g || !g.top) return;
      const t = e.touches[0], dy = t.clientY - g.y;
      if (!g.on) { if (dy > 8 && dy > Math.abs(t.clientX - g.x)) { g.on = true; el.classList.add('drag'); } else if (dy < -4 || Math.abs(t.clientX - g.x) > 10) { g = null; return; } else return; }
      e.preventDefault();
      el.style.transform = `translate3d(0,${Math.max(0, dy)}px,0)`;
      g.dy = dy;
    }, { passive: false });
    const end = () => {
      if (!g) return; const k = g; g = null;
      if (!k.on) return;
      el.classList.remove('drag');
      const v = k.dy / Math.max(1, performance.now() - k.t);
      if (k.dy > 90 || v > 0.6) { quietUntil = performance.now() + 300; close(); } else el.style.transform = '';
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }

  /* hold an app: options; hold and drag: put it where you want */
  function holdTile(g) { g.held = true; g.tile.classList.add('lift'); buzz('long'); }
  function startDrag(g, t) {
    S.dragging = true;
    const tile = g.tile, r = tile.getBoundingClientRect();
    const ghost = tile.cloneNode(true); ghost.classList.add('ghost'); ghost.classList.remove('lift');
    ghost.style.width = r.width + 'px'; $('#app').appendChild(ghost);
    g.ghost = ghost; g.off = [t.clientX - r.left, t.clientY - r.top];
    tile.classList.remove('lift'); tile.classList.add('hold');
    g.grid = tile.parentElement; g.grid.classList.add('sorting');
    dragTile(g, t);
  }
  function dragTile(g, t) {
    g.ghost.style.left = (t.clientX - g.off[0]) + 'px'; g.ghost.style.top = (t.clientY - g.off[1]) + 'px';
    const tiles = [...g.grid.querySelectorAll('.tile[data-key]')];
    let best = null, bd = 1e9;
    for (const el of tiles) { const r = el.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - t.clientX, r.top + r.height / 2 - t.clientY); if (d < bd) { bd = d; best = el; } }
    if (best && best !== g.tile && bd < 60) {
      // FLIP: remember where everything was, move the held tile, animate the rest into place.
      const before = new Map(tiles.map(el => [el, el.getBoundingClientRect()]));
      const i = tiles.indexOf(g.tile), j = tiles.indexOf(best);
      g.grid.insertBefore(g.tile, i < j ? best.nextSibling : best);
      for (const el of tiles) {
        if (el === g.tile) continue;
        const a = before.get(el), b = el.getBoundingClientRect();
        if (a.left !== b.left || a.top !== b.top) { el.style.transition = 'none'; el.style.transform = `translate(${a.left - b.left}px,${a.top - b.top}px)`; void el.offsetWidth; el.style.transition = ''; el.style.transform = ''; }
      }
      buzz();
    }
  }
  function dropTile(g) {
    S.dragging = false;
    quietUntil = performance.now() + 450;
    g.ghost.remove(); g.tile.classList.remove('hold'); g.grid.classList.remove('sorting');
    const order = [...g.grid.querySelectorAll('.tile[data-key]')].map(el => el.dataset.key), set = new Set(order);
    const p = curPage();
    if (p.id === 'home') D.pinned = order.concat(arr(D.pinned).filter(k => !set.has(k)));
    else if (p.sp) { const full = (p.sp.sort === 'custom' ? p.sp.apps : spaceApps(p.sp).map(a => a.key).concat(p.sp.apps.filter(k => !appOf(k) || isHidden(k)))); p.sp.apps = order.concat(full.filter(k => !set.has(k))); p.sp.sort = 'custom'; }
    save(); renderPages();
  }

  /* ---------- wiring ---------- */
  function wire() {
    const app = $('#app');
    app.addEventListener('click', onClick);
    homeGestures($('#stage')); homeGestures($('#bar')); homeGestures($('#dots'));
    pullToClose($('#sheet'), () => $('#sheetBody'), () => closeSheet());
    pullToClose($('#player'), () => $('#player .pl-body'), closePlayer);
    // Results and the A–Z grid keep the keyboard up when tapped.
    $('#find').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    // Long-press in the results opens the app's options.
    let lp = 0;
    $('#find').addEventListener('touchstart', e => { const t = e.target.closest('.tile[data-key]'); clearTimeout(lp); if (t) lp = setTimeout(() => { quietUntil = performance.now() + 500; exitFind(); appSheet(t.dataset.key); }, 480); }, { passive: true });
    ['touchmove', 'touchend', 'touchcancel'].forEach(k => $('#find').addEventListener(k, () => clearTimeout(lp), { passive: true }));
    app.addEventListener('contextmenu', e => { if (!('ontouchstart' in window)) { const t = e.target.closest('.tile[data-key]'); if (t) { e.preventDefault(); exitFind(); appSheet(t.dataset.key); } } else e.preventDefault(); });
    const inp = q();
    inp.addEventListener('focus', () => { if (!S.reply && !S.finding) enterFind(); });
    inp.addEventListener('click', () => { if (!S.reply && !S.finding) enterFind(); });
    inp.addEventListener('input', () => { if (!S.reply) { if (!S.finding) enterFind(); renderFind(); } });
    inp.addEventListener('blur', () => { setTimeout(() => { if (S.finding && !inp.value && document.activeElement !== inp && !S.pool) exitFind(); }, 180); });
    $('#bar').addEventListener('submit', e => { e.preventDefault(); if (S.reply) sendReply(inp.value); else runTop(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') back(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement !== inp) back(); if (!S.finding && !S.sheet && document.activeElement !== inp) { if (e.key === 'ArrowRight') goPage(S.page + 1); if (e.key === 'ArrowLeft') goPage(S.page - 1); } });
    addEventListener('resize', () => { applyWide(); placeTrack(); });
    for (const el of [app, $('#home'), $('#stage')]) el.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderTop(); renderPages(); } });
  }
  function applyWide() {
    const w = innerWidth >= 700;
    if (w === S.wide) return;
    S.wide = w; $('#app').classList.toggle('wide', w);
    if (w && (S.sheet === 'waiting' || S.sheet === 'waiting-peek')) closeSheet(true);
    renderSide(); renderBar(); placeTrack();
  }
  function back() {
    if (S.player) return closePlayer();
    if (S.sheet) return closeSheet();
    if (S.reply) return ACT['reply-cancel']();
    if (S.finding) return exitFind();
    if (!$('#answer').hidden) return hideAnswer();
    if (S.page !== 0) return goPage(0);
  }
  function goHome() { closePlayer(); closeSheet(); exitFind(); hideAnswer(); goPage(0, true); }

  /* ---------- render ---------- */
  function renderAll() { renderTop(); if (!S.dragging) renderPages(); renderBar(); renderSide(); if (S.sheet === 'waiting') refreshSheet(waitingHtml()); }
  let refreshT = 0;
  const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(renderAll, 90); };
  function tick() {
    if (document.hidden) return;
    checkReminders(); renderTop();
    document.querySelectorAll('.page .glance').forEach((g, i) => { const p = pages()[i]; if (p) g.innerHTML = glanceHtml(p, i); });
    document.querySelectorAll('[data-countdown]').forEach(el => { const s = Math.round((+el.dataset.countdown - now()) / 1000); el.textContent = s > 0 ? fmtDur(s) : 'done'; });
  }

  /* ---------- native events ---------- */
  window.SB = {
    toast,
    state: () => ({ sheet: S.sheet, finding: S.finding, reply: !!S.reply, player: S.player, page: S.page, dragging: !!S.dragging }),
    onNative(type, data) {
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { /* keep string */ } }
      switch (type) {
        case 'back': back(); break;
        case 'home': goHome(); break;
        case 'apps': loadApps(); refreshSoon(); break;
        case 'notifs': loadNotifs(Array.isArray(data) ? data : undefined); refreshSoon(); break;
        case 'media': {
          const prev = S.media; S.media = data && data.title ? data : null;
          const same = prev && S.media && prev.title === S.media.title && prev.artist === S.media.artist && prev.art === S.media.art;
          renderBar(); renderSide();
          if (S.player) { if (same) updatePlayer(); else if (S.plDragging) S.plStale = true; else renderPlayer(); }
          break;
        }
        case 'battery': S.battery = data || S.battery; renderTop(); if (S.sheet === 'you') youSheet(); break;
        case 'perms': S.perms = (data && typeof data === 'object') ? data : (B.perms() || {}); loadAll(); refreshSoon(); break;
        case 'events': S.events = arr(data); refreshSoon(); break;
        case 'remind': checkReminders(); break;
        case 'update': onUpdate(data); break;
        case 'resume': loadAll(); checkReminders(); refreshSoon(); break;
      }
    }
  };

  /* ---------- start ---------- */
  function init() {
    loadAll();
    initPassport();
    applySkin();
    wire();
    S.wide = !(innerWidth >= 700); applyWide();
    renderAll();
    checkReminders();
    setInterval(tick, 30000);
    setInterval(() => { if (!document.hidden) document.querySelectorAll('[data-countdown]').forEach(el => { const s = Math.round((+el.dataset.countdown - now()) / 1000); el.textContent = s > 0 ? fmtDur(s) : 'done'; }); }, 1000);
    loadPics();
    if (B.ready) B.ready();   // tells the app this page started fine (a downloaded page that doesn't is rolled back)
    noteNewPage();
  }
  init();
})();
