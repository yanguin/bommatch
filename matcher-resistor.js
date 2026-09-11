// matcher-resistor.js
// 5 厂家电阻型号 → 大毅（TA-I）型号解析器
// 输入：国巨（YAGEO）/兴亚（KOA）/罗姆（ROHM）/威世（VISHAY）/普森美（PROSEMI）的电阻型号
// 输出：大毅型号 + 规格信息（封装/精度/阻值/系列）

'use strict';

// ============================================================
// 常量表
// ============================================================

// 英制尺寸 → 大毅尺寸码
// 注：3920/5930 是 EBR 合金专属大尺寸，其余系列（RMF/RMS/...）无此封装
const SIZE_TO_DAYI = {
  '0201': '02', '0402': '04', '0603': '06',
  '0805': '10', '1206': '12', '1210': '13',
  '2010': '20', '2512': '25',
  '3920': '39', '5930': '59',
  '1225': '12'
};

// 大毅尺寸码 → 英制（反向表，PROSEMI 等直接用 2 位码的厂家用）
const DAYI_SIZE_TO_INCH = {
  '02': '0201', '04': '0402', '06': '0603',
  '10': '0805', '12': '1206', '13': '1210',
  '20': '2010', '25': '2512',
  '39': '3920', '59': '5930'
};

// 系列专属尺寸码覆盖（皇上 2026-09-08 拍板：RLPL 的 L12 = 1225，非 1206）
// RLPL 是长边电极大功率料，1225 才合理；其余系列的 12 仍为 1206
const SERIES_SIZE_OVERRIDE = {
  RLPL: { '12': '1225' }
};

// KOA 尺寸码 → 英制
const KOA_SIZE_TO_INCH = {
  '1F': '0402', '1H': '0402', '1E': '0402', '1J': '0402',
  '2A': '0603', '2B': '0603', '2E': '0603', '2F': '0603',
  '3A': '0805', '3F': '0805', '3E': '0805',
  '4A': '1206', '4B': '1206'
};

// 简化 KOA 单字符尺寸码
const KOA_SIZE_SIMPLE = {
  '1': '0402', '2': '0603', '3': '0805', '4': '1206', '5': '1210'
};

// ROHM 尺寸码 → 英制
const ROHM_SIZE_TO_INCH = {
  '01': '0402', '03': '0603', '10': '0805',
  '18': '0603', '21': '0805', '25': '1210'
};

// 容差码 ↔ 容差字符串（Vishay 0Ω jumper 用 Z）
const TOL_MAP = {
  'F': '±1%', 'G': '±2%', 'J': '±5%', 'D': '±0.5%',
  'B': '±0.1%', 'A': '±0.05%', 'C': '±0.25%', 'K': '±10%',
  'Z': '0Ω jumper'
};

// 容差 → 大毅阻值命名法位数（依据皇上确认：J/G=3位E24，F/D=4位E96）
const TOL_TO_DIGITS = {
  'J': 3, 'G': 3, 'F': 4, 'D': 4, 'B': 4, 'A': 4, 'C': 4, 'K': 3, 'Z': 3
};

// 输入系列前缀 → 大毅默认系列（依据图3选型表 + 图2分类规则）
const SERIES_MAP = {
  // 国巨
  'yageo': {
    'AC': 'RMF',     // 汽车级厚膜（AEC-Q200）
    'RC': 'RMF',     // 普通厚膜
    'AF': 'RMS',     // 抗硫化厚膜
    'RT': 'RMS',     // 抗硫化（备用前缀）
    'SR': 'RAS',     // 抗浪涌
    'AR': 'RAS',     // 抗浪涌
    'PE': 'RLM',     // 金属箔电流检测（低阻）
    'PA': 'RLP',     // 电流检测（超低阻）
    'PU': 'EBR',     // 合金
    'AH': 'RHS'      // 超高功率
  },
  // KOA
  'koa': {
    'RK73B': 'RMF', 'RK73H': 'RMF', 'RK73G': 'RMF',
    'RK73B-RT': 'RMS', 'RK73H-RT': 'RMS', 'RK73G-RT': 'RMS',
    'TLR': 'RLM', 'TSL': 'RLP', 'SLN': 'RLS', 'BLR': 'RHS',
    'PSJ': 'EBR', 'PSL': 'PBR', 'PSG': 'EBR'
  },
  // ROHM
  'rohm': {
    'MCR': 'RMF', 'TRR': 'RMS',
    'UCR': 'RLM', 'PMR': 'RLM', 'PML': 'RLP',
    'PSR': 'EBR', 'GMR': 'EBR'
  },
  // VISHAY
  'vishay': {
    'CRCW': 'RMF', 'RCA': 'RMS',
    'WSL': 'RLM', 'WSK': 'RHS',
    'WSLT': 'EBR', 'WSLP': 'PBR', 'WSLF': 'EBR'
  },
  // PROSEMI（普森美，韩国，贴片合金电阻）
  'prosemi': {
    'APSRP': 'EBR'      // 合金（AEC-Q200）
  }
};

// EBR 合金系列专属规则（皇上 2026-09-04 确认，锚点 EBR59FER50M = 5930 ±1% 编带 0.5mΩ）
//   尺寸只有三个：25=2512、39=3920、59=5930
//   容差只有三个：F=±1%、G=±2%、J=±5%
//   包装例子用 E
const EBR_SIZE_CODES = ['25', '39', '59'];
const EBR_TOL_CODES = ['F', 'G', 'J'];

// 大毅自家系列（反解白名单，3~4 字母）
// RMH = 高功率厚膜，皇上 2026-09-07 样本 RMH25FE2R70（2512 / 2W / 2.7Ω / ±1% / -55~155℃）
// RLPL = 长边电极大功率合金，皇上 2026-09-08 样本 RLPL12FEGMR010（1225 / 3W / 锰铜 / 10mΩ）
const DAYI_SERIES = ['RMF', 'RMS', 'RAS', 'RLM', 'RLP', 'RLS', 'RHS', 'RMH', 'EBR', 'PBR', 'RLPL'];
// 交替匹配必须长系列在前，否则 RLPL 会被 RLP 抢走（JS 正则最左优先）
const DAYI_SERIES_PATTERN = [...DAYI_SERIES].sort((a, b) => b.length - a.length).join('|');

