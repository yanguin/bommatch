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

// ---------- 解析 BOM 物料描述 ----------
function parseDesc(desc) {
  if (!desc) return null;
  let text = String(desc).replace(/，/g, ',').replace(/μ/g, 'µ').trim();

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
      series: series
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
        names: exact.map((c) => c.name),
        status: '精确匹配',
        matchType: 'exact'
      };
    }
    // 忽略偏差匹配
    return {
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
      names: fuzzyResults.map((c) => c.name),
      status: '容差匹配',
      matchType: 'fuzzy'
    };
  }

  return { names: [], status: '未匹配', matchType: 'none' };
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
        res = { names: m.names, status: m.status, byLetter: new Map(), matchType: m.matchType };

        if (m.names.length > 0) {
          if (m.matchType === 'exact') nExact++;
          else if (m.matchType === 'ignore_dev') nIgnoreDev++;
          else if (m.matchType === 'fuzzy') nFuzzy++;

          for (const nm of m.names) {
            const L = (nm[0] || '?').toUpperCase();
            if (!res.byLetter.has(L)) res.byLetter.set(L, []);
            res.byLetter.get(L).push(nm);
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

module.exports = { runMatch, parseDesc, buildIndex, matchSpec, getSeries };