// BOM 匹配器核心逻辑
// 改进版本：精确匹配优先、容差匹配、系列过滤

// ---------- 规格归一化 ----------
function capToPf(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^([0-9.]+)\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i);
  if (!m) return null;
  let val = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'pf' || u === 'p') val *= 1;
  else if (u === 'nf' || u === 'n') val *= 1e3;
  else if (u === 'uf' || u === 'µf' || u === 'u' || u === 'µ') val *= 1e6;
  else if (u === 'mf') val *= 1e9;
  else return null;
  return Math.round(val * 1e6) / 1e6;
}

function voltToNum(s) {
  if (s === undefined || s === null || s === '') return null;
  const str = String(s).trim();
  let m = str.match(/^(\d+(?:\.\d+)?)\s*([kK])[vV]$/);
  if (m) return Math.round(parseFloat(m[1]) * 1000 * 1000) / 1000;
  m = str.match(/^(\d+(?:\.\d+)?)\s*[vV]$/);
  if (m) return Math.round(parseFloat(m[1]) * 1000) / 1000;
  m = str.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseFloat(m[1]) * 1000) / 1000;
  return null;
}

function tempCode(s) {
  if (!s) return null;
  const c = String(s).trim().toUpperCase();
  const m = c.match(/^(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])/);
  if (!m) return null;
  const code = m[1];
  if (code === 'COG' || code === 'NPO' || code === 'NP0') return 'C0G';
  return code;
}

function sizeInch(s) {
  if (!s) return null;
  let v = String(s).trim().replace(/^(SMD|SM)/i, '').trim();
  const m = v.match(/(\d{4,6})/);
  return m ? m[1] : null;
}

function normDev(s) {
  if (s === undefined || s === null) return '';
  let v = String(s).replace(/\+\/-/g, '±').replace(/\s+/g, '');
  if (!v) return '';
  // 解析 ±10% / 10% / ±0.1pF / 0.1pF / 20.0% 等，统一归一化为 ±<整数或小数><%|pF>
  const m = v.match(/^(±)?(\d+(?:\.\d+)?)(%|pF)$/i);
  if (m) {
    const num = parseFloat(m[2]);
    const numStr = Number.isInteger(num) ? String(num) : String(num);
    const unit = m[3].toLowerCase() === 'pf' ? 'pF' : '%';
    return '±' + numStr + unit;
  }
  // 无法按数值解析的（如 ±80%-20%），保证有 ± 前缀
  if (!v.startsWith('±')) v = '±' + v;
  return v;
}

// EIA 三位码转 pF
// 规则：前两位为有效数字，第三位为乘数（10 的幂）
// 例如：222 = 22×10² = 2200 pF；104 = 10×10⁴ = 100000 pF；101 = 10×10¹ = 100 pF
// 带 R 表示小数点：4R7 = 4.7 pF，R75 = 0.75 pF
function eiaCodeToPf(code) {
  if (!code) return null;
  const s = String(code).trim().toUpperCase();
  // 标准 EIA 三位码
  const m = s.match(/^(\d{1,2})(\d)$/);
  if (m) {
    const sig = parseInt(m[1], 10);
    const mult = parseInt(m[2], 10);
    if (isNaN(sig) || isNaN(mult)) return null;
    return sig * Math.pow(10, mult);
  }
  // 带 R 的小数表示
  if (/^\d*R\d*$/.test(s)) {
    const val = parseFloat(s.replace(/R/i, '.'));
    if (!isNaN(val)) return val;
  }
  return null;
}

// EIA 三位码转电压（V）
// 规则与 eiaCodeToPf 一致：前两位为有效数字，第三位为乘数（10 的幂）
// 用于风华/火炬等品牌的电压码解析
// 例如：500=50V, 160=16V, 101=100V, 202=2000V；带 R 表示小数点：6R3=6.3V, 2R5=2.5V
function eiaCodeToVolt(code) {
  if (!code) return null;
  const s = String(code).trim().toUpperCase();
  // 标准 EIA 三位码
  const m = s.match(/^(\d{1,2})(\d)$/);
  if (m) {
    const sig = parseInt(m[1], 10);
    const mult = parseInt(m[2], 10);
    if (isNaN(sig) || isNaN(mult)) return null;
    return sig * Math.pow(10, mult);
  }
  // 带 R 的小数表示
  if (/^\d*R\d*$/.test(s)) {
    const val = parseFloat(s.replace(/R/i, '.'));
    if (!isNaN(val)) return val;
  }
  return null;
}

// 公差字母码转标准偏差格式
// J=±5%, K=±10%, M=±20% 等
function devLetterToNorm(letter) {
  if (!letter) return '';
  const c = String(letter).trim().toUpperCase();
  const map = {
    B: '±0.1pF',
    C: '±0.25pF',
    D: '±0.5pF',
    F: '±1%',
    G: '±2%',
    J: '±5%',
    K: '±10%',
    M: '±20%',
    P: '±100%',
    Z: '±80%-20%'
  };
  return map[c] || '';
}

// 字段模式识别
const RE_CAP = /^[0-9.]+\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i;
const RE_DEV = /^(±|\+\/-)?\s*\d+(?:\.\d+)?(?:%|pF)$/i;
const RE_VOLT = /^\d+(?:\.\d+)?\s*[kK]?[vV]$/;
const RE_TEMP = /^(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])\b/i;
const RE_SIZE = /^(SMD|SM)?\s*\d{4,6}(?![0-9])/i;

