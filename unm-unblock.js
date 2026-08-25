// ====================================================================
//  UnblockNeteaseMusic (UNM) 音源解锁模块
//  - 基于 @unblockneteasemusic/server 的 match 核心
//  - 提供配置持久化（音源顺序、cookie、joox/migu 凭据等）
//  - 提供 unblockMatch(id, meta): 给定网易云歌曲 id 与可选元数据，
//    按配置的音源顺序尝试从其它公开音源获取可播放地址
// ====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function unmPromiseWithTimeout(promise, timeoutMs, code) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(code || 'UNM_MATCH_TIMEOUT');
        err.code = code || 'UNM_MATCH_TIMEOUT';
        reject(err);
      }, Math.max(500, Number(timeoutMs) || 8000));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let matchFn = null;
try {
  matchFn = require('@unblockneteasemusic/server/src/provider/match');
} catch (err) {
  console.warn('[UNM] match module unavailable:', err.message);
}

const UNM_CONFIG_FILE = path.join(__dirname, 'data', 'unm-config.json');

const UNM_KNOWN_SOURCES = [
  'kugou', 'kuwo', 'migu', 'qq', 'bodian', 'bilibili', 'pyncmd', 'joox',
];
const UNM_DEFAULT_SOURCE_ORDER = ['kugou', 'bodian', 'migu', 'kuwo'];

const unmConfigDefaults = () => ({
  version: 1,
  enabled: true,
  sourceOrder: UNM_DEFAULT_SOURCE_ORDER.slice(),
  jooxCookie: '',
  miguCookie: '',
  qqCookie: '',
  strictSourceOrder: false,
  enableFlac: true,
  searchAlbum: false,
  updatedAt: 0,
});

let unmConfig = loadUnmConfigFromDisk();

function sanitizeUnmSourceOrder(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach(item => {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key) || UNM_KNOWN_SOURCES.indexOf(key) < 0) return;
    seen.add(key);
    out.push(key);
  });
  UNM_DEFAULT_SOURCE_ORDER.forEach(key => {
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  });
  return out.slice(0, 8);
}

function normalizeUnmConfig(raw) {
  const base = unmConfigDefaults();
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    ...base,
    ...input,
    enabled: !!input.enabled,
    sourceOrder: sanitizeUnmSourceOrder(input.sourceOrder),
    jooxCookie: String(input.jooxCookie || '').trim().slice(0, 4096),
    miguCookie: String(input.miguCookie || '').trim().slice(0, 4096),
    qqCookie: String(input.qqCookie || '').trim().slice(0, 8192),
    strictSourceOrder: !!input.strictSourceOrder,
    enableFlac: input.enableFlac !== false,
    searchAlbum: !!input.searchAlbum,
    version: 1,
  };
}

function loadUnmConfigFromDisk() {
  try {
    if (fs.existsSync(UNM_CONFIG_FILE)) {
      return normalizeUnmConfig(JSON.parse(fs.readFileSync(UNM_CONFIG_FILE, 'utf8')));
    }
  } catch (err) {
    console.warn('[UNM] config load failed:', err.message);
  }
  return unmConfigDefaults();
}

