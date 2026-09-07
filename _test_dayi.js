// _test_dayi.js
// 大毅电阻型号解析回归测试
// 用法：node _test_dayi.js
//
// 阻值编码规则（皇上 2026-09-03 两轮确认为准）：
//   1%(F/D/B/A/C) → 4 位，分两段，阈值 100Ω：
//      >= 100Ω : E-96 纯数字 3位有效数+1位指数
//                100→1000(皇上锚点)、220→2200、499→4990、510→5100、
//                1K→1001、2.2K→2201、4.99K→4991、10K→1002、1M→1004
//      < 100Ω  : R 表示补到 4 字符  2.2→2R20、22→22R0、62→62R0、0.05→0R05
//   5%(J/G/K)   → 3 位 E-24 两位有效数+指数：4.7K→472、10K→103、150K→154、1M→105
//                  <10Ω 用 R 表示 3 字符：2.2→2R2、1→1R0
//   EBR(合金，mΩ 语义，皇上 2026-09-04 锚点 EBR59FER50M)：不看精度位数，<1Ω 全用毫欧
//     <1mΩ      → R{两位}M，粒度 0.01mΩ：0.3mΩ→R30M、0.5mΩ→R50M
//     1~999mΩ   → R{三位}，粒度 1mΩ   ：1mΩ→R001、10mΩ→R010、100mΩ→R100、500mΩ→R500
//     其余系列 R 表示法单位是 Ω（22R0=22Ω），两套语义不通用
//   0Ω          → '0'，且容差归一为 J

'use strict';

const { matchResistorToDayi } = require('./matcher-resistor');