// ---------- 解析微容产品型号名称 ----------
// 型号格式示例：T562G1210C0G102NPZ, B106M1210X5R500NRZ, B151J0805SPC251NKT
// 命名规则：
//   第1位：系列代码（A/T/B/V）
//   第2-4位：标称电容量（单位：pF），前两位数码为有效数字，后一位数码为10的幂数；
//            当标称电容量小于10pF时，以字母R表示小数点。
//            如：104=100000pF; 4R7=4.7pF; 0R5=0.5pF; R75=0.75pF
//   第5位：公差代码（A=±0.05pF，B=±0.1pF, C=±0.25pF, D=±0.5pF, F=±1%,G=±2%, J=±5%, K=±10%, M=±20%）
//   第6-9位：尺寸代码（0201，0402，0603，0805，1206，1210）
//   第10-12/13位：温度特性（如C0G, X5R, X7R）
//   第13-15/14-16位：电压等级EIA码（如2R5=2.5Vdc, 4R0=4.0Vdc, 6R3=6.3Vdc, 100=10Vdc, 160=16Vdc,
//            250=25Vdc, 350=35Vdc, 500=50Vdc, 101=100Vdc, 201=200Vdc, 251=250Vdc, 501=500Vdc,
//            631=630Vdc, 102=1000Vdc）
//   后面：其他参数
function parseProductName(name) {
  if (!name) return null;
  const s = String(name).trim().toUpperCase();

  // 验证基本格式：以A/T/B/V开头，至少12位
  const firstChar = s[0];
  if (!['A', 'T', 'B', 'V'].includes(firstChar)) return null;
  if (s.length < 12) return null;

  try {
    // 1. 系列识别
    const series = firstChar;

    // 2. 容量码（第2-4位，3位，可能是纯数字或含R）
    // 规则：前两位为有效数字，后一位为乘数；或含R表示小数点
    // 如：104=10×10⁴=100000pF, 4R7=4.7pF, 0R5=0.5pF, R75=0.75pF
    const capCode = s.substring(1, 4);
    // 验证容量码格式：纯数字或含R
    if (!/^[\dR]{3}$/.test(capCode)) return null;

    // 解析容量值
    let capPf = null;
    if (capCode.includes('R')) {
      // 含R的格式：R表示小数点
      capPf = parseFloat(capCode.replace('R', '.'));
    } else {
      // 纯数字EIA码：前两位有效数字，第三位乘数
      const sig = parseInt(capCode.substring(0, 2), 10);
      const mult = parseInt(capCode[2], 10);
      if (!isNaN(sig) && !isNaN(mult)) {
        capPf = sig * Math.pow(10, mult);
      }
    }
    if (capPf === null || isNaN(capPf)) return null;

    // 3. 公差代码（第5位字母）
    const devLetter = s[4];
    const dev = devLetterToNorm(devLetter);

    // 4. 尺寸代码（第6-9位，4位数字）
    const sizeCode = s.substring(5, 9);
    if (!/^\d{4}$/.test(sizeCode)) return null;

    // 尺寸代码映射到显示格式
    const sizeMap = {
      '0201': '0201/0603M',
      '0402': '0402/1005M',
      '0603': '0603/1608M',
      '0805': '0805/2012M',
      '1206': '1206/3216M',
      '1210': '1210/3225M',
      '2220': '2220/5750M'
    };
    const size = sizeMap[sizeCode] || sizeCode;

    // 5. 温度特性（从第10位开始，可能是C0G/X5R/X7R等）
    // 需要根据不同格式识别
    let temp = null;
    let voltCode = null;
    let volt = null;

    // 尝试匹配温度特性：C0G, X5R, X7R, X6S, X6T, X7S, X7T, X8G, X8L, X3H
    const tempPatterns = ['C0G', 'X5R', 'X7R', 'X6S', 'X6T', 'X7S', 'X7T', 'X8G', 'X8L', 'X3H'];
    const tempStartIdx = 9;

    for (const tp of tempPatterns) {
      if (s.substring(tempStartIdx, tempStartIdx + tp.length) === tp) {
        temp = tp;
        // 电压码在温度特性后面，3位（可能是数字或含R）
        voltCode = s.substring(tempStartIdx + tp.length, tempStartIdx + tp.length + 3);
        break;
      }
    }

    // 如果没有匹配到标准温度特性，可能是旧格式（如SPC）
    // 例如：B151J0805SPC251NKT
    if (!temp) {
      // 尝试匹配其他温度特性格式
      // SPC 可能表示某种特性，但数据中显示为 C0G
      // 这种格式下温度特性需要从产品数据中获取，无法直接从型号解析
      // 但电压码可能在后面（如251）
      const altTempMatch = s.match(/(?:SPC|SP)(\d{3})/i);
      if (altTempMatch) {
        // 对于SPC格式，假设温度特性为C0G（根据数据观察）
        temp = 'C0G';
        voltCode = altTempMatch[1];
      }
    }

    if (!temp) return null;

    // 6. 电压等级EIA码解析
    // 规则：纯数字时，前两位有效数字，第三位乘数；
    //       含R时，R表示小数点
    // 如：2R5=2.5V, 4R0=4.0V, 6R3=6.3V, 100=10V, 160=16V, 250=25V, 350=35V, 500=50V,
    //     101=100V, 201=200V, 251=250V, 501=500V, 631=630V, 102=1000V
    if (voltCode && /^[\dR]{3}$/.test(voltCode)) {
      if (voltCode.includes('R')) {
        // 含R的格式：R表示小数点
        volt = parseFloat(voltCode.replace('R', '.'));
      } else {
        // 纯数字EIA码：前两位有效数字，第三位乘数
        const sig = parseInt(voltCode.substring(0, 2), 10);
        const mult = parseInt(voltCode[2], 10);
        if (!isNaN(sig) && !isNaN(mult)) {
          volt = sig * Math.pow(10, mult);
        }
      }
    }

    if (volt === null || isNaN(volt)) return null;

    return {
      series,
      cap: capPf,
      dev,
      size,
      temp,
      volt,
      raw: name
    };
  } catch (err) {
    return null;
  }
}

// ---------- 解析其他品牌 MLCC 贴片电容型号 ----------
// 支持：国巨 YAGEO(CC)、风华 FH(4位数字开头)、火炬 Torch(FCC/HGC)、村田 Murata(GRM)、TDK(CGA)
// 返回格式与 parseProductName 对齐：{ series, cap, dev, size, temp, volt, raw }
// series 始终为 null（其他品牌无微容 A/T/B/V 系列）
function parseOtherBrandMlcc(name) {
  if (!name) return null;
  const s = String(name).trim().toUpperCase();

  // 国巨 YAGEO：CC 开头
  if (s.startsWith('CC')) return parseYageo(s);

  // 火炬 Torch：FCC 或 HGC 开头
  if (s.startsWith('FCC') || s.startsWith('HGC')) return parseTorch(s);

  // 村田 Murata：GRM 开头（通用型）
  if (s.startsWith('GRM')) return parseMurata(s);

  // 村田 Murata：GCM 开头（车规级）
  if (s.startsWith('GCM')) return parseMurataGcm(s);

  // TDK 东电化：CGA 开头（车规级）
  if (s.startsWith('CGA')) return parseTdk(s);

  // 风华 FH：4位数字开头 + 介质字母(B/CG/X)
  // 需在村田/国巨/火炬/TDK 之后判断，避免误匹配
  if (/^\d{4}(B|CG|X)[\dR]{3}/.test(s)) return parseFenghua(s);

  return null;
}

// 国巨 YAGEO 解析
// 格式：CC + 尺寸(4) + 偏差(1字母) + 内部码(1字母,通常R,部分为K) + 温度特性(3)+内部电压编码(1) + 版本(2字母) + 容量码(3)
// 示例：CC0402KRX7R0BB103 → 尺寸0402, 偏差K(±10%), 介质X7R, 容量103(=10nF)
// 注意1：偏差后的内部码字符不固定（R/K等），仅作占位不参与解析
// 注意2：温度相关段为4位整体（如X7R0），介质取前3位；型号不含标准电压信息，volt 始终为 null
function parseYageo(s) {
  const m = s.match(/^CC(\d{4})([A-Z])(?:[A-Z])([A-Z0-9]{4})([A-Z]{2})([\dR]{3})[A-Z]*$/);
  if (!m) return null;

  const sizeCode = m[1];
  const devLetter = m[2];
  const tempSeg = m[3];        // 4位温度+电压编码段（如 X7R0）
  const capCode = m[5];

  const cap = eiaCodeToPf(capCode);
  if (cap === null) return null;

  // 介质取温度段前3位（X7R0 → X7R）
  let temp = tempCode(tempSeg.substring(0, 3));
  // 微容筛选项中无 Y5V，设为空
  if (temp === 'Y5V') temp = '';

  return {
    series: null,
    cap,
    dev: devLetterToNorm(devLetter),
    size: sizeCode,
    temp: temp || '',
    volt: null,  // 国巨型号内部电压编码不对应标准电压值，不解析
    raw: s
  };
}

