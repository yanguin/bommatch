// 独立交叉验证：产品档位基准表（手工换算，硬编码，不复用 main.js 代码）
// 容量统一 pF，电压统一 V；P007 容量/电压均不可解析
const BASE = [
  { name: 'P001', pf: 1e6,    v: 25  },  // 1uF
  { name: 'P002', pf: 4.7e6,  v: 16  },  // 4.7uF
  { name: 'P003', pf: 1e7,    v: 6.3 },  // 10uF
  { name: 'P004', pf: 1e5,    v: 50  },  // 100nF
  { name: 'P005', pf: 2.2e7,  v: 100 },  // 22uF
  { name: 'P006', pf: 4.7e4,  v: 25  },  // 47nF
  { name: 'P007', pf: null,   v: null }  // N/A
];
const toPf = (val, u) => val * (u === 'uF' ? 1e6 : u === 'nF' ? 1e3 : 1);
const EPS = 0.001;
function expectCap(f) {
  // 独立判定：exact 精确 / range 闭区间（from、to 可各自带单位）
  let lo = null, hi = null, exact = null;
  if (f.capacityMode === 'range') {
    if (f.capacityFrom !== '' && f.capacityFrom != null && !isNaN(parseFloat(f.capacityFrom)))
      lo = toPf(parseFloat(f.capacityFrom), f.capacityUnit);
    if (f.capacityTo !== '' && f.capacityTo != null && !isNaN(parseFloat(f.capacityTo)))
      hi = toPf(parseFloat(f.capacityTo), f.capacityToUnit || f.capacityUnit);
  } else if (f.capacityValue) {
    exact = toPf(parseFloat(f.capacityValue), f.capacityUnit);
  }
  return BASE.filter(p => {
    if (p.pf === null) return false;
    if (exact !== null) return Math.abs(p.pf - exact) <= EPS;
    if (lo !== null && p.pf < lo - EPS) return false;
    if (hi !== null && p.pf > hi + EPS) return false;
    return (exact !== null) || (lo !== null || hi !== null);
  }).map(p => p.name).join(',');
}
function expectVolt(f) {
  let lo = null, hi = null, exact = null;
  if (f.voltageMode === 'range') {
    if (f.voltageFrom !== '' && f.voltageFrom != null && !isNaN(parseFloat(f.voltageFrom))) lo = parseFloat(f.voltageFrom);
    if (f.voltageTo !== '' && f.voltageTo != null && !isNaN(parseFloat(f.voltageTo))) hi = parseFloat(f.voltageTo);
  } else if (f.voltageValue) {
    exact = parseFloat(f.voltageValue);
  }
  return BASE.filter(p => {
    if (p.v === null) return false;
    if (exact !== null) return Math.abs(p.v - exact) <= EPS;
    if (lo !== null && p.v < lo - EPS) return false;
    if (hi !== null && p.v > hi + EPS) return false;
    return (exact !== null) || (lo !== null || hi !== null);
  }).map(p => p.name).join(',');
}
// 逐用例：独立基准期望 vs 测试文件里的手写期望
const cases = [
  ['1  精确0.1uF',        { capacityMode:'exact', capacityValue:'0.1', capacityUnit:'uF' }, 'cap', 'P004'],
  ['3  闭区间1~10uF',     { capacityMode:'range', capacityFrom:'1', capacityTo:'10', capacityUnit:'uF' }, 'cap', 'P001,P002,P003'],
  ['3  nF范围100~1000',   { capacityMode:'range', capacityFrom:'100', capacityTo:'1000', capacityUnit:'nF' }, 'cap', 'P001,P004'],
  ['3b 跨单位1000pF~1uF', { capacityMode:'range', capacityFrom:'1000', capacityUnit:'pF', capacityTo:'1', capacityToUnit:'uF' }, 'cap', 'P001,P004,P006'],
  ['3c 无toUnit回退',     { capacityMode:'range', capacityFrom:'100', capacityTo:'1000', capacityUnit:'nF', capacityToUnit:undefined }, 'cap', 'P001,P004'],
  ['4  只填from=10uF',    { capacityMode:'range', capacityFrom:'10', capacityUnit:'uF' }, 'cap', 'P003,P005'],
  ['5  只填to=0.1uF',     { capacityMode:'range', capacityTo:'0.1', capacityUnit:'uF' }, 'cap', 'P004,P006'],
  ['8  电压16~50V',       { voltageMode:'range', voltageFrom:'16', voltageTo:'50' }, 'volt', 'P001,P002,P004,P006'],
  ['9  电压只填from=25',  { voltageMode:'range', voltageFrom:'25' }, 'volt', 'P001,P004,P005,P006'],
  ['10 电压只填to=16',    { voltageMode:'range', voltageTo:'16' }, 'volt', 'P002,P003'],
  ['12 电压精确6.3V',     { voltageValue:'6.3' }, 'volt', 'P003'],
  ['13 容量[1e6,1e7]∩电压[16,25]', { capacityMode:'range', capacityFrom:'1', capacityTo:'10', capacityUnit:'uF', voltageMode:'range', voltageFrom:'16', voltageTo:'25' }, 'both', 'P001,P002'],
];
let bad = 0;
for (const [tag, f, kind, written] of cases) {
  let derived;
  if (kind === 'cap') derived = expectCap(f);
  else if (kind === 'volt') derived = expectVolt(f);
  else derived = BASE.filter(p => {
    if (p.pf === null || p.v === null) return false;
    const inCap = p.pf >= 1e6 - EPS && p.pf <= 1e7 + EPS;
    const inV = p.v >= 16 - EPS && p.v <= 25 + EPS;
    return inCap && inV;
  }).map(p => p.name).join(',');
  const ok = derived === written;
  if (!ok) bad++;
  console.log(`${ok ? '一致' : '不一致'} ${tag}  基准=${derived}  测试内期望=${written}`);
}
console.log(bad === 0 ? '\n全部一致：20 条测试期望值无算漏' : `\n发现 ${bad} 处不一致`);
process.exit(bad > 0 ? 1 : 0);
