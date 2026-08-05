const https = require('https');
const fs = require('fs');
const path = require('path');

// Gitee 仓库 version.txt 的 raw 地址（master 分支）
const REMOTE_VERSION_URL = 'https://gitee.com/yanguin/bommatch/raw/master/version.txt';

// 云函数 URL（腾讯云 SCF 函数 URL）
// const LICENSE_URL = 'https://1449115859-lvc153q7j1.ap-guangzhou.tencentscf.com';
// 本地 version.txt 路径
const LOCAL_VERSION_PATH = path.join(__dirname, 'version.txt');

// 默认使用时长（秒），远程未返回时使用：8小时
const DEFAULT_DURATION = 8 * 60 * 60;

let startTime = null;
let checkTimer = null;
let onExpiredCallback = null;
let currentDuration = DEFAULT_DURATION; // 当前使用时长限制（秒）

/**
 * 解析 version.txt 内容（支持 JSON 和纯文本格式）
 * JSON 格式：{"version": "1.2.0", "duration": 16200, "enabled": true}
 * 纯文本格式：整行作为版本号
 * @param {string} content - 文件内容
 * @returns {{version: string, duration: number, enabled: boolean, message: string}}
 */
function parseVersionFile(content) {
  const text = (content || '').trim();

  // 尝试 JSON 解析
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      return {
        version: json.version || '',
        duration: (typeof json.duration === 'number' && json.duration > 0)
          ? json.duration
          : DEFAULT_DURATION,
        enabled: json.enabled !== false, // 默认 true
        message: json.message || ''
      };
    } catch (e) {
      // JSON 解析失败，降级为纯文本
    }
  }

  // 纯文本格式：整行作为版本号
  return {
    version: text,
    duration: DEFAULT_DURATION,
    enabled: true,
    message: ''
  };
}

/**
 * 读取本地 version.txt
 * @returns {{version: string, duration: number, enabled: boolean, message: string}}
 */
function readLocalVersion() {
  try {
    const content = fs.readFileSync(LOCAL_VERSION_PATH, 'utf8');
    return parseVersionFile(content);
  } catch (e) {
    return { version: '', duration: DEFAULT_DURATION, enabled: true, message: '' };
  }
}

/**
 * 比较两个语义化版本号（如 1.2.0）
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = (v1 || '').split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = (v2 || '').split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * HTTP GET 请求（支持重定向）
 * @param {string} url - 请求地址
 * @param {Function} callback - 回调 (err, data, statusCode)
 */
function httpGet(url, callback) {
  const req = https.get(url, (res) => {
    // 处理 3xx 重定向
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      httpGet(res.headers.location, callback);
      return;
    }
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      callback(null, data, res.statusCode);
    });
  });

  req.on('error', (err) => {
    callback(err, null, null);
  });

  // 10秒超时
  req.setTimeout(10000, () => {
    req.destroy();
    callback(new Error('timeout'), null, null);
  });
}

/**
 * 检查版本与授权状态（联网请求 gitee version.txt，与本地比对）
 * @returns {Promise<{enabled: boolean, needsUpdate: boolean, message: string, duration: number, localVersion: string, remoteVersion: string}>}
 */
function checkLicense() {
  return new Promise((resolve) => {
    const local = readLocalVersion();

    httpGet(REMOTE_VERSION_URL, (err, data, statusCode) => {
      // 网络错误或请求失败
      if (err || statusCode !== 200) {
        resolve({
          enabled: false,
          needsUpdate: false,
          message: '无法连接到服务器验证版本，请检查网络后重试',
          duration: DEFAULT_DURATION,
          localVersion: local.version,
          remoteVersion: ''
        });
        return;
      }

      const remote = parseVersionFile(data);

      // 检查总开关：enabled 为 false 时，所有版本均不可用
      if (!remote.enabled) {
        resolve({
          enabled: false,
          needsUpdate: false,
          message: remote.message || '该软件暂不可使用',
          duration: DEFAULT_DURATION,
          localVersion: local.version,
          remoteVersion: remote.version
        });
        return;
      }

      // 比较版本号：本地版本 < 远程版本 → 需要更新
      if (compareVersions(local.version, remote.version) < 0) {
        resolve({
          enabled: false,
          needsUpdate: true,
          message: `当前版本不是最新的，请更新到最新版本后再使用。\n当前版本：${local.version}\n最新版本：${remote.version}\n\n下载地址：https://gitee.com/yanguin/bommatch`,
          duration: DEFAULT_DURATION,
          localVersion: local.version,
          remoteVersion: remote.version
        });
        return;
      }

      // 版本通过，正常启动（使用远程返回的使用时长）
      resolve({
        enabled: true,
        needsUpdate: false,
        message: '软件可用',
        duration: remote.duration,
        localVersion: local.version,
        remoteVersion: remote.version
      });
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