// 风华 FH 解析
// 格式：尺寸(4) + 介质(B/CG/X) + 容量码(3) + 偏差(1字母) + 电压码(3,可含R) + 包装(字母)
// 示例：0603B101K500NT → 尺寸0603, 介质B(X7R), 容量101(=100pF), 偏差K(±10%), 电压500(=50V)
//       0402B104K6R3NT → 电压6R3(=6.3V)
function parseFenghua(s) {
  const m = s.match(/^(\d{4})(B|CG|X)([\dR]{3})([A-Z])([\dR]{3})[A-Z]*$/);
  if (!m) return null;

  const sizeCode = m[1];
  const mediumCode = m[2];     // B/CG/X
  const capCode = m[3];
  const devLetter = m[4];
  const voltCode = m[5];

  const cap = eiaCodeToPf(capCode);
  if (cap === null) return null;

  const mediumMap = { B: 'X7R', CG: 'C0G', X: 'X5R' };

  return {
    series: null,
    cap,
    dev: devLetterToNorm(devLetter),
    size: sizeCode,
    temp: mediumMap[mediumCode] || '',
    volt: eiaCodeToVolt(voltCode),
    raw: s
  };
}

// 火炬 Torch 解析
// FCC 格式：FCC + 尺寸(4) + 介质(1字母) + 容量码(3) + 偏差(1字母) + 电压码(3) + 包装
//   示例：FCC1206X226K250HT → 尺寸1206, 介质X(X5R), 容量226(=22µF), 偏差K(±10%), 电压250(=25V)
// HGC 格式：HGC + 尺寸(4) + 介质码(2) + 容量码(3) + 偏差(1字母) + 电压码(3) + 包装
//   示例：HGC0805R5476M100NSLJ → 尺寸0805, 介质R5(X5R), 容量476(=47µF), 偏差M(±20%), 电压100(=10V)
function parseTorch(s) {
  // FCC 格式：介质为单字母
  if (s.startsWith('FCC')) {
    const m = s.match(/^FCC(\d{4})([A-Z])([\dR]{3})([A-Z])([\dR]{3})[A-Z]*$/);
    if (!m) return null;

    const cap = eiaCodeToPf(m[3]);
    if (cap === null) return null;

    const fccMediumMap = { X: 'X5R', B: 'X7R', C: 'C0G' };

    return {
      series: null,
      cap,
      dev: devLetterToNorm(m[4]),
      size: m[1],
      temp: fccMediumMap[m[2]] || '',
      volt: eiaCodeToVolt(m[5]),
      raw: s
    };
  }

  // HGC 格式：介质为2位码（R5/R7/N4 等）
  if (s.startsWith('HGC')) {
    const m = s.match(/^HGC(\d{4})([A-Z0-9]{2})([\dR]{3})([A-Z])([\dR]{3})[A-Z]*$/);
    if (!m) return null;

    const cap = eiaCodeToPf(m[3]);
    if (cap === null) return null;

    const hgcMediumMap = { R5: 'X5R', R7: 'X7R', N4: 'C0G' };

    return {
      series: null,
      cap,
      dev: devLetterToNorm(m[4]),
      size: m[1],
      temp: hgcMediumMap[m[2]] || '',
      volt: eiaCodeToVolt(m[5]),
      raw: s
    };
  }

  return null;
}

// 村田 Murata 解析
// 格式：GRM(3) + 尺寸(2) + 厚度(1) + 介质(2) + 电压(2) + 容量码(3) + 偏差(1字母) + 规格(3) + 包装(1) = 18位
// 示例：GRM32EC72A106KE05L → 尺寸32(=1210), 介质C7(=X7S), 电压2A(=100V), 容量106(=10µF), 偏差K(±10%)
function parseMurata(s) {
  const m = s.match(/^GRM(\d{2})([A-Z0-9])([A-Z0-9]{2})([A-Z0-9]{2})([\dR]{3})([A-Z])([A-Z0-9]{3})([A-Z])$/);
  if (!m) return null;

  const sizeCode2 = m[1];    // 2位尺寸码
  const mediumCode = m[3];   // 2位介质码
  const voltCode = m[4];     // 2位电压码
  const capCode = m[5];      // 容量EIA码
  const devLetter = m[6];    // 偏差字母

  // 尺寸码映射（2位 → 4位 inch 码）
  const sizeMap = {
    '02': '0402', '03': '0603', '05': '0805', '06': '1206', '08': '1210',
    '15': '0201', '18': '0603', '21': '0805', '31': '1206', '32': '1210',
    '55': '1812'
  };
  const size = sizeMap[sizeCode2];
  if (!size) return null;

  // 介质码映射
  const mediumMap = { '5C': 'C0G', 'R6': 'X5R', 'R7': 'X7R', 'C7': 'X7S' };

  // 电压码映射
  const voltMap = {
    '0G': 4, '0J': 6.3, '0L': 2.5, '1A': 10, '1C': 16, '1E': 25, '1H': 50,
    '1V': 35, '1K': 80, '2A': 100, '2D': 200, '2E': 250, '2W': 450,
    '2H': 500, '2K': 600, '3A': 1000
  };

  const cap = eiaCodeToPf(capCode);
  if (cap === null) return null;

  return {
    series: null,
    cap,
    dev: devLetterToNorm(devLetter),
    size,
    temp: mediumMap[mediumCode] || '',
    volt: voltMap[voltCode] !== undefined ? voltMap[voltCode] : null,
    raw: s
  };
}