// 额定功率码（位于包装码之后、阻值码之前）
// ⚠ 各系列档位不同，同一字母在不同系列可能不同义，出货前必须回该系列 Datasheet 核对：
//   RLM（皇上 2026-09-08 官方命名规则）：B=1/8W、A=1/4W、S=1/2W；RLM12 实测 C=1W
//   RLP/RLPL（皇上 2026-09-07）：C=1W、D=1.5W、E=2W、G=3W
const POWER_CODES = {
  B: '1/8W', A: '1/4W', S: '1/2W',
  C: '1W', D: '1.5W', E: '2W', G: '3W'
};
// EBR 功率查表（皇上 2026-09-08 官方规格表）
// EBR 型号里**没有功率位**，功率由「尺寸 + 阻值」唯一决定，只能查表得出。
// 单位：阻值 mΩ、功率 W。表外阻值不猜，返回 null。
const EBR_POWER_TABLE = {
  '25': [[0.2, 6], [0.3, 6], [0.5, 6], [1, 6], [2, 6], [3, 4], [4, 4], [5, 3]],
  '39': [[0.2, 12], [0.3, 10], [0.5, 9], [0.7, 8], [1, 8], [2, 6], [3, 5], [4, 5], [5, 5]],
  '59': [[0.1, 15], [0.2, 15], [0.3, 10], [0.5, 10], [0.75, 10], [1, 9], [2, 7], [3, 7]]
};

// 按 EBR 尺寸码 + 阻值(Ω) 查额定功率，返回 '6W' 这类字符串；查不到返回 null
function lookupEbrPower(sizeCode, ohm) {
  const rows = EBR_POWER_TABLE[sizeCode];
  if (!rows || !isFinite(ohm)) return null;
  const mr = ohm * 1000;
  const hit = rows.find(([r]) => Math.abs(r - mr) < 1e-6);
  return hit ? hit[1] + 'W' : null;
}

// 材料码（位于功率码之后、阻值码之前）
const MATERIAL_CODES = { M: 'MnCu锰铜' };
// 带功率位的系列（其余系列如 RMH/RMS 的阻值码直接跟在包装码后）
// RLM 已确认：[实样本] RLM12FTCMR020 = 1206 ±1% 纸带 C(1W) M(锰铜) R020(20mΩ)（皇上 2026-09-08）
const POWER_CODE_SERIES = ['RLM', 'RLP', 'RLPL'];
// 型号里带【材料位】的系列（RLM/RLPL 有 M=锰铜；RLP/EBR 无材料位，禁止拼接）
const MATERIAL_CODE_SERIES = ['RLM', 'RLPL'];

// 电流检测/合金族：<1Ω 的阻值码用 R + 3 位小数（无前导 0），与厚膜系列的 0R05 写法不同
// 锚点：RLM12FTCMR020 / RLP25FEGR010 / RLPL12FEGMR002（均为皇上 [实样本]）
const ALLOY_R_SERIES = ['RLM', 'RLP', 'RLPL'];

// 已确认用 E（编带）包装的系列；其余系列一律默认 T（纸带）
//   EBR：皇上 2026-09-04 锚点 EBR59FER50M
//   RMH：皇上 2026-09-07 样本 RMH25FE2R70 [仅一条样本，RMH 全系列是否通用 E 待皇上确认]
const E_PACK_SERIES = ['EBR', 'RMH'];

// ============================================================
// 工具函数
// ============================================================

// 阻值码转欧姆
// 支持格式：
//   0 / 0R / 000  → 0Ω
//   103         → E-24 3位, 10×10^3 = 10K
//   1002        → E-96 4位, 100×10^2 = 10K
//   10K / 4K7 / 1M0 / 100K  → 字母倍率（国巨/威世）
//   0R05 / 43R2 / 100R  → R 表示小数点
function parseResistance(code) {
  if (!code) return null;
  const s = String(code).toUpperCase();

  // 0Ω 多种写法
  if (s === '0' || s === '0R' || /^0+$/.test(s) || s === '00L') {
    return { value: 0, formatted: '0Ω', digits: 3, code: '0' };
  }

  // 带 R 小数点：0R05 / 43R2 / 100R / R010（R010 = 0.010Ω，R 前可无数字，大毅 RLP/RLPL 合金料常见）
  const rm = s.match(/^(\d*)R(\d*)$/);
  if (rm && (rm[1] !== '' || rm[2] !== '')) {
    const v = parseFloat((rm[1] || '0') + (rm[2] ? '.' + rm[2] : ''));
    // digits 按字符长度归 3 或 4：>=4 字符按 4 位
    const digits = s.length >= 4 ? 4 : 3;
    return { value: v, formatted: formatOhm(v), digits, code: s };
  }

  // 倍率：1M0 / 10K / 4K7 / 1M / 100K
  const km = s.match(/^(\d+)([KM])(\d*)$/);
  if (km) {
    const base = parseFloat(km[1] + (km[3] ? '.' + km[3] : ''));
    const v = base * (km[2] === 'K' ? 1e3 : 1e6);
    // 倍率算 4 位（与 KOA E-96 一致）
    return { value: v, formatted: formatOhm(v), digits: 4, code: s };
  }

  // 纯数字 4 位 E-96：1002 = 10K
  if (/^\d{4}$/.test(s)) {
    const mantissa = parseInt(s.slice(0, 3));
    const exp = parseInt(s[3]);
    const v = mantissa * Math.pow(10, exp);
    return { value: v, formatted: formatOhm(v), digits: 4, code: s };
  }
  // 纯数字 3 位 E-24：前 2 位有效数 + 第 3 位指数
  // 例：102 = 10×10^2 = 1K、103 = 10×10^3 = 10K、472 = 47×10^2 = 4.7K
  if (/^\d{3}$/.test(s)) {
    const mantissa = parseInt(s.slice(0, 2));
    const exp = parseInt(s[2]);
    const v = mantissa * Math.pow(10, exp);
    return { value: v, formatted: formatOhm(v), digits: 3, code: s };
  }
  return null;
}

