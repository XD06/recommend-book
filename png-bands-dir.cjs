// 一次性：批量扫描目录内 PNG，找"整幅宽度的暗行段"（用户截图里 24px 全宽纯黑横带的特征）。跑完删除。
// 用法: node png-bands-dir.cjs <目录> [暗度阈值=40] [最小宽度占比=0.8]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : (() => { throw new Error('unsupported colorType ' + colorType); })();
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported bitDepth=${bitDepth} interlace=${interlace}`);
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

const dir = process.argv[2];
const TH = Number(process.argv[3] || 40);
const MINW = Number(process.argv[4] || 0.8);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const rows = [];
for (const f of files) {
  const { w, h, ch, stride, out } = decode(path.join(dir, f));
  const bands = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    let n = 0;
    const base = y * stride;
    for (let x = 0; x < w; x += 2) {
      const o = base + x * ch;
      if (0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2] < TH) n++;
    }
    const frac = n / (w / 2);
    if (frac >= MINW) { if (start < 0) start = y; }
    else { if (start >= 0) { bands.push([start, y - 1]); start = -1; } }
  }
  if (start >= 0) bands.push([start, h - 1]);
  const wide = bands.filter(([a, b]) => b - a >= 2);
  if (wide.length) rows.push({ file: f, w, h, bands: wide.map(([a, b]) => `y=${a}..${b} (${b - a + 1}px)`) });
}
console.log(JSON.stringify({ dir, threshold: TH, minRowFrac: MINW, frames: files.length, framesWithFullWidthDarkBand: rows.length, hits: rows.slice(0, 20) }, null, 1));