// TDK 东电化 CGA 系列车规级 MLCC 解析
// 格式：CGA + 尺寸(1位) + 厚度(1字母) + 寿命试压(1数字) + 温度特性(3位) + 电压(2位) + 容量(3位) + 偏差(1字母) + 厚度/包装/特殊码(剩余)
// 示例：CGA3E3X7R1H474KT000N → 尺寸0603, X7R, 1H(50V), 474(470nF), K(±10%)
//       CGA6P1C0G3B103G250AC  → 尺寸1210, C0G, 3B(1250V), 103(10nF), G(±2%)
//       CGA3E2NP02A3R3C080AA  → 尺寸0603, NP0(=C0G), 2A(100V), 3R3(3.3pF), C(±0.25pF)
function parseTdk(s) {
  const m = s.match(/^CGA([1-9D])([A-Z])([123])(C0G|NP0|X5R|X6S|X7R|X7S|X7T|X8R|X8L)([0-9][A-Z])([\dR]{3})([CDFGJKM])([A-Z0-9]*)$/);
  if (!m) return null;

  const sizeCode = m[1];        // 1位尺寸码
  const tempCode = m[4];        // 温度特性（C0G/NP0/X5R/X7R等）
  const voltCode = m[5];        // 2位电压码
  const capCode = m[6];         // 3位容量 EIA 码
  const devLetter = m[7];       // 偏差字母

  // 尺寸码映射（TDK CGA 系列 → inch 码）
  const sizeMap = {
    '1': '0201', '2': '0402', '3': '0603', '4': '0805', '5': '1206',
    '6': '1210', '7': '1808', '8': '1812', '9': '2220', 'D': '3025'
  };
  const size = sizeMap[sizeCode];
  if (!size) return null;

  // 温度特性归一化：NP0 与 C0G 同义
  let temp = tempCode;
  if (temp === 'NP0') temp = 'C0G';

  // 电压码映射（TDK 标准）
  const voltMap = {
    '0G': 4, '0L': 2.5, '0J': 6.3,
    '1A': 10, '1C': 16, '1E': 25, '1V': 35, '1H': 50, '1K': 80,
    '2A': 100, '2D': 200, '2E': 250, '2W': 450, '2H': 500, '2K': 600,
    '3A': 1000, '3B': 1250, '3D': 2000, '3F': 3000
  };

  const cap = eiaCodeToPf(capCode);
  if (cap === null) return null;

  return {
    series: null,
    cap,
    dev: devLetterToNorm(devLetter),
    size,
    temp,
    volt: voltMap[voltCode] !== undefined ? voltMap[voltCode] : null,
    raw: s
  };
}

// 村田 Murata GCM 系列车规级 MLCC 解析
// 格式：GCM + 尺寸(2) + 厚度(1) + 温度特性(2) + 电压(2) + 容量码(3) + 偏差(1字母) + 规格(3) + 包装(1)
// 示例：GCM155C1H221JA16D  → 尺寸0402(15), C0G(5C), 50V(1H), 220pF(221), ±5%(J)
//       GCM155R71H104KE02D  → 尺寸0402(15), X7R(R7), 50V(1H), 100nF(104), ±10%(K)
function parseMurataGcm(s) {
  const m = s.match(/^GCM(\d{2})([A-Z0-9])([A-Z0-9]{2})([A-Z0-9]{2})([\dR]{3})([A-Z])([A-Z0-9]{3})([A-Z])$/);
  if (!m) return null;

  const sizeCode2 = m[1];    // 2位尺寸码
  const mediumCode = m[3];   // 2位温度特性码
  const voltCode = m[4];     // 2位电压码
  const capCode = m[5];      // 容量 EIA 码
  const devLetter = m[6];    // 偏差字母

  // 尺寸码映射（村田 GCM 系列与 GRM 系列尺寸码相同）
  const sizeMap = {
    '03': '0201', '15': '0402', '18': '0603', '21': '0805', '31': '1206', '32': '1210',
    '35': '1812', '43': '2220'
  };
  const size = sizeMap[sizeCode2];
  if (!size) return null;

  // 温度特性码映射（村田 GCM 系列车规级）
  // 注意：C2, 7U, 9E 等特殊介质微容筛选项中无对应选项，会置空
  const mediumMap = {
    '5C': 'C0G', '5G': 'X8G',
    'R6': 'X5R', 'R7': 'X7R', 'R9': 'X8R',
    'C7': 'X7S', 'D7': 'X7T',
    'L8': 'X8L', 'M8': 'X8M', 'N8': 'X8N'
  };

  // 电压码映射（村田 GCM 系列与 GRM 系列电压码基本相同）
  const voltMap = {
    '0G': 4, '0L': 2.5, '0J': 6.3,
    '1A': 10, '1C': 16, '1E': 25, 'YA': 35, '1H': 50, '1K': 80,
    '2A': 100, '2E': 250, '2W': 450, '2H': 500, '2K': 600,
    '3A': 1000, '3D': 2000
  };

  const cap = eiaCodeToPf(capCode);
  if (cap === null) return null;

  return {
    series: null,
    cap,
    dev: devLetterToNorm(devLetter),
    size,
    temp: mediumMap[mediumCode] || '',
    volt: voltMap[voltCode] !== undefined ? voltMap[voltCode] : null,
    raw: s
  };
}

