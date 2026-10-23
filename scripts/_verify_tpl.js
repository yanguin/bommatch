// 临时验证：index.html 的 Vue 模板能否编译通过（stub document，与既往方法一致）
const fs = require('fs');

// stub document，避免 Vue.compile 崩溃
const noop = () => {};
global.document = {
  createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop }),
  createElementNS: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
  createTextNode: () => ({}),
  createEvent: () => ({ initEvent: noop, timeStamp: 0 }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  body: { appendChild: noop, removeChild: noop },
  documentElement: { style: {} }
};
global.window = global;
global.navigator = { userAgent: 'node' };

const Vue = require('vue/dist/vue.common.js');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
// 提取 <body> 内 #app 容器内容（整个 body 即 Vue 模板挂载区）
const m = html.match(/<body>([\s\S]*)<\/body>/);
if (!m) { console.error('未找到 body'); process.exit(1); }
// 去掉 <script> 标签（模板里不应有）
const tpl = m[1].replace(/<script[\s\S]*?<\/script>/g, '');
try {
  Vue.compile(tpl);
  console.log('模板编译 OK');
} catch (e) {
  console.error('模板编译失败:', e.message);
  process.exit(1);
}
