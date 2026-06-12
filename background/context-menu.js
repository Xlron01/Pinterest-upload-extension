import { MSG_TYPES, STORAGE_KEYS, MAX_BATCH_SIZE } from '../shared/constants.js';
import { ConfigManager } from './config-manager.js';
import { Fetcher } from './fetcher.js';
import { TabManager } from './tab-manager.js';

export const ContextMenu = {
  register() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'PINFLOW_SEND',
        title: 'Pin to Pinterest',
        contexts: ['image', 'video'],
      });
      chrome.contextMenus.create({
        id: 'PINFLOW_BATCH_ADD',
        title: 'Add to Pin Queue',
        contexts: ['image', 'video'],
      });
      chrome.contextMenus.create({
        id: 'PINFLOW_BATCH_RUN',
        title: 'Publish Queue Now',
        contexts: ['page'],
      });
    });
  },
};

export async function handleSinglePin(info, tab) {
  const profile = await ConfigManager.getActiveProfile();
  if (!profile) {
    chrome.action.openPopup();
    return;
  }

  const settings = await ConfigManager.getSettings();

  ToastBridge.send(tab.id, {
    status: 'fetching',
    message: 'Preparing image...',
  });

  const config = await ConfigManager.getConfig();
  const job = {
    jobId: crypto.randomUUID(),
    mediaType: info.mediaType || (info.srcUrl && info.srcUrl.includes('.mp4') ? 'video' : 'image'),
    mediaUrl: info.srcUrl,
    mediaBuffer: null,
    mimeType: '',
    filename: '',
    title: tab.title || '',
    description: profile.description,
    hashtags: profile.hashtags,
    websiteUrl: profile.websiteUrl,
    sourcePageUrl: tab.url,
    sourceTabId: tab.id,
    status: 'fetching',
    selectors: config.selectors,
    timing: config.timing,
    createdAt: Date.now(),
  };

  const fetchResult = await Fetcher.fetchMedia(job.mediaUrl);
  if (!fetchResult.success) {
    ToastBridge.send(tab.id, {
      status: 'error',
      message: `Failed to fetch image: ${fetchResult.error}`,
    });
    return;
  }

  job.mediaBuffer = arrayBufferToBase64(fetchResult.buffer);
  job.mimeType = fetchResult.mimeType;
  job.filename = fetchResult.filename;
  job.status = 'uploading';

  const pinTab = await TabManager.openPinterest();
  await TabManager.waitForContentScript(pinTab.id);

  chrome.tabs.sendMessage(pinTab.id, {
    type: MSG_TYPES.START_PIN_JOB,
    job,
  });
}

export async function handleBatchAdd(info, tab) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
  const jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];

  if (jobs.length >= MAX_BATCH_SIZE) {
    ToastBridge.send(tab.id, {
      status: 'error',
      message: `Queue full (max ${MAX_BATCH_SIZE} items)`,
    });
    return;
  }

  const config = await ConfigManager.getConfig();
  const profile = await ConfigManager.getActiveProfile();

  const job = {
    jobId: crypto.randomUUID(),
    mediaType: info.mediaType || 'image',
    mediaUrl: info.srcUrl,
    title: tab.title || '',
    description: profile ? profile.description : '',
    hashtags: profile ? profile.hashtags : [],
    websiteUrl: profile ? profile.websiteUrl : '',
    sourcePageUrl: tab.url,
    sourceTabId: tab.id,
    status: 'pending',
    selectors: config.selectors,
    timing: config.timing,
    createdAt: Date.now(),
  };

  jobs.push(job);
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });

  ToastBridge.send(tab.id, {
    status: 'fetching',
    message: `Added to queue (${jobs.length}/${MAX_BATCH_SIZE})`,
  });

  chrome.action.setBadgeText({ text: String(jobs.length) });
}

export async function handleBatchRun(tab) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
  const jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];
  if (jobs.length === 0) return;

  const settings = await ConfigManager.getSettings();
  const profile = await ConfigManager.getActiveProfile();
  const config = await ConfigManager.getConfig();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (job.status === 'done') continue;

    ToastBridge.send(job.sourceTabId, {
      status: 'uploading',
      message: `Publishing ${i + 1} of ${jobs.length}...`,
    });

    const fetchResult = await Fetcher.fetchMedia(job.mediaUrl);
    if (!fetchResult.success) {
      job.status = 'error';
      job.errorMessage = fetchResult.error;
      await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });
      continue;
    }

    job.mediaBuffer = arrayBufferToBase64(fetchResult.buffer);
    job.mimeType = fetchResult.mimeType;
    job.filename = fetchResult.filename;
    job.description = profile ? profile.description : job.description;
    job.hashtags = profile ? profile.hashtags : job.hashtags;
    job.websiteUrl = profile ? profile.websiteUrl : job.websiteUrl;
    job.selectors = config.selectors;
    job.timing = config.timing;

    const pinTab = await TabManager.openPinterest();
    await TabManager.waitForContentScript(pinTab.id);

    const response = await chrome.tabs.sendMessage(pinTab.id, {
      type: MSG_TYPES.START_PIN_JOB,
      job,
    });

    if (settings.autoCloseTab) {
      chrome.tabs.remove(pinTab.id);
    }

    job.status = response?.success ? 'done' : 'error';
    if (!response?.success) job.errorMessage = response?.error || 'Unknown error';
    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });
  }

  ToastBridge.send(jobs[0].sourceTabId, {
    status: 'done',
    message: 'All pins published!',
  });

  chrome.action.setBadgeText({ text: '' });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const ToastBridge = {
  send(tabId, toast) {
    try {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/toast.js'],
      }).then(() => {
        chrome.tabs.sendMessage(tabId, {
          type: MSG_TYPES.SHOW_TOAST,
          toast,
        });
      }).catch(() => {});
    } catch (err) {
      console.warn('[PinFlow] ToastBridge failed:', err.message);
    }
  },
};