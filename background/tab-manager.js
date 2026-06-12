const PINTEREST_URLS = [
  'https://www.pinterest.com/pin-builder/',
  'https://www.pinterest.com/pin-creation-tool/',
];

export const TabManager = {
  async openPinterest() {
    const existing = await chrome.tabs.query({ url: '*://www.pinterest.com/pin-builder/*' });
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
      return existing[0];
    }

    const creationExisting = await chrome.tabs.query({ url: '*://www.pinterest.com/pin-creation-tool/*' });
    if (creationExisting.length > 0) {
      await chrome.tabs.update(creationExisting[0].id, { active: true });
      return creationExisting[0];
    }

    const tab = await chrome.tabs.create({
      url: PINTEREST_URLS[0],
      active: false,
    });
    return tab;
  },

  async waitForContentScript(tabId, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        return;
      } catch {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    throw new Error('Content script not ready within timeout');
  },

  async closePinterestTab(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab may already be closed by user
    }
  },
};

chrome.tabs.onRemoved.addListener((tabId) => {
  // If a Pinterest tab is closed while a job is running,
  // the job status update will be handled by the content script's error path
});