function formatOhm(v) {
  if (v === 0) return '0Ω';
  if (v >= 1e6) return trimDecimal(v / 1e6) + 'MΩ';
  if (v >= 1e3) return trimDecimal(v / 1e3) + 'KΩ';
  // <10mΩ 用 mΩ 显示（0.3mΩ），避免 "0.0Ω" 丢精度
  if (v < 0.01) return trimDecimal(v * 1000) + 'mΩ';
  return trimDecimal(v) + 'Ω';
}

function trimDecimal(n) {
  if (n === Math.floor(n)) return String(Math.floor(n));
  // 3 位小数：1 位会把 0.01Ω 打成 "0Ω"、把 1.87K 打成 "1.9K"
  return String(parseFloat(n.toFixed(3)));
}

// 合金毫欧阻值解析（仅合金系列上下文使用，M = 毫欧小数点）
// 注意：与国巨/威世的 M=兆欧 表示法冲突，故不能进通用 parseResistance
//   0M30 → 0.3mΩ、1M0 → 1mΩ、2M2 → 2.2mΩ、15M → 15mΩ
function parseAlloyResistance(code) {
  if (!code) return null;
  const s = String(code).toUpperCase();
  const m = s.match(/^(\d*)M(\d*)$/);
  if (!m) return parseResistance(code); // 非 M 表示法，回退通用解析（R 表示等）
  const mohm = parseFloat((m[1] || '0') + (m[2] ? '.' + m[2] : '.0'));
  const v = mohm / 1000;
  return { value: v, formatted: formatOhm(v), digits: s.length >= 4 ? 4 : 3, code: s };
}

// ------------------------------------------------------------
// 欧姆值 → 大毅阻值码
// 规则（皇上 2026-09-03 两轮确认 + 2026-09-04 EBR 合金毫欧规则）：
//   0Ω               → '0'
//   EBR 合金（mΩ 语义，皇上 2026-09-04 确认）：
//     < 1mΩ  → R{两位}M，粒度 0.01mΩ  R50M=0.5mΩ、R30M=0.3mΩ、R10M=0.1mΩ
//     < 1Ω   → R{三位}，粒度 1mΩ     R001=1mΩ、R010=10mΩ、R100=100mΩ、R500=500mΩ
//     注意：R 在 EBR 里单位是 mΩ，在 RMF/RLM 等系列里单位是 Ω（22R0=22Ω），两套语义不通用
//   J/G/K (3位 E-24) → 2位有效数 + 1位指数：4.7K→472、10K→103、150K→154、1M→105
//                       <10Ω 用 R 表示 3 字符：2.2→2R2、1→1R0
//   F/D/B/A/C (4位)  → 分两段（皇上锚点：22Ω→22R0、2.2Ω→2R20、100Ω→1000）：
//     >= 100Ω : E-96 纯数字 3位有效数+1位指数
//               100→1000、220→2200、499→4990、510→5100、
//               1K→1001、2.2K→2201、4.99K→4991、10K→1002、1M→1004
//     < 100Ω  : R 表示并补齐 4 字符  2.2Ω→2R20、22Ω→22R0、62Ω→62R0、0.05Ω→0R05
//     注：阈值是 100Ω 而非 1KΩ——100Ω 能凑出 3 位有效数(100×10^0)，故走 E-96；
//         <100Ω 只有 1~2 位有效数，指数会为负，只能退回 R 表示。
// ------------------------------------------------------------
function resistanceToDayiCode(value, tolCode, series) {
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return '0';
  // EBR 单独走 mΩ 语义（皇上 2026-09-04 确认）：<1Ω 全部用毫欧编码，不看精度位数
  if (series === 'EBR' && v < 1) return encodeMilliohm(v);
  const digits = TOL_TO_DIGITS[tolCode] || 3;
  if (digits === 3) return encodeE24(v);
  return v >= 100 ? encodeE96(v) : encodeR4(v, series);
}

// E-24 标准阻值序列（大毅/国巨产品库只含标准值）
const E24_SERIES = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91];

// E-24：对齐到最近标准值后输出 2 位有效数 + 1 位指数（v 归一到 [10,100)）
// 例：4.7K→472、10K→103、33→330、100→101、150K→154、1M→105
// <10Ω 用 R 表示 3 字符：2.2→2R2、1→1R0、9.9→9R9
function encodeE24(v) {
  if (v < 10) return encodeR3(v);

  let mant = v, exp = 0;
  while (mant >= 100) { mant /= 10; exp++; }
  while (mant < 10) { mant *= 10; exp--; }

  // 超过最大标准值（91）时进位到下一数量级：99.9 → 10 × 10^(exp+1)
  if (mant > 96) { mant = 10; exp++; }
  else {
    let best = E24_SERIES[0], bd = Infinity;
    for (const x of E24_SERIES) {
      const d = Math.abs(x - mant);
      if (d < bd) { bd = d; best = x; }
    }
    mant = best;
  }
  if (exp < 0 || exp > 9) return null;
  return String(mant) + String(exp);
}

// R 表示法 3 字符（仅 E-24 的 <10Ω 段）
//   1 → 1R0、2.2 → 2R2、9.9 → 9R9
//   <1Ω 无法压进 3 字符，退化为 4 字符：0.5 → 0R50、0.05 → 0R05
function encodeR3(v) {
  if (v >= 1) return v.toFixed(1).replace('.', 'R');
  return v.toFixed(2).replace('0.', '0R');
}

// E-96：3 位有效数 + 1 位指数（v 归一到 [100,1000)）
function encodeE96(v) {
  let mant = v, exp = 0;
  while (mant >= 1000) { mant /= 10; exp++; }
  while (mant < 100) { mant *= 10; exp--; }
  if (exp < 0 || exp > 9) return null;
  return String(Math.round(mant)).padStart(3, '0') + String(exp);
}

