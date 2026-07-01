const https = require('https');

// 云函数 URL（腾讯云 SCF 函数 URL）
const LICENSE_URL = 'https://1449115859-lvc153q7j1.ap-guangzhou.tencentscf.com';

// 默认使用时长（秒），云函数未返回时使用：8小时
const DEFAULT_DURATION = 8 * 60 * 60;

let startTime = null;
let checkTimer = null;
let onExpiredCallback = null;
let currentDuration = DEFAULT_DURATION; // 当前使用时长限制（秒）

/**
 * 检查授权状态（联网请求云函数）
 * @returns {Promise<{enabled: boolean, message: string, duration: number}>}
 */
function checkLicense() {
  return new Promise((resolve) => {
    const req = https.get(LICENSE_URL, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const duration = (typeof json.duration === 'number' && json.duration > 0)
            ? json.duration
            : DEFAULT_DURATION;
          resolve({
            enabled: json.enabled === true || json.enabled === 'true',
            message: json.message || '',
            duration: duration
          });
        } catch (e) {
          resolve({ enabled: false, message: '授权信息解析失败', duration: DEFAULT_DURATION });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ enabled: false, message: '网络连接失败，请检查网络后重试', duration: DEFAULT_DURATION });
    });

    // 10秒超时
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ enabled: false, message: '网络连接超时，请检查网络后重试', duration: DEFAULT_DURATION });
    });
  });
}

/**
 * 开始使用时长计时
 * @param {number} duration - 使用时长限制（秒）
 * @param {Function} onExpired - 过期回调
 */
function startUsageTimer(duration, onExpired) {
  startTime = Date.now();
  onExpiredCallback = onExpired;
  currentDuration = (typeof duration === 'number' && duration > 0) ? duration : DEFAULT_DURATION;

  // 计算检查间隔：时长较短时缩短检查周期（最少5秒，最多60秒）
  const interval = Math.min(60000, Math.max(5000, currentDuration * 1000 / 60));

  checkTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= currentDuration * 1000) {
      stopUsageTimer();
      if (onExpiredCallback) onExpiredCallback();
    }
  }, interval);
}

/**
 * 停止计时
 */
function stopUsageTimer() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/**
 * 获取剩余使用时间（格式化为 时:分:秒）
 */
function getRemainingTimeFormatted() {
  if (!startTime) return '00:00:00';
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, currentDuration * 1000 - elapsed);
  const totalSec = Math.floor(remaining / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

module.exports = {
  checkLicense,
  startUsageTimer,
  stopUsageTimer,
  getRemainingTimeFormatted,
  DEFAULT_DURATION
};
