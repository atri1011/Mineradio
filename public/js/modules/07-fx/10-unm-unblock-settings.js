// ============================================================
//  UNM 音源解锁设置（视觉控制台 · 系统区）
//  - 读写 /api/unm/config
//  - 渲染音源顺序 chips、凭据输入与开关状态
//  - 提供测试解锁入口
// ============================================================
var UNM_SOURCE_LABELS = {
  kugou: '酷狗',
  kuwo: '酷我',
  migu: '咪咕',
  bodian: '波点',
  qq: 'QQ 音乐',
  bilibili: 'B站',
  pyncmd: 'pyncmd',
  joox: 'JOOX',
};
var unmConfig = null;
var unmConfigLoaded = false;

function unmNode(id) {
  return document.getElementById(id);
}

function normalizeUnmSourceOrderClient(order, knownSources) {
  var seen = {};
  var out = [];
  (Array.isArray(order) ? order : []).forEach(function (key) {
    key = String(key || '').toLowerCase();
    if (!key || seen[key]) return;
    if (knownSources && knownSources.indexOf(key) < 0) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function applyUnmConfigState(config) {
  unmConfig = config || unmConfig;
  if (!unmConfig) return;
  unmConfigLoaded = true;
  var enabledToggle = unmNode('t-unmEnabled');
  if (enabledToggle) enabledToggle.classList.toggle('on', !!unmConfig.enabled);
  var strictToggle = unmNode('t-unmStrictSourceOrder');
  if (strictToggle) strictToggle.classList.toggle('on', !!unmConfig.strictSourceOrder);
  var flacToggle = unmNode('t-unmEnableFlac');
  if (flacToggle) flacToggle.classList.toggle('on', !!unmConfig.enableFlac);
  var albumToggle = unmNode('t-unmSearchAlbum');
  if (albumToggle) albumToggle.classList.toggle('on', !!unmConfig.searchAlbum);
  renderUnmSourceOrder();
  updateUnmStatusText();
}

function updateUnmStatusText() {
  var chip = unmNode('unm-config-status');
  if (!chip || !unmConfig) return;
  var parts = [];
  parts.push(unmConfig.enabled ? '已启用' : '已停用');
  parts.push('音源 ' + unmConfig.sourceOrder.length + ' 个');
  var cookieBits = [];
  if (unmConfig.qqCookieSet) cookieBits.push('QQ');
  if (unmConfig.miguCookieSet) cookieBits.push('咪咕');
  if (unmConfig.jooxCookieSet) cookieBits.push('JOOX');
  parts.push(cookieBits.length ? ('凭据: ' + cookieBits.join('/')) : '未填凭据');
  chip.textContent = 'UNM · ' + parts.join(' · ');
}

function renderUnmSourceOrder() {
  var list = unmNode('unm-source-list');
  if (!list || !unmConfig) return;
  var known = Array.isArray(unmConfig.knownSources) ? unmConfig.knownSources : Object.keys(UNM_SOURCE_LABELS);
  var order = normalizeUnmSourceOrderClient(unmConfig.sourceOrder, known);
  list.innerHTML = '';
  order.forEach(function (key, index) {
    var chip = document.createElement('div');
    chip.className = 'unm-source-item';
    chip.title = UNM_SOURCE_LABELS[key] || key;
    var badge = document.createElement('span');
    badge.className = 'unm-source-order-index';
    badge.textContent = String(index + 1);
    var label = document.createElement('span');
    label.textContent = UNM_SOURCE_LABELS[key] || key;
    var remove = document.createElement('span');
    remove.className = 'unm-source-remove';
    remove.textContent = '×';
    remove.title = '移出顺序';
    remove.onclick = function (event) {
      event.stopPropagation();
      moveUnmSourceOutOfOrder(key);
    };
    chip.appendChild(badge);
    chip.appendChild(label);
    chip.appendChild(remove);
    list.appendChild(chip);
  });
  known.forEach(function (key) {
    if (order.indexOf(key) >= 0) return;
    var chip = document.createElement('div');
    chip.className = 'unm-source-item disabled';
    chip.title = (UNM_SOURCE_LABELS[key] || key) + ' · 点击加入';
    var label = document.createElement('span');
    label.textContent = '+ ' + (UNM_SOURCE_LABELS[key] || key);
    chip.onclick = function () { appendUnmSourceToOrder(key); };
    chip.appendChild(label);
    list.appendChild(chip);
  });
}

function appendUnmSourceToOrder(key) {
  if (!unmConfig) return;
  var order = normalizeUnmSourceOrderClient(unmConfig.sourceOrder);
  if (order.indexOf(key) >= 0) return;
  order.push(key);
  unmConfig.sourceOrder = order;
  renderUnmSourceOrder();
  saveUnmSettings();
}

function moveUnmSourceOutOfOrder(key) {
  if (!unmConfig) return;
  unmConfig.sourceOrder = normalizeUnmSourceOrderClient(unmConfig.sourceOrder).filter(function (item) { return item !== key; });
  renderUnmSourceOrder();
  saveUnmSettings();
}

function shiftUnmSource(key, delta) {
  if (!unmConfig) return;
  var order = normalizeUnmSourceOrderClient(unmConfig.sourceOrder);
  var index = order.indexOf(key);
  var nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  order[index] = order[nextIndex];
  order[nextIndex] = key;
  unmConfig.sourceOrder = order;
  renderUnmSourceOrder();
  saveUnmSettings();
}

function resetUnmSourceOrder() {
  if (!unmConfig) return;
  unmConfig.sourceOrder = ['kugou', 'bodian', 'migu', 'kuwo'];
  renderUnmSourceOrder();
  saveUnmSettings().then(function () {
    setUnmTestResultText('已恢复默认音源顺序。');
  });
}

function readUnmCookieInputs() {
  return {
    qqCookie: (unmNode('unm-qq-cookie') || {}).value || '',
    miguCookie: (unmNode('unm-migu-cookie') || {}).value || '',
    jooxCookie: (unmNode('unm-joox-cookie') || {}).value || '',
  };
}

function clearUnmCookieInputs() {
  ['unm-qq-cookie', 'unm-migu-cookie', 'unm-joox-cookie'].forEach(function (id) {
    var input = unmNode(id);
    if (input) input.value = '';
  });
}

function setUnmTestResultText(text) {
  var node = unmNode('unm-test-result');
  if (node) node.textContent = text || '';
}

function toggleUnmEnabled() {
  if (!unmConfig) return;
  unmConfig.enabled = !unmConfig.enabled;
  applyUnmConfigState(unmConfig);
  saveUnmSettings();
}

function toggleUnmStrictSourceOrder() {
  if (!unmConfig) return;
  unmConfig.strictSourceOrder = !unmConfig.strictSourceOrder;
  applyUnmConfigState(unmConfig);
  saveUnmSettings();
}

function toggleUnmEnableFlac() {
  if (!unmConfig) return;
  unmConfig.enableFlac = !unmConfig.enableFlac;
  applyUnmConfigState(unmConfig);
  saveUnmSettings();
}

function toggleUnmSearchAlbum() {
  if (!unmConfig) return;
  unmConfig.searchAlbum = !unmConfig.searchAlbum;
  applyUnmConfigState(unmConfig);
  saveUnmSettings();
}

function saveUnmSettings() {
  if (!unmConfigLoaded) return Promise.resolve();
  var payload = {
    enabled: !!unmConfig.enabled,
    sourceOrder: normalizeUnmSourceOrderClient(unmConfig.sourceOrder),
    strictSourceOrder: !!unmConfig.strictSourceOrder,
    enableFlac: unmConfig.enableFlac !== false,
    searchAlbum: !!unmConfig.searchAlbum,
  };
  var cookies = readUnmCookieInputs();
  if (cookies.qqCookie.trim()) payload.qqCookie = cookies.qqCookie.trim();
  if (cookies.miguCookie.trim()) payload.miguCookie = cookies.miguCookie.trim();
  if (cookies.jooxCookie.trim()) payload.jooxCookie = cookies.jooxCookie.trim();
  return apiJson('/api/unm/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function (config) {
    applyUnmConfigState(config);
    clearUnmCookieInputs();
    updateUnmStatusText();
    if (typeof showToast === 'function') showToast('UNM 配置已保存');
    return config;
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('UNM 配置保存失败');
    console.warn('[UNM] save failed:', err);
  });
}

function testUnmMatch() {
  var song = Array.isArray(playQueue) && currentIdx >= 0 ? playQueue[currentIdx] : null;
  var query = song
    ? '?id=' + encodeURIComponent(song.id || song.mid || song.hash || '') +
      '&name=' + encodeURIComponent(song.name || song.title || '') +
      '&artist=' + encodeURIComponent(song.artist || '') +
      '&album=' + encodeURIComponent(song.album || '') +
      '&duration=' + encodeURIComponent(song.durationMs || song.duration || 0)
    : '';
  setUnmTestResultText('正在测试' + (song ? '：' + (song.name || '') : '（队列里没有当前歌曲）') + ' ...');
  apiJson('/api/unm/url' + query, { timeoutMs: 15000 }).then(function (data) {
    if (data && data.url) {
      setUnmTestResultText('测试成功：通过 ' + (UNM_SOURCE_LABELS[data.unmSource] || data.unmSource || '未知音源') + ' 找到可播放音源。');
    } else {
      setUnmTestResultText('测试失败：' + ((data && (data.message || data.error)) || '没有找到可用音源。'));
    }
  }).catch(function (err) {
    setUnmTestResultText('测试失败：' + (err && err.message || '网络错误'));
  });
}

function refreshUnmSettings() {
  apiJson('/api/unm/config').then(function (config) {
    applyUnmConfigState(config);
  }).catch(function (err) {
    var chip = unmNode('unm-config-status');
    if (chip) chip.textContent = 'UNM 配置读取失败';
    console.warn('[UNM] load failed:', err);
  });
}

setTimeout(refreshUnmSettings, 600);

// ---------- 播放链路接入 ----------
function unmEnabled() {
  return !!(unmConfigLoaded && unmConfig && unmConfig.enabled);
}

function providerVipLevelForUnmGate(provider) {
  var status = platformStatus(provider) || {};
  if (!status.loggedIn) return 'none';
  return typeof providerVipLevel === 'function' ? providerVipLevel(provider, status) : 'none';
}

// 有 VIP 的平台不启用解锁；无 VIP / 未登录的平台走 UNM。
function unmShouldBypassProviderRestriction(provider) {
  if (!unmEnabled()) return false;
  provider = normalizePlaybackProvider(provider);
  if (provider === 'spotify') return true;
  return providerVipLevelForUnmGate(provider) !== 'vip' && providerVipLevelForUnmGate(provider) !== 'svip';
}