// R 表示法（仅 < 100Ω 段），总字符数补齐 4 位
//   v<1 且系列为 RLP/RLPL（有实锚点，皇上 2026-09-08 样本）：
//           R + 三位小数，无前导 0 —— R010=0.010Ω、R040=0.040Ω、R002=0.002Ω
//   v<1 其余系列：沿用带前导 0 的旧写法 0R05（无锚点，不改）
//   v<0.001（RLP/RLPL）或 v<0.01（其余系列）：精度不够，返回 null 让调用方回退原码 + warning
function encodeR4(v, series) {
  const alloyForm = ALLOY_R_SERIES.includes(series);
  if (alloyForm) {
    if (v < 0.001) return null;
    if (v < 1) return 'R' + String(Math.round(v * 1000)).padStart(3, '0');
  } else if (v < 0.01) {
    return null;
  }
  const s = v < 10 ? v.toFixed(2) : v.toFixed(1);
  return s.replace('.', 'R');
}

// EBR 合金毫欧编码（皇上 2026-09-04 锚点：R50M=0.5mΩ、R001=1mΩ）——仅 EBR 系列调用
//   <1mΩ      : R{两位}M，粒度 0.01mΩ → 0.5mΩ=R50M、0.3mΩ=R30M、0.1mΩ=R10M
//   1mΩ~999mΩ : R{三位}，粒度 1mΩ    → 1mΩ=R001、10mΩ=R010、100mΩ=R100、500mΩ=R500
//   >=1Ω      : 超出合金阻值范围，返回 null 由调用方回退
//   非粒度整数值四舍五入对齐（5.6mΩ→R006）——非整数 mΩ 写法待皇上确认
function encodeMilliohm(v) {
  const mohm = v * 1000;
  if (mohm >= 1000) return null;
  if (mohm < 1) {
    const n = Math.round(mohm * 100);
    return (n >= 1 && n <= 99) ? 'R' + String(n).padStart(2, '0') + 'M' : null;
  }
  const n = Math.round(mohm);
  return (n >= 1 && n <= 999) ? 'R' + String(n).padStart(3, '0') : null;
}

function pickDayiSeries(brand, prefix) {
  const m = SERIES_MAP[brand];
  if (!m) return null;
  if (m[prefix]) return m[prefix];
  for (const key of Object.keys(m)) {
    if (prefix.startsWith(key)) return m[key];
  }
  return null;
}

// ============================================================
// 国巨 YAGEO 解析
// ============================================================
// 格式：{2字母前缀}{4数字尺寸}{容差}{厚度码}-?{卷盘}{阻值}{无铅码}
// 连字符可省略（输入容错：去标点/空格后仍可匹配）
// 例：AC0402JR-070RL  →  AC, 0402, J(±5%), R, 07, 0R(0Ω), L
// 例：RC0402FR-0710KL →  RC, 0402, F(±1%), R, 07, 10K(10KΩ), L
// 例：RC0603FR-07103KL → RC, 0603, F(±1%), R, 07, 103(10K), K/L
// 阻值格式：0R / 10K / 4K7 / 100R / 0R05 / 1002 / 103 等
function parseYageoResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  const m = u.match(/^(AC|RC|RT|AF|SR|AR|PE|PA|PU|AH)(\d{4})([DFGJABDCKZ])(\w)-?(\d{2})(.*)$/);
  if (!m) return null;
  const [, prefix, size, tolCode, , , tail] = m;
  // 剥离末尾无铅码（仅当去掉它后余下字符串仍是合法阻值）
  let resCode = tail, leadFlag = '';
  if (tail.length >= 2) {
    const lastChar = tail[tail.length - 1];
    if (/[A-Z]/.test(lastChar) && lastChar !== 'R' && lastChar !== 'K' && lastChar !== 'M') {
      const candidate = tail.slice(0, -1);
      if (parseResistance(candidate)) {
        leadFlag = lastChar;
        resCode = candidate;
      }
    }
  }
  const res = parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'yageo', model: s, prefix, size, tolCode, resistance: res,
    packaging: 'T'
  });
}

// ============================================================
// KOA 兴亚 解析
// ============================================================
// RK73 格式：RK73{系列字母}{尺寸码2字符}{端子+包装 1-3字母}{阻值}{容差}
// 例：RK73B1JTTD102J   → RK73B, 1J(0402), TTD, 102(1K),   J(±5%)
// 例：RK73H1JTTD1002F  → RK73H, 1J(0402), TTD, 1002(10K), F(±1%)
// 例：RK73B2BTD1002F   → RK73B, 2B(0603), TD,  1002(10K), F(±1%)
// 注意：
//   1. 尺寸码是 **2 字符**（1J=0402、2A/2B=0603、3A=0805、4A=1206），不是单字符
//   2. 容差在 **末尾**，中间段是端子+包装（1-3 字母，长度不固定）
function parseKoaResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  // 长前缀优先（带 -RT 抗硫化）
  let m = u.match(/^(RK73[BHG]-RT)([0-9A-Z]{2})([A-Z]{1,3})((?:0R\d*|\d+[KM]\d*|\d+R\d*|\d{3,5}))([DFGJABDCKZ])$/);
  let prefix, sizeCode, middle, resCode, tolCode;
  if (m) {
    [, prefix, sizeCode, middle, resCode, tolCode] = m;
  } else {
    m = u.match(/^(RK73[BHG])([0-9A-Z]{2})([A-Z]{1,3})((?:0R\d*|\d+[KM]\d*|\d+R\d*|\d{3,5}))([DFGJABDCKZ])$/);
    if (!m) {
      // KOA 电流检测/合金系列（TLR/TSL/SLN/BLR/PSJ/PSL/PSG）
      m = u.match(/^(TLR|TSL|SLN|BLR|PSJ|PSL|PSG)(\d{1,2})([DFGJABDCKZ])(\w?)([\dRKM]{3,5})([A-Z]?)$/);
      if (!m) return null;
      [, prefix, sizeCode, tolCode, , resCode] = m;
      return makeSpec({
        brand: 'koa', model: s, prefix, size: null, tolCode,
        resistance: parseResistance(resCode), packaging: 'T',
        warning: 'KOA 电流检测/合金系列尺寸需查 datasheet'
      });
    }
    [, prefix, sizeCode, middle, resCode, tolCode] = m;
  }
  const sizeInch = KOA_SIZE_TO_INCH[sizeCode];
  if (!sizeInch) return null;
  const res = parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'koa', model: s, prefix, size: sizeInch, tolCode, resistance: res,
    packaging: 'T'
  });
}

