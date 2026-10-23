// 复制格式模板引擎回归测试（不依赖 Electron）
// 做法：从 renderer.js 中按注释标记切出 getCopyFieldVal / fillCopyTemplate 方法体，
// 用 mock 行数据验证 6 个内置预设的输出与设计示例逐字一致 + 边界用例。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

const START = '    // ---- 模板化复制：字段取值 / 模板填充 / 按预设复制 ----';
const END = '    // 记住上次使用的预设';
const i0 = src.indexOf(START);
const i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0 || i1 <= i0) {
  console.error('FAIL: 未能在 renderer.js 中定位模板引擎代码块');
  process.exit(1);
}
const block = src.slice(i0, i1);

// eval 上下文需要内置预设表（从 renderer.js 原样抽出 COPY_BUILT_IN_PRESETS 定义，保证同源）
const m = src.match(/const COPY_BUILT_IN_PRESETS = \[[\s\S]*?\];/);
if (!m) { console.error('FAIL: 未找到 COPY_BUILT_IN_PRESETS'); process.exit(1); }
let methods;
eval(m[0].replace('const COPY_BUILT_IN_PRESETS', 'var COPY_BUILT_IN_PRESETS') + '\nmethods = ({' + block + '});');

const ctx = Object.assign({}, methods, { copyCustomPresets: [] });

// mock 行：与设计示例对齐的真实字段形态
const row = {
  productName: 'T225K0402X5R100NCT',
  inputName: '输入的原型号',
  size: '0402/1005M',
  tempCharacteristics: 'X5R(-55℃~85℃)',
  capacity: '2.2uF',
  capacityDeviation: '±10%',
  voltage: 10,
  unmatched: false
};
const ID = 'modelSpec';
const PRESETS = ['modelSpec', 'spec', 'spec2model', 'erpLookup', 'erpFull', 'origDesc', 'modelInput'];

// 期望输出（皇上钦定的示例）
const EXPECT = {
  modelSpec:  'T225K0402X5R100NCT/0402/X5R/2.2uF/±10%/10V',
  spec:       '0402/X5R/2.2uF/±10%/10V',
  spec2model: '0402/X5R/2.2uF/±10%/10V==》T225K0402X5R100NCT',
  erpLookup:  'CCAP,2.2UF,±10%,10V,X5R,SMD0402==》T225K0402X5R100NCT',
  erpFull:    'CCAP,2.2UF,±10%,10V,X5R,SMD0402,T225K0402X5R100NCT',
  origDesc:   'CCAP,2.2UF,±10%,10V,X5R,SMD0402',
  modelInput: 'T225K0402X5R100NCT/输入的原型号'
};

let pass = 0, fail = 0;
for (const id of PRESETS) {
  const p = COPY_BUILT_IN_PRESETS.find(x => x.id === id);
  const out = ctx.fillCopyTemplate(p, row);
  if (out === EXPECT[id]) { pass++; console.log(`PASS  ${id}: ${out}`); }
  else { fail++; console.log(`FAIL  ${id}\n  期望: ${EXPECT[id]}\n  实际: ${out}`); }
}

// ---- 边界用例 ----
const edgeCases = [
  // 暂无匹配行：规格全空 + 型号走「暂无匹配」，spec2model 下悬空 ==》 应被清理
  { name: 'unmatched行清理悬空推导符',
    row: { unmatched: true, productName: '', size: '', tempCharacteristics: '', capacity: '', capacityDeviation: '', voltage: '' },
    preset: 'spec2model', expect: '暂无匹配' },
  // 字段中间空段省略：无偏差时用 / 连接不留空段
  { name: '空段自动省略',
    row: { unmatched: false, productName: '', size: '0603', tempCharacteristics: 'C0G(-55℃~125℃)', capacity: '100nF', capacityDeviation: '', voltage: 50 },
    preset: 'spec', expect: '0603/C0G/100nF/50V' },
  // 单型号模式无 inputName：modelInput 只剩型号
  { name: '输入型号为空省略',
    row: { unmatched: false, productName: 'T104K0201X5R100NJT', inputName: '', size: '', tempCharacteristics: '', capacity: '', capacityDeviation: '', voltage: '' },
    preset: 'modelInput', expect: 'T104K0201X5R100NJT' },
  // 风格关闭时容值/封装保持原样
  { name: '非ERP预设不做大写与SMD',
    row: { unmatched: false, productName: '', size: '0402/1005M', tempCharacteristics: 'X5R(-55℃~85℃)', capacity: '2.2uF', capacityDeviation: '±10%', voltage: 10 },
    preset: 'spec', expect: '0402/X5R/2.2uF/±10%/10V' },
];
for (const c of edgeCases) {
  const p = COPY_BUILT_IN_PRESETS.find(x => x.id === c.preset);
  const out = ctx.fillCopyTemplate(p, c.row);
  if (out === c.expect) { pass++; console.log(`PASS  [边界] ${c.name}: ${out}`); }
  else { fail++; console.log(`FAIL  [边界] ${c.name}\n  期望: ${c.expect}\n  实际: ${out}`); }
}

console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