const cases = [
  // ============================================================
  // 国巨 AC 系列实样本（皇上 2026-09-03 提供，41 条 AEC-Q200 汽车级）
  // ============================================================
  // --- 0402 1/16W ---
  { input: 'AC0402JR-070RL', expect: 'RMF04JT0', note: 'AC0402 0Ω ±5%' },
  { input: 'AC0402FR-072R2L', expect: 'RMF04FT2R20', note: 'AC0402 2.2Ω ±1% (<1K 用 R 补4位)' },
  { input: 'AC0402FR-073R3L', expect: 'RMF04FT3R30', note: 'AC0402 3.3Ω ±1%' },
  { input: 'AC0402FR-0722RL', expect: 'RMF04FT22R0', note: 'AC0402 22Ω ±1%' },
  { input: 'AC0402JR-0733RL', expect: 'RMF04JT330', note: 'AC0402 33Ω ±5% (E-24: 33×10^0)' },
  { input: 'AC0402JR-07100RL', expect: 'RMF04JT101', note: 'AC0402 100Ω ±5% (E-24: 10×10^1)' },
  { input: 'AC0402FR-07510RL', expect: 'RMF04FT5100', note: 'AC0402 510Ω ±1% (E-96: 510×10^0)' },
  { input: 'AC0402JR-071KL', expect: 'RMF04JT102', note: 'AC0402 1KΩ ±5% (E-24: 10×10^2)' },
  { input: 'AC0402JR-071K8L', expect: 'RMF04JT182', note: 'AC0402 1.8KΩ ±5% (E-24: 18×10^2)' },
  { input: 'AC0402FR-071K87L', expect: 'RMF04FT1871', note: 'AC0402 1.87KΩ ±1% (E-96: 187×10^1)' },
  { input: 'AC0402FR-072K2L', expect: 'RMF04FT2201', note: 'AC0402 2.2KΩ ±1% (E-96: 220×10^1)' },
  { input: 'AC0402FR-072K7L', expect: 'RMF04FT2701', note: 'AC0402 2.7KΩ ±1%' },
  { input: 'AC0402JR-074K7L', expect: 'RMF04JT472', note: 'AC0402 4.7KΩ ±5% (E-24: 47×10^2)' },
  { input: 'AC0402FR-074K99L', expect: 'RMF04FT4991', note: 'AC0402 4.99KΩ ±1% (E-96: 499×10^1)' },
  { input: 'AC0402FR-0710KL', expect: 'RMF04FT1002', note: 'AC0402 10KΩ ±1% (E-96: 100×10^2)' },
  { input: 'AC0402JR-0718KL', expect: 'RMF04JT183', note: 'AC0402 18KΩ ±5% (E-24: 18×10^3)' },
  { input: 'AC0402FR-0720KL', expect: 'RMF04FT2002', note: 'AC0402 20KΩ ±1%' },
  { input: 'AC0402FR-0720K5L', expect: 'RMF04FT2052', note: 'AC0402 20.5KΩ ±1% (E-96: 205×10^2)' },
  { input: 'AC0402JR-0722KL', expect: 'RMF04JT223', note: 'AC0402 22KΩ ±5%' },
  { input: 'AC0402FR-0739KL', expect: 'RMF04FT3902', note: 'AC0402 39KΩ ±1%' },
  { input: 'AC0402FR-0740K2L', expect: 'RMF04FT4022', note: 'AC0402 40.2KΩ ±1%' },
  { input: 'AC0402JR-0747KL', expect: 'RMF04JT473', note: 'AC0402 47KΩ ±5%' },
  { input: 'AC0402FR-0747K5L', expect: 'RMF04FT4752', note: 'AC0402 47.5KΩ ±1%' },
  { input: 'AC0402FR-0756KL', expect: 'RMF04FT5602', note: 'AC0402 56KΩ ±1%' },
  { input: 'AC0402FR-0778K7L', expect: 'RMF04FT7872', note: 'AC0402 78.7KΩ ±1%' },
  { input: 'AC0402FR-07100KL', expect: 'RMF04FT1003', note: 'AC0402 100KΩ ±1% (E-96: 100×10^3)' },
  { input: 'AC0402JR-07150KL', expect: 'RMF04JT154', note: 'AC0402 150KΩ ±5% (E-24: 15×10^4)' },
  { input: 'AC0402FR-071K3L', expect: 'RMF04FT1301', note: 'AC0402 1.3KΩ ±1%' },
  { input: 'AC0402FR-078K2L', expect: 'RMF04FT8201', note: 'AC0402 8.2KΩ ±1%' },
  { input: 'AC0402FR-071RL', expect: 'RMF04FT1R00', note: 'AC0402 1Ω ±1% (<10Ω 两位小数)' },
  { input: 'AC0402FR-07150KL', expect: 'RMF04FT1503', note: 'AC0402 150KΩ ±1%' },
  // --- 0603 1/10W ---
  { input: 'AC0603FR-072R2L', expect: 'RMF06FT2R20', note: 'AC0603 2.2Ω ±1%' },
  { input: 'AC0603JR-074K7L', expect: 'RMF06JT472', note: 'AC0603 4.7KΩ ±5%' },
  { input: 'AC0603FR-077K5L', expect: 'RMF06FT7501', note: 'AC0603 7.5KΩ ±1%' },
  { input: 'AC0603JR-0710KL', expect: 'RMF06JT103', note: 'AC0603 10KΩ ±5%' },
  { input: 'AC0603FR-0724K9L', expect: 'RMF06FT2492', note: 'AC0603 24.9KΩ ±1%' },
  { input: 'AC0603FR-0747KL', expect: 'RMF06FT4702', note: 'AC0603 47KΩ ±1%' },
  { input: 'AC0603FR-0782KL', expect: 'RMF06FT8202', note: 'AC0603 82KΩ ±1%' },
  { input: 'AC0603FR-07100KL', expect: 'RMF06FT1003', note: 'AC0603 100KΩ ±1%' },
  { input: 'AC0603FR-07120KL', expect: 'RMF06FT1203', note: 'AC0603 120KΩ ±1%' },
  { input: 'AC0603FR-071ML', expect: 'RMF06FT1004', note: 'AC0603 1MΩ ±1% (E-96: 100×10^4)' },
  { input: 'AC0603FR-071M5L', expect: 'RMF06FT1504', note: 'AC0603 1.5MΩ ±1% (E-96: 150×10^4)' },
  // --- 1206 1/4W ---
  { input: 'AC1206FR-0762RL', expect: 'RMF12FT62R0', note: 'AC1206 62Ω ±1%' },
  // --- 1210 1/2W ---
  { input: 'AC1210FR-07499RL', expect: 'RMF13FT4990', note: 'AC1210 499Ω ±1% (E-96: 499×10^0)' },

  // ============================================================
  // 国巨其他系列
  // ============================================================
  { input: 'RC0402FR-0710KL', expect: 'RMF04FT1002', note: '国巨 RC 0402 ±1% 10K' },
  { input: 'RC0402FR-07100RL', expect: 'RMF04FT1000', note: '皇上锚点：RES,100Ω,±1%,1/16W,SMD0402 → RMF04FT1000 (E-96: 100×10^0)' },
  { input: 'AF0402FR-0710KL', expect: 'RMS04FT1002', note: '国巨 AF 抗硫化 0402 ±1% 10K' },
  { input: 'SR1206FR-0710KL', expect: 'RAS12FT1002', note: '国巨 SR 抗浪涌 1206 ±1% 10K' },
  { input: 'PE0402FR-070R05L', expect: 'RLM04FT0R05', note: '国巨 PE 电流检测 0402 ±1% 0.05Ω' },
  { input: 'PE1206FR-070R005L', expect: 'RLM12FT0R005', note: '5mΩ 非 EBR 系列：<0.01Ω 大毅写法无锚点，回退原码 + warning（不得输出 0R01）' },
  { input: 'PA2512FR-070R002L', expect: 'RLP25FT0R002', note: '2mΩ 非 EBR 系列：同上回退（不得输出 0R00）' },
  { input: 'PU2512FKEQ10KL', expect: null, note: '国巨 PU 合金型号格式特殊，本轮不实现' },

  // ============================================================
  // KOA 兴亚（尺寸码 2 字符；容差在末尾；中段是端子+包装 1-3 字母）
  // ============================================================
  { input: 'RK73B1JTTD102J', expect: 'RMF04JT102', note: 'KOA RK73B 1J=0402 1K(E-24 102) ±5%' },
  { input: 'RK73H1JTTD1002F', expect: 'RMF04FT1002', note: 'KOA RK73H 1J=0402 10K(E-96 1002) ±1%' },
  { input: 'RK73B2BTD1002F', expect: 'RMF06FT1002', note: 'KOA RK73B 2B=0603 10K ±1%' },

  // ============================================================
  // ROHM 罗姆（本轮只实现 MCR）
  // ============================================================
  { input: 'MCR01MZPF1002', expect: 'RMF04FT1002', note: 'ROHM MCR 01=0402 ±1% 10K' },
  { input: 'MCR18EZHF1002', expect: 'RMF06FT1002', note: 'ROHM MCR 18=0603 ±1% 10K' },
  { input: 'TRR01MZF1002', expect: null, note: 'ROHM TRR 本轮未实现' },

  // ============================================================
  // VISHAY 威世（容差在阻值之后）
  // ============================================================
  { input: 'CRCW040210K0FKED', expect: 'RMF04FT1002', note: 'VISHAY CRCW 0402 ±1% 10K' },
  { input: 'CRCW06030000Z0ED', expect: 'RMF06JT0', note: 'VISHAY CRCW 0603 0Ω jumper（Z→J 归一）' },
  { input: 'RCA040210K0FKED', expect: 'RMS04FT1002', note: 'VISHAY RCA 抗硫化 0402 ±1% 10K' },

  // ============================================================
  // PROSEMI 普森美（合金，2026-09-04 皇上样本）
  // EBR 规则（皇上 2026-09-04 确认，锚点 EBR59FER50M）：
  //   尺寸只有 25=2512/39=3920/59=5930；容差只有 F/G/J；包装用 E
  //   毫欧编码：<1mΩ → R{两位}M（R50M=0.5mΩ）；>=1mΩ → R{三位}（R001=1mΩ）
  //
  // 数据来源分级（改动前先看清楚，别把外推当事实）：
  //   [实样本] 皇上提供的真实型号，可信
  //   [外推]   奴才按规则推出来的型号，厂家未必这么写，待皇上拿真实料号核对
  // ============================================================
  { input: 'APSRP25M4F0M30', expect: 'EBR25FER30M', note: '[实样本] 2512 ±1% 0.3mΩ → R30M' },
  { input: 'APSRP25M4F1M00', expect: 'EBR25FER001', note: '[实样本] 2512 ±1% 1mΩ → R001（皇上锚点）' },
  { input: 'APSRP25M4F5M60', expect: 'EBR25FER006', note: '[外推] 5.6mΩ → 对齐 6mΩ R006（非整数 mΩ 粒度待确认）' },
  { input: 'RES,0.3mΩ,±1%，4W，SMD2512,PROSEMI,APSRP25M4F0M30,AEQ-200', expect: 'EBR25FER30M', note: '[实样本] 整行规格描述：提取 APSRP25M4F0M30' },
  { input: 'APSRP12M4F1M00', expect: null, note: '[外推] EBR 无 1206 尺寸 → 报错（只 2512/3920/5930）' },
  { input: 'APSRP25M4D0M30', expect: null, note: '[外推] EBR 无 ±0.5%(D) → 报错（只 F/G/J）' },

  // --- EBR 3920/5930 大尺寸（2026-09-04 补：尺寸表原本缺 39/59）---
  // 尺寸码 39/59 本身是皇上确认的；但「PROSEMI 合金料用 39/59 表示 3920/5930」属外推
  { input: 'APSRP59M4F0M50', expect: 'EBR59FER50M', note: '[外推] 5930 ±1% 0.5mΩ → EBR59FER50M（输出形式与皇上锚点一致）' },
  { input: 'APSRP39M4F0M50', expect: 'EBR39FER50M', note: '[外推] 3920 ±1% 0.5mΩ' },
  { input: 'APSRP59M4F1M00', expect: 'EBR59FER001', note: '[外推] 5930 ±1% 1mΩ' },
  { input: 'APSRP59M4J0M30', expect: 'EBR59JER30M', note: '[外推] 5930 ±5% 0.3mΩ（J 也走 mΩ 语义，不受 3 位限制）' },
  { input: 'APSRP39M4G1M00', expect: 'EBR39GER001', note: '[外推] 3920 ±2% 1mΩ' },

  // --- EBR 10mΩ~999mΩ 段（2026-09-04 补：原阈值 10mΩ 导致掉进 Ω 语义的 R 表示）---
  // 高危外推：PROSEMI 在 >=10mΩ 是否仍用 M 表示（010M/100M/500M）完全无依据，
  //           也可能改用 R 表示。若皇上拿到真实料号，优先替换这一组。
  //           本组真正要守的是「EBR 输出必须是 R010/R100/R500 而非 0R01/0R10/0R50」。
  { input: 'APSRP25M4F010M', expect: 'EBR25FER010', note: '[外推] 10mΩ → R010（原错输出 0R01）' },
  { input: 'APSRP25M4F100M', expect: 'EBR25FER100', note: '[外推] 100mΩ → R100（原错输出 0R10）' },
  { input: 'APSRP25M4F500M', expect: 'EBR25FER500', note: '[外推] 500mΩ → R500（原错输出 0R50）' },
  { input: 'APSRP59M4F100M', expect: 'EBR59FER100', note: '[外推] 5930 100mΩ → R100' },

  // ============================================================
  // 输入容错（2026-09-03：去除标点/空格 + 规格描述提取型号）
  // ============================================================
  { input: 'AC0402FR 0720KL', expect: 'RMF04FT2002', note: '带空格：去空格后匹配' },
  { input: 'AC0402FR0720KL', expect: 'RMF04FT2002', note: '无连字符：连字符可选' },
  { input: 'AC0402FR,0720KL', expect: 'RMF04FT2002', note: '逗号分隔：去标点后匹配' },
  { input: 'AC0402FR－0720KL', expect: 'RMF04FT2002', note: '全角横线：归一为半角' },
  { input: 'RES,20KΩ，±1%，1/16W，SMD0402,国巨，AC0402FR-0720KL，AEC-Q200', expect: 'RMF04FT2002', note: '整段规格描述：提取 AC0402FR-0720KL' },
  { input: 'RES 100Ω ±1% 1/16W SMD0402 CRCW040210K0FKED', expect: 'RMF04FT1002', note: '空格分隔规格描述：提取 CRCW040210K0FKED' },
  { input: 'RES,20KΩ，±1%，1/16W，SMD0402,国巨，AEC-Q200', expect: null, note: '规格描述不含型号：无法换算' },

  // ============================================================
  // 皇上 2026-09-04 提供的大毅规格复核（E-96 指数位含义）
  //   RMF04FT1871 = 1.87KΩ、RMF04FT1872 = 18.7KΩ → 前 3 位有效数 + 第 4 位指数
  //   注意：±5% 档厂家只出 E-24 标准值（如 1K8），不出 1K87 —— 1.87K 只存在于 ±1% 档。
  //        故「±5% 的非 E-24 阻值」现实中无此物料，不要拿虚构型号给对齐逻辑背书。
  // ============================================================
  { input: 'RES,1.87KΩ，±1%，1/16W，SMD0402,国巨，AC0402FR-071K87L,AEC-Q200', expect: 'RMF04FT1871', note: '皇上样本：整行规格描述，1.87KΩ → 1871' },
  { input: 'AC0402FR-0718K7L', expect: 'RMF04FT1872', note: '18.7KΩ → 1872（皇上提供的大毅规格对照）' },
  { input: 'AC0402FR-07187KL', expect: 'RMF04FT1873', note: '187KΩ → 1873（指数位递增）' },
  { input: 'AC0402JR-071K8L', expect: 'RMF04JT182', note: '±5% 档的真实物料是 1.8K（E-24 标准值）→ 182，非 1.87K' },

  // ============================================================
  // 大毅自家型号反解（2026-09-04 皇上批准）
  // 格式：系列(3字母)+尺寸(2位)+容差+包装+阻值
  // 阻值段 R 的语义按系列分：EBR=mΩ（R50M=0.5mΩ），其余系列=Ω（22R0=22Ω）
  // ============================================================
  { input: 'EBR59FER50M', expect: 'EBR59FER50M', note: '反解锚点：5930 ±1% 编带 0.5mΩ' },
  { input: 'EBR25FER001', expect: 'EBR25FER001', note: '反解：2512 ±1% 1mΩ' },
  { input: 'EBR25FER100', expect: 'EBR25FER100', note: '反解：100mΩ（R 在 EBR 里是 mΩ，不是 Ω）' },
  { input: 'EBR59JER30M', expect: 'EBR59JER30M', note: '反解：±5% 0.3mΩ' },
  { input: 'RMF04FT1002', expect: 'RMF04FT1002', note: '反解：厚膜 0402 ±1% 10K（E-96）' },
  { input: 'RMF04JT472', expect: 'RMF04JT472', note: '反解：厚膜 0402 ±5% 4.7K（E-24）' },
  { input: 'RMF04FT22R0', expect: 'RMF04FT22R0', note: '反解：22Ω（R 在非 EBR 里是 Ω）' },
  { input: 'RMF04JT0', expect: 'RMF04JT0', note: '反解：0Ω' },
  { input: 'RLM04FT0R05', expect: 'RLM04FT0R05', note: '反解：电流检测 0.05Ω' },
  { input: 'RMS04FT1002', expect: 'RMS04FT1002', note: '反解：抗硫化系列' },
  { input: 'RAS12FT1002', expect: 'RAS12FT1002', note: '反解：抗浪涌系列' },
  { input: 'RES,10KΩ,±1%,1/16W,SMD0402,大毅,RMF04FT1002', expect: 'RMF04FT1002', note: '反解：从规格描述中提取大毅型号' },
  { input: 'RMF99FT1002', expect: null, note: '反解：尺寸码 99 不存在 → 报错' },
  { input: 'XYZ04FT1002', expect: null, note: '反解：非大毅系列 → 无法识别' },

  // ============================================================
  // 边界
  // ============================================================
  { input: 'INVALID123', expect: null, note: '无效输入' }
];

