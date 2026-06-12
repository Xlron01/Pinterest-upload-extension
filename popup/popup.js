import { MSG_TYPES, STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_CONFIG, MAX_BATCH_SIZE } from '../shared/constants.js';
import { validateProfile, validateSettings, createProfile, sanitizeHashtags } from '../shared/validator.js';

class PopupApp {
  constructor() {
    this.profiles = [];
    this.activeProfileId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.editingProfileId = null;
    this.remoteConfig = { ...DEFAULT_CONFIG };
    this.pendingJobs = [];
  }

  async init() {
    await this.loadState();
    this.renderActiveProfile();
    this.renderProfileList();
    this.renderSettings();
    this.renderQueue();
    this.bindEvents();
  }

  async loadState() {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROFILES,
      STORAGE_KEYS.ACTIVE_PROFILE,
      STORAGE_KEYS.REMOTE_CONFIG,
      STORAGE_KEYS.CONFIG_LAST_SYNC,
      STORAGE_KEYS.PENDING_JOBS,
      STORAGE_KEYS.SETTINGS,
    ]);

    this.profiles = data[STORAGE_KEYS.PROFILES] || [];
    this.activeProfileId = data[STORAGE_KEYS.ACTIVE_PROFILE] || null;
    this.remoteConfig = data[STORAGE_KEYS.REMOTE_CONFIG] || { ...DEFAULT_CONFIG };

    if (data[STORAGE_KEYS.SETTINGS] && validateSettings(data[STORAGE_KEYS.SETTINGS])) {
      this.settings = data[STORAGE_KEYS.SETTINGS];
    }

    this.pendingJobs = data[STORAGE_KEYS.PENDING_JOBS] || [];
  }

  renderActiveProfile() {
    const select = document.getElementById('active-profile');
    select.innerHTML = '<option value="">No profile selected</option>';

    for (const profile of this.profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      if (profile.id === this.activeProfileId) option.selected = true;
      select.appendChild(option);
    }
  }

  renderProfileList() {
    const container = document.getElementById('profile-list');

    if (this.profiles.length === 0) {
      container.innerHTML = '<p class="empty-state">No profiles yet. Create one above.</p>';
      return;
    }

    container.innerHTML = '';
    for (const profile of this.profiles) {
      const item = document.createElement('div');
      item.className = 'profile-item' + (profile.id === this.activeProfileId ? ' active' : '');

      item.innerHTML = `
        <div class="profile-item-info">
          <div class="profile-item-name">${escapeHtml(profile.name)}</div>
          <div class="profile-item-url">${escapeHtml(profile.websiteUrl)}</div>
        </div>
        <div class="profile-item-actions">
          <button class="btn-icon edit" data-id="${profile.id}" title="Edit">&#9998;</button>
          <button class="btn-icon delete" data-id="${profile.id}" title="Delete">&#10005;</button>
        </div>
      `;
      container.appendChild(item);
    }
  }

  renderSettings() {
    document.getElementById('remote-config-url').value = this.settings.remoteConfigUrl;
    document.getElementById('setting-auto-close').checked = this.settings.autoCloseTab;
    document.getElementById('setting-show-toasts').checked = this.settings.showToasts;
    document.getElementById('setting-batch-mode').checked = this.settings.batchMode;
  }

  renderQueue() {
    const section = document.getElementById('queue-section');
    const list = document.getElementById('queue-list');
    const count = document.getElementById('queue-count');
    const runBtn = document.getElementById('run-queue-btn');

    if (!this.settings.batchMode || this.pendingJobs.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    count.textContent = this.pendingJobs.length;
    runBtn.disabled = this.pendingJobs.length === 0;

    list.innerHTML = '';
    for (const job of this.pendingJobs) {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.innerHTML = `
        <span class="queue-item-status ${job.status}"></span>
        <span class="queue-item-name">${escapeHtml(job.filename || 'Pending')}</span>
      `;
      list.appendChild(item);
    }
  }

  bindEvents() {
    document.getElementById('active-profile').addEventListener('change', (e) => {
      this.handleSetActive(e.target.value);
    });

    document.getElementById('profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSaveProfile();
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      this.resetForm();
    });

    document.getElementById('profile-description').addEventListener('input', (e) => {
      document.getElementById('desc-count').textContent = e.target.value.length;
    });

    document.getElementById('profile-list').addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit');
      const deleteBtn = e.target.closest('.delete');

      if (editBtn) this.handleEditProfile(editBtn.dataset.id);
      if (deleteBtn) this.handleDeleteProfile(deleteBtn.dataset.id);
    });

    document.getElementById('settings-toggle').addEventListener('click', () => {
      this.toggleSection('settings-body', 'settings-arrow');
    });

    document.getElementById('force-sync-btn').addEventListener('click', () => {
      this.handleForceSyncConfig();
    });

    const settingsFields = ['remote-config-url', 'setting-auto-close', 'setting-show-toasts', 'setting-batch-mode'];
    for (const id of settingsFields) {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', () => {
        this.handleSettingsChange();
      });
    }

    document.getElementById('run-queue-btn').addEventListener('click', () => {
      this.handleRunQueue();
    });
  }

  async handleSaveProfile() {
    this.clearErrors();

    const name = document.getElementById('profile-name').value.trim();
    const description = document.getElementById('profile-description').value.trim();
    const hashtagsRaw = document.getElementById('profile-hashtags').value.trim();
    const websiteUrl = document.getElementById('profile-website').value.trim();

    const hashtags = sanitizeHashtags(hashtagsRaw);

    let hasError = false;

    if (!name || name.length > 50) {
      this.showInlineError('name-error', 'Name is required (max 50 chars)');
      hasError = true;
    }

    if (description.length > 500) {
      this.showInlineError('desc-error', 'Max 500 characters');
      hasError = true;
    }

    if (!websiteUrl) {
      this.showInlineError('url-error', 'Website URL is required');
      hasError = true;
    } else {
      try {
        new URL(websiteUrl);
      } catch {
        this.showInlineError('url-error', 'Invalid URL');
        hasError = true;
      }
    }

    if (hasError) return;

    let profile;
    if (this.editingProfileId) {
      profile = this.profiles.find(p => p.id === this.editingProfileId);
      if (!profile) return;
      Object.assign(profile, {
        name,
        description,
        hashtags,
        websiteUrl,
        updatedAt: Date.now(),
      });
    } else {
      profile = createProfile({ name, description, hashtags, websiteUrl });
      this.profiles.push(profile);
    }

    if (!validateProfile(profile)) {
      this.showInlineError('name-error', 'Invalid profile data');
      return;
    }

    await chrome.runtime.sendMessage({
      type: MSG_TYPES.SAVE_PROFILE,
      profile,
    });

    await this.loadState();
    this.renderActiveProfile();
    this.renderProfileList();
    this.resetForm();
  }

  async handleDeleteProfile(id) {
    await chrome.runtime.sendMessage({
      type: MSG_TYPES.DELETE_PROFILE,
      profileId: id,
    });

    await this.loadState();
    this.renderActiveProfile();
    this.renderProfileList();
  }

  handleEditProfile(id) {
    const profile = this.profiles.find(p => p.id === id);
    if (!profile) return;

    this.editingProfileId = id;
    document.getElementById('profile-id').value = id;
    document.getElementById('profile-name').value = profile.name;
    document.getElementById('profile-description').value = profile.description;
    document.getElementById('desc-count').textContent = profile.description.length;
    document.getElementById('profile-hashtags').value = profile.hashtags.join(', ');
    document.getElementById('profile-website').value = profile.websiteUrl;
    document.getElementById('form-title').textContent = 'Edit Profile';
    document.getElementById('cancel-btn').style.display = 'inline-block';
    document.getElementById('save-btn').textContent = 'Update Profile';
  }

  resetForm() {
    this.editingProfileId = null;
    document.getElementById('profile-id').value = '';
    document.getElementById('profile-form').reset();
    document.getElementById('desc-count').textContent = '0';
    document.getElementById('form-title').textContent = 'New Profile';
    document.getElementById('cancel-btn').style.display = 'none';
    document.getElementById('save-btn').textContent = 'Save Profile';
    this.clearErrors();
  }

  async handleSetActive(id) {
    await chrome.runtime.sendMessage({
      type: MSG_TYPES.SET_ACTIVE_PROFILE,
      profileId: id || null,
    });

    this.activeProfileId = id || null;
    this.renderProfileList();
  }

  async handleSettingsChange() {
    const url = document.getElementById('remote-config-url').value.trim();
    const newSettings = {
      remoteConfigUrl: url || DEFAULT_SETTINGS.remoteConfigUrl,
      autoCloseTab: document.getElementById('setting-auto-close').checked,
      showToasts: document.getElementById('setting-show-toasts').checked,
      batchMode: document.getElementById('setting-batch-mode').checked,
    };

    if (!validateSettings(newSettings)) return;

    this.settings = newSettings;
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
    this.renderQueue();
  }

  async handleForceSyncConfig() {
    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = 'Syncing...';

    const response = await chrome.runtime.sendMessage({
      type: MSG_TYPES.FORCE_CONFIG_SYNC,
    });

    if (response && response.success) {
      statusEl.textContent = 'Synced';
      await this.loadState();
    } else {
      statusEl.textContent = 'Sync failed';
    }
  }

  handleRunQueue() {
    chrome.runtime.sendMessage({
      type: MSG_TYPES.START_PIN_JOB,
      batch: true,
    });
  }

  toggleSection(bodyId, arrowId) {
    const body = document.getElementById(bodyId);
    const arrow = document.getElementById(arrowId);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
  }

  showInlineError(fieldId, msg) {
    document.getElementById(fieldId).textContent = msg;
  }

  clearErrors() {
    const errors = document.querySelectorAll('.field-error');
    for (const el of errors) {
      el.textContent = '';
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new PopupApp();
  app.init();
});