// 回归测试：单型号筛选「标称容量 / 额定电压」精确与范围（闭区间）双模式
// 从 main.js 提取 filter-products handler（带逗号后缀，避免误匹配 filter-products-multi），用 mock ipcMain 执行真实代码
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');

// 提取 cleanFeatures 函数（handler 内部用到）
const cfMatch = src.match(/function cleanFeatures\(html\) \{[\s\S]*?\n\}/);
if (!cfMatch) throw new Error('cleanFeatures 未找到');
eval(cfMatch[0]);

// mock ipcMain，捕获 handler（注意逗号，避免匹配到 filter-products-multi）
const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
const srcHandler = src.match(/ipcMain\.handle\('filter-products',[\s\S]*?\n\}\);/);
if (!srcHandler) throw new Error('filter-products handler 未找到');
eval(srcHandler[0]);

const fn = handlers['filter-products'];
const event = { sender: { send: () => {} } };

// 测试产品库：容量/电压离散档混排
const products = {
  list: [
    { productName: 'P001', features: '', size: '0402/1005M', tempCharacteristics: 'X7R', capacity: '1uF',   capacityDeviation: '±10%', voltage: '25'  },
    { productName: 'P002', features: '', size: '0603/1608M', tempCharacteristics: 'X7R', capacity: '4.7uF', capacityDeviation: '±10%', voltage: '16'  },
    { productName: 'P003', features: '', size: '0805/2012M', tempCharacteristics: 'X5R', capacity: '10uF',  capacityDeviation: '±20%', voltage: '6.3' },
    { productName: 'P004', features: '', size: '0603/1608M', tempCharacteristics: 'X7R', capacity: '100nF', capacityDeviation: '±10%', voltage: '50'  },
    { productName: 'P005', features: '', size: '0805/2012M', tempCharacteristics: 'X5R', capacity: '22uF',  capacityDeviation: '±20%', voltage: '100' },
    { productName: 'P006', features: '', size: '0402/1005M', tempCharacteristics: 'C0G', capacity: '47nF',  capacityDeviation: '±5%',  voltage: '25'  },
    { productName: 'P007', features: '', size: '0603/1608M', tempCharacteristics: 'X7R', capacity: 'N/A',   capacityDeviation: '',     voltage: 'N/A' }
  ]
};

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}
const names = r => r.data.map(d => d.productName);

(async () => {
  // 1. 精确模式不回归：单值 + 单位换算
  let r = await fn(event, { products, filterForm: { capacityMode: 'exact', capacityValue: '0.1', capacityUnit: 'uF' } });
  check('精确模式 0.1uF=100nF 命中', names(r).join(',') === 'P004');

  // 兼容旧表单：无 mode 字段按精确处理
  r = await fn(event, { products, filterForm: { capacityValue: '10', capacityUnit: 'pF' } });
  check('无 mode 字段兼容为精确', r.error && r.error.includes('至少设置一个') === false && r.data.length === 0 || (r.data && r.data.length === 0));
  // 10pF 库中无对应 → 0 条；关键是没走范围分支也没报错
  check('旧表单字段不报错', !r.error);

  // 2. 范围闭区间：1uF ~ 10uF 含两端
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '1', capacityTo: '10', capacityUnit: 'uF' } });
  check('闭区间 1~10uF 含边界命中 3 条', names(r).join(',') === 'P001,P002,P003');

  // 3. 范围 + nF 单位换算：100nF ~ 1000nF
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '100', capacityTo: '1000', capacityUnit: 'nF' } });
  check('nF 范围命中 100nF 与 1uF', names(r).join(',') === 'P001,P004');

  // 3b. from/to 各自单位独立换算：1000pF ~ 1uF（to 端用 capacityToUnit）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '1000', capacityUnit: 'pF', capacityTo: '1', capacityToUnit: 'uF' } });
  check('跨单位 1000pF~1uF', names(r).join(',') === 'P001,P004,P006');

  // 3c. 旧表单无 capacityToUnit 字段：回退共用 capacityUnit（100~1000，按 nF）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '100', capacityTo: '1000', capacityUnit: 'nF', capacityToUnit: undefined } });
  check('无 toUnit 字段回退共用单位', names(r).join(',') === 'P001,P004');

  // 4. 开区间：只填 from（>= 下限）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '10', capacityUnit: 'uF' } });
  check('只填 from = >=10uF', names(r).join(',') === 'P003,P005');

  // 5. 开区间：只填 to（<= 上限）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityTo: '0.1', capacityUnit: 'uF' } });
  check('只填 to = <=0.1uF', names(r).join(',') === 'P004,P006');

  // 6. 容量 from > to 报错
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '10', capacityTo: '1', capacityUnit: 'uF' } });
  check('容量下限>上限报错', !!r.error && r.error.includes('标称容量范围无效'));

  // 7. 无法解析容量的产品在范围模式下被剔除
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '1', capacityTo: '100', capacityUnit: 'uF' } });
  check('N/A 容量不命中', !names(r).includes('P007'));

  // 8. 电压范围闭区间：16 ~ 50V 含两端（P001=25、P006=25 也在区间内）
  r = await fn(event, { products, filterForm: { voltageMode: 'range', voltageFrom: '16', voltageTo: '50' } });
  check('电压闭区间 16~50V', names(r).join(',') === 'P001,P002,P004,P006');

  // 9. 电压开区间：只填 from
  r = await fn(event, { products, filterForm: { voltageMode: 'range', voltageFrom: '25' } });
  check('电压只填 from = >=25V', names(r).join(',') === 'P001,P004,P005,P006');

  // 10. 电压开区间：只填 to
  r = await fn(event, { products, filterForm: { voltageMode: 'range', voltageTo: '16' } });
  check('电压只填 to = <=16V', names(r).join(',') === 'P002,P003');

  // 11. 电压 from > to 报错
  r = await fn(event, { products, filterForm: { voltageMode: 'range', voltageFrom: '50', voltageTo: '16' } });
  check('电压下限>上限报错', !!r.error && r.error.includes('额定电压范围无效'));

  // 12. 电压精确模式不回归（mode 缺省按精确）
  r = await fn(event, { products, filterForm: { voltageValue: '6.3' } });
  check('电压精确 6.3V 不回归', names(r).join(',') === 'P003');

  // 13. 容量+电压范围叠加（AND）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '1', capacityTo: '10', capacityUnit: 'uF', voltageMode: 'range', voltageFrom: '16', voltageTo: '25' } });
  check('容量电压范围叠加', names(r).join(',') === 'P001,P002');

  // 14. 范围全空 + 有其他条件 = 该条件不筛选，按其他条件正常筛（2026-10-27 皇上圣裁，不报错）
  r = await fn(event, { products, filterForm: { temps: ['X7R'], capacityMode: 'range', capacityFrom: '', capacityTo: '' } });
  check('范围全空+其他条件=不筛选不报错', !r.error && r.data.length === 4);

  // 15. 整张表单无任何条件（范围全空且别处也空）→ 沿用空表单兜底报错（皇上圣裁保留，防全库卡顿）
  r = await fn(event, { products, filterForm: { capacityMode: 'range', capacityFrom: '', capacityTo: '' } });
  check('整表单全空报「请至少设置一个筛选条件」', !!r.error && r.error.includes('请至少设置一个筛选条件'));

  // 15. hasCondition：仅范围条件时不报「请至少设置一个筛选条件」
  r = await fn(event, { products, filterForm: { voltageMode: 'range', voltageFrom: '1000' } });
  check('仅范围条件放行（无命中）', !r.error && r.data.length === 0);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
