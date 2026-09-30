// 一次性排查：只读 Chrome 各 profile 的 Preferences / Local State，看与"刷新顶部闪黑带"相关的开关
// （主题、强制暗色、书签栏、硬件加速、窗口位置）。跑完即可删除。
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\dsk\\AppData\\Local\\Google\\Chrome\\User Data';

const pick = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { __err: e.message.slice(0, 50) }; } };

const KEYS = [
  'extensions.theme.id', 'extensions.theme.use_system', 'extensions.theme.preferred_color_scheme',
  'browser.theme.use_system', 'browser.theme.color_scheme', 'browser.theme.id',
  'browser.enabled_labs_experiments', 'browser.append_tab_in_new_window',
  'bookmark_bar.show_on_all_bookmarks_pages', 'browser.show_bookmarks_bar',
  'browser.window_placement', 'session.restore_on_startup',
  'appearance.theme', 'appearance.color_scheme_type', 'appearance.side_panel_style',
  'profile.avatar_icon', 'account_info',
];
const LOCAL_KEYS = ['hardware_acceleration_mode.enabled', 'browser.enabled_labs_experiments'];

const ls = read(path.join(ROOT, 'Local State'));
console.log('Local State:', JSON.stringify(Object.fromEntries(KEYS.length && LOCAL_KEYS.map((k) => [k, pick(ls, k)]).filter(([, v]) => v !== undefined))));

for (const d of fs.readdirSync(ROOT).filter((x) => /^Default$|^Profile /.test(x)).sort()) {
  const f = path.join(ROOT, d, 'Preferences');
  if (!fs.existsSync(f)) continue;
  const j = read(f);
  const out = {};
  for (const k of KEYS) {
    const v = pick(j, k);
    if (v === undefined) continue;
    out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v;
  }
  const who = Array.isArray(j.account_info) && j.account_info[0] ? j.account_info[0].email || j.account_info[0].full_name : undefined;
  delete out.account_info;
  console.log(`\n[${d}]${who ? ' ' + who : ''} mtime=${fs.statSync(f).mtime.toISOString().slice(0, 16)}`);
  console.log('  ' + JSON.stringify(out));
}
