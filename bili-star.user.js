// ==UserScript==
// @name         Bili Star Stable
// @namespace    https://local.bili-star
// @version      0.3.0
// @description  Keep high-liked danmaku and special danmaku on Bilibili video pages, with SPA re-hook support.
// @match        https://www.bilibili.com/video/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[Bili Star]';
  const POLL_INTERVAL_MS = 500;
  const POLL_TIMEOUT_MS = 30000;
  const ENABLED_KEY = 'enabled';

  let lastVideoKey = null;
  let runtimeEnabled = GM_getValue(ENABLED_KEY, true) !== false;

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

  function registerMenu() {
    const title = runtimeEnabled
      ? '当前：已开启，点击关闭'
      : '当前：已关闭，点击开启';

    GM_registerMenuCommand(title, async () => {
      await toggleEnabledAndReload('menu');
    });
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    const tagName = target.tagName;
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      target.isContentEditable === true
    );
  }

  async function toggleEnabledAndReload(source) {
    runtimeEnabled = !runtimeEnabled;
    GM_setValue(ENABLED_KEY, runtimeEnabled);

    const confirmed = await new Promise((resolve) => {
      window.setTimeout(() => {
        resolve(GM_getValue(ENABLED_KEY, true) !== false);
      }, 50);
    });

    runtimeEnabled = confirmed;
    lastVideoKey = null;
    info(`Bili Star 已${runtimeEnabled ? '开启' : '关闭'}，页面即将刷新`, {
      confirmed,
      source,
    });

    window.setTimeout(() => {
      location.reload();
    }, 120);
  }

  function installShortcut() {
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'End') {
          return;
        }

        if (isEditableTarget(event.target)) {
          return;
        }

        event.preventDefault();
        toggleEnabledAndReload('shortcut:end');
      },
      true
    );
  }

  function getVideoKey() {
    const state = window.__INITIAL_STATE__;
    const aid = state?.aid ?? '';
    const cid = state?.cid ?? state?.videoData?.cid ?? '';
    const bvid = state?.bvid ?? '';
    return `${bvid}:${aid}:${cid}`;
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

    if (!runtimeEnabled) {
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
    if (!danmakuX) {
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
      if (runtimeEnabled) {
        dataBase.dmArray.splice(0, dataBase.dmArray.length, ...filteredExisting);
      }
    }

    if (manager.timeLine && Array.isArray(manager.timeLine.list)) {
      const filteredTimeline = filterDanmakuList(manager.timeLine.list);
      if (runtimeEnabled) {
        manager.timeLine.list.splice(0, manager.timeLine.list.length, ...filteredTimeline);
      }
    }

    if (runtimeEnabled && typeof manager.clear === 'function') {
      manager.clear();
    }

    if (runtimeEnabled && typeof danmakuX.clear === 'function') {
      danmakuX.clear();
    }

    if (runtimeEnabled && typeof danmakuX.fresh === 'function') {
      danmakuX.fresh();
    }

    danmakuX.__biliStarInstalled = true;
    info('Installed userscript filter', {
      remaining: Array.isArray(dataBase.dmArray) ? dataBase.dmArray.length : null,
      videoKey: getVideoKey(),
      enabled: runtimeEnabled,
    });
    return true;
  }

  async function tryInstallForCurrentVideo() {
    if (!runtimeEnabled) {
      return false;
    }

    try {
      const player = window.__INITIAL_STATE__?.player;
      const getDanmakuX = player?.danmaku?.getDanmakuX;
      if (typeof getDanmakuX !== 'function') {
        return false;
      }

      const danmakuX = await getDanmakuX.call(player.danmaku);
      const dmArray = danmakuX?.manager?.dataBase?.dmArray;
      if (!Array.isArray(dmArray)) {
        return false;
      }

      return installFilter(danmakuX);
    } catch (error) {
      warn(`Install attempt failed: ${String(error)}`);
      return false;
    }
  }

  async function waitAndInstall() {
    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const installed = await tryInstallForCurrentVideo();
      if (installed) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }

    warn('Timed out waiting for DanmakuX; filter not installed');
    return false;
  }

  async function syncToCurrentVideo(force) {
    if (!runtimeEnabled) {
      return;
    }

    const videoKey = getVideoKey();
    if (!videoKey || videoKey === '::') {
      return;
    }

    if (!force && videoKey === lastVideoKey) {
      return;
    }

    lastVideoKey = videoKey;
    info('Detected video context change', { videoKey, href: location.href });
    await waitAndInstall();
  }

  function installNavigationHooks() {
    const originalPushState = history.pushState;
    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      window.setTimeout(() => {
        syncToCurrentVideo(true);
      }, 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      window.setTimeout(() => {
        syncToCurrentVideo(true);
      }, 0);
      return result;
    };

    window.addEventListener('popstate', () => {
      window.setTimeout(() => {
        syncToCurrentVideo(true);
      }, 0);
    });

    window.setInterval(() => {
      syncToCurrentVideo(false);
    }, 1000);
  }

  async function boot() {
    registerMenu();
    installShortcut();

    if (!runtimeEnabled) {
      info('Bili Star 当前为关闭状态');
      return;
    }

    installNavigationHooks();
    await syncToCurrentVideo(true);
  }

  boot();
})();
