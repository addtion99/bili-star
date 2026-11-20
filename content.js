(async function () {
  'use strict';

  const TAG = '[Bili Star]';

  function info(message, extra) {
    if (typeof extra === 'undefined') {
      console.info(`${TAG} ${message}`);
      return;
    }
    console.info(`${TAG} ${message}`, extra);
  }

  const enabled = await new Promise((resolve) => {
    chrome.storage.local.get({ enabled: true }, (result) => {
      resolve(result.enabled !== false);
    });
  });

  if (!enabled) {
    info('Filter disabled by popup setting');
    return;
  }

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-script.js');
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