function persistUnmConfig() {
  try {
    const dir = path.dirname(UNM_CONFIG_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const temp = UNM_CONFIG_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(temp, JSON.stringify(unmConfig, null, 2), 'utf8');
    fs.renameSync(temp, UNM_CONFIG_FILE);
    return true;
  } catch (err) {
    console.warn('[UNM] config save failed:', err.message);
    return false;
  }
}

function getUnmConfigForClient() {
  return {
    ok: true,
    enabled: unmConfig.enabled,
    sourceOrder: unmConfig.sourceOrder.slice(),
    knownSources: UNM_KNOWN_SOURCES.slice(),
    jooxCookieSet: !!unmConfig.jooxCookie,
    miguCookieSet: !!unmConfig.miguCookie,
    qqCookieSet: !!unmConfig.qqCookie,
    strictSourceOrder: unmConfig.strictSourceOrder,
    enableFlac: unmConfig.enableFlac,
    searchAlbum: unmConfig.searchAlbum,
    updatedAt: unmConfig.updatedAt || 0,
  };
}

function updateUnmConfig(patch) {
  const next = normalizeUnmConfig({ ...unmConfig, ...(patch && typeof patch === 'object' ? patch : {}) });
  next.updatedAt = Date.now();
  unmConfig = next;
  persistUnmConfig();
  applyUnmRuntimeEnvironment();
  return getUnmConfigForClient();
}

function applyUnmRuntimeEnvironment() {
  // UNM 的 provider 通过环境变量读取凭据，require 时已固化部分值，
  // 因此这里直接改写对应模块的运行时状态。
  try {
    process.env.FOLLOW_SOURCE_ORDER = unmConfig.strictSourceOrder ? 'true' : '';
    process.env.SELECT_MAX_BR = unmConfig.strictSourceOrder ? '' : 'true';
    process.env.ENABLE_FLAC = unmConfig.enableFlac ? 'true' : '';
    process.env.SEARCH_ALBUM = unmConfig.searchAlbum ? 'true' : '';
  } catch (_) {}

  try {
    const select = require('@unblockneteasemusic/server/src/provider/select');
    select.ENABLE_FLAC = !!unmConfig.enableFlac;
  } catch (_) {}

  try {
    const joox = require('@unblockneteasemusic/server/src/provider/joox');
    joox.headers.cookie = unmConfig.jooxCookie || null;
  } catch (_) {}

  try {
    const migu = require('@unblockneteasemusic/server/src/provider/migu');
    migu.headers.aversionid = unmConfig.miguCookie || null;
    migu.headers.cookie = unmConfig.miguCookie ? ('migu_music_sid=' + unmConfig.miguCookie) : undefined;
  } catch (_) {}

  try {
    const qq = require('@unblockneteasemusic/server/src/provider/qq');
    if (typeof qq.setCookie === 'function') qq.setCookie(unmConfig.qqCookie || '');
    else if (qq.headers) qq.headers.cookie = unmConfig.qqCookie || null;
  } catch (_) {}
}
applyUnmRuntimeEnvironment();

// ---------- 匹配结果缓存 ----------
const unmMatchCache = new Map();
const UNM_MATCH_CACHE_LIMIT = 240;
const UNM_MATCH_CACHE_TTL_MS = 30 * 60 * 1000;

function unmCacheKey(id, meta) {
  const fingerprint = [meta && meta.name, meta && meta.artists, meta && meta.album, meta && meta.duration]
    .map(value => String(value || '')).join('|');
  return crypto.createHash('sha1').update(String(id || '') + '::' + fingerprint).digest('hex').slice(0, 24);
}

function rememberUnmMatch(key, value) {
  if (unmMatchCache.size >= UNM_MATCH_CACHE_LIMIT) {
    const oldest = unmMatchCache.keys().next().value;
    if (oldest) unmMatchCache.delete(oldest);
  }
  unmMatchCache.set(key, { at: Date.now(), value });
}

async function unblockMatch(id, meta, timeoutMs) {
  if (!matchFn) return { ok: false, error: 'UNM_MATCH_MODULE_UNAVAILABLE', message: 'UNM 匹配核心不可用' };
  const songId = String(id || '').trim();
  if (!songId) return { ok: false, error: 'MISSING_SONG_ID', message: '缺少歌曲 id' };

  const key = unmCacheKey(songId, meta);
  const cached = unmMatchCache.get(key);
  if (cached && Date.now() - cached.at < UNM_MATCH_CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }
  if (cached) unmMatchCache.delete(key);

  const info = {};
  if (meta && (meta.name || meta.title)) {
    // UNM find() 期望与网易云 song/detail 一致的结构：
    // artists 为数组（含 name）、album 为对象、duration 为毫秒。
    info.id = songId;
    info.name = String(meta.name || meta.title || '');
    info.alias = [];
    info.duration = Number(meta.duration) || 0;
    info.album = { id: '', name: String(meta.album || '') };
    const artistNames = String(meta.artist || meta.artists || '')
      .split(/[,，、\/]/).map(name => ({ id: '', name: name.trim() })).filter(artist => artist.name);
    if (!artistNames.length) artistNames.push({ id: '', name: '' });
    info.artists = artistNames;
  }

  const budgetMs = Math.max(2500, Math.min(12000, Number(timeoutMs) || 8000));
  try {
    const audioData = await unmPromiseWithTimeout(
      matchFn(songId, unmConfig.sourceOrder.slice(), Object.keys(info).length ? info : null),
      budgetMs,
      'UNM_MATCH_TIMEOUT'
    );
    if (!audioData || !audioData.url) throw new Error('UNM_EMPTY_RESULT');
    const result = {
      ok: true,
      url: audioData.url,
      source: audioData.source || '',
      br: Number(audioData.br) || 0,
      size: Number(audioData.size) || 0,
      md5: audioData.md5 || '',
    };
    rememberUnmMatch(key, result);
    return result;
  } catch (err) {
    const code = err && err.code === 'UNM_MATCH_TIMEOUT' ? 'UNM_MATCH_TIMEOUT' : 'UNM_MATCH_FAILED';
    if (code !== 'UNM_MATCH_TIMEOUT') {
      // 失败结果短缓存，避免同一首歌反复触发全量源探测拖慢切歌。
      rememberUnmMatch(key, { ok: false, error: code });
    }
    return { ok: false, error: code, message: err && err.message || 'UNM 未能在任何配置音源找到可播放版本' };
  }
}

module.exports = {
  getUnmConfigForClient,
  updateUnmConfig,
  unblockMatch,
};
