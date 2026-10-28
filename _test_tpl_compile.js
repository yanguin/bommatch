// index.html Vue 模板编译验证（不启动 Electron）
// 取 #app 内 HTML，stub document 后用 Vue 2.7 完整版编译，模板语法错误会在此暴露
const fs = require('fs');
const vm = require('vm');
const https = require('https');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('<div id="app">');
const end = html.indexOf('<script src=');
if (start < 0 || end < 0) { console.error('FAIL: 未定位到 #app'); process.exit(1); }
const tpl = html.slice(start, end);

function fetch(url) {
  return new Promise((resolve, reject) => {
    const go = (n) => https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', e => { if (n < 3) setTimeout(() => go(n + 1), 1500); else reject(e); });
    go(0);
  });
}

(async () => {
  // 代理环境：优先走环境变量代理（本机 node fetch 直连不稳，https 模块走 env 代理不可用 → 先试直连，失败提示）
  let vueSrc;
  try { vueSrc = fs.readFileSync('_vue_2.7.14.min.js', 'utf8'); }
  catch (e) { vueSrc = await fetch('https://unpkg.com/vue@2.7.14/dist/vue.min.js'); fs.writeFileSync('_vue_2.7.14.min.js', vueSrc); }

  const sandbox = {
    console,
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      createTextNode: () => ({}),
      createComment: () => ({}),
      querySelector: () => null,
      addEventListener() {}, removeEventListener() {}
    },
    navigator: { userAgent: 'node' },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  vm.createContext(sandbox);
  vm.runInContext(vueSrc, sandbox);
  const Vue = sandbox.Vue;
  if (!Vue || !Vue.compile) { console.error('FAIL: Vue 未加载'); process.exit(1); }
  try {
    Vue.compile(tpl);
    console.log('PASS  index.html #app 模板编译通过');
  } catch (err) {
    console.error('FAIL  模板编译错误: ' + err.message);
    process.exit(1);
  }

  // 另编译 renderer.js 里的 col-filter-head 组件模板（自定义表头列筛选面板）
  const rjs = fs.readFileSync('renderer.js', 'utf8');
  const cm = rjs.match(/Vue\.component\('col-filter-head',\s*\{[\s\S]*?template:\s*`([\s\S]*?)`\s*\}\);/);
  if (!cm) { console.error('FAIL  未找到 col-filter-head 组件模板'); process.exit(1); }
  try {
    Vue.compile(cm[1]);
    console.log('PASS  renderer.js col-filter-head 组件模板编译通过');
    process.exit(0);
  } catch (err) {
    console.error('FAIL  组件模板编译错误: ' + err.message);
    process.exit(1);
  }
})().catch(e => { console.error('FAIL  ' + e.message); process.exit(1); });