// ============================================================
// ROHM 罗姆 解析
// ============================================================
// 本轮先实现 MCR 系列（公司薄膜主力型号），TRR/UCR/PMR 等后续按需扩展
// MCR 格式：MCR + 尺寸码(2位) + 系列码(2字母) + 容差 + 阻值
// 例：MCR01MZPF1002 → MCR, 01(0402), MZP, F(±1%), 1002(10K)
// 例：MCR18EZHF1002 → MCR, 18(0603), EZH, F(±1%), 1002(10K)
function parseRohmResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  const m = u.match(/^MCR(\d{2})(\w{2,4})([DFGJABDCKZ])([\dRKM]{3,5})([A-Z]?)$/);
  if (!m) return null;
  const [, sizeCode, , tolCode, resCode] = m;
  const sizeInch = ROHM_SIZE_TO_INCH[sizeCode];
  if (!sizeInch) return null;
  const res = parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'rohm', model: s, prefix: 'MCR', size: sizeInch, tolCode,
    resistance: res, packaging: 'T'
  });
}

// ============================================================
// VISHAY 威世 解析
// ============================================================
// CRCW 格式：CRCW + 尺寸 + 阻值 + 容差 + 包装（容差在阻值后）
// 例：CRCW040210K0FKED → CRCW, 0402, 10K0(10KΩ), F(±1%), KED(包装)
// 例：CRCW06030000Z0ED → CRCW, 0603, 0000(0Ω), Z(0Ω jumper), 0ED(包装)
// 例：RCA040210K0FKED  → RCA, 0402, 10K0, F, KED（抗硫化）
function parseVishayResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  // CRCW / RCA（容差在阻值之后）
  let m = u.match(/^(CRCW|RCA)(\d{4})((?:0R\d*|\d+[KM]\d*|\d+R\d+|\d{3,5}))([DFGJABDCKZ])(\w{1,3})$/);
  let prefix, size, resCode, tolCode;
  if (m) {
    [, prefix, size, resCode, tolCode] = m;
  } else {
    // WSL / WSK 金属箔（尺寸未自动推断）
    m = u.match(/^(WSL|WSK|WSLT|WSLP|WSLF)(\d{2,3})([DFGJABDCKZ])((?:0R\d*|\d+[KM]\d*|\d+R\d+|\d{3,5}))([A-Z]?)$/);
    if (!m) return null;
    [, prefix, , tolCode, resCode] = m;
    return makeSpec({
      brand: 'vishay', model: s, prefix, size: null, tolCode,
      resistance: parseResistance(resCode), packaging: 'T',
      warning: 'VISHAY WSL 尺寸需查 datasheet，未自动推断'
    });
  }
  const res = parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'vishay', model: s, prefix, size, tolCode, resistance: res,
    packaging: 'T'
  });
}

// ============================================================
// PROSEMI 普森美 解析
// ============================================================
// APSRP 合金电阻格式：APSRP + 尺寸码(2位) + 功率/系列码(1-2位) + 容差 + 阻值(mΩ)
// 例：APSRP25M4F0M30 → APSRP, 25(2512), M4(4W), F(±1%), 0M30(0.3mΩ)
//   尺寸码与大毅同族：02/04/06/10/12/13/20/25
//   阻值用 M 表示毫欧：M 作小数点（0M30=0.3mΩ），勿与兆欧 M 混淆
function parseProsemiResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  const m = u.match(/^APSRP(\d{2})(\w{1,2})([DFGJABDCKZ])([0-9A-Z]+)$/);
  if (!m) return null;
  const [, sizeCode, , tolCode, resCode] = m;
  const sizeInch = DAYI_SIZE_TO_INCH[sizeCode];
  if (!sizeInch) return null;
  const res = parseAlloyResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'prosemi', model: s, prefix: 'APSRP', size: sizeInch, tolCode,
    resistance: res, packaging: 'T'
  });
}

// ------------------------------------------------------------
// PROSEMI 普罗森美 LMJ / SRC 系列（皇上 2026-09-08 提供真值表）
// ------------------------------------------------------------
// LMJ：LMJ{尺寸}{材料}{精度}{功率}{阻值}   阻值 R 是【Ω 语义】小数点
//   LMJ08MF0P5R005 → 0805 锰铜 ±1% 0.5W  0.005Ω(5mΩ)
//   LMJ12MF1P0R010 → 1206 锰铜 ±1% 1.0W  0.010Ω(10mΩ)
//   材料：M=锰铜、N=镍铜；功率形如 0P5/1P0/2P0（P 是小数点）
// SRC：SRC{尺寸}{材料}{精度}{功率}{阻值}   阻值 R 是【mΩ 语义】小数点（与 LMJ 相反！）
//   SRC39MFI0R50 → 3920 锰铜 ±1% 5W   0.50mΩ
//   SRC25FFD5R0  → 2512 镍铜 ±1% 1.5W 5.0mΩ
//   材料：M=锰铜、F=镍铜；功率码 I=5W / E=2W / H=3W / F=2.5W / P=4W / A=7W / D=1.5W
const SRC_POWER_CODES = { D: 1.5, F: 2.5, E: 2, H: 3, P: 4, I: 5, A: 7 };

// PROSEMI 尺寸码 → 大毅系列 + 英制（皇上样本反推；LMJ25/SRC25→RLP、SRC39/59→EBR 为推测，输出时标注）
const PROSEMI_TARGET = {
  '08': { size: '0805', series: 'RLM' },
  '12': { size: '1206', series: 'RLM' },
  '25': { size: '2512', series: 'RLP' },
  '39': { size: '3920', series: 'EBR' },
  '59': { size: '5930', series: 'EBR' }
};

// 大毅功率码（按系列分档， watt 为数值）
const DAYI_POWER_BY_SERIES = {
  RLM: [{ w: 0.125, c: 'B' }, { w: 0.25, c: 'A' }, { w: 0.5, c: 'S' }, { w: 1, c: 'C' }],
  RLP: [{ w: 1, c: 'C' }, { w: 1.5, c: 'D' }, { w: 2, c: 'E' }, { w: 3, c: 'G' }],
  RLPL: [{ w: 1, c: 'C' }, { w: 1.5, c: 'D' }, { w: 2, c: 'E' }, { w: 3, c: 'G' }]
};

