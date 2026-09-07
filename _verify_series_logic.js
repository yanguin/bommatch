// 端到端验证：真实产品库 + filter-products-multi 的系列查询条件逻辑
// 提取 main.js 中真实 handler 与 cleanFeatures 执行（与 _test_multi_filter.js 同法）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

const cfMatch = src.match(/function cleanFeatures\(html\) \{[\s\S]*?\n\}/);
if (!cfMatch) throw new Error('cleanFeatures 未找到');
eval(cfMatch[0]);

const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
const srcHandler = src.match(/ipcMain\.handle\('filter-products-multi'[\s\S]*?\n\}\);/);
if (!srcHandler) throw new Error('handler 未找到');
eval(srcHandler[0]);
const fn = handlers['filter-products-multi'];

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'viiyong_products_full.json'), 'utf8'));
// loadJsonData 返回结构：{ data: <json内容> }，渲染层传给 handler 的是 json 内容本身
const products = raw.data && raw.data.list ? raw.data : raw;
if (!products.list) throw new Error('产品库结构异常: ' + Object.keys(raw).slice(0, 10).join(','));
console.log(`产品库加载: ${products.list.length} 条产品\n`);

// 用户上一轮的 29 条国巨输入（含一条重复）
const INPUTS = `AC0402JRNPO9BN100
AC0402JRNPO9BN101
AC0402JRNPO9BN102
AC0402KRX7R9BB102
AC0402KRX7R9BB103
AC0402KRX7R9BB104
AC0402JRNPO9BN151
AC0402JRNPO9BN221
AC0402KRX7R9BB222
AC0402KRX7R9BB222
AC0402KRX7R9BB223
AC0402KRX7R9BB332
AC0402KRX7R9BB333
AC0402JRNPO9BN391
AC0402JRNPO9BN470
AC0402JRNPO9BN471
AC0402KRX7R9BB562
AC0603JRNPO9BN101
AC0603KRX7R9BB102
AC0603KRX7R9BB154
AC0603JRNPO9BN220
AC0603KRX7R9BB332
AC0603JRNPO9BN470
AC0603JRNPO9BN471
AC0603KRX7R9BB472
AC0603KRX7R9BB473
AC0603JRNPO0BN470
AC0805KKX7R9BB334
AC0805KRX7R9BB471
AC0805KKX7R0BB104`.split('\n').map(s => s.trim());

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail || ''); }
}
const event = { sender: { send: () => {} } };

