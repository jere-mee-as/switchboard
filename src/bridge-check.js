const { chromium } = require('playwright');
const fs = require('fs');
const html = fs.readFileSync('' + process.argv[2] + '', 'utf8');
const mock = html.match(/<script>\n\/\* Preview bridge[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '').replace('window.SBMock = window.SBNative ? null : (', 'window.__M = (');
const arity = JSON.parse(fs.readFileSync('' + __dirname + '/arity.json', 'utf8'));
(async () => {
  const b = await chromium.launch(); const bad = []; const calls = {};
  const ctx = await b.newContext({ viewport: { width: 412, height: 810 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  await ctx.addInitScript(({ mock, arity }) => {
    eval(mock);
    window.__calls = {};
    const N = {};
    for (const [m, n] of Object.entries(arity)) N[m] = function () {
      window.__calls[m] = (window.__calls[m] || 0) + 1;
      if (arguments.length !== n) throw new Error(`arity ${m}: got ${arguments.length}, wants ${n}`);
      for (const a of arguments) if (a === undefined || a === null || (typeof a === 'number' && !isFinite(a))) throw new Error(`bad arg to ${m}: ${a}`);
      const f = window.__M[m]; const r = f ? f.apply(null, arguments) : null;
      return (r !== null && typeof r === 'object') ? JSON.stringify(r) : r;
    };
    window.SBNative = N;
  }, { mock, arity });
  const p = await ctx.newPage();
  p.on('pageerror', e => bad.push('pageerror ' + e.message));
  p.on('console', m => { if (/bridge|arity|bad arg/.test(m.text())) bad.push(m.text()); });
  await p.goto('file://' + process.argv[2] + ''); await p.waitForTimeout(600);
  const typeRun = async t => { await p.tap('#q'); await p.fill('#q', t); await p.dispatchEvent('#q', 'input'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); };
  for (const t of ['.timer 10m', '/alarm 6:30am wake', '.remind 20m call Marco', '.reminders', '.event Dinner fri 7pm', '.note test note', '.calc 2*21', '.flash', '.flash off', '.dnd on', '.dnd off',
    '.settings wifi', '.shade', '.battery', '.pin Reddit', '.unpin Reddit', '.move Reddit to Work', '.space new Travel', '.space rename Travel to Trips', '.space delete Trips', '.hide Uber', '.unhide Uber',
    '.mute Venmo', '.unmute Venmo', '.info Chrome', '.uninstall Shazam', '.roll 2d20', '.flip', '.8ball will it pass', '.mate', '.theme light', '.theme auto', '.accent mint', '.accent brass',
    '.name Jeremias', '.status testing', '.call Lucas', '.text Lucas hey', '.open spotify', '.search tacos', '.map reston', '.update', '.clear', '.whoami', '/nope', 'hola', 'spotify', '3+4', 'zzqx']) {
    await typeRun(t); await p.evaluate(() => SB.onNative('back')); await p.evaluate(() => SB.onNative('back'));
  }
  await p.waitForTimeout(1200);  // update flow events
  await p.evaluate(() => SB.onNative('home'));
  // waiting actions
  await p.tap('#wait'); await p.waitForTimeout(400);
  for (const sel of ['[data-act="reply"]']) { await p.tap('#sheet ' + sel); await p.fill('#q', 'ok'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); }
  await p.tap('#sheet [data-act="naction"]').catch(() => {}); await p.waitForTimeout(150);
  await p.tap('#sheet [data-act="cv-done"]'); await p.waitForTimeout(150);
  await p.tap('#sheet [data-act="ag-done"]'); await p.waitForTimeout(150);
  await p.tap('#sheet [data-act="nopen"]'); await p.waitForTimeout(150);
  await p.tap('#wait'); await p.waitForTimeout(300); await p.tap('#sheet [data-act="clear-all"]'); await p.waitForTimeout(150);
  await p.evaluate(() => SB.onNative('home'));
  // player
  await p.tap('#cover'); await p.waitForTimeout(600);
  for (const s of ['.pl-play', '[data-act="pl-skip"][data-cmd="next"]', '[data-act="pl-skip"][data-cmd="prev"]']) { await p.tap('#player ' + s); await p.waitForTimeout(200); }
  await p.tap('#player [data-act="media-open"].pl-open'); await p.waitForTimeout(200);
  // app sheet actions
  for (const a of ['app-info', 'app-mute', 'app-mute', 'app-uninstall']) {
    await p.evaluate(() => SB.onNative('home'));
    await p.evaluate(() => document.querySelector('.page .tile').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  }
  // you sheet
  await p.tap('#me'); await p.waitForTimeout(300);
  for (const a of ['[data-act="skin"][data-v="black"]', '[data-act="accent"][data-v="lime"]', '[data-act="url"]', '[data-act="qr"]']) { await p.tap('#sheet ' + a).catch(e => bad.push('tap ' + a)); await p.waitForTimeout(200); }
  await p.evaluate(() => SB.onNative('back'));
  // agenda event, glance event
  await p.tap('.page [data-act="event"]'); await p.tap('#date'); await p.waitForTimeout(300); await p.tap('#sheet [data-act="event"]');
  // native events
  await p.evaluate(() => { SB.onNative('resume'); SB.onNative('perms'); SB.onNative('apps'); SB.onNative('battery', '{"pct":12,"charging":false}'); SB.onNative('events', '[]'); SB.onNative('media', 'null'); SB.onNative('remind', 'x'); });
  await p.waitForTimeout(300);
  console.log('calls', JSON.stringify(await p.evaluate(() => window.__calls)));
  console.log(bad.length ? bad.join('\n') : 'no bridge or page errors');
  await b.close();
})();
