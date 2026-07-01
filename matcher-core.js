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
  return String(s).replace(/\+\/-/g, '±').replace(/\s+/g, '');
}

// 字段模式识别
const RE_CAP = /^[0-9.]+\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i;
const RE_DEV = /^(±|\+\/-)\s*\d+(?:\.\d+)?(?:%|pF)$/i;
const RE_VOLT = /^\d+(?:\.\d+)?\s*[kK]?[vV]$/;
const RE_TEMP = /^(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])\b/i;
const RE_SIZE = /^(SMD|SM)?\s*\d{4,6}(?![0-9])/i;

// ---------- 解析 BOM 物料描述 ----------
function parseDesc(desc) {
  if (!desc) return null;
  let text = String(desc).replace(/，/g, ',').replace(/μ/g, 'µ');
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
  const cands = index.get(key);

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

    // 检查电压、温度、尺寸是否完全匹配
    if (volt !== spec.volt || tempStr !== spec.temp || sizeStr !== spec.size) continue;

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

// ---------- 主流程 ----------
function runMatch(bomPath, products, options = {}) {
  const XLSX = require('xlsx');
  const { selectedSeries = [], exactFirst = true, fuzzyTolerance = 0.05, descColumnName = '物料描述' } = options;

  console.log('构建产品索引...');
  const { index, total } = buildIndex(products, selectedSeries);
  console.log(`产品总数 ${total}, 索引键数 ${index.size}`);

  console.log('读取 BOM 表...');
  const wb = XLSX.readFile(bomPath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
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
    return { error: `未找到"${descColumnName}"列` };
  }

  console.log(`表头行=${headerIdx}, ${descColumnName}列=${descCol}`);

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
      nEmpty++; // 统计空描述
    } else if (descCache.has(desc)) {
      res = descCache.get(desc);
      nDuplicate++; // 统计重复物料
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
    success: true,
    stats: {
      total: results.length,
      parsed: nParsed,
      unparse: nUnparse,
      empty: nEmpty, // 新增：空描述统计
      duplicate: nDuplicate, // 新增：重复物料统计
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

module.exports = { runMatch, parseDesc, buildIndex, matchSpec, getSeries };