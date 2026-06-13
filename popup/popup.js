import { MSG_TYPES, STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_CONFIG, MAX_BATCH_SIZE, QUEUE_DELAY_MS } from '../shared/constants.js';
import { sanitizeHashtags, validateProfile, validateSettings, createProfile } from '../shared/validator.js';

class PopupApp {
  constructor() {
    this.profiles = [];
    this.activeProfileId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.editingProfileId = null;
    this.remoteConfig = { ...DEFAULT_CONFIG };
    this.pendingJobs = [];
    this.scrapedImages = [];
    this.selectedImages = new Set();
    this.isQueueRunning = false;
  }

  async init() {
    await this.loadState();
    this.renderActiveProfile();
    this.renderProfileList();
    this.renderSettings();
    this.renderQueue();
    this.bindEvents();
    this.bindFormToggle();
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

  bindFormToggle() {
    const formToggle = document.getElementById('form-toggle');
    const form = document.getElementById('profile-form');
    formToggle.addEventListener('click', () => {
      const isVisible = form.style.display !== 'none';
      form.style.display = isVisible ? 'none' : 'flex';
      document.getElementById('form-arrow').innerHTML = isVisible ? '&#9654;' : '&#9660;';
    });
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

    const settingsFields = ['remote-config-url', 'setting-show-toasts'];
    for (const id of settingsFields) {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', () => {
        this.handleSettingsChange();
      });
    }

    document.getElementById('run-queue-btn').addEventListener('click', () => {
      this.handleRunQueue();
    });

    document.getElementById('clear-queue-btn').addEventListener('click', () => {
      this.handleClearQueue();
    });

    document.getElementById('scrape-btn').addEventListener('click', () => {
      this.handleScrapeImages();
    });

    document.getElementById('add-selected-btn').addEventListener('click', () => {
      this.handleAddSelected();
    });

    document.getElementById('select-all-btn').addEventListener('click', () => {
      this.handleSelectAll();
    });

