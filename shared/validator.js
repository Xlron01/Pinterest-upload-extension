import { SELECTOR_KEYS, DEFAULT_CONFIG } from './constants.js';

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;

  if (typeof profile.name !== 'string' || profile.name.length === 0 || profile.name.length > 50) return false;

  if (typeof profile.description !== 'string' || profile.description.length > 500) return false;

  if (!Array.isArray(profile.hashtags)) return false;
  if (profile.hashtags.length > 20) return false;
  for (const tag of profile.hashtags) {
    if (typeof tag !== 'string' || !tag.startsWith('#')) return false;
  }

  if (typeof profile.websiteUrl !== 'string') return false;
  try {
    new URL(profile.websiteUrl);
  } catch {
    return false;
  }

  if (profile.boardId !== null && typeof profile.boardId !== 'string') return false;

  return true;
}

export function validateRemoteConfig(config) {
  if (!config || typeof config !== 'object') return false;

  if (typeof config.version !== 'string') return false;
  if (typeof config.updatedAt !== 'string') return false;

  if (!config.selectors || typeof config.selectors !== 'object') return false;
  for (const key of SELECTOR_KEYS) {
    if (typeof config.selectors[key] !== 'string') return false;
  }

  if (!config.timing || typeof config.timing !== 'object') return false;
  for (const key of Object.keys(DEFAULT_CONFIG.timing)) {
    if (typeof config.timing[key] !== 'number' || config.timing[key] < 0) return false;
  }

  return true;
}

export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;

  if (typeof settings.remoteConfigUrl !== 'string') return false;
  try {
    new URL(settings.remoteConfigUrl);
  } catch {
    return false;
  }

  if (typeof settings.autoCloseTab !== 'boolean') return false;
  if (typeof settings.showToasts !== 'boolean') return false;
  if (typeof settings.batchMode !== 'boolean') return false;

  return true;
}

export function createProfile(partial) {
  const profile = {
    id: crypto.randomUUID(),
    name: partial.name || '',
    description: partial.description || '',
    hashtags: partial.hashtags || [],
    websiteUrl: partial.websiteUrl || '',
    boardId: partial.boardId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!validateProfile(profile)) {
    throw new Error('Invalid profile data');
  }

  return profile;
}

export function sanitizeHashtags(input) {
  if (typeof input !== 'string') return [];
  return input
    .split(/[,\s]+/)
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0)
    .map(tag => tag.startsWith('#') ? tag : '#' + tag)
    .slice(0, 20);
}