// ---------- 解析 BOM 物料描述 ----------
function parseDesc(desc) {
  if (!desc) return null;
  // 统一字符：全角逗号→半角，μ→µ，全角百分号→半角
  let text = String(desc).replace(/，/g, ',').replace(/μ/g, 'µ').replace(/％/g, '%').trim();

  // ===== 中文电容描述格式 =====
  // 格式：电容[容量]/[电压] ... (各种变体)
  // 例如：电容0.1UF/50V 0603±10％  X7R
  //       电容22uf/16V 封装1206±20%，x7R
  //       电容10UF/25V 1206±10%
  //       贴片电容 22UF/25V X7R 1210±10%
  //       电容0.1UF/50V(X7R) 0402 ±10%
  //       电容2.2uF/100V/X7S/±10%/1206
  //       电容 4.7uF±10%/100V 封装：1210 材质：X7S
  //       电容8.2pF/50V NPO ±0.25pF
  if (text.startsWith('电容') || text.startsWith('贴片电容')) {
    // 移除"贴片电容"或"电容"前缀
    let content = text.replace(/^贴片电容\s*/i, '').replace(/^电容\s*/i, '').trim();

    // 尝试提取容量 (可能带偏差，如 4.7uF±10%)
    // 容量后可能是 / 或空格
    const capMatch = content.match(/^([0-9.]+\s*(?:pF|nF|uF|µF|mF|p|n|u|µ))\s*(±\s*\d+(?:\.\d+)?%?)?\s*([\/\s])/i);
    if (capMatch) {
      const capStr = capMatch[1];
      const cap = capToPf(capStr);
      const preDev = capMatch[2] ? normDev(capMatch[2]) : '';
      const separator = capMatch[3] || ' ';
      if (cap !== null) {
        // 提取电压
        let volt = null;
        let remaining = content.substring(capMatch[0].length).trim();

        // 格式1: 容量/电压/介质/偏差/尺寸 (全斜杠格式)
        // 例如：电容2.2uF/100V/X7S/±10%/1206
        // 或者：容量偏差/电压/尺寸/材质 (如 4.7uF±10%/100V/...)
        if (separator === '/' && remaining.includes('/')) {
          const slashParts = remaining.split('/').map(s => s.trim()).filter(s => s);
          if (slashParts.length >= 1) {
            // 第一部分是电压
            volt = voltToNum(slashParts[0]);
            let temp = null;
            let dev = preDev;
            let size = null;

            // 遍历剩余部分
            for (let i = 1; i < slashParts.length; i++) {
              const part = slashParts[i];
              if (!temp && RE_TEMP.test(part)) { temp = tempCode(part); continue; }
              if (!dev && RE_DEV.test(part)) { dev = normDev(part); continue; }
              if (!size && RE_SIZE.test(part)) { size = sizeInch(part); continue; }
            }

            // 允许缺少介质的情况
            if (volt !== null && size) {
              return { cap, dev: dev || '', volt, temp: temp || '', size, raw: desc };
            }
          }
        }

        // 格式2: 容量/电压 或 容量 电压 (后面是其他信息)
        // 提取电压 (电压可能在容量后面，用/分隔，也可能直接跟数字和V)
        const voltMatch = remaining.match(/^(\d+(?:\.\d+)?\s*[kK]?[vV])/i);
        if (voltMatch) {
          volt = voltToNum(voltMatch[1]);
          remaining = remaining.substring(voltMatch[0].length).trim();
        }

        if (volt !== null) {
          // 从剩余文本中提取介质、偏差、尺寸
          let temp = null;
          let dev = preDev; // 使用预先解析的偏差
          let size = null;

          // 先尝试从括号中提取介质 (如 (X7R) 或 （X7R）)
          const tempParenMatch = remaining.match(/[（(]\s*(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])\s*[)）]/i);
          if (tempParenMatch) {
            temp = tempCode(tempParenMatch[1]);
            remaining = remaining.replace(tempParenMatch[0], ' ');
          }

          // 移除品牌信息和"封装:"、"材质:"等标签
          remaining = remaining.replace(/[（(][^)）]*[)）]/g, ' ') // 移除其他括号内的信息
                                 .replace(/封装[：:]\s*/i, ' ')
                                 .replace(/材质[：:]\s*/i, ' ')
                                 .replace(/封装/i, ' ')
                                 .replace(/[，,]/g, ' ')
                                 .trim();

          // 尝试匹配 NPO (可能单独出现)
          if (!temp && /\bNPO\b/i.test(remaining)) {
            temp = 'C0G';
            remaining = remaining.replace(/\bNPO\b/i, ' ');
          }

          // 尝试匹配带偏差的 pF 格式 (如 ±0.25pF)
          const pfDevMatch = remaining.match(/(±\s*\d+(?:\.\d+)?\s*pF)/i);
          if (pfDevMatch && !dev) {
            dev = normDev(pfDevMatch[1]);
            remaining = remaining.replace(pfDevMatch[1], ' ');
          }

          // 按空格/斜杠分割剩余部分
          const parts = remaining.split(/[\s\/]+/).map(s => s.trim()).filter(s => s);

          for (const part of parts) {
            if (!temp && RE_TEMP.test(part)) { temp = tempCode(part); continue; }
            if (!dev && RE_DEV.test(part)) { dev = normDev(part); continue; }
            // 尺寸可能带偏差，如 0603±10%，需要一起提取
            if (!size) {
              const sizeDevMatch = part.match(/^(\d{4,6})\s*(±\s*\d+(?:\.\d+)?%?)$/i);
              if (sizeDevMatch) {
                size = sizeInch(sizeDevMatch[1]);
                if (!dev) dev = normDev(sizeDevMatch[2]);
                continue;
              }
              // 单独的尺寸
              if (RE_SIZE.test(part)) { size = sizeInch(part); continue; }
            }
          }

          // 如果没找到介质，尝试从文本中提取X5R/X7R等
          if (!temp) {
            const tempMatch = remaining.match(/(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])/i);
            if (tempMatch) temp = tempCode(tempMatch[1]);
          }

          // 尝试提取尺寸（可能带有偏差，如 0603±10%）
          if (!size) {
            const sizeDevMatch = remaining.match(/(\d{4})\s*(±\s*\d+(?:\.\d+)?%?)/i);
            if (sizeDevMatch) {
              size = sizeInch(sizeDevMatch[1]);
              if (!dev) dev = normDev(sizeDevMatch[2]);
            }
          }

          // 如果有尺寸，但缺少介质，允许返回（介质为空字符串）
          // 这样在匹配阶段可以忽略介质维度进行匹配
          if (size) {
            return { cap, dev: dev || '', volt, temp: temp || '', size, raw: desc };
          }
        }
      }
    }
  }

  // ===== 中文描述格式 =====
  // 格式：<尺寸>封装...中文..._<容量>/<公差>/<电压>[/<介质>]
  // 例如：0402封装无极性贴片陶瓷电容_100nF/±10%/50V/X7R
  //       0603封装无极性贴片陶瓷电容_3.3nF/±10%/50V     （介质缺失）
  //       0805封装无极性贴片陶瓷电容_22uF/±20%/10V/X7R, 无极性贴片电容
  //       0402封装..._22pF/±5%/50V/NP0, 0402封装..._22pF/±1%/50V/NP0  （一行多规格）
  // 特征：含"封装"和"_"，_ 后为 容量/公差/电压[/介质]
  if (text.includes('封装') && text.includes('_')) {
    const segments = text.split(',').map((s) => s.trim()).filter((s) => s);
    for (const seg of segments) {
      const sizeM = seg.match(/(\d{4})\s*封装/);
      if (!sizeM) continue;
      const size = sizeM[1];
      const underIdx = seg.lastIndexOf('_');
      if (underIdx < 0) continue;
      const afterUnder = seg.substring(underIdx + 1).trim();
      const fields = afterUnder.split('/').map((s) => s.trim()).filter((s) => s);
      if (fields.length < 3) continue;
      const cap = capToPf(fields[0]);
      const dev = normDev(fields[1]);
      const volt = voltToNum(fields[2]);
      const temp = fields[3] ? (tempCode(fields[3]) || '') : '';
      if (cap !== null && volt !== null && size) {
        return { cap, dev: dev || '', volt, temp, size, raw: desc };
      }
    }
  }

  // ===== 贴片电容逗号格式 =====
  // 格式：贴片电容[型号],容量(EIA码)/电压,公差,介质,尺寸
  // 例如：贴片电容,10uF(106)/10V, ±10%,X5R,0603
  //       贴片电容(国巨CC0603KRX7R9BB472),4.7nF(472)/50V,±10%,X7R,0603
  //       贴片电容(国巨CC0603JRNPO9BN150),15pF(15P)/50V,±5%,NP0,0603
  // 特征：开头是"贴片电容"，逗号分隔5段，第2段含 "/" 且括号内有EIA码
  if (text.startsWith('贴片电容') && text.includes(',')) {
    const parts = text.split(',').map((s) => s.trim()).filter((s) => s);
    if (parts.length >= 5) {
      // 第2段：容量(EIA码)/电压，如 10uF(106)/10V 或 4.7nF(472)/50V
      const capVoltPart = parts[1];
      if (capVoltPart.includes('/')) {
        const cv = capVoltPart.split('/').map((s) => s.trim());
        if (cv.length >= 2) {
          // 容量部分可能有括号EIA码，取括号前内容
          let capStr = cv[0];
          const parenIdx = capStr.indexOf('(');
          if (parenIdx > 0) capStr = capStr.substring(0, parenIdx);
          const cap = capToPf(capStr);
          const volt = voltToNum(cv[1]);
          const dev = normDev(parts[2]);
          const temp = tempCode(parts[3]);
          const size = sizeInch(parts[4]);
          if (cap !== null && volt !== null && temp && size) {
            return { cap, dev: dev || '', volt, temp, size, raw: desc };
          }
        }
      }
    }
  }

  // ===== SMD 斜杠分隔描述格式 =====
  // 格式：SMD/[容量]/[偏差]/[电压或尺寸]/[尺寸或电压]/[介质]/[原厂型号[:：]型号]
  // 电压和尺寸的顺序可能互换；"原厂型号"前可能缺失斜杠
  // 例如：SMD/1pF/±0.25pF/50V/0402/NPO/原厂型号：CC0402CRNPO9BN1R0
  //       SMD/0.3pF/±0.1pF/0402/50V/COG/原厂型号：0402CG0R3B500NT
  //       SMD/1nF/±5%/50V/0402/NPO原厂型号:CC0402JRNPO9BN102
  if (/^SMD[\/\s]/i.test(text)) {
    // 在"原厂型号"前统一补充斜杠，便于后续分割（已有斜杠时产生空段会被过滤）
    const normalized = text.replace(/(原厂型号)/i, '/$1');
    const sp = normalized.split('/').map((p) => p.trim()).filter((p) => p.length);
    // sp[0]=SMD, sp[1]=容量, sp[2]=偏差, sp[3]/sp[4]=电压|尺寸(顺序不定), sp[5]=介质
    if (sp.length >= 6 && /^SMD$/i.test(sp[0])) {
      const cap = capToPf(sp[1]);
      const dev = normDev(sp[2]);
      let volt = null, size = null, temp = '';
      for (let i = 3; i <= 4 && i < sp.length; i++) {
        if (volt === null && RE_VOLT.test(sp[i])) { volt = voltToNum(sp[i]); continue; }
        if (size === null && RE_SIZE.test(sp[i])) { size = sizeInch(sp[i]); continue; }
      }
      if (sp[5] && RE_TEMP.test(sp[5])) { temp = tempCode(sp[5]); }
      if (cap !== null && volt !== null && size && temp) {
        return { cap, dev: dev || '', volt, temp, size, raw: desc };
      }
    }
  }

  // ===== 斜杠分隔的 EIA 码格式 =====
  // 格式：[C]/容量码/公差/电压/介质/尺寸/[附加]/[RoHS]
  // 例如：C/222/K/50/X5R/0402/A/RoHS  → 2200pF, ±10%, 50V, X5R, 0402
  //       C/101/K/50/X5R/0402/A/RoHS  → 100pF,  ±10%, 50V, X5R, 0402
  //       C/100/J/50/NP0/0402/A/RoHS  → 10pF,   ±5%,  50V, C0G, 0402
  if (text.includes('/')) {
    const sp = text.split('/').map((p) => p.trim()).filter((p) => p.length);
    const typeCode = sp[0] ? sp[0].toUpperCase() : '';
    // 第 0 段若为电容类型标识(C/CAP/MLCC)则跳过
    const startIdx = (typeCode === 'C' || typeCode === 'CAP' || typeCode === 'MLCC') ? 1 : 0;
    if (sp.length >= startIdx + 5) {
      const cap = eiaCodeToPf(sp[startIdx]);
      const dev = devLetterToNorm(sp[startIdx + 1]);
      const volt = voltToNum(sp[startIdx + 2]);
      const temp = tempCode(sp[startIdx + 3]);
      const size = sizeInch(sp[startIdx + 4]);
      if (cap !== null && volt !== null && temp && size) {
        return { cap, dev: dev || '', volt, temp, size, raw: desc };
      }
    }
  }

  // ===== 逗号分隔的 EIA 码格式（带 MLCC 标识） =====
  // 格式：MLCC,容量码,公差字母,电压,介质,尺寸,[厚度],[具体型号]
  // 例如：MLCC,106,K,6.3V,X5R,0603,T=0.80mm,V106K0603X5R6R3NKT(VIIYONG)
  //       MLCC,226,M,25V,X5R,0805,T=1.25mm,GRM21BR61E226ME44L(Murata)
  //       MLCC,106,M,6.3V,X5R,0603,T=0.85mm,C0603B106M007T(HEC)
  // 特征：逗号分隔，第0段是 MLCC/C/CAP，第1段是纯数字EIA码
  if (text.includes(',')) {
    const parts = text.split(',').map((p) => p.trim()).filter((p) => p.length);
    // 判断是否为逗号+EIA码格式：第0段是类型标识，第1段是3位数字的EIA码
    const type0 = parts[0] ? parts[0].toUpperCase() : '';
    const isTypeIdent = (type0 === 'MLCC' || type0 === 'C' || type0 === 'CAP' || type0 === 'CERAMIC' || type0 === 'CAPACITOR');
    const isEiaCode = parts[1] && /^\d{3,4}$/.test(parts[1]); // 106, 226, 475 等纯数字码
    if (isTypeIdent && isEiaCode && parts.length >= 6) {
      const cap = eiaCodeToPf(parts[1]);
      const dev = devLetterToNorm(parts[2]);
      const volt = voltToNum(parts[3]);
      const temp = tempCode(parts[4]);
      const size = sizeInch(parts[5]);
      if (cap !== null && volt !== null && temp && size) {
        return { cap, dev: dev || '', volt, temp, size, raw: desc };
      }
    }
  }

  // ===== 逗号/空格分隔格式（原有逻辑） =====
  let parts = text.split(',').map((p) => p.trim()).filter((p) => p.length);

  const expanded = [];
  for (const p of parts) {
    let m = p.match(/^([0-9.]+\s*(?:pF|nF|uF|µF|mF|p|n|u|µ))\s*(±\s*\d+(?:\.\d+)?(?:%|pF)|\+\/-\s*\d+(?:\.\d+)?(?:%|pF))$/i);
    if (m) { expanded.push(m[1].trim()); expanded.push(m[2].trim()); continue; }
    m = p.match(/^(\d+(?:\.\d+)?\s*[kK]?[vV])\s*(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])$/i);
    if (m) { expanded.push(m[1].trim()); expanded.push(m[2].trim()); continue; }
    expanded.push(p);
  }
  parts = expanded;

  let cap = null, dev = null, volt = null, temp = null, size = null;
  for (const p of parts) {
    if (cap === null && RE_CAP.test(p)) { cap = capToPf(p); continue; }
    if (dev === null && RE_DEV.test(p)) { dev = normDev(p); continue; }
    if (volt === null && RE_VOLT.test(p)) { volt = voltToNum(p); continue; }
    if (temp === null && RE_TEMP.test(p)) { temp = tempCode(p); continue; }
    if (size === null && RE_SIZE.test(p)) { size = sizeInch(p); continue; }
  }
  if (cap === null || volt === null || temp === null || size === null) return null;
  return { cap, dev: dev || '', volt, temp, size, raw: desc };
}

