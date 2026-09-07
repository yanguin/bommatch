// 临时单测：从 main.js 提取 filter-products-multi handler 与 cleanFeatures，用 mock ipcMain 执行真实代码
const fs = require('fs');
const src = fs.readFileSync('C:/Users/yangu/Desktop/viiyong/bommatch/main.js', 'utf8');

// 提取 cleanFeatures 函数
const cfMatch = src.match(/function cleanFeatures\(html\) \{[\s\S]*?\n\}/);
if (!cfMatch) throw new Error('cleanFeatures 未找到');
eval(cfMatch[0]);

// mock ipcMain，捕获 handler
const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
const srcHandler = src.match(/ipcMain\.handle\('filter-products-multi'[\s\S]*?\n\}\);/);
if (!srcHandler) throw new Error('handler 未找到');
eval(srcHandler[0]);

const fn = handlers['filter-products-multi'];

// 构造测试产品库
const products = {
  list: [
    { productName: 'T106K1206X7T100N2P', features: '<span>软端子</span>', size: '1206/3216M', tempCharacteristics: 'X7T', capacity: '10pF', capacityDeviation: '±10%', voltage: '25', specs: [{ Title: 'S1', FileUrl: 'u1' }] },
    { productName: 'B106K0603X7R100N2P', features: '', size: '0603/1608M', tempCharacteristics: 'X7R', capacity: '10pF', capacityDeviation: '±10%', voltage: '50', specs: [] },
    { productName: 'V106K0805X5R100N2P', features: '', size: '0805/2012M', tempCharacteristics: 'X5R', capacity: '10pF', capacityDeviation: '±20%', voltage: '16', specs: [] },
    { productName: 'A106K0402X7R100N2P', features: '', size: '0402/1005M', tempCharacteristics: 'X7R', capacity: '10pF', capacityDeviation: '±10%', voltage: '100', specs: [] }
  ]
};

const event = { sender: { send: () => {} } };
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}

