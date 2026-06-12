import { STORAGE_KEYS, DEFAULT_CONFIG, DEFAULT_SETTINGS, SYNC_INTERVAL_MS } from '../shared/constants.js';
import { validateRemoteConfig } from '../shared/validator.js';

export const ConfigManager = {
  async initDefaults() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROFILES,
      STORAGE_KEYS.ACTIVE_PROFILE,
      STORAGE_KEYS.REMOTE_CONFIG,
      STORAGE_KEYS.CONFIG_LAST_SYNC,
      STORAGE_KEYS.PENDING_JOBS,
      STORAGE_KEYS.SETTINGS,
    ]);

    const updates = {};

    if (!data[STORAGE_KEYS.PROFILES]) {
      updates[STORAGE_KEYS.PROFILES] = [];
    }
    if (data[STORAGE_KEYS.ACTIVE_PROFILE] === undefined) {
      updates[STORAGE_KEYS.ACTIVE_PROFILE] = null;
    }
    if (!data[STORAGE_KEYS.REMOTE_CONFIG]) {
      updates[STORAGE_KEYS.REMOTE_CONFIG] = { ...DEFAULT_CONFIG };
    }
    if (data[STORAGE_KEYS.CONFIG_LAST_SYNC] === undefined) {
      updates[STORAGE_KEYS.CONFIG_LAST_SYNC] = 0;
    }
    if (!data[STORAGE_KEYS.PENDING_JOBS]) {
      updates[STORAGE_KEYS.PENDING_JOBS] = [];
    }
    if (!data[STORAGE_KEYS.SETTINGS]) {
      updates[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS };
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  },

  async syncRemoteIfStale() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.CONFIG_LAST_SYNC);
    const lastSync = data[STORAGE_KEYS.CONFIG_LAST_SYNC] || 0;
    if (!lastSync || Date.now() - lastSync > SYNC_INTERVAL_MS) {
      await this.syncRemote();
    }
  },

  async syncRemote() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = data[STORAGE_KEYS.SETTINGS];
    const url = settings?.remoteConfigUrl;
    if (!url) return;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const config = await res.json();
      if (!validateRemoteConfig(config)) throw new Error('Schema invalid');
      await chrome.storage.local.set({
        [STORAGE_KEYS.REMOTE_CONFIG]: config,
        [STORAGE_KEYS.CONFIG_LAST_SYNC]: Date.now(),
      });
    } catch (err) {
      console.warn('[PinFlow] Remote config sync failed:', err.message);
    }
  },

  async getActiveProfile() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROFILES,
      STORAGE_KEYS.ACTIVE_PROFILE,
    ]);
    const profiles = data[STORAGE_KEYS.PROFILES] || [];
    const activeId = data[STORAGE_KEYS.ACTIVE_PROFILE];
    return profiles.find(p => p.id === activeId) || null;
  },

  async getSelectors() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.REMOTE_CONFIG);
    const config = data[STORAGE_KEYS.REMOTE_CONFIG] || DEFAULT_CONFIG;
    return config.selectors;
  },

  async getTiming() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.REMOTE_CONFIG);
    const config = data[STORAGE_KEYS.REMOTE_CONFIG] || DEFAULT_CONFIG;
    return config.timing;
  },

  async getSettings() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return data[STORAGE_KEYS.SETTINGS] || { ...DEFAULT_SETTINGS };
  },

  async getConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.REMOTE_CONFIG);
    return data[STORAGE_KEYS.REMOTE_CONFIG] || { ...DEFAULT_CONFIG };
  },
};