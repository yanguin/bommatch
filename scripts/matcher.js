// BOM 匹配器: 读取客户 BOM 表的"物料描述"列, 解析规格, 在 viiyong 全量产品中
// 匹配对应品名, 按品名首字母分列写入新 xlsx(保留原表数据+追加匹配列).
//
// 物料描述格式: CCAP,100nF,±10%,50V,X7R,SMD0402
//   -> 类型, 容量, 偏差, 电压, 温度特性, 尺寸(SMD+Inch代码)
const fs = require('fs');
const XLSX = require('xlsx');

const BOM_PATH = 'C:\\Users\\yangu\\Desktop\\viiyong\\viiyong\\HSAE-常用MLCC型号-替代料匹配.xlsx';
const FULL_JSON = 'C:\\Users\\yangu\\Desktop\\viiyong\\viiyong\\viiyong_products_full.json';
const OUT_PATH = 'C:\\Users\\yangu\\Desktop\\viiyong\\viiyong\\HSAE-常用MLCC型号-替代料匹配_viiyong匹配.xlsx';

// ---------- 规格归一化 ----------
// 容量 -> pF 数值; 支持单位 pF/nF/uF/µF/mF 以及简写 p/n/u/µ
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
// 电压 -> 数值; 支持 "50V" "6.3V" "1kV" 以及 viiyong 的裸数字 "250"
function voltToNum(s) {
  if (s === undefined || s === null || s === '') return null;
  const str = String(s).trim();
  let m = str.match(/^(\d+(?:\.\d+)?)\s*([kK])[vV]$/); // kV
  if (m) return Math.round(parseFloat(m[1]) * 1000 * 1000) / 1000;
  m = str.match(/^(\d+(?:\.\d+)?)\s*[vV]$/); // V
  if (m) return Math.round(parseFloat(m[1]) * 1000) / 1000;
  m = str.match(/^(\d+(?:\.\d+)?)$/); // 裸数字 (viiyong)
  if (m) return Math.round(parseFloat(m[1]) * 1000) / 1000;
  return null;
}
// 温度特性 -> 代码; 归一化别名 COG/NPO/NP0 -> C0G (同一介质); 提取前导代码忽略后续温度范围文本
function tempCode(s) {
  if (!s) return null;
  const c = String(s).trim().toUpperCase();
  const m = c.match(/^(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])/);
  if (!m) return null;
  const code = m[1];
  if (code === 'COG' || code === 'NPO' || code === 'NP0') return 'C0G';
  return code;
}
// 尺寸 -> Inch 代码
// BOM: "SMD0402"/"SM0603"/"SMD0603(Soft-T)" -> "0402"/"0603"; viiyong: "0402/1005M" -> "0402"
function sizeInch(s) {
  if (!s) return null;
  let v = String(s).trim().replace(/^(SMD|SM)/i, '').trim();
  const m = v.match(/(\d{4,6})/);
  return m ? m[1] : null;
}
// 偏差归一化: "+/-" -> "±", 去空白
function normDev(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\+\/-/g, '±').replace(/\s+/g, '');
}

// 字段模式识别 (用于按内容识别而非固定位置)
const RE_CAP = /^[0-9.]+\s*(pF|nF|uF|µF|mF|p|n|u|µ)$/i;
const RE_DEV = /^(±|\+\/-)\s*\d+(?:\.\d+)?(?:%|pF)$/i;
const RE_VOLT = /^\d+(?:\.\d+)?\s*[kK]?[vV]$/;
const RE_TEMP = /^(C0G|COG|NPO|NP0|[CXYZ]\d[A-Z])\b/i;
const RE_SIZE = /^(SMD|SM)?\s*\d{4,6}(?![0-9])/i;