function dayiPowerCode(series, watt) {
  const rows = DAYI_POWER_BY_SERIES[series];
  if (!rows || !isFinite(watt)) return null;
  const hit = rows.find((r) => Math.abs(r.w - watt) < 1e-9);
  return hit ? hit.c : null;
}

function parseProsemiLmj(s) {
  const u = String(s).trim().toUpperCase();
  const m = u.match(/^LMJ(\d{2})([MN])([FGJ])(\dP\d)(R[0-9A-Z]+)$/);
  if (!m) return null;
  const [, sizeCode, matCode, tolCode, powCode, resCode] = m;
  const t = PROSEMI_TARGET[sizeCode];
  if (!t) return null;
  // 阻值：R 是小数点，单位 Ω —— 0.005Ω = 5mΩ
  const ohm = parseFloat(resCode.replace('R', '0.'));
  if (!isFinite(ohm)) return null;
  const watt = parseFloat(powCode.replace('P', '.'));
  const powerCode = dayiPowerCode(t.series, watt);
  const warnings = [];
  if (!powerCode) warnings.push(`大毅 ${t.series} 无 ${watt}W 功率档，型号中功率位留空，需人工核对`);
  // 材料：只有锰铜有确认码 M；镍铜的大毅码未知，按皇上"没有写就不用在意"留空
  const materialCode = matCode === 'M' ? 'M' : null;
  if (matCode !== 'M') warnings.push('PROSEMI 镍铜材料对应大毅码未知，材料位留空，需人工核对');
  return makeSpec({
    brand: 'prosemi', model: s, prefix: 'LMJ', size: t.size, tolCode,
    resistance: { value: ohm, formatted: formatOhm(ohm), digits: 4, code: resCode },
    packaging: t.series === 'RLP' ? 'E' : 'T',
    dayiSeriesOverride: t.series, powerCode, materialCode,
    warning: warnings.length ? warnings.join('；') : null
  });
}

function parseProsemiSrc(s) {
  const u = String(s).trim().toUpperCase();
  const m = u.match(/^SRC(\d{2})([MFN])([FGJ])([A-Z])(\dR[0-9A-Z]+)$/);
  if (!m) return null;
  const [, sizeCode, matCode, tolCode, powCode, resCode] = m;
  const t = PROSEMI_TARGET[sizeCode];
  if (!t) return null;
  // 阻值：R 是小数点，单位 mΩ —— 0R50 = 0.50mΩ
  const mr = parseFloat(resCode.replace('R', '.'));
  if (!isFinite(mr)) return null;
  const ohm = mr / 1000;
  const watt = SRC_POWER_CODES[powCode];
  const warnings = [];
  if (watt === undefined) warnings.push(`PROSEMI 功率码 ${powCode} 含义未知，无法换算功率`);
  // EBR 无功率位；RLP 按档位取码
  const powerCode = t.series === 'EBR' ? null : dayiPowerCode(t.series, watt);
  if (t.series !== 'EBR' && watt !== undefined && !powerCode) {
    warnings.push(`大毅 ${t.series} 无 ${watt}W 功率档，型号中功率位留空，需人工核对`);
  }
  const materialCode = matCode === 'M' ? 'M' : null;
  if (matCode !== 'M') warnings.push('PROSEMI 镍铜材料对应大毅码未知，材料位留空，需人工核对');
  return makeSpec({
    brand: 'prosemi', model: s, prefix: 'SRC', size: t.size, tolCode,
    resistance: { value: ohm, formatted: formatOhm(ohm), digits: 4, code: resCode },
    packaging: t.series === 'EBR' ? 'E' : (t.series === 'RLP' ? 'E' : 'T'),
    dayiSeriesOverride: t.series, powerCode, materialCode, srcPower: watt,
    warning: warnings.length ? warnings.join('；') : null
  });
}

// ============================================================
// 大毅自家型号反解（皇上 2026-09-04 批准）
// ============================================================
// 格式：系列(3字母) + 尺寸(2位) + 容差(1字母) + 包装(1字母) + 阻值
//   例：RMF04FT1002 → RMF, 04(0402), F(±1%), T(纸带), 1002(10KΩ)
//   例：EBR59FER50M → EBR, 59(5930), F(±1%), E(编带), R50M(0.5mΩ)
// 阻值段按系列分语义（与编码侧对称）：
//   EBR  → R 单位是 mΩ：R50M=0.5mΩ、R001=1mΩ、R100=100mΩ
//   其余 → R 单位是 Ω ：22R0=22Ω、0R05=0.05Ω；另支持 E-96(1002)/E-24(103)/0
function parseDayiMilliohm(code) {
  if (!code) return null;
  const s = String(code).toUpperCase();
  let m = s.match(/^R(\d{3})$/);          // R001=1mΩ、R010=10mΩ、R100=100mΩ
  if (m) {
    const v = parseInt(m[1], 10) / 1000;
    return { value: v, formatted: formatOhm(v), digits: 4, code: s };
  }
  m = s.match(/^R(\d{2})M$/);             // R50M=0.5mΩ、R30M=0.3mΩ（粒度 0.01mΩ）
  if (m) {
    const v = parseInt(m[1], 10) / 100 / 1000;
    return { value: v, formatted: formatOhm(v), digits: 4, code: s };
  }
  return null;
}

function parseDayiResistor(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  const m = u.match(new RegExp('^(' + DAYI_SERIES_PATTERN + ')(\\d{2})([FGJDBACK])([TEI])([0-9A-Z]+)$'));
  if (!m) return null;
  const [, series, sizeCode, tolCode, packaging, rest] = m;
  // 尺寸码按系列覆盖：RLPL 的 12 = 1225，其余系列走通用表
  const sizeInch = (SERIES_SIZE_OVERRIDE[series] && SERIES_SIZE_OVERRIDE[series][sizeCode])
    || DAYI_SIZE_TO_INCH[sizeCode];
  if (!sizeInch) return null;

  // 功率位/材料位剥离：RLP/RLPL 在包装码与阻值码之间还有 {功率}{材料?}
  //   RLM10FT S M R010     → 1/2W, 锰铜, 10mΩ（皇上 2026-09-08 [实样本]）
  //   RLPL12FE G M R010    → 3W, 锰铜, 10mΩ
  // 功率码字符集含 B/A/S（RLM 小功率档），阻值码只以数字或 R 开头，不会误吞
  let powerCode = null;
  let materialCode = null;
  let resCode = rest;
  if (POWER_CODE_SERIES.includes(series)) {
    const pm = rest.match(/^([CDEGBAS])(M?)([0-9A-Z]+)$/);
    if (pm) {
      powerCode = pm[1];
      materialCode = pm[2] || null;
      resCode = pm[3];
    }
  }

  const res = series === 'EBR' ? parseDayiMilliohm(resCode) : parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'dayi', model: s, prefix: series, size: sizeInch, tolCode,
    resistance: res, packaging, dayiSeriesOverride: series,
    powerCode, materialCode
  });
}