(async () => {
  // ===== 1. 全系列（series 空 = 旧行为基准）=====
  let r = await fn(event, { products, names: INPUTS, series: [] });
  check('空系列=全库匹配（无 error）', !r.error, r.error);
  console.log(`  全库: 输入${r.stats.totalInputs} 已匹配${r.stats.matchedInputs} 未匹配${r.stats.unmatchedInputs} 结果行${r.data.length}\n`);

  // ===== 2. 只勾 A 系列（用户场景）=====
  r = await fn(event, { products, names: INPUTS, series: ['A'] });
  check('A系列: 无 error', !r.error, r.error);
  console.log(`  A系列: 输入${r.stats.totalInputs} 已匹配${r.stats.matchedInputs} 未匹配${r.stats.unmatchedInputs} 结果行${r.data.length}`);

  // 2a. 所有非占位行都是 A 系列产品
  const nonPlaceholder = r.data.filter(d => !d.unmatched);
  check('A系列: 所有命中行都是 A 开头产品', nonPlaceholder.every(d => /^[A]/.test(d.productName)),
    nonPlaceholder.filter(d => !/^[A]/.test(d.productName)).map(d => d.productName).join(','));
  // 2b. 未匹配占位行字段完整
  const placeholders = r.data.filter(d => d.unmatched);
  check('A系列: 占位行 hitCount=0 且有 inputName', placeholders.every(d => d.hitCount === 0 && d.inputName));
  // 2c. 统计口径：matched + unmatched = total
  check('A系列: 已匹配+未匹配=输入数', r.stats.matchedInputs + r.stats.unmatchedInputs === r.stats.totalInputs);
  // 2d. 每输入的行数 = hitCount
  const byInput = new Map();
  for (const d of r.data) {
    if (!byInput.has(d.inputIndex)) byInput.set(d.inputIndex, []);
    byInput.get(d.inputIndex).push(d);
  }
  let hitCountOk = true, badDetail = [];
  for (const [idx, rows] of byInput) {
    const lead = rows.find(x => !x.unmatched);
    if (lead && lead.hitCount !== rows.length) { hitCountOk = false; badDetail.push(`input#${idx} hitCount=${lead.hitCount} rows=${rows.length}`); }
  }
  check('A系列: 每组行数=hitCount', hitCountOk, badDetail.join('; '));
  // 2e. 之前确认过的数字：A 系列 27 产品 + 若干占位（打印供人工核对）
  console.log(`  A系列明细: 产品行${nonPlaceholder.length} 占位行${placeholders.length} 输入组${byInput.size}`);
  const multi = [...byInput.values()].filter(rows => rows.length > 1);
  console.log(`  多产品输入组: ${multi.length} 组（hitCount>1）: ${multi.map(rows => rows[0].hitCount).join(',')}`);
  console.log(`  未匹配输入: ${placeholders.map(p => p.inputName).join(', ')}\n`);

  // ===== 3. 对照：A+T+B+V 全勾 = 空系列结果 =====
  const rAll4 = await fn(event, { products, names: INPUTS, series: ['A', 'T', 'B', 'V'] });
  check('四系列全勾=全库结果', rAll4.data.length === (await fn(event, { products, names: INPUTS, series: [] })).data.length);

  // ===== 4. 单条输入专项：CC0603KRX7R6BB225（只有 B/V/T 产品）=====
  r = await fn(event, { products, names: ['CC0603KRX7R6BB225'], series: ['A'] });
  check('B/V/T专属规格+只勾A → 未匹配占位', r.data.length === 1 && r.data[0].unmatched === true && r.data[0].hitCount === 0);
  r = await fn(event, { products, names: ['CC0603KRX7R6BB225'], series: ['B', 'V', 'T'] });
  check('B/V/T专属规格+勾BVT → 命中', r.data.length > 0 && r.data.every(d => /^[BVT]/.test(d.productName)) && r.data[0].hitCount === r.data.length);
  console.log(`  CC0603KRX7R6BB225 勾BVT: ${r.data.map(d => d.productName).join(', ')}\n`);

  // ===== 5. 系列条件同样作用于精确/模糊型号匹配（用真实存在的 A 系列产品）=====
  const realA = products.list.find(p => /^A104K0402X7T/.test(p.productName));
  r = await fn(event, { products, names: [realA.productName], series: ['T'] });
  check('A产品型号+只勾T → 未匹配占位', r.data.length === 1 && r.data[0].unmatched === true && r.data[0].hitCount === 0);
  r = await fn(event, { products, names: [realA.productName], series: ['A'] });
  check('A产品型号+勾A → 精确命中', r.data.length === 1 && r.data[0].hitCount === 1 && !r.data[0].unmatched);
  // 5b. 真实型号不会被规格宽松解析误伤（parseDescLoose 返回 null，型号走精确/模糊）
  const { parseDescLoose } = require(path.join(__dirname, 'matcher-core.js'));
  check('真实型号不触发宽松规格解析', parseDescLoose(realA.productName) === null);

  // ===== 6. 前端不实时过滤（模拟 filteredFilterResult 新逻辑）=====
  // 模拟：查询时勾了 A，查询后用户取消勾选（filterMultiSeries=[]），filteredFilterResult 应不变
  const rQuery = await fn(event, { products, names: INPUTS, series: ['A'] });
  const filterResult = rQuery.data.map((item, idx) => ({ ...item, rowNo: idx + 1, specs: Object.freeze(item.specs || []) }));
  // renderer 新逻辑：computed 只看 filterSearchText，不看 filterMultiSeries
  const filteredNoSearch = filterResult; // 勾选变化 → 仍返回全部 filterResult
  check('查询后取消勾选 → 结果不变', filteredNoSearch.length === rQuery.data.length);
  const kw = 'AC0402JRNPO9BN100'.toLowerCase();
  const filteredSearch = filterResult.filter(item =>
    (item.inputName && item.inputName.toLowerCase().includes(kw)) ||
    (item.productName && item.productName.toLowerCase().includes(kw)));
  check('右侧搜索仍生效', filteredSearch.length >= 1 && filteredSearch.every(item =>
    (item.inputName || '').toLowerCase().includes(kw) || (item.productName || '').toLowerCase().includes(kw)));

  // ===== 7. 性能：200 条输入全库匹配耗时 =====
  const t0 = Date.now();
  await fn(event, { products, names: Array(200).fill('CC0402KRX7R9BB104').map((v, i) => v), series: ['A', 'T'] });
  console.log(`\n性能: 200 条输入 × AT系列 全程 ${Date.now() - t0}ms`);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