    document.getElementById('deselect-all-btn').addEventListener('click', () => {
      this.handleDeselectAll();
    });
  }

  async handleScrapeImages() {
    const btn = document.getElementById('scrape-btn');
    btn.textContent = 'Scanning page...';
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        btn.textContent = 'No active tab';
        setTimeout(() => {
          btn.textContent = 'Capture Images from Page';
          btn.classList.remove('loading');
          btn.disabled = false;
        }, 2000);
        return;
      }

      if (tab.url && tab.url.includes('pinterest.com')) {
        btn.textContent = 'Cannot scrape Pinterest';
        setTimeout(() => {
          btn.textContent = 'Capture Images from Page';
          btn.classList.remove('loading');
          btn.disabled = false;
        }, 2000);
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/scrape-images.js'],
      });

      const response = await chrome.tabs.sendMessage(tab.id, { type: MSG_TYPES.SCRAPE_IMAGES });

      if (response && response.images && response.images.length > 0) {
        this.scrapedImages = response.images;
        this.selectedImages.clear();
        this.renderImageGrid();
      } else {
        btn.textContent = 'No images found';
        setTimeout(() => {
          btn.textContent = 'Capture Images from Page';
          btn.classList.remove('loading');
          btn.disabled = false;
        }, 2000);
        return;
      }
    } catch (err) {
      console.error('[PinFlow] Scrape error:', err);
      btn.textContent = 'Error scanning page';
      setTimeout(() => {
        btn.textContent = 'Capture Images from Page';
        btn.classList.remove('loading');
        btn.disabled = false;
      }, 2000);
      return;
    }

    btn.textContent = 'Rescan Page';
    btn.classList.remove('loading');
    btn.disabled = false;
  }

  renderImageGrid() {
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '';
    grid.style.display = 'grid';

    for (let i = 0; i < this.scrapedImages.length; i++) {
      const img = this.scrapedImages[i];
      const item = document.createElement('div');
      item.className = 'image-grid-item';
      item.dataset.index = i;
      item.addEventListener('click', () => this.toggleImageSelection(i));

      const imgEl = document.createElement('img');
      imgEl.src = img.src;
      imgEl.alt = img.alt || '';
      imgEl.loading = 'lazy';
      item.appendChild(imgEl);

      const checkmark = document.createElement('span');
      checkmark.className = 'checkmark';
      checkmark.textContent = '\u2713';
      item.appendChild(checkmark);

      if (img.isVideo) {
        const badge = document.createElement('span');
        badge.className = 'video-badge';
        badge.textContent = 'VIDEO';
        item.appendChild(badge);
      }

      grid.appendChild(item);
    }

    document.getElementById('selection-bar').style.display = 'flex';
    this.updateSelectionCount();
  }

  toggleImageSelection(index) {
    if (this.selectedImages.has(index)) {
      this.selectedImages.delete(index);
    } else {
      if (this.selectedImages.size >= MAX_BATCH_SIZE) return;
      this.selectedImages.add(index);
    }

    const items = document.querySelectorAll('.image-grid-item');
    items[index].classList.toggle('selected');
    this.updateSelectionCount();
  }

  handleSelectAll() {
    const max = Math.min(this.scrapedImages.length, MAX_BATCH_SIZE);
    this.selectedImages.clear();
    for (let i = 0; i < max; i++) {
      this.selectedImages.add(i);
    }
    document.querySelectorAll('.image-grid-item').forEach((item, i) => {
      item.classList.toggle('selected', this.selectedImages.has(i));
    });
    this.updateSelectionCount();
  }

  handleDeselectAll() {
    this.selectedImages.clear();
    document.querySelectorAll('.image-grid-item').forEach(item => {
      item.classList.remove('selected');
    });
    this.updateSelectionCount();
  }

  updateSelectionCount() {
    document.getElementById('selection-count').textContent = this.selectedImages.size + ' selected';
    document.getElementById('add-selected-btn').disabled = this.selectedImages.size === 0;
  }

  async handleAddSelected() {
    const profile = this.profiles.find(p => p.id === this.activeProfileId);
    if (!profile) {
      alert('Please select an active profile first.');
      return;
    }

    const btn = document.getElementById('add-selected-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    const config = await this.getConfig();

    const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
    let jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    for (const index of this.selectedImages) {
      if (jobs.length >= MAX_BATCH_SIZE) break;

      const img = this.scrapedImages[index];
      jobs.push({
        jobId: crypto.randomUUID(),
        mediaType: img.isVideo ? 'video' : 'image',
        mediaUrl: img.src,
        title: tab ? tab.title || '' : '',
        description: profile.description,
        hashtags: profile.hashtags,
        websiteUrl: profile.websiteUrl,
        sourcePageUrl: tab ? tab.url : '',
        sourceTabId: tab ? tab.id : 0,
        status: 'pending',
        selectors: config.selectors,
        timing: config.timing,
        thumbnailUrl: img.src,
        createdAt: Date.now(),
      });
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });
    this.pendingJobs = jobs;
    this.renderQueue();

    chrome.action.setBadgeText({ text: String(jobs.length) });

    btn.textContent = 'Added!';
    setTimeout(() => {
      btn.textContent = 'Add to Queue (max 25)';
      btn.disabled = false;
    }, 1500);

    this.selectedImages.clear();
    document.querySelectorAll('.image-grid-item').forEach(item => {
      item.classList.remove('selected');
    });
    this.updateSelectionCount();
  }

  async getConfig() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.REMOTE_CONFIG);
    return data[STORAGE_KEYS.REMOTE_CONFIG] || DEFAULT_CONFIG;
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
    document.getElementById('setting-show-toasts').checked = this.settings.showToasts;
  }

  renderQueue() {
    const section = document.getElementById('queue-section');
    const list = document.getElementById('queue-list');
    const count = document.getElementById('queue-count');
    const runBtn = document.getElementById('run-queue-btn');
    const clearBtn = document.getElementById('clear-queue-btn');
    const progressDiv = document.getElementById('queue-progress');

    if (this.pendingJobs.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    count.textContent = this.pendingJobs.length;
    runBtn.disabled = this.pendingJobs.length === 0 || this.isQueueRunning;
    clearBtn.style.display = this.pendingJobs.length > 0 ? 'block' : 'none';

    list.innerHTML = '';
    for (const job of this.pendingJobs) {
      const item = document.createElement('div');
      item.className = 'queue-item';

      let thumbHtml = '';
      if (job.thumbnailUrl) {
        thumbHtml = `<img class="queue-item-thumb" src="${escapeHtml(job.thumbnailUrl)}" alt="">`;
      }

      item.innerHTML = `
        ${thumbHtml}
        <span class="queue-item-status ${job.status}"></span>
        <span class="queue-item-name">${escapeHtml(job.filename || job.mediaUrl.split('/').pop().split('?')[0] || 'Pending')}</span>
      `;
      list.appendChild(item);
    }

    progressDiv.style.display = this.isQueueRunning ? 'block' : 'none';
  }

  async handleSaveProfile() {
    this.clearErrors();
    const name = document.getElementById('profile-name').value.trim();
    const description = document.getElementById('profile-description').value.trim();
    const hashtagsRaw = document.getElementById('profile-hashtags').value.trim();
    let websiteUrl = document.getElementById('profile-website').value.trim();
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) {
      websiteUrl = 'https://' + websiteUrl;
    }
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
      try { new URL(websiteUrl); } catch { this.showInlineError('url-error', 'Invalid URL'); hasError = true; }
    }
    if (hasError) return;

    let profile;
    if (this.editingProfileId) {
      profile = this.profiles.find(p => p.id === this.editingProfileId);
      if (!profile) return;
      Object.assign(profile, { name, description, hashtags, websiteUrl, updatedAt: Date.now() });
    } else {
      profile = createProfile({ name, description, hashtags, websiteUrl });
      this.profiles.push(profile);
    }

    if (!validateProfile(profile)) {
      this.showInlineError('name-error', 'Invalid profile data');
      return;
    }

    await chrome.runtime.sendMessage({ type: MSG_TYPES.SAVE_PROFILE, profile });
    await this.loadState();
    this.renderActiveProfile();
    this.renderProfileList();
    this.resetForm();
  }

  async handleDeleteProfile(id) {
    await chrome.runtime.sendMessage({ type: MSG_TYPES.DELETE_PROFILE, profileId: id });
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
    document.getElementById('profile-form').style.display = 'flex';
    document.getElementById('form-arrow').innerHTML = '&#9660;';
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
    await chrome.runtime.sendMessage({ type: MSG_TYPES.SET_ACTIVE_PROFILE, profileId: id || null });
    this.activeProfileId = id || null;
    this.renderProfileList();
  }

  async handleSettingsChange() {
    const url = document.getElementById('remote-config-url').value.trim();
    const newSettings = {
      remoteConfigUrl: url || DEFAULT_SETTINGS.remoteConfigUrl,
      autoCloseTab: true,
      showToasts: document.getElementById('setting-show-toasts').checked,
      batchMode: true,
    };
    if (!validateSettings(newSettings)) return;
    this.settings = newSettings;
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
  }

  async handleForceSyncConfig() {
    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = 'Syncing...';
    const response = await chrome.runtime.sendMessage({ type: MSG_TYPES.FORCE_CONFIG_SYNC });
    if (response && response.success) {
      statusEl.textContent = 'Synced';
      await this.loadState();
    } else {
      statusEl.textContent = 'Sync failed';
    }
  }

  async handleRunQueue() {
    if (this.isQueueRunning) return;
    this.isQueueRunning = true;
    this.renderQueue();
    await chrome.runtime.sendMessage({ type: MSG_TYPES.START_BATCH_QUEUE });
  }

  async handleClearQueue() {
    await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: [] });
    this.pendingJobs = [];
    this.renderQueue();
    chrome.action.setBadgeText({ text: '' });
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
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
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