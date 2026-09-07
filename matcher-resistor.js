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
  '3920': '39', '5930': '59'
};

// 大毅尺寸码 → 英制（反向表，PROSEMI 等直接用 2 位码的厂家用）
const DAYI_SIZE_TO_INCH = {
  '02': '0201', '04': '0402', '06': '0603',
  '10': '0805', '12': '1206', '13': '1210',
  '20': '2010', '25': '2512',
  '39': '3920', '59': '5930'
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

// 大毅自家系列（反解白名单，均为 3 字母）
const DAYI_SERIES = ['RMF', 'RMS', 'RAS', 'RLM', 'RLP', 'RLS', 'RHS', 'EBR', 'PBR'];

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

  // 带 R 小数点：0R05 / 43R2 / 100R
  const rm = s.match(/^(\d+)R(\d*)$/);
  if (rm) {
    const v = parseFloat(rm[1] + (rm[2] ? '.' + rm[2] : ''));
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
  return v >= 100 ? encodeE96(v) : encodeR4(v);
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
//   v<10  : 两位小数  1→1R00、2.2→2R20、3.3→3R30、0.05→0R05
//   v<100 : 一位小数  10→10R0、22→22R0、62→62R0、99.9→99R9
//   v<0.01: 两位小数不够（0.005→0R01、0.002→0R00 全是错值），
//            大毅该段写法无锚点，故返回 null 让调用方回退原码 + warning，不猜
function encodeR4(v) {
  if (v < 0.01) return null;
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
  const m = u.match(new RegExp('^(' + DAYI_SERIES.join('|') + ')(\\d{2})([FGJDBACK])([TE])([0-9A-Z]+)$'));
  if (!m) return null;
  const [, series, sizeCode, tolCode, packaging, resCode] = m;
  const sizeInch = DAYI_SIZE_TO_INCH[sizeCode];
  if (!sizeInch) return null;
  const res = series === 'EBR' ? parseDayiMilliohm(resCode) : parseResistance(resCode);
  if (!res) return null;
  return makeSpec({
    brand: 'dayi', model: s, prefix: series, size: sizeInch, tolCode,
    resistance: res, packaging, dayiSeriesOverride: series
  });
}

// ============================================================
// 统一分派 + 规格构造
// ============================================================

function makeSpec({ brand, model, prefix, size, tolCode, resistance, packaging, warning, dayiSeriesOverride }) {
  const sizeCode = size ? (SIZE_TO_DAYI[size] || null) : null;
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
    + DAYI_SERIES.join('|') + '|'
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
  if (new RegExp('^(' + DAYI_SERIES.join('|') + ')').test(u)) {
    const r = parseDayiResistor(s);
    if (r) return r;
  }
  if (/^APSRP/.test(u)) {
    const r = parseProsemiResistor(s);
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

  // 包装：EBR 例子用 E（编带），其余系列 T（纸带，皇上 2026-09-03 默认）
  const packaging = spec.dayiSeries === 'EBR' ? 'E' : spec.packaging;

  const dayiModel = `${spec.dayiSeries}${spec.sizeCode}${tolCode}${packaging}${resCode}`;
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