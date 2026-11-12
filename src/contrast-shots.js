// Contrast audit: every visible text element, its color vs the real pixels behind it (screenshot), per state.
const { chromium } = require('playwright');
const fs = require('fs'); const OUTDIR = require('path').resolve(__dirname, 'contrast-out') + '/'; fs.mkdirSync(OUTDIR, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const page = process.argv[2] || 'file://' + require('path').resolve(__dirname, '../index.html');
  const results = [];
  const states = [];
  for (const skin of ['dark', 'light', 'black']) for (const v of ['home', 'recent', 'drawer', 'waiting', 'you', 'wall', 'answer', 'find', 'agenda', 'spaces', 'help', 'cmds']) states.push({ skin, v, wall: null });
  for (const skin of ['auto', 'dark', 'black', 'light']) for (const wall of ['dawn clear', 'day clear', 'day storm', 'dusk clear', 'dusk storm', 'night clear', 'night rain']) for (const v of ['home', 'recent', 'answer', 'drawer', 'spaces']) states.push({ skin, v, wall });
  const ctx = await b.newContext({ viewport: { width: 412, height: 810 }, isMobile: true, hasTouch: true, colorScheme: 'dark', deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const st of states) {
    await p.goto(page); await p.waitForTimeout(350);
    const run = async t => { await p.evaluate(t => { const q = document.querySelector('#q'); q.focus(); q.value = t; q.dispatchEvent(new Event('input')); document.querySelector('#bar').requestSubmit(); }, t); await p.waitForTimeout(200); };
    await run('.theme ' + st.skin); await p.evaluate(() => SB.onNative('home'));
    if (st.wall) await run('.wallpaper ' + st.wall); else await run('.wallpaper none');
    await p.evaluate(() => { SB.onNative('home'); document.querySelector('#toast').classList.remove('on'); });
    await p.waitForTimeout(250);
    if (st.v === 'recent') await p.keyboard.press('ArrowLeft');
    if (st.v === 'drawer') await p.evaluate(() => { document.querySelector('#q').focus(); });
    if (st.v === 'waiting') await p.click('#wait');
    if (st.v === 'you') await p.click('#me');
    if (st.v === 'wall') await run('.wallpaper');
    if (st.v === 'answer') await run('.timer 25m');
    if (st.v === 'find') await p.evaluate(() => { const q = document.querySelector('#q'); q.focus(); q.value = 'c'; q.dispatchEvent(new Event('input')); });
    if (st.v === 'agenda') await p.click('#date');
    if (st.v === 'spaces') await p.click('#spacename');
    if (st.v === 'help') await run('.help');
    if (st.v === 'cmds') await p.evaluate(() => { const q = document.querySelector('#q'); q.focus(); q.value = '.'; q.dispatchEvent(new Event('input')); });
    await p.evaluate(() => document.querySelector('#toast').classList.remove('on'));
    await p.waitForTimeout(700);
    const shot = await p.screenshot();
    const items = await p.evaluate(() => {
      const out = [];
      const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null; let e = el; while (e) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null; e = e.parentElement; } return r; };
      for (const el of document.querySelectorAll('#app *')) {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        // topmost? skip text covered by something opaque
        const r = vis(el); if (!r) continue;
        const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        const top = document.elementFromPoint(cx, cy); if (!top || !(top === el || el.contains(top) || top.contains(el))) continue;
        const cs = getComputedStyle(el);
        const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 40);
        out.push({ txt, color: cs.color, size: parseFloat(cs.fontSize), weight: +cs.fontWeight, op: (() => { let o = 1, e = el; while (e) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } return o; })(), r: [r.left, r.top, r.width, r.height], cls: el.className && el.className.baseVal === undefined ? (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').join('.') + ' <' + el.tagName.toLowerCase() : el.tagName });
      }
      return out;
    });
    const name = (st.skin + '_' + (st.wall || 'none') + '_' + st.v).replace(/ /g, '-');
    fs.writeFileSync('' + OUTDIR + '' + name + '.png', shot);
    fs.writeFileSync('' + OUTDIR + '' + name + '.json', JSON.stringify(items));
  }
  await b.close();
})();