// ============================================================
// 统一分派 + 规格构造
// ============================================================

function makeSpec({ brand, model, prefix, size, tolCode, resistance, packaging, warning, dayiSeriesOverride, powerCode, materialCode, srcPower }) {
  const seriesOverride = dayiSeriesOverride;
  // 尺寸码按系列覆盖：RLPL 的 1225 编为 12，其余走通用表
  const sizeCode = (seriesOverride && SERIES_SIZE_OVERRIDE[seriesOverride] && size
    && Object.keys(SERIES_SIZE_OVERRIDE[seriesOverride]).find(k => SERIES_SIZE_OVERRIDE[seriesOverride][k] === size))
    || (size ? (SIZE_TO_DAYI[size] || null) : null);
  const tol = TOL_MAP[tolCode] || null;
  const dayiSeries = dayiSeriesOverride || pickDayiSeries(brand, prefix);
  return {
    ok: true,
    brand,
    model,
    prefix,
    size,                // 英制：0402 / 0603 / null
    sizeCode,            // 大毅码：04 / 06 / null
    tol,                 // ±5% / ±1% / null
    tolCode,             // J / F / null
    resistance: resistance.value,
    resistanceFormatted: resistance.formatted,
    resistanceCode: resistance.code,
    resistanceDigits: resistance.digits,
    requiredDigits: TOL_TO_DIGITS[tolCode] || null,
    packaging,           // T=纸带
    powerCode: powerCode || null,        // 额定功率码 C/D/E/G（仅 RLP/RLPL 等有）
    power: powerCode ? (POWER_CODES[powerCode] || null) : null,
    materialCode: materialCode || null,  // 材料码 M=MnCu 锰铜
    material: materialCode ? (MATERIAL_CODES[materialCode] || null) : null,
    srcPower: srcPower || null,      // 源厂商标称功率(W)，用于与大毅查表功率比对
    dayiSeries,          // RMF / RMS / RAS / ...
    warning: warning || null
  };
}

// ------------------------------------------------------------
// 输入容错预处理：去除多余空格/标点，从规格描述中提取型号
// 例：输入 "RES,20KΩ，±1%，1/16W，SMD0402,国巨，AC0402FR-0720KL，AEC-Q200"
//     → 提取 "AC0402FR-0720KL" → RMF04FT2002
// ------------------------------------------------------------

// 全角横线 → 半角连字符
function normalizeDash(s) {
  return String(s).replace(/[－—―–]/g, '-');
}

// 规格描述常见分隔符（保留型号内部的 - 连字符）
const SPEC_SEP_RE = /[\s,，;；、.。:：/／|｜!！?？()（）[\]【】]+/;

// 从混有规格描述的文本中提取候选型号：
//   1) 按分隔符切分的 token
//   2) 按厂商前缀直接匹配的片段（覆盖未被分隔符隔开的情况）
function extractModelCandidates(text) {
  const candidates = [];
  const push = (c) => {
    c = normalizeDash(c).replace(/^-+|-+$/g, '');
    if (c && !candidates.includes(c)) candidates.push(c);
  };
  for (const token of String(text).split(SPEC_SEP_RE)) {
    if (token) push(token);
  }
  const re = new RegExp('(CRCW|RCA|WSLT|WSLP|WSLF|WSL|WSK|APSRP|'
    + DAYI_SERIES_PATTERN + '|'
    + 'RK73[BHG](?:-RT)?|TLR|TSL|SLN|BLR|PSJ|PSL|PSG|MCR|AC|RC|RT|AF|SR|AR|PE|PA|PU|AH)[0-9A-Za-z-]*', 'g');
  let m;
  while ((m = re.exec(String(text))) !== null) {
    push(m[0]);
  }
  return candidates;
}

// 解析成功后在备注中标注实际使用的型号（输入与提取结果不一致时）
function withExtractNote(r, parsed, original) {
  if (parsed === original) return r;
  const note = `已从输入中提取型号 ${parsed}`;
  r.warning = r.warning ? r.warning + '；' + note : note;
  return r;
}

// 厂商前缀分派（任一解析成功即返回；前缀冲突如 RC vs RCA 时优先长前缀）
function dispatchResistorParser(s) {
  if (!s) return null;
  const u = s.trim().toUpperCase();
  // 大毅自家型号（3 字母系列，与他牌前缀无重叠，放最前）
  if (new RegExp('^(' + DAYI_SERIES_PATTERN + ')').test(u)) {
    const r = parseDayiResistor(s);
    if (r) return r;
  }
  if (/^APSRP/.test(u)) {
    const r = parseProsemiResistor(s);
    if (r) return r;
  }
  // PROSEMI 的 LMJ / SRC 系列（需在 APSRP 之后，前缀不冲突）
  if (/^LMJ/.test(u)) {
    const r = parseProsemiLmj(s);
    if (r) return r;
  }
  if (/^SRC/.test(u)) {
    const r = parseProsemiSrc(s);
    if (r) return r;
  }
  if (/^(CRCW|RCA|WSL|WSK)/.test(u)) {
    const r = parseVishayResistor(s);
    if (r) return r;
  }
  if (/^(RK73|TLR|TSL|SLN|BLR|PSJ|PSL|PSG)/.test(u)) {
    const r = parseKoaResistor(s);
    if (r) return r;
  }
  if (/^MCR/.test(u)) {
    const r = parseRohmResistor(s);
    if (r) return r;
  }
  if (/^(AC|RC|RT|AF|SR|AR|PE|PA|PU|AH)/.test(u)) {
    const r = parseYageoResistor(s);
    if (r) return r;
  }
  return null;
}