// ---------- 宽松解析（用于型号筛选场景） ----------
// 与 parseDesc 不同，不要求所有字段都存在，只要识别到任一字段即返回
// 用于在型号筛选输入框中输入规格描述时，自动填充已识别的筛选项
function parseDescLoose(desc) {
  if (!desc) return null;

  // 先尝试严格解析，成功则直接返回
  const strict = parseDesc(desc);
  if (strict) return strict;

  // 宽松解析：从文本中提取所有能识别的字段
  let text = String(desc).replace(/，/g, ',').replace(/μ/g, 'µ').replace(/％/g, '%').trim();

  let cap = null, dev = '', volt = null, temp = '', size = '';
  let matchedText = '';

  // 1. 提取容量（带单位，优先匹配长单位 pF/nF/uF/µF/mF，再匹配单字母 p/n/u/µ）
  const capMatch = text.match(/([0-9.]+)\s*(pF|nF|uF|µF|mF)/i) || text.match(/([0-9.]+)\s*(p|n|u|µ)\b/i);
  if (capMatch) {
    const v = capToPf(capMatch[1] + capMatch[2]);
    if (v !== null) {
      cap = v;
      matchedText += capMatch[0] + ' ';
    }
  }

  // 2. 提取电压（数字+V/KV，后面不能跟字母，避免误匹配型号）
  const voltMatch = text.match(/(\d+(?:\.\d+)?)\s*[kK]?[vV](?![a-zA-Z])/);
  if (voltMatch) {
    volt = voltToNum(voltMatch[1] + 'V');
    if (volt !== null) matchedText += voltMatch[0] + ' ';
  }

  // 3. 提取介质（C0G/X5R/X7R/NPO 等）
  const tempMatch = text.match(/\b(C0G|COG|NPO|NP0|X5R|X6S|X6T|X7R|X7S|X7T|X8G|X8L|X3H)\b/i);
  if (tempMatch) {
    temp = tempCode(tempMatch[1]);
    if (temp) matchedText += tempMatch[0] + ' ';
  }

  // 4. 提取偏差（±数字% 或 ±数字pF）
  const devMatch = text.match(/(±\s*\d+(?:\.\d+)?\s*(?:%|pF))/i);
  if (devMatch) {
    dev = normDev(devMatch[1]);
    if (dev) matchedText += devMatch[0] + ' ';
  }

  // 5. 提取尺寸（4位数字）—— 从未匹配的文本中提取，避免误匹配容量/电压中的数字
  let remaining = text;
  if (capMatch && cap !== null) remaining = remaining.replace(capMatch[0], ' ');
  if (voltMatch && volt !== null) remaining = remaining.replace(voltMatch[0], ' ');
  if (tempMatch && temp) remaining = remaining.replace(tempMatch[0], ' ');
  if (devMatch && dev) remaining = remaining.replace(devMatch[0], ' ');
  // 移除括号内的备注信息
  remaining = remaining.replace(/[（(][^)）]*[)）]/g, ' ');

  const sizeMatch = remaining.match(/\b(\d{4})\b/);
  if (sizeMatch) {
    size = sizeInch(sizeMatch[1]) || '';
  }

  // 至少识别到一个有效字段才返回
  if (cap !== null || volt !== null || temp || size || dev) {
    return { cap, dev, volt, temp, size, raw: desc };
  }

  return null;
}

