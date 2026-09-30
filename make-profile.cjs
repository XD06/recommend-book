// 一次性排查：造一个只含"主题/外观"偏好的空 Chrome profile 目录（不含任何用户数据），
// 用来在受控浏览器里复现"自定义浏览器主题 → 刷新时内容区顶部闪黑带"。跑完即可删除。
// 用法: node make-profile.cjs <目录> [--no-theme]
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const withTheme = !process.argv.includes('--no-theme');

// 下面这组值是从用户 Default profile 的 Preferences 里读出来的（仅主题相关，无个人数据）
const theme = {
  color_scheme: 1, color_scheme2: 1,
  color_variant: 2, color_variant2: 2,
  follows_system_colors: false,
  saved_local_theme: 'CAAQAEgB',
  user_color: -205879, user_color2: -205879,
};

fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({}));
fs.writeFileSync(
  path.join(dir, 'Default', 'Preferences'),
  JSON.stringify({
    browser: { theme: withTheme ? theme : {} },
    extensions: withTheme ? { theme: { id: 'user_color_theme_id' } } : {},
    profile: { exit_type: 'Normal', was_clean: true },
  }, null, 1),
);
console.log('profile =', dir, '| theme =', withTheme ? 'user_color_theme_id (RGB 252,219,104)' : 'none');
