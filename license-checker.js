const https = require('https');
const fs = require('fs');
const path = require('path');

// Gitee 仓库 version.txt 的 raw 地址（master 分支）
const REMOTE_RAW_URL = 'https://gitee.com/yanguin/bommatch/raw/master/version.txt';
// Gitee API 地址（raw 链接被拦截时的备用方案）
const REMOTE_API_URL = 'https://gitee.com/api/v5/repos/yanguin/bommatch/contents/version.txt?ref=master';

// 本地 version.txt 路径
const LOCAL_VERSION_PATH = path.join(__dirname, 'version.txt');

// 默认使用时长（秒），远程未返回时使用：8小时
const DEFAULT_DURATION = 8 * 60 * 60;

let startTime = null;
let checkTimer = null;
let onExpiredCallback = null;
let currentDuration = DEFAULT_DURATION; // 当前使用时长限制（秒）

/**
 * 校验版本号格式（至少匹配 x.y 或 x.y.z）
 * @param {string} version - 版本号字符串
 * @returns {boolean}
 */
function isValidVersion(version) {
  return /^\d+\.\d+(\.\d+)?/.test((version || '').trim());
}

/**
 * 解析 version.txt 内容（支持 JSON 和纯文本格式）
 * JSON 格式：{"version": "1.2.1", "duration": 16200, "enabled": true}
 * 纯文本格式：整行作为版本号
 * @param {string} content - 文件内容
 * @returns {{version: string, duration: number, enabled: boolean, message: string}|null} 解析失败返回 null
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
  // 如果内容包含 HTML 标签或多行，说明不是有效的版本文件
  if (text.includes('<') || text.includes('\n')) {
    return null;
  }

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
    const parsed = parseVersionFile(content);
    return parsed || { version: '', duration: DEFAULT_DURATION, enabled: true, message: '' };
  } catch (e) {
    return { version: '', duration: DEFAULT_DURATION, enabled: true, message: '' };
  }
}

/**
 * 比较两个语义化版本号（如 1.2.1）
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
 * HTTP GET 请求（支持重定向，带 User-Agent）
 * @param {string} url - 请求地址
 * @param {Function} callback - 回调 (err, data, statusCode)
 */
function httpGet(url, callback) {
  const options = {
    headers: {
      'User-Agent': 'BOMMatch/1.0 (Electron Desktop App)'
    }
  };

  const req = https.get(url, options, (res) => {
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
 * 从 Gitee API 获取 version.txt 内容（备用方案）
 * API 返回 JSON，content 字段为 base64 编码
 * @param {Function} callback - 回调 (err, content)
 */
function fetchViaApi(callback) {
  httpGet(REMOTE_API_URL, (err, data, statusCode) => {
    if (err || statusCode !== 200) {
      callback(new Error('api failed'), null);
      return;
    }
    try {
      const json = JSON.parse(data);
      if (json.content && json.encoding === 'base64') {
        const content = Buffer.from(json.content, 'base64').toString('utf8');
        callback(null, content);
      } else {
        callback(new Error('invalid api response'), null);
      }
    } catch (e) {
      callback(e, null);
    }
  });
}

/**
 * 检查版本与授权状态（联网请求 gitee version.txt，与本地比对）
 * @returns {Promise<{enabled: boolean, needsUpdate: boolean, message: string, duration: number, localVersion: string, remoteVersion: string}>}
 */
function checkLicense() {
  return new Promise((resolve) => {
    const local = readLocalVersion();

    // 第一步：尝试 raw 链接
    httpGet(REMOTE_RAW_URL, (err, data, statusCode) => {
      const tryParseRemote = (content) => {
        const remote = parseVersionFile(content);

        // 解析失败或版本号无效（可能是 HTML 验证页面）
        if (!remote || !isValidVersion(remote.version)) {
          return null;
        }
        return remote;
      };

      // raw 链接成功且内容有效
      if (!err && statusCode === 200) {
        const remote = tryParseRemote(data);
        if (remote) {
          resolveResult(remote);
          return;
        }
      }

      // 第二步：raw 失败或内容无效，尝试 Gitee API
      fetchViaApi((apiErr, apiContent) => {
        if (!apiErr && apiContent) {
          const remote = tryParseRemote(apiContent);
          if (remote) {
            resolveResult(remote);
            return;
          }
        }

        // 两种方式都失败
        resolve({
          enabled: false,
          needsUpdate: false,
          message: '无法连接到服务器验证版本，请检查网络后重试',
          duration: DEFAULT_DURATION,
          localVersion: local.version,
          remoteVersion: ''
        });
      });
    });

    /**
     * 根据远程版本信息返回结果
     * @param {{version: string, duration: number, enabled: boolean, message: string}} remote
     */
    function resolveResult(remote) {
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
          message: `当前版本不是最新的，请更新到最新版本后再使用。\n当前版本：${local.version}\n最新版本：${remote.version}`,
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
    }
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