// ---------- 系列识别 ----------
function getSeries(productName) {
  if (!productName) return null;
  const name = String(productName).toUpperCase();
  // A系列: A开头，车载动力总成/安全设备
  if (name.startsWith('A')) return 'A';
  // T系列: T开头，车载信息娱乐/舒适设备
  if (name.startsWith('T')) return 'T';
  // B系列: B开头，工业设备
  if (name.startsWith('B')) return 'B';
  // V系列: V开头，通用设备
  if (name.startsWith('V')) return 'V';
  return null;
}

// ---------- 构建索引 ----------
function buildIndex(products, selectedSeries) {
  const list = products.list || [];
  const index = new Map();

  for (const it of list) {
    const series = getSeries(it.productName);

    // 过滤系列
    if (selectedSeries && selectedSeries.length > 0) {
      if (!series || !selectedSeries.includes(series)) continue;
    }

    const cap = capToPf(it.capacity);
    const volt = voltToNum(it.voltage);
    const temp = tempCode(it.tempCharacteristics);
    const sz = sizeInch(it.size);
    if (cap === null || volt === null || !temp || !sz) continue;

    const key = `${cap}|${volt}|${temp}|${sz}`;
    if (!index.has(key)) index.set(key, []);

    index.get(key).push({
      name: it.productName,
      dev: normDev(it.capacityDeviation),
      series: series,
      specs: it.specs || []
    });
  }

  return { index, total: list.length };
}

// ---------- 容差匹配 ----------
// 检查两个容量值是否在容差范围内
function capMatchWithinTolerance(cap1, cap2, tolerance = 0.05) {
  if (cap1 === null || cap2 === null) return false;
  const diff = Math.abs(cap1 - cap2);
  const avg = (cap1 + cap2) / 2;
  return diff / avg <= tolerance;
}

// ---------- 匹配逻辑 ----------
function matchSpec(spec, index, options = {}) {
  const { exactFirst = true, fuzzyTolerance = 0.05 } = options;

  // 精确匹配
  const key = `${spec.cap}|${spec.volt}|${spec.temp}|${spec.size}`;
  let cands = index.get(key);

  // 介质缺失时，忽略介质维度匹配（按 容量/电压/尺寸 匹配）
  if ((!cands || cands.length === 0) && spec.temp === '') {
    cands = [];
    for (const [k, items] of index.entries()) {
      const [capStr, voltStr, , sizeStr] = k.split('|');
      if (parseFloat(capStr) === spec.cap && parseFloat(voltStr) === spec.volt && sizeStr === spec.size) {
        cands.push(...items);
      }
    }
  }

  if (cands && cands.length > 0) {
    // 偏差完全一致
    const exact = cands.filter((c) => c.dev === spec.dev);
    if (exact.length > 0) {
      return {
        items: exact.map((c) => ({ name: c.name, specs: c.specs })),
        names: exact.map((c) => c.name),
        status: '精确匹配',
        matchType: 'exact'
      };
    }
    // 忽略偏差匹配
    return {
      items: cands.map((c) => ({ name: c.name, specs: c.specs })),
      names: cands.map((c) => c.name),
      status: '忽略偏差',
      matchType: 'ignore_dev'
    };
  }

  // 容差匹配（容量在一定误差范围内）
  const fuzzyResults = [];
  for (const [k, items] of index.entries()) {
    const [capStr, voltStr, tempStr, sizeStr] = k.split('|');
    const cap = parseFloat(capStr);
    const volt = parseFloat(voltStr);

    // 检查电压、尺寸是否完全匹配；介质非空时才检查介质
    if (volt !== spec.volt || sizeStr !== spec.size) continue;
    if (spec.temp !== '' && tempStr !== spec.temp) continue;

    // 检查容量是否在容差范围内
    if (capMatchWithinTolerance(cap, spec.cap, fuzzyTolerance)) {
      fuzzyResults.push(...items);
    }
  }

  if (fuzzyResults.length > 0) {
    return {
      items: fuzzyResults.map((c) => ({ name: c.name, specs: c.specs })),
      names: fuzzyResults.map((c) => c.name),
      status: '容差匹配',
      matchType: 'fuzzy'
    };
  }

  return { items: [], names: [], status: '未匹配', matchType: 'none' };
}

