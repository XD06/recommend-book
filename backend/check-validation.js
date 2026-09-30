// 离线验证 recommendValidation 的清洗逻辑（零 token、确定性）
// 用法：node check-validation.js
'use strict';
const path = require('path');
const { validateAdvisorJson } = require(path.join(__dirname, 'dist', 'services', 'recommendValidation.js'));

const library = [
  { id: 'id-1', title: '悉达多', author: '黑塞', category: '文学', subcategory: '小说' },
  { id: 'id-2', title: '深入理解计算机系统', author: 'Bryant', category: '计算机科学', subcategory: '系统' },
  { id: 'id-3', title: '思考，快与慢（第2版）', author: '卡尼曼', category: '心理学', subcategory: '认知' },
];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

// 1. 幻觉 bookId 用书名修复
{
  const raw = JSON.stringify({
    mode: 'recommendation',
    libraryMatches: [{ bookId: 'fake-uuid', title: '《悉达多》', reason: 'r', relevanceScore: 0.9 }],
    externalMatches: [],
  });
  const { validation } = validateAdvisorJson(raw, library);
  check('幻觉 bookId 被书名修复', validation.repaired === 1 && validation.dropped === 0, JSON.stringify(validation));
}

// 2. 修不掉的丢弃
{
  const raw = JSON.stringify({
    mode: 'recommendation',
    libraryMatches: [{ bookId: 'fake', title: '完全不存在的书XYZ', reason: 'r' }],
    externalMatches: [],
  });
  const { validation } = validateAdvisorJson(raw, library);
  check('修不掉的被丢弃', validation.dropped === 1 && validation.kept === 0, JSON.stringify(validation));
}

// 3. 【P0-5】站外推荐与书库重复 → 必须剔除（提示词红线第 4 条）
{
  const raw = JSON.stringify({
    mode: 'recommendation',
    libraryMatches: [{ bookId: 'id-1', title: '悉达多', reason: 'r' }],
    externalMatches: [
      { title: '悉达多', author: '黑塞', reason: '站外推了一本库里已有的书' },
      { title: '《悉达多》', author: '赫尔曼·黑塞', reason: '带书名号也算同一本' },
      { title: '助推', author: '塞勒', reason: '这本真的不在库里' },
    ],
  });
  const { json, validation } = validateAdvisorJson(raw, library);
  const out = JSON.parse(json);
  check('重复的站外推荐被剔除（含《》写法）', out.externalMatches.length === 1 && out.externalMatches[0].title === '助推', JSON.stringify(out.externalMatches.map((e) => e.title)));
  check('被剔除的书名留证在 externalDuplicates', (validation.externalDuplicates || []).length === 2, JSON.stringify(validation.externalDuplicates));
}

// 4. 只有 externalMatches、没有 libraryMatches 时也必须去重（旧的提前 return 会漏掉这条）
{
  const raw = JSON.stringify({
    mode: 'recommendation',
    libraryMatches: [],
    externalMatches: [{ title: '思考，快与慢', author: '卡尼曼', reason: '版次不同也要认出来' }],
  });
  const { json, validation } = validateAdvisorJson(raw, library);
  check('空 libraryMatches 时仍做站外去重', JSON.parse(json).externalMatches.length === 0 && (validation.externalDuplicates || []).length === 1, JSON.stringify(validation));
}

// 5. 不同册的书不能被误并（副标题保留策略）
{
  const lib2 = [
    { id: 'a', title: '明朝那些事儿（第1部）', author: '当年明月', category: '历史', subcategory: '中国史' },
    { id: 'b', title: '明朝那些事儿（第2部）', author: '当年明月', category: '历史', subcategory: '中国史' },
  ];
  const raw = JSON.stringify({
    mode: 'recommendation',
    libraryMatches: [],
    externalMatches: [{ title: '明朝那些事儿', author: '当年明月', reason: '只给主标题，同名多本时不该猜' }],
  });
  const { json } = validateAdvisorJson(raw, lib2);
  check('同名多本不误判为重复', JSON.parse(json).externalMatches.length === 1);
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