// ---------- 解析 BOM 物料描述 (按内容识别字段, 容错各种格式) ----------
// 返回 {cap, dev, volt, temp, size, raw} 或 null
function parseDesc(desc) {
  if (!desc) return null;
  // 归一化: 中文逗号 -> 英文逗号; 希腊 μ -> 微符号 µ
  let text = String(desc).replace(/，/g, ',').replace(/μ/g, 'µ');
  let parts = text.split(',').map((p) => p.trim()).filter((p) => p.length);

  // 拆分合并段: "容量+偏差" (2.2uF±20%) 与 "电压+温度" (6.3VX5R)
  const expanded = [];
  for (const p of parts) {
    // 容量+偏差
    let m = p.match(/^([0-9.]+\s*(?:pF|nF|uF|µF|mF|p|n|u|µ))\s*(±\s*\d+(?:\.\d+)?(?:%|pF)|\+\/-\s*\d+(?:\.\d+)?(?:%|pF))$/i);
    if (m) { expanded.push(m[1].trim()); expanded.push(m[2].trim()); continue; }
    // 电压+温度, 如 "6.3VX5R" "50VX7R" "1kVC0G"
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

// ---------- 加载 viiyong 全量产品, 建索引 ----------
function loadIndex() {
  const data = JSON.parse(fs.readFileSync(FULL_JSON, 'utf8'));
  const list = data.list || [];
  // 核心键: capPf|volt|temp|sizeInch  ->  [{name, dev}]
  const index = new Map();
  for (const it of list) {
    const cap = capToPf(it.capacity);
    const volt = voltToNum(it.voltage);
    const temp = tempCode(it.tempCharacteristics);
    const sz = sizeInch(it.size);
    if (cap === null || volt === null || !temp || !sz) continue;
    const key = `${cap}|${volt}|${temp}|${sz}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ name: it.productName, dev: normDev(it.capacityDeviation) });
  }
  return { index, total: list.length };
}

// 对一条解析后的规格做匹配
function matchSpec(spec, index) {
  const key = `${spec.cap}|${spec.volt}|${spec.temp}|${spec.size}`;
  const cands = index.get(key);
  if (!cands || cands.length === 0) {
    return { names: [], status: '未匹配' };
  }
  // 优先偏差完全一致
  const exact = cands.filter((c) => c.dev === spec.dev);
  if (exact.length > 0) {
    return { names: exact.map((c) => c.name), status: '精确匹配' };
  }
  // 退而求其次: 忽略偏差 (同类规格全部品名)
  return { names: cands.map((c) => c.name), status: '忽略偏差' };
}

// ---------- 主流程 ----------
function main() {
  console.log('加载 viiyong 全量产品...');
  const { index, total } = loadIndex();
  console.log(`产品总数 ${total}, 索引键数 ${index.size}`);

  console.log('读取 BOM 表...');
  const wb = XLSX.readFile(BOM_PATH);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
  console.log(`Sheet: ${sheetName}, 行数: ${rows.length}`);

  // 定位表头行(含"物料描述")与列
  let headerIdx = -1;
  let descCol = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if (typeof rows[i][j] === 'string' && rows[i][j].includes('物料描述')) {
        headerIdx = i;
        descCol = j;
      }
    }
  }
  if (headerIdx < 0) throw new Error('未找到"物料描述"列');
  console.log(`表头行=${headerIdx}, 物料描述列=${descCol}`);

  const origWidth = Math.max(...rows.map((r) => (r ? r.length : 0)));
  // 第一遍: 匹配所有数据行, 收集结果与首字母集合
  const results = []; // 每行: {names, status, byLetter: Map<letter, name[]>}
  const letterSet = new Set();
  let nParsed = 0, nMatched = 0, nExact = 0, nIgnoreDev = 0, nNoMatch = 0, nUnparse = 0;
  const descCache = new Map(); // desc -> result (去重加速)

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const desc = r[descCol];
    let res;
    if (!desc) {
      res = { names: [], status: '空描述', byLetter: new Map() };
    } else if (descCache.has(desc)) {
      res = descCache.get(desc);
    } else {
      const spec = parseDesc(desc);
      if (!spec) {
        res = { names: [], status: '未解析', byLetter: new Map() };
        nUnparse++;
      } else {
        nParsed++;
        const m = matchSpec(spec, index);
        res = { names: m.names, status: m.status, byLetter: new Map() };
        if (m.names.length > 0) {
          nMatched++;
          if (m.status === '精确匹配') nExact++;
          else nIgnoreDev++;
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
  console.log(`\n匹配统计:`);
  console.log(`  数据行: ${results.length}`);
  console.log(`  成功解析: ${nParsed}`);
  console.log(`  未解析: ${nUnparse}`);
  console.log(`  有匹配: ${nMatched} (精确 ${nExact}, 忽略偏差 ${nIgnoreDev})`);
  console.log(`  未匹配: ${nNoMatch}`);
  console.log(`  品名首字母列: [${letters.join(', ')}]`);

  // 诊断样本
  const unparseSamples = [];
  const nomatchSamples = [];
  const descCache2 = new Set();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const desc = r[descCol];
    if (!desc) continue;
    if (descCache2.has(desc)) continue;
    descCache2.add(desc);
    const spec = parseDesc(desc);
    if (!spec) {
      if (unparseSamples.length < 20) unparseSamples.push(desc);
    } else {
      const key = `${spec.cap}|${spec.volt}|${spec.temp}|${spec.size}`;
      if (!index.get(key) && nomatchSamples.length < 20) {
        nomatchSamples.push(`${desc}  ->  ${spec.cap}pF/${spec.volt}V/${spec.temp}/${spec.size} (dev=${spec.dev})`);
      }
    }
  }
  console.log(`\n未解析样本(前20):`);
  unparseSamples.forEach((s) => console.log('  ' + s));
  console.log(`\n未匹配样本(前20, 去重描述):`);
  nomatchSamples.forEach((s) => console.log('  ' + s));

  // 第二遍: 组装输出 AOA (保留原表 + 追加首字母列 + 匹配数量 + 匹配状态)
  const extraHeaders = [...letters, '匹配数量', '匹配状态'];
  const aoa = [];
  // 表头行 (及表头之前的所有行) 原样保留并补齐到 origWidth
  for (let i = 0; i <= headerIdx; i++) {
    const r = (rows[i] || []).slice();
    while (r.length < origWidth) r.push(null);
    if (i === headerIdx) r.push(...extraHeaders);
    aoa.push(r);
  }
  // 数据行
  for (let k = 0; k < results.length; k++) {
    const rowIdx = headerIdx + 1 + k;
    const r = (rows[rowIdx] || []).slice();
    while (r.length < origWidth) r.push(null);
    const res = results[k];
    for (const L of letters) {
      const arr = res.byLetter.get(L);
      r.push(arr && arr.length > 0 ? arr.join('\n') : null);
    }
    r.push(res.names.length);
    r.push(res.status);
    aoa.push(r);
  }

  const outWs = XLSX.utils.aoa_to_sheet(aoa);
  // 列宽: 原列保留默认, 首字母列加宽并自动换行
  outWs['!cols'] = [];
  for (let c = 0; c < origWidth; c++) outWs['!cols'].push({ wch: 14 });
  for (const L of letters) outWs['!cols'].push({ wch: 26 });
  outWs['!cols'].push({ wch: 8 }); // 匹配数量
  outWs['!cols'].push({ wch: 10 }); // 匹配状态

  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outWs, sheetName);
  XLSX.writeFile(outWb, OUT_PATH);
  console.log(`\n完成! 输出: ${OUT_PATH}`);
}

try {
  main();
} catch (e) {
  console.error('失败:', e);
  process.exit(1);
}