// ---------- 单个 sheet 的匹配处理 ----------
function matchSingleSheet(ws, sheetName, index, options) {
  const XLSX = require('xlsx');
  const { exactFirst = true, fuzzyTolerance = 0.05, descColumnName = '物料描述' } = options;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });

  // 定位表头行（使用自定义列名）
  let headerIdx = -1;
  let descCol = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if (typeof rows[i][j] === 'string' && rows[i][j].includes(descColumnName)) {
        headerIdx = i;
        descCol = j;
      }
    }
  }

  if (headerIdx < 0) {
    // 回退：自动尝试常见规格列名（表头可能是"规格"/"PLMTITLE"/"描述"等）
    const fallbacks = [
      '物料描述', '物料规格', '规格描述', '规格型号', '规格', '器件规格', '零件规格',
      '物料名称', '描述', 'PLMTITLE', 'TITLE', 'Description', 'description', 'Part Number', '描述规格'
    ];
    for (let i = 0; i < Math.min(20, rows.length) && headerIdx < 0; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        const cell = typeof rows[i][j] === 'string' ? rows[i][j].trim() : '';
        if (!cell) continue;
        const lower = cell.toLowerCase();
        if (fallbacks.some((fn) => lower === fn.toLowerCase() || lower.includes(fn.toLowerCase()))) {
          headerIdx = i;
          descCol = j;
        }
      }
    }
  }

  if (headerIdx < 0) {
    // 该 sheet 未找到规格列，返回空结果
    return {
      sheetName,
      skipped: true,
      reason: `未找到"${descColumnName}"列`,
      stats: {
        total: 0, parsed: 0, unparse: 0, empty: 0, duplicate: 0,
        exact: 0, ignoreDev: 0, fuzzy: 0, noMatch: 0, letters: []
      },
      data: { rows, headerIdx: -1, descCol: -1, results: [], origWidth: 0, letters: [] }
    };
  }

  const origWidth = Math.max(...rows.map((r) => (r ? r.length : 0)));
  const results = [];
  const letterSet = new Set();
  let nParsed = 0, nExact = 0, nIgnoreDev = 0, nFuzzy = 0, nNoMatch = 0, nUnparse = 0, nEmpty = 0, nDuplicate = 0;
  const descCache = new Map();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const desc = r[descCol];
    let res;

    if (!desc) {
      res = { names: [], status: '空描述', byLetter: new Map(), matchType: 'empty' };
      nEmpty++;
    } else if (descCache.has(desc)) {
      res = descCache.get(desc);
      nDuplicate++;
    } else {
      const spec = parseDesc(desc);
      if (!spec) {
        res = { names: [], status: '未解析', byLetter: new Map(), matchType: 'unparse' };
        nUnparse++;
      } else {
        nParsed++;
        const m = matchSpec(spec, index, { exactFirst, fuzzyTolerance });
        res = { items: m.items || [], names: m.names, status: m.status, byLetter: new Map(), matchType: m.matchType };

        if (m.names.length > 0) {
          if (m.matchType === 'exact') nExact++;
          else if (m.matchType === 'ignore_dev') nIgnoreDev++;
          else if (m.matchType === 'fuzzy') nFuzzy++;

          for (const item of m.items) {
            const L = (item.name[0] || '?').toUpperCase();
            if (!res.byLetter.has(L)) res.byLetter.set(L, []);
            res.byLetter.get(L).push(item);
            letterSet.add(L);
          }
        } else {
          nNoMatch++;
        }
      }
      descCache.set(desc, res);
    }
    results.push(res);
  }

  const letters = [...letterSet].sort();

  return {
    sheetName,
    skipped: false,
    stats: {
      total: results.length,
      parsed: nParsed,
      unparse: nUnparse,
      empty: nEmpty,
      duplicate: nDuplicate,
      exact: nExact,
      ignoreDev: nIgnoreDev,
      fuzzy: nFuzzy,
      noMatch: nNoMatch,
      letters: letters
    },
    data: {
      rows,
      headerIdx,
      descCol,
      results,
      origWidth,
      letters
    }
  };
}

// ---------- 主流程（支持多 sheet） ----------
function runMatch(bomPath, products, options = {}) {
  const XLSX = require('xlsx');
  const { selectedSeries = [], exactFirst = true, fuzzyTolerance = 0.05, descColumnName = '物料描述' } = options;

  console.log('构建产品索引...');
  const { index, total } = buildIndex(products, selectedSeries);
  console.log(`产品总数 ${total}, 索引键数 ${index.size}`);

  console.log('读取 BOM 表...');
  const wb = XLSX.readFile(bomPath);
  const sheetNames = wb.SheetNames;
  console.log(`Excel 共 ${sheetNames.length} 个 sheet: ${sheetNames.join(', ')}`);

  const sheets = [];
  const aggregateLetterSet = new Set();
  let aggregateStats = {
    total: 0, parsed: 0, unparse: 0, empty: 0, duplicate: 0,
    exact: 0, ignoreDev: 0, fuzzy: 0, noMatch: 0
  };

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    console.log(`处理 sheet: ${sheetName}`);
    const sheetResult = matchSingleSheet(ws, sheetName, index, {
      exactFirst, fuzzyTolerance, descColumnName
    });

    sheets.push(sheetResult);

    // 聚合统计
    if (!sheetResult.skipped) {
      const s = sheetResult.stats;
      for (const k of Object.keys(aggregateStats)) {
        aggregateStats[k] += s[k] || 0;
      }
      for (const L of s.letters) aggregateLetterSet.add(L);
    }
  }

  // 没有任何 sheet 成功
  const validSheets = sheets.filter((s) => !s.skipped);
  if (validSheets.length === 0) {
    return { error: `所有 sheet 均未找到"${descColumnName}"列` };
  }

  const letters = [...aggregateLetterSet].sort();

  return {
    success: true,
    totalSheets: sheets.length,
    validSheets: validSheets.length,
    sheets,
    stats: {
      ...aggregateStats,
      letters
    }
  };
}

module.exports = { runMatch, parseDesc, parseDescLoose, buildIndex, matchSpec, getSeries, parseProductName, parseOtherBrandMlcc };