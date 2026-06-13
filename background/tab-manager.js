const PINTEREST_PIN_BUILDER = 'https://www.pinterest.com/pin-creation-tool/';

export const TabManager = {
  async openPinterest() {
    const existingPins = await chrome.tabs.query({ url: '*://www.pinterest.com/pin-creation-tool/*' });
    if (existingPins.length > 0) {
      return existingPins[0];
    }

    const existingCreate = await chrome.tabs.query({ url: '*://www.pinterest.com/pin-creation-tool/*' });
    if (existingCreate.length > 0) {
      return existingCreate[0];
    }

    const existingCreate2 = await chrome.tabs.query({ url: '*://www.pinterest.com/pin/create/*' });
    if (existingCreate2.length > 0) {
      return existingCreate2[0];
    }

    const tab = await chrome.tabs.create({
      url: PINTEREST_PIN_BUILDER,
      active: false,
    });

    await this.waitForPageLoad(tab.id);
    return tab;
  },

  async waitForPageLoad(tabId, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(); }
      }, timeoutMs);

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) return;
        if (changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          if (!resolved) { resolved = true; resolve(); }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  },

  async waitForContentScript(tabId, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (response && response.pong) return;
      } catch {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    throw new Error('Content script not ready within timeout');
  },

  async closePinterestTab(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch { }
  },
};