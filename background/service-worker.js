import { ConfigManager } from './config-manager.js';
import { ContextMenu, handleSinglePin, handleBatchAdd, handleBatchRun } from './context-menu.js';
import { MSG_TYPES, STORAGE_KEYS, QUEUE_DELAY_MS } from '../shared/constants.js';
import { queueManager } from './queue-manager.js';

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Keep the service worker alive
    chrome.storage.local.get('pendingJobs');
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await ConfigManager.initDefaults();
  await ConfigManager.syncRemote();
  ContextMenu.register();
});

chrome.runtime.onStartup.addListener(async () => {
  await ConfigManager.syncRemoteIfStale();
  ContextMenu.register();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG_TYPES.GET_STATE) {
    handleGetState().then(sendResponse);
    return true;
  }

  if (msg.type === MSG_TYPES.SAVE_PROFILE) {
    handleSaveProfile(msg.profile).then(sendResponse);
    return true;
  }

  if (msg.type === MSG_TYPES.DELETE_PROFILE) {
    handleDeleteProfile(msg.profileId).then(sendResponse);
    return true;
  }

  if (msg.type === MSG_TYPES.SET_ACTIVE_PROFILE) {
    handleSetActiveProfile(msg.profileId).then(sendResponse);
    return true;
  }

  if (msg.type === MSG_TYPES.FORCE_CONFIG_SYNC) {
    ConfigManager.syncRemote().then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false, error: 'Sync failed' });
    });
    return true;
  }

  if (msg.type === MSG_TYPES.JOB_STATUS_UPDATE) {
    handleJobStatusUpdate(msg.jobId, msg.status, msg.error).then(sendResponse);
    return true;
  }

  if (msg.type === MSG_TYPES.START_BATCH_QUEUE) {
    queueManager.start().then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function handleGetState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.PROFILES,
    STORAGE_KEYS.ACTIVE_PROFILE,
    STORAGE_KEYS.REMOTE_CONFIG,
    STORAGE_KEYS.CONFIG_LAST_SYNC,
    STORAGE_KEYS.PENDING_JOBS,
    STORAGE_KEYS.SETTINGS,
  ]);
  return { success: true, data };
}

async function handleSaveProfile(profile) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PROFILES);
  const profiles = data[STORAGE_KEYS.PROFILES] || [];
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = { ...profile, updatedAt: Date.now() };
  } else {
    profiles.push(profile);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  broadcastStateUpdate();
  return { success: true };
}

async function handleDeleteProfile(profileId) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.PROFILES, STORAGE_KEYS.ACTIVE_PROFILE]);
  const profiles = (data[STORAGE_KEYS.PROFILES] || []).filter(p => p.id !== profileId);
  let update = { [STORAGE_KEYS.PROFILES]: profiles };
  if (data[STORAGE_KEYS.ACTIVE_PROFILE] === profileId) {
    update[STORAGE_KEYS.ACTIVE_PROFILE] = null;
  }
  await chrome.storage.local.set(update);
  broadcastStateUpdate();
  return { success: true };
}

async function handleSetActiveProfile(profileId) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROFILE]: profileId });
  broadcastStateUpdate();
  return { success: true };
}

async function handleJobStatusUpdate(jobId, status, error) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
  const jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];
  const job = jobs.find(j => j.jobId === jobId);
  if (job) {
    job.status = status;
    if (error) job.errorMessage = error;
    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });
  }
  broadcastStateUpdate();
  return { success: true };
}

function broadcastStateUpdate() {
  chrome.runtime.sendMessage({ type: MSG_TYPES.STATE_UPDATED }).catch(() => { });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'PINFLOW_SEND') await handleSinglePin(info, tab);
    else if (info.menuItemId === 'PINFLOW_BATCH_ADD') await handleBatchAdd(info, tab);
    else if (info.menuItemId === 'PINFLOW_BATCH_RUN') await handleBatchRun(tab);
  } catch (err) {
    console.error('[PinFlow] Context menu handler error:', err);
  }
});