function parseResistorModel(s) {
  if (!s) return null;
  const trimmed = normalizeDash(String(s).trim());
  // 1) 原样尝试
  let r = dispatchResistorParser(trimmed);
  if (r) return r;
  // 2) 去除所有空格后尝试（如 "AC0402FR 0720KL"）
  const squeezed = trimmed.replace(/\s+/g, '');
  if (squeezed !== trimmed) {
    r = dispatchResistorParser(squeezed);
    if (r) return withExtractNote(r, squeezed, trimmed);
  }
  // 3) 从规格描述中提取候选型号逐个尝试
  for (const c of extractModelCandidates(trimmed)) {
    if (c === trimmed) continue;
    r = dispatchResistorParser(c);
    if (r) return withExtractNote(r, c, trimmed);
  }
  // 4) 去除其余标点符号后兜底尝试（如 "AC0402FR,0720KL"）
  const stripped = squeezed.replace(/[^0-9A-Za-z-]/g, '');
  if (stripped !== squeezed) {
    r = dispatchResistorParser(stripped);
    if (r) return withExtractNote(r, stripped, trimmed);
  }
  return null;
}

// ============================================================
// 规格 → 大毅型号
// ============================================================
// 阻值码**按精度位数重新编码**（皇上 2026-09-03 确认：1% 强制 4 位、5% 强制 3 位 E-24）
//   0Ω → '0'；F/D/B/A/C → 4 位；J/G/K → 3 位 E-24
// 0Ω 时把非 J 的容差归一为 J（5% 默认）
function toDayiModel(spec) {
  if (!spec || !spec.ok) return null;
  if (!spec.sizeCode) return { ...spec, dayiModel: null, error: '缺少尺寸信息' };
  if (!spec.dayiSeries) return { ...spec, dayiModel: null, error: '无对应大毅系列' };
  if (!spec.tolCode) return { ...spec, dayiModel: null, error: '缺少精度信息' };

  // EBR 合金系列专属校验（皇上 2026-09-04 确认：只有 25/39/59 三尺寸、F/G/J 三容差）
  if (spec.dayiSeries === 'EBR') {
    if (!EBR_SIZE_CODES.includes(spec.sizeCode)) {
      return { ...spec, dayiModel: null, error: `EBR 只有 2512(25)/3920(39)/5930(59) 三个尺寸，无 ${spec.size || spec.sizeCode}` };
    }
    if (!EBR_TOL_CODES.includes(spec.tolCode)) {
      return { ...spec, dayiModel: null, error: `EBR 只有 ±1%(F)/±2%(G)/±5%(J) 三档精度，无 ${spec.tol || spec.tolCode}` };
    }
  }

  const warnings = [];

  // EBR 型号无功率位，额定功率由「尺寸 + 阻值」查表得出（皇上 2026-09-08 官方规格表）
  if (spec.dayiSeries === 'EBR') {
    const ebrPower = lookupEbrPower(spec.sizeCode, spec.resistance);
    if (ebrPower) {
      spec.power = ebrPower;
      // 源厂商标称功率与大毅查表功率不一致时必须报警（同尺寸下功率随阻值变化，不能只看尺寸）
      if (spec.srcPower && Math.abs(spec.srcPower - parseFloat(ebrPower)) > 1e-9) {
        warnings.push(`功率差异：源料号标称 ${spec.srcPower}W，大毅 ${spec.dayiSeries} 在该阻值档为 ${ebrPower}，必须人工确认能否替换`);
      }
    } else {
      warnings.push(`EBR${spec.sizeCode} 在 ${spec.resistanceFormatted} 档无官方功率数据（表内只有 0.1~5mΩ 离散档），需核对规格书`);
    }
  }

  let tolCode = spec.tolCode;

  // 0Ω 特殊归一
  if (spec.resistance === 0) {
    if (tolCode === 'Z') {
      warnings.push('Vishay Z(0Ω jumper) 在大毅归一为 J(±5%)，差异不影响性能');
    }
    tolCode = 'J';
  }

  // 按精度位数重新编码阻值
  let resCode = resistanceToDayiCode(spec.resistance, tolCode, spec.dayiSeries);
  if (!resCode) {
    resCode = spec.resistanceCode;
    warnings.push(`阻值 ${spec.resistanceFormatted} 超出大毅编码范围，回退为输入原码 ${spec.resistanceCode}`);
  }

  // 包装：已确认系列用 E（编带），其余系列沿用输入的 T（纸带）
  const packaging = E_PACK_SERIES.includes(spec.dayiSeries) ? 'E' : spec.packaging;

  // 功率位 + 材料位回带：仅当输入本身带这两位时才拼接
  // 材料位只有 RLM/RLPL 有，RLP/EBR 无此位，拼上去就是错料号
  const matCode = MATERIAL_CODE_SERIES.includes(spec.dayiSeries) ? (spec.materialCode || '') : '';
  const midCode = (spec.powerCode || '') + matCode;

  const dayiModel = `${spec.dayiSeries}${spec.sizeCode}${tolCode}${packaging}${midCode}${resCode}`;
  return {
    ...spec,
    dayiModel,
    dayiTolCode: tolCode,
    dayiResCode: resCode,
    packaging,
    warnings
  };
}

// ============================================================
// 顶层便捷函数
// ============================================================

function matchResistorToDayi(s) {
  const spec = parseResistorModel(s);
  if (!spec) return { ok: false, input: s, error: '无法识别厂家/格式' };
  return toDayiModel(spec);
}

module.exports = {
  parseResistorModel,
  parseYageoResistor,
  parseKoaResistor,
  parseRohmResistor,
  parseVishayResistor,
  parseProsemiResistor,
  parseDayiResistor,
  parseDayiMilliohm,
  toDayiModel,
  matchResistorToDayi,
  // 内部工具（便于测试）
  parseResistance,
  parseAlloyResistance,
  resistanceToDayiCode,
  SIZE_TO_DAYI,
  TOL_MAP,
  TOL_TO_DIGITS,
  SERIES_MAP
};