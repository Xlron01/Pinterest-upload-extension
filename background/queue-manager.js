import { STORAGE_KEYS, MSG_TYPES } from '../shared/constants.js';
import { ConfigManager } from './config-manager.js';
import { Fetcher } from './fetcher.js';
import { TabManager } from './tab-manager.js';

const TAB_CLOSE_DELAY_MS = 300;

let isRunning = false;

export const queueManager = {
  async start() {
    if (isRunning) {
      console.log('[PinFlow] Queue already running');
      return;
    }

    isRunning = true;
    console.log('[PinFlow] Queue processing started');

    const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
    let jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];

    if (jobs.length === 0) {
      isRunning = false;
      return;
    }

    const settings = await ConfigManager.getSettings();
    const profile = await ConfigManager.getActiveProfile();
    const config = await ConfigManager.getConfig();
    const totalJobs = jobs.length;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job.status === 'done') continue;

      console.log('[PinFlow] Processing job ' + (i + 1) + '/' + totalJobs);

      const fetchResult = await Fetcher.fetchMedia(job.mediaUrl);
      if (!fetchResult.success) {
        job.status = 'error';
        job.errorMessage = fetchResult.error;
        await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });
        chrome.action.setBadgeText({ text: String(jobs.filter(j => j.status !== 'done').length) });
        continue;
      }

      job.mediaBuffer = arrayBufferToBase64(fetchResult.buffer);
      job.mimeType = fetchResult.mimeType;
      job.filename = fetchResult.filename;
      if (profile) {
        job.description = profile.description;
        job.hashtags = profile.hashtags;
        job.websiteUrl = profile.websiteUrl;
      }
      job.selectors = config.selectors;
      job.timing = config.timing;
      job.status = 'uploading';

      let pinTab;
      try {
        pinTab = await TabManager.openPinterest();
        await TabManager.waitForContentScript(pinTab.id, 20000);

        const response = await chrome.tabs.sendMessage(pinTab.id, {
          type: MSG_TYPES.START_PIN_JOB,
          job,
        });

        job.status = (response && response.success) ? 'done' : 'error';
        if (!response || !response.success) {
          job.errorMessage = (response && response.error) || 'Unknown error';
        }
      } catch (err) {
        job.status = 'error';
        job.errorMessage = err.message;
      }

      await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });

      if (pinTab) {
        try { await chrome.tabs.remove(pinTab.id); } catch {}
      }

      await new Promise(r => setTimeout(r, TAB_CLOSE_DELAY_MS));

      const remaining = jobs.filter(j => j.status !== 'done').length;
      chrome.action.setBadgeText({ text: String(remaining) });
    }

    isRunning = false;
    console.log('[PinFlow] Queue processing complete');

    chrome.action.setBadgeText({ text: '' });
  },
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}