let pass = 0, fail = 0;
for (const c of cases) {
  const result = matchResistorToDayi(c.input);
  const actualModel = result && result.ok ? result.dayiModel : null;
  const ok = actualModel === c.expect;
  if (ok) pass++; else fail++;
  const tag = ok ? 'PASS' : 'FAIL';

  console.log('[' + tag + '] ' + c.input.padEnd(20) + ' -> ' + (actualModel || '(null)') + ' (expect: ' + c.expect + ')  [' + c.note + ']');
  if (!ok && result && result.ok) {
    console.log('       spec:', JSON.stringify({
      brand: result.brand, prefix: result.prefix,
      size: result.size, sizeCode: result.sizeCode,
      tol: result.tol, tolCode: result.tolCode,
      resistance: result.resistanceFormatted, resCode: result.resistanceCode,
      dayiSeries: result.dayiSeries, dayiResCode: result.dayiResCode,
      dayiTolCode: result.dayiTolCode,
      warnings: result.warnings
    }, null, 2));
  }
}

// ============================================================
// 反解回环：把上面每条用例产出的大毅型号再喂回去，
// 反解 → 重新编码 → 必须逐字节还原。这是反解实现正确性的硬判据。
// ============================================================
console.log('\n=== 反解回环（大毅自家型号自洽性）===');
const dayiModels = [...new Set(cases.map((c) => c.expect).filter(Boolean))];
let loopPass = 0, loopFail = 0;
for (const model of dayiModels) {
  const r = matchResistorToDayi(model);
  const back = r && r.ok ? r.dayiModel : null;
  if (back === model) {
    loopPass++;
  } else {
    loopFail++;
    console.log('[FAIL] ' + model + ' -> ' + back + (r && r.error ? ' (' + r.error + ')' : ''));
  }
}
console.log('回环: ' + loopPass + ' PASS, ' + loopFail + ' FAIL / ' + dayiModels.length + ' 个大毅型号');
fail += loopFail;

console.log('\n总计: ' + (pass + loopPass) + ' PASS, ' + fail + ' FAIL / ' + (cases.length + dayiModels.length));
process.exit(fail > 0 ? 1 : 0);
