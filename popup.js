const statusNode = document.getElementById('status');
const enableButton = document.getElementById('enable');
const disableButton = document.getElementById('disable');

function setStatus(enabled) {
  statusNode.textContent = `当前状态：${enabled ? '开启' : '关闭'}`;
}

function writeEnabled(enabled) {
  chrome.storage.local.set({ enabled }, () => {
    setStatus(enabled);
  });
}

chrome.storage.local.get({ enabled: true }, (result) => {
  setStatus(result.enabled);
});

enableButton.addEventListener('click', () => {
  writeEnabled(true);
});

disableButton.addEventListener('click', () => {
  writeEnabled(false);
});
