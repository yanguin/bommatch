// ============ 渲染层公共工具函数 ============

/**
 * 多型号输入拆分：按行拆分、去空白、过滤空行，超出上限截断并提示
 * 三品牌（微容/强茂/大毅）多型号输入共用
 * @param {string} text - 多行文本
 * @param {Function} warn - 提示函数（如 Vue 实例的 $message.warning）
 * @param {number} max - 最大行数上限，默认 200
 * @returns {string[]} 型号行数组（空数组表示无有效输入）
 */
function splitInputLines(text, warn, max = 200) {
  const lines = String(text || '')
    .split(/[\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > max) {
    if (warn) warn(`仅取前 ${max} 行`);
    return lines.slice(0, max);
  }
  return lines;
}

module.exports = { splitInputLines };
