(function () {
  'use strict';

  const TAG = '[Bili Star]';
  const POLL_INTERVAL_MS = 500;
  const POLL_TIMEOUT_MS = 30000;

  let lastVideoKey = null;
  let lastDanmakuX = null;
  let syncInFlight = false;

  if (window.__BILI_STAR_PAGE_SCRIPT_INSTALLED__) {
    return;
  }
  window.__BILI_STAR_PAGE_SCRIPT_INSTALLED__ = true;

  function info(message, extra) {
    if (typeof extra === 'undefined') {
      console.info(`${TAG} ${message}`);
      return;
    }
    console.info(`${TAG} ${message}`, extra);
  }

  function warn(message, extra) {
    if (typeof extra === 'undefined') {
      console.warn(`${TAG} ${message}`);
      return;
    }
    console.warn(`${TAG} ${message}`, extra);
  }

  function isSpecialDanmaku(item) {
    if (!item || typeof item !== 'object') {
      return false;
    }

    return item.pool !== 0 || item.mode === 8 || item.rawMode === 8 || item.dmFrom === 0;
  }

  function shouldKeepDanmaku(item) {
    if (!item || typeof item !== 'object') {
      return false;
    }

    return item.isHighLike === true || (typeof item.weight === 'number' && item.weight >= 11) || isSpecialDanmaku(item);
  }

  function filterDanmakuList(list) {
    if (!Array.isArray(list)) {
      return list;
    }

    return list.filter(shouldKeepDanmaku);
  }

  function patchMethod(target, key, wrapperFactory) {
    if (!target || typeof target[key] !== 'function') {
      return false;
    }

    const original = target[key];
    if (original.__biliStarPatched) {
      return true;
    }

    const wrapped = wrapperFactory(original);
    wrapped.__biliStarPatched = true;
    target[key] = wrapped;
    return true;
  }

  function installFilter(danmakuX) {
    if (!danmakuX || danmakuX.__biliStarInstalled) {
      return false;
    }

    const manager = danmakuX.manager;
    const dataBase = manager && manager.dataBase;
    if (!manager || !dataBase || typeof dataBase.addList !== 'function') {
      warn('DanmakuX structure missing addList hook');
      return false;
    }

    patchMethod(dataBase, 'addList', (original) => {
      return function patchedAddList(list) {
        return original.call(this, filterDanmakuList(list));
      };
    });

    patchMethod(manager, 'addList', (original) => {
      return function patchedManagerAddList(list) {
        return original.call(this, filterDanmakuList(list));
      };
    });

    patchMethod(manager, 'multipleAdd', (original) => {
      return function patchedMultipleAdd(list) {
        return original.call(this, filterDanmakuList(list));
      };
    });

    patchMethod(manager, 'insert', (original) => {
      return function patchedInsert(list) {
        return original.call(this, filterDanmakuList(list));
      };
    });

    if (Array.isArray(dataBase.dmArray)) {
      const filteredExisting = filterDanmakuList(dataBase.dmArray);
      dataBase.dmArray.splice(0, dataBase.dmArray.length, ...filteredExisting);
    }

    if (manager.timeLine && Array.isArray(manager.timeLine.list)) {
      const filteredTimeline = filterDanmakuList(manager.timeLine.list);
      manager.timeLine.list.splice(0, manager.timeLine.list.length, ...filteredTimeline);
    }

    if (typeof manager.clear === 'function') {
      manager.clear();
    }

    if (typeof danmakuX.clear === 'function') {
      danmakuX.clear();
    }

    if (typeof danmakuX.fresh === 'function') {
      danmakuX.fresh();
    }

    danmakuX.__biliStarInstalled = true;
    const remaining = Array.isArray(dataBase.dmArray) ? dataBase.dmArray.length : null;
    info('Installed danmaku filter in page world', { remaining });
    return true;
  }

  function getVideoKey() {
    const state = window.__INITIAL_STATE__;
    const aid = state?.aid ?? '';
    const cid = state?.cid ?? state?.videoData?.cid ?? '';
    const bvid = state?.bvid ?? '';
    return `${bvid}:${aid}:${cid}`;
  }

  async function tryInstall() {
    try {
      const player = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.player;
      const getDanmakuX = player && player.danmaku && player.danmaku.getDanmakuX;
      if (typeof getDanmakuX !== 'function') {
        return false;
      }

      const danmakuX = await getDanmakuX.call(player.danmaku);
      const dmArray = danmakuX?.manager?.dataBase?.dmArray;
      if (!Array.isArray(dmArray)) {
        return false;
      }

      const keptCount = dmArray.filter(shouldKeepDanmaku).length;
      if (keptCount === 0) {
        warn('No high-liked or special danmaku found on current page');
      }

      const installed = installFilter(danmakuX);
      if (installed) {
        lastDanmakuX = danmakuX;
      }
      return installed;
    } catch (error) {
      warn(`Install attempt failed: ${String(error)}`);
      return false;
    }
  }

  async function syncToCurrentVideo(force) {
    if (syncInFlight) {
      return;
    }

    const videoKey = getVideoKey();
    if (!videoKey || videoKey === '::') {
      return;
    }

    let currentDanmakuX = null;
    try {
      const player = window.__INITIAL_STATE__?.player;
      const getDanmakuX = player?.danmaku?.getDanmakuX;
      if (typeof getDanmakuX === 'function') {
        currentDanmakuX = await getDanmakuX.call(player.danmaku);
      }
    } catch (error) {
      warn(`DanmakuX lookup failed: ${String(error)}`);
      return;
    }

    if (!force && videoKey === lastVideoKey && currentDanmakuX === lastDanmakuX) {
      return;
    }

    lastVideoKey = videoKey;
    syncInFlight = true;
    try {
      await tryInstall();
      info('Synced danmaku filter', { videoKey, href: location.href });
    } finally {
      syncInFlight = false;
    }
  }

  function installNavigationHooks() {
    if (window.__BILI_STAR_NAV_HOOKED__) {
      return;
    }
    window.__BILI_STAR_NAV_HOOKED__ = true;

    const originalPushState = history.pushState;
    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(() => syncToCurrentVideo(true), 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(() => syncToCurrentVideo(true), 0);
      return result;
    };

    window.addEventListener('popstate', () => {
      window.setTimeout(() => syncToCurrentVideo(true), 0);
    });

    window.setInterval(() => syncToCurrentVideo(false), 1000);
  }

  async function boot() {
    installNavigationHooks();

    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT_MS && !lastDanmakuX) {
      await syncToCurrentVideo(true);
      if (lastDanmakuX) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!lastDanmakuX) {
      warn('Timed out waiting for DanmakuX; filter not installed');
    }
  }

  boot();
})();
