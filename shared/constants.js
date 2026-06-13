export const MSG_TYPES = {
  START_PIN_JOB: 'START_PIN_JOB',
  JOB_STATUS_UPDATE: 'JOB_STATUS_UPDATE',
  SHOW_TOAST: 'SHOW_TOAST',
  GET_STATE: 'GET_STATE',
  SAVE_PROFILE: 'SAVE_PROFILE',
  DELETE_PROFILE: 'DELETE_PROFILE',
  SET_ACTIVE_PROFILE: 'SET_ACTIVE_PROFILE',
  FORCE_CONFIG_SYNC: 'FORCE_CONFIG_SYNC',
  STATE_UPDATED: 'STATE_UPDATED',
  SCRAPE_IMAGES: 'SCRAPE_IMAGES',
  START_BATCH_QUEUE: 'START_BATCH_QUEUE',
  QUEUE_PROGRESS: 'QUEUE_PROGRESS',
};

export const STORAGE_KEYS = {
  PROFILES: 'profiles',
  ACTIVE_PROFILE: 'activeProfileId',
  REMOTE_CONFIG: 'remoteConfig',
  CONFIG_LAST_SYNC: 'configLastSync',
  PENDING_JOBS: 'pendingJobs',
  SETTINGS: 'settings',
};

export const SELECTOR_KEYS = [
  'fileInput',
  'titleInput',
  'websiteInput',
  'tagsInput',
  'descriptionBox',
  'publishButton',
];

export const DEFAULT_CONFIG = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  selectors: {
    fileInput: '[data-test-id="storyboard-upload-input"]',
    titleInput: '#storyboard-selector-title',
    websiteInput: '#WebsiteField',
    tagsInput: '#combobox-storyboard-interest-tags',
    descriptionBox: '[role="textbox"]',
    publishButton: '[data-test-id*="save"]',
  },
  timing: {
    typingMinMs: 50,
    typingMaxMs: 120,
    wordPauseMs: 200,
    stepMinMs: 800,
    stepMaxMs: 1500,
    uploadWaitMs: 3000,
    publishWaitMs: 2000,
  },
};

export const DEFAULT_SETTINGS = {
  remoteConfigUrl: 'https://gist.githubusercontent.com/placeholder/pinflow-config.json',
  autoCloseTab: true,
  showToasts: true,
  batchMode: false,
};

export const JOB_STATUS = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  UPLOADING: 'uploading',
  FILLING: 'filling',
  PUBLISHING: 'publishing',
  DONE: 'done',
  ERROR: 'error',
};

export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const MAX_BATCH_SIZE = 25;

export const QUEUE_DELAY_MS = 5000;

export const AUTHOR_NAME = 'Ahmed Alghra';

export function filterTitle(title) {
  if (!title) return title;
  var result = title;
  result = result.replace(/\bby\b(.+?)\bon\b/gi, function () {
    return 'by ' + AUTHOR_NAME + ' on';
  });
  result = result.replace(/\bon\b.*/gi, ' on Memories Box Website');
  return result;
}