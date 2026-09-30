// 一次性排查：自动化 Chromium + 真实 reload + 窄横带高帧率连拍，看 24px 顶部黑带是否能在受控浏览器里复现。跑完删除。
// 用法: node strip-reload.cjs [--url=http://localhost:5173/] [--ms=6000] [--extra-chrome-arg=...]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const EXE = 'C:\\Users\\dsk\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';
const OUT = 'strip';
const URL = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:5173/';
const MS = Number(process.argv.find((a) => a.startsWith('--ms='))?.split('=')[1] || 6000);
const RELAY = process.argv.find((a) => a.startsWith('--y='))?.split('=')[1];
const HH = process.argv.find((a) => a.startsWith('--h='))?.split('=')[1];
const NORELOAD = process.argv.includes('--no-reload');
const CHROME_EXE = process.argv.find((a) => a.startsWith('--exe='))?.split('=').slice(1).join('=') || EXE;
const MAX = process.argv.includes('--max');
const PROFILE = process.argv.find((a) => a.startsWith('--profile='))?.split('=').slice(1).join('=');

function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : (() => { throw new Error('colorType ' + ct); })();
  if (bd !== 8 || il !== 0) throw new Error(`bitDepth=${bd} interlace=${il}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, stride, out };
}

// 每帧：找出"整幅宽度 90% 以上都是暗像素"的连续行段（=用户截图里那条全宽黑带的特征）
function bandsOf(file, TH = 40, MINFRAC = 0.9) {
  const { w, h, ch, stride, out } = decode(file);
  const res = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    let n = 0;
    const base = y * stride;
    for (let x = 0; x < w; x += 2) {
      const o = base + x * ch;
      if (0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2] < TH) n++;
    }
    if (n / (w / 2) >= MINFRAC) { if (start < 0) start = y; }
    else { if (start >= 0 && y - 1 - start >= 2) res.push([start, y - 1]); start = -1; }
  }
  if (start >= 0 && h - 1 - start >= 2) res.push([start, h - 1]);
  return { res, w, h };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const args = ['--no-first-run'];
  args.push(MAX ? '--start-maximized' : '--window-position=60,60', ...(MAX ? [] : ['--window-size=1280,860']));
  for (const a of process.argv) if (a.startsWith('--extra=')) args.push(a.slice(6));
  // --profile 时用持久化目录（可预置 Preferences 复现 profile 级状态，如自定义主题）；
  // 不传则 Playwright 给一个全新临时目录（无扩展、无主题、无登录态）
  let browser = null, ctx;
  const ctxOpts = MAX ? { viewport: null } : { viewport: { width: 1200, height: 780 } };
  if (PROFILE) {
    ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: CHROME_EXE, headless: false, args, ...ctxOpts });
  } else {
    browser = await chromium.launch({ executablePath: CHROME_EXE, headless: false, args });
    ctx = await browser.newContext(ctxOpts);
  }
  if (URL.includes('localhost') && fs.existsSync('dev-token.json')) {
    const { user, token } = JSON.parse(fs.readFileSync('dev-token.json', 'utf8'));
    await ctx.addInitScript(([u, tk]) => {
      localStorage.setItem('deepread_token', tk);
      localStorage.setItem('deepread_user', JSON.stringify(u));
    }, [user, token]);
  }
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.bringToFront();
  await sleep(2500);
  const geom = await page.evaluate(() => ({
    dpr: devicePixelRatio, inner: innerWidth + 'x' + innerHeight, outer: outerWidth + 'x' + outerHeight,
    // 内容区顶部相对窗口顶端的 device px 偏移（含标签栏+地址栏+书签栏）
    uiBand: Math.round((outerHeight - innerHeight) * devicePixelRatio),
  }));
  console.log('url =', page.url(), '| title =', await page.title(), '| nodes =', await page.evaluate(() => document.querySelectorAll('*').length));
  console.log('geometry =', JSON.stringify(geom));

  const y = Number(RELAY) || Math.max(0, geom.uiBand - 60);
  const h = Number(HH) || 260;
  const tw = Number(process.argv.find((a) => a.startsWith('--w='))?.split('=')[1]) || 0;
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'strip-capture.ps1',
    '-OutDir', OUT, '-Ms', String(MS), '-Delay', '1200', '-Y', String(y), '-H', String(h), '-W', String(tw)]
    .concat(process.env.AUTOPOP ? ['-AutoPop', process.env.AUTOPOP] : []), { stdio: ['ignore', 'pipe', 'pipe'] });
  let capLog = '';
  child.stdout.on('data', (d) => { capLog += d; process.stdout.write(String(d)); });
  child.stderr.on('data', (d) => { capLog += d; });
  await sleep(1600);
  if (!NORELOAD) {
    for (let n = 1; n <= 3; n++) {
      const t0 = Date.now();
      await page.reload({ waitUntil: 'commit' });
      console.log(`reload#${n} commit +${Date.now() - t0}ms`);
      await page.waitForLoadState('load').catch(() => {});
      console.log(`reload#${n} load +${Date.now() - t0}ms`);
      await sleep(1800);
    }
  }
  await new Promise((res) => child.on('close', res));

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
  const t = (f) => Number(/-(\d+)ms/.exec(f)[1]);
  const hits = [];
  for (const f of files) {
    const { res, w, h } = bandsOf(path.join(OUT, f));
    if (res.length) hits.push({ frame: f, t: t(f), size: w + 'x' + h, bands: res.map(([a, b]) => `y=${a}..${b}(${b - a + 1}px)`) });
  }
  const ivals = [];
  for (let i = 1; i < files.length; i++) ivals.push(t(files[i]) - t(files[i - 1]));
  ivals.sort((a, b) => a - b);
  console.log(JSON.stringify({
    frames: files.length,
    medianIntervalMs: ivals.length ? ivals[Math.floor(ivals.length / 2)] : null,
    maxIntervalMs: ivals.length ? ivals[ivals.length - 1] : null,
    framesWithFullWidthBand: hits.length,
    hits: hits.slice(0, 15),
  }, null, 1));
  if (hits.length) fs.writeFileSync(path.join(OUT, '_bandframes.json'), JSON.stringify(hits, null, 1));
  if (browser) await browser.close(); else await ctx.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