(async () => {
  // 1. 基本顺序 + 精确匹配 + 大小写不敏感
  let r = await fn(event, { products, names: ['t106k1206x7t100n2p', 'B106K0603X7R100N2P'] });
  check('两条精确命中', r.data.length === 2 && r.stats.matchedInputs === 2 && r.stats.unmatchedInputs === 0);
  check('按输入顺序', r.data[0].inputName === 't106k1206x7t100n2p' && r.data[0].productName === 'T106K1206X7T100N2P' && r.data[1].productName === 'B106K0603X7R100N2P');
  check('带 inputIndex', r.data[0].inputIndex === 0 && r.data[1].inputIndex === 1);

  // 2. 模糊匹配（includes 兜底）
  r = await fn(event, { products, names: ['V106'] });
  check('模糊命中', r.data.length === 1 && r.data[0].productName === 'V106K0805X5R100N2P');

  // 3. 未匹配计数 + 占位行（未匹配输入在表格中可见）
  r = await fn(event, { products, names: ['T106K1206X7T100N2P', 'ZZZZZZ'] });
  check('未匹配计数', r.stats.totalInputs === 2 && r.stats.matchedInputs === 1 && r.stats.unmatchedInputs === 1);
  check('未匹配占位行', r.data.length === 2 && r.data[1].unmatched === true && r.data[1].inputName === 'ZZZZZZ');
  check('productCount 排除占位行', r.stats.productCount === 1);

  // 4. 不同输入命中同一产品：各自生成行（便于逐行核对）
  r = await fn(event, { products, names: ['T106K1206X7T100N2P', 'T106'] });
  check('重复命中各自成行', r.data.length === 2 && r.data[0].inputIndex === 0 && r.data[1].inputIndex === 1 && r.data[1].productName === 'T106K1206X7T100N2P');

  // 4b. 重复输入不去重：各自成组、各自计数（与用户输入一一对应）
  r = await fn(event, { products, names: ['T106K1206X7T100N2P', 't106k1206x7t100n2p'] });
  check('重复输入各自成行', r.stats.totalInputs === 2 && r.data.length === 2 && r.data.every(d => d.productName === 'T106K1206X7T100N2P'));

  // 5. names 为空 / 非数组
  r = await fn(event, { products, names: [] });
  check('空 names 报错', !!r.error);
  r = await fn(event, { products, names: 'x' });
  check('非数组 names 报错', !!r.error);

  // 6. products 未加载
  r = await fn(event, { products: null, names: ['A'] });
  check('products 防御', r.error === '产品数据未加载');

  // 7. 元素校验：非字符串/超长剔除
  r = await fn(event, { products, names: [123, 'x'.repeat(101), '   ', 'A106K0402X7R100N2P'] });
  check('剔除无效元素', r.data.length === 1 && r.stats.totalInputs === 1);

  // 8. 超 200 行截断（未匹配输入也生成占位行）
  const many = [];
  for (let i = 0; i < 205; i++) many.push('NOMATCH' + i);
  many[0] = 'T106K1206X7T100N2P';
  r = await fn(event, { products, names: many });
  check('截断 200 + truncated', r.truncated === true && r.stats.totalInputs === 200 && r.data.length === 200 && r.stats.productCount === 1 && r.stats.unmatchedInputs === 199);

  // 9. specs/features 透传
  r = await fn(event, { products, names: ['T106K1206X7T100N2P'] });
  check('specs 透传', Array.isArray(r.data[0].specs) && r.data[0].specs.length === 1);
  check('features 清洗', r.data[0].features === '软端子');

  // 10. 规格描述匹配（容量为锚定字段）；无命中生成占位行
  r = await fn(event, { products, names: ['CCAP,560pF,±10%,50V,X7R,SMD0402'] });
  check('规格无匹配产品', r.stats.unmatchedInputs === 1 && r.data.length === 1 && r.data[0].unmatched === true);

  // 构造含规格可命中产品的库：10pF ±10% 50V X7R 0402
  const products2 = {
    list: [
      { productName: 'B104K0402X7R500N2P', features: '', size: '0402/1005M', tempCharacteristics: 'X7R', capacity: '100pF', capacityDeviation: '±10%', voltage: '50', specs: [] },
      { productName: 'A104K0402X7R500N2P', features: '', size: '0402/1005M', tempCharacteristics: 'X7R', capacity: '100pF', capacityDeviation: '±10%', voltage: '50', specs: [] },
      { productName: 'V104K0402X7R500N2P', features: '', size: '0402/1005M', tempCharacteristics: 'X7R', capacity: '100pF', capacityDeviation: '±10%', voltage: '50', specs: [] },
      { productName: 'B104K0402C0G500N2P', features: '', size: '0402/1005M', tempCharacteristics: 'C0G', capacity: '100pF', capacityDeviation: '±5%', voltage: '50', specs: [] },
      { productName: 'B224K0603X7R500N2P', features: '', size: '0603/1608M', tempCharacteristics: 'X7R', capacity: '220pF', capacityDeviation: '±10%', voltage: '50', specs: [] }
    ]
  };

  // 11. 规格描述：全字段命中（多产品，跨系列）
  r = await fn(event, { products: products2, names: ['CCAP,100pF,±10%,50V,X7R,SMD0402'] });
  check('规格全字段多产品命中', r.stats.matchedInputs === 1 && r.data.length === 3);
  check('规格命中产品集合', r.data.every(d => ['B104K0402X7R500N2P', 'A104K0402X7R500N2P', 'V104K0402X7R500N2P'].includes(d.productName)));
  check('规格 inputName 透传', r.data[0].inputName === 'CCAP,100pF,±10%,50V,X7R,SMD0402');

  // 12. 规格描述：NP0 归一 C0G + 偏差过滤
  r = await fn(event, { products: products2, names: ['CCAP,100pF,±5%,50V,NP0,SMD0402'] });
  check('NP0 归一 C0G 命中', r.data.length === 1 && r.data[0].productName === 'B104K0402C0G500N2P');

  // 13. 规格描述：容量换算（nF/uF）
  r = await fn(event, { products: products2, names: ['CCAP,0.22nF,±10%,50V,X7R,SMD0603'] });
  check('nF 换算命中 0603', r.data.length === 1 && r.data[0].productName === 'B224K0603X7R500N2P');

  // 14. 型号 + 规格混合输入
  r = await fn(event, { products: products2, names: ['B104K0402C0G500N2P', 'CCAP,100pF,±10%,50V,X7R,SMD0402', 'ZZZ'] });
  check('混合输入统计', r.stats.totalInputs === 3 && r.stats.matchedInputs === 2 && r.stats.unmatchedInputs === 1);
  check('混合输入结果含型号与规格命中', r.data.length === 5 && r.data.filter(d => d.unmatched).length === 1);

  // 15. 无容量字段不触发规格匹配（纯型号误输入防误判；避开产品名子串）
  r = await fn(event, { products: products2, names: ['FOOBAR'] });
  check('无容量不触发规格匹配', r.stats.unmatchedInputs === 1 && r.data.length === 1 && r.data[0].unmatched === true);

  // 16. 系列查询条件：限定搜索范围（products2 中 100pF/X7R/0402 规格分布在 A/B/V 三系列）
  r = await fn(event, { products: products2, names: ['CCAP,100pF,±10%,50V,X7R,SMD0402'], series: ['A'] });
  check('系列限定只搜 A', r.data.length === 1 && r.data[0].productName === 'A104K0402X7R500N2P');
  check('系列限定命中数 hitCount', r.data[0].hitCount === 1);
  // 16b. 所选系列无该规格产品 → 未匹配占位行（hitCount 0）
  r = await fn(event, { products: products2, names: ['CCAP,100pF,±10%,50V,X7R,SMD0402'], series: ['T'] });
  check('系列内无产品→未匹配占位', r.stats.unmatchedInputs === 1 && r.data.length === 1 && r.data[0].unmatched === true && r.data[0].hitCount === 0);
  // 16c. 系列限定作用于精确/模糊匹配
  r = await fn(event, { products, names: ['T106K1206X7T100N2P'], series: ['A'] });
  check('系列限定精确匹配', r.stats.unmatchedInputs === 1 && r.data[0].unmatched === true);
  r = await fn(event, { products, names: ['T106K1206X7T100N2P'], series: ['T'] });
  check('系列内精确命中', r.data.length === 1 && r.data[0].hitCount === 1);
  // 16d. series 非法值防御：只认 A/T/B/V，纯非法值集 = 不过滤；空数组 = 不过滤
  r = await fn(event, { products, names: ['T106K1206X7T100N2P'], series: ['X'] });
  check('非法系列值忽略', r.data.length === 1 && r.data[0].productName === 'T106K1206X7T100N2P');
  r = await fn(event, { products, names: ['T106K1206X7T100N2P'], series: [] });
  check('空系列不过滤', r.data.length === 1 && r.data[0].productName === 'T106K1206X7T100N2P');

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
