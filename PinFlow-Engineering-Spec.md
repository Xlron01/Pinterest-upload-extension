# PinFlow — Chrome Extension

## Full Engineering Specification
>
> Architecture · Data Contracts · Interfaces · Selectors  
> Manifest V3 · Chrome Extension · v1.0.0

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [File & Directory Structure](#2-file--directory-structure)
3. [manifest.json — Full Specification](#3-manifestjson--full-specification)
4. [Data Contracts & Interfaces](#4-data-contracts--interfaces)
5. [Service Worker](#5-service-worker--backgroundservice-workerjs)
6. [Content Script](#6-content-script--contentpin-builderjs)
7. [Humanizer Module](#7-humanizer-module--contenthumanizerjs)
8. [Toast Notification System](#8-toast-notification-system--contenttoastjs)
9. [Popup UI](#9-popup-ui--popuppopupjs)
10. [Remote Config JSON](#10-remote-config--hosted-json)
11. [Batch Mode Architecture](#11-batch-mode-architecture)
12. [Error Handling Strategy](#12-error-handling-strategy)
13. [Development Phases](#13-development-phases)
14. [Critical Engineering Rules](#14-critical-engineering-rules)

---

## 1. Project Overview

### 1.1 Vision

PinFlow is a Chrome Extension built on Manifest V3 that enables users to capture images or videos from any website via a right-click context menu, then automatically publish them to Pinterest as newly **created** Pins — not saved items. The extension mimics natural human interaction with Pinterest's pin-builder UI, injects metadata from reusable profiles, and provides real-time feedback without requiring the user to interact with the Pinterest tab.

### 1.2 Core Objectives

- Capture images/videos from any page via right-click context menu
- Publish to Pinterest as **created** Pins (not saved), with a destination URL
- Support single-image and batch-upload modes
- Auto-fill title, description, hashtags, and website link from saved Profiles
- Humanize all DOM interactions to avoid bot detection
- Operate with Remote Config so selectors can be updated without re-publishing to Chrome Web Store
- Provide unobtrusive Toast notifications on the source page

### 1.3 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Extension Standard | Chrome Manifest V3 | Required for Chrome Web Store; Service Worker model |
| Background | Service Worker (SW) | Handles CORS-free fetch, context menu, orchestration |
| Content Layer | Content Script | Injected into pinterest.com/pin-builder only |
| UI | Popup HTML + Vanilla JS | No framework needed; fast, lightweight |
| Config Storage | chrome.storage.local + Remote JSON | Local-first with remote sync for selector updates |
| Remote Config Host | GitHub Gist / Cloudflare Worker | Versioned JSON; zero-cost; CDN-cached |

---

## 2. File & Directory Structure

Every file has exactly one responsibility. No file may handle concerns from two layers.

```
pinflow/
├── manifest.json                 ← MV3 declaration (permissions, CSP, SW registration)
├── background/
│   ├── service-worker.js         ← Entry point: context menu + message router
│   ├── fetcher.js                ← CORS-safe image/video fetch → ArrayBuffer
│   ├── config-manager.js         ← Local storage read/write + remote sync
│   └── tab-manager.js            ← Open pinterest tab, inject CS, lifecycle
├── content/
│   ├── pin-builder.js            ← DOM automation on pinterest.com/pin-builder
│   ├── humanizer.js              ← Jitter delays, simulated typing, click events
│   └── toast.js                  ← Injected notification UI on source page
├── popup/
│   ├── popup.html
│   ├── popup.js                  ← Profile CRUD + active profile selector
│   └── popup.css
├── shared/
│   ├── constants.js              ← MSG_TYPES, STORAGE_KEYS, SELECTOR_KEYS
│   └── validator.js              ← Schema validation for profiles & remote config
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── remote/
    └── config.schema.json        ← JSON schema for remote config validation
```

---

## 3. manifest.json — Full Specification

```json
{
  "manifest_version": 3,
  "name": "PinFlow",
  "version": "1.0.0",
  "description": "One-click Pinterest pin creator from any image on the web",
  "permissions": [
    "contextMenus",
    "storage",
    "activeTab",
    "scripting",
    "tabs",
    "notifications"
  ],
  "host_permissions": [
    "<all_urls>",
    "https://www.pinterest.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": [
    
      "https://www.pinterest.com/pin-creation-tool/*"
    ],
    "js": ["content/humanizer.js", "content/pin-builder.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "assets/icon-16.png",
      "48": "assets/icon-48.png"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "web_accessible_resources": []
}
```

> **`<all_urls>` في host_permissions ضروري** حتى يتمكن الـ Service Worker من fetch الصور من أي موقع بدون أخطاء CORS.

---

## 4. Data Contracts & Interfaces

كل object يُمرَّر بين المكونات يجب أن يتطابق مع هذه الـ interfaces. يجب التحقق منها runtime عبر `validator.js`.

### 4.1 Profile Interface

```typescript
interface Profile {
  id:          string;    // UUID v4 — generated at creation
  name:        string;    // Display name, max 50 chars
  description: string;    // Pin description text, max 500 chars
  hashtags:    string[];  // e.g. ['#design', '#ui'] — max 20 items
  websiteUrl:  string;    // Must pass URL validation
  boardId:     string | null; // Reserved for future board selection
  createdAt:   number;    // Unix timestamp ms
  updatedAt:   number;    // Unix timestamp ms
}
```

### 4.2 PinJob Interface

```typescript
interface PinJob {
  jobId:         string;          // UUID v4
  mediaType:     'image' | 'video';
  mediaUrl:      string;          // Original URL from context menu
  mediaBuffer:   ArrayBuffer;     // Fetched bytes — set by SW fetcher
  mimeType:      string;          // e.g. 'image/jpeg'
  filename:      string;          // Derived from URL or 'pin-<timestamp>.jpg'
  title:         string;          // From page <title> or profile override
  description:   string;          // From active profile
  hashtags:      string[];        // From active profile
  websiteUrl:    string;          // From active profile
  sourcePageUrl: string;          // Tab URL where right-click occurred
  sourceTabId:   number;          // Chrome tab ID — for toast injection
  status:        JobStatus;
  createdAt:     number;
}

type JobStatus =
  | 'pending'       // Created, not yet started
  | 'fetching'      // SW downloading media
  | 'uploading'     // CS injecting file into Pinterest
  | 'filling'       // CS filling form fields
  | 'publishing'    // CS clicked publish button
  | 'done'          // Complete
  | 'error';        // Failed — check errorMessage
```

### 4.3 RemoteConfig Interface

```typescript
interface RemoteConfig {
  version:   string;        // Semver e.g. '1.2.0'
  updatedAt: string;        // ISO date string
  selectors: PinSelectors;
  timing:    TimingConfig;
}

interface PinSelectors {
  fileInput:      string;   // '[data-test-id="storyboard-upload-input"]'
  titleInput:     string;   // '#storyboard-selector-title'
  websiteInput:   string;   // '#WebsiteField'
  tagsInput:      string;   // '#combobox-storyboard-interest-tags'
  descriptionBox: string;   // '[role="textbox"]'
  publishButton:  string;   // resolved dynamically after image upload
}

interface TimingConfig {
  typingMinMs:   number;    // Default: 50   — min ms between keystrokes
  typingMaxMs:   number;    // Default: 150  — max ms between keystrokes
  wordPauseMs:   number;    // Default: 300  — extra pause after each word
  stepMinMs:     number;    // Default: 1000 — min ms between major steps
  stepMaxMs:     number;    // Default: 2500 — max ms between major steps
  uploadWaitMs:  number;    // Default: 3000 — wait for Pinterest to process upload
  publishWaitMs: number;    // Default: 2000 — wait after publish click
}
```

### 4.4 AppState Interface (chrome.storage.local)

```typescript
interface AppState {
  profiles:        Profile[];
  activeProfileId: string | null;
  remoteConfig:    RemoteConfig;
  configLastSync:  number;        // Unix timestamp of last sync
  pendingJobs:     PinJob[];      // Batch queue — max 10
  settings: {
    remoteConfigUrl: string;      // GitHub Gist raw URL
    autoCloseTab:    boolean;     // Close Pinterest tab when done
    showToasts:      boolean;
    batchMode:       boolean;
  };
}
```

### 4.5 Message Protocol

كل رسالة بين المكونات تستخدم `chrome.runtime.sendMessage` أو `chrome.tabs.sendMessage` وتلتزم بهذا الـ envelope:

```javascript
// shared/constants.js
const MSG_TYPES = {
  // SW → CS (pin-builder tab)
  START_PIN_JOB:      'START_PIN_JOB',
  // CS → SW
  JOB_STATUS_UPDATE:  'JOB_STATUS_UPDATE',
  // SW → CS (source tab)
  SHOW_TOAST:         'SHOW_TOAST',
  // Popup → SW
  GET_STATE:          'GET_STATE',
  SAVE_PROFILE:       'SAVE_PROFILE',
  DELETE_PROFILE:     'DELETE_PROFILE',
  SET_ACTIVE_PROFILE: 'SET_ACTIVE_PROFILE',
  FORCE_CONFIG_SYNC:  'FORCE_CONFIG_SYNC',
  // SW → Popup
  STATE_UPDATED:      'STATE_UPDATED',
};

// Standard response envelope — كل response يجب أن يتبع هذا
interface MsgResponse {
  success: boolean;
  data?:   any;
  error?:  string;
}
```

---

## 5. Service Worker — background/service-worker.js

الـ Service Worker هو المحرك الرئيسي. لا يلمس DOM أبداً. مسؤولياته الثلاث: context menu، جلب الميديا، توجيه الرسائل.

### 5.1 Initialization Flow

```javascript
// يعمل مرة واحدة عند تثبيت/تحديث الإضافة
chrome.runtime.onInstalled.addListener(async () => {
  await ConfigManager.initDefaults();    // ضبط القيم الافتراضية
  await ConfigManager.syncRemote();      // جلب الـ remote config
  ContextMenu.register();                // إنشاء قائمة الكليك يمين
});

// يعمل عند إعادة تشغيل المتصفح
chrome.runtime.onStartup.addListener(async () => {
  await ConfigManager.syncRemoteIfStale(); // sync لو مضى أكثر من 6 ساعات
  ContextMenu.register();
});
```

### 5.2 Context Menu Registration

```javascript
function register() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'PINFLOW_SEND',
      title:    'Pin to Pinterest 📌',
      contexts: ['image', 'video'],     // يظهر فقط عند الكليك يمين على صورة/فيديو
    });
    chrome.contextMenus.create({
      id:       'PINFLOW_BATCH_ADD',
      title:    'Add to Pin Queue 📋',
      contexts: ['image', 'video'],
    });
    chrome.contextMenus.create({
      id:       'PINFLOW_BATCH_RUN',
      title:    'Publish Queue Now 🚀',
      contexts: ['page'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'PINFLOW_SEND')       handleSinglePin(info, tab);
  if (info.menuItemId === 'PINFLOW_BATCH_ADD')  handleBatchAdd(info, tab);
  if (info.menuItemId === 'PINFLOW_BATCH_RUN')  handleBatchRun(tab);
});
```

### 5.3 handleSinglePin() — دالة التنسيق الرئيسية

```javascript
async function handleSinglePin(info, tab) {
  // 1. إظهار toast "جاري التجهيز" على التاب المصدر
  ToastBridge.send(tab.id, { status: 'fetching', message: 'جاري تجهيز الصورة...' });

  // 2. بناء PinJob
  const profile = await ConfigManager.getActiveProfile();
  const job = JobFactory.create({
    mediaUrl:      info.srcUrl,
    sourceTabId:   tab.id,
    sourcePageUrl: tab.url,
    pageTitle:     tab.title,
    profile,
  });

  // 3. جلب الميديا داخل SW (CORS-safe)
  const fetchResult = await Fetcher.fetchMedia(job.mediaUrl);
  if (!fetchResult.success) {
    ToastBridge.send(tab.id, { status: 'error', message: fetchResult.error });
    return;
  }
  job.mediaBuffer = fetchResult.buffer;
  job.mimeType    = fetchResult.mimeType;
  job.filename    = fetchResult.filename;
  job.status      = 'uploading';

  // 4. فتح تاب بينتريست في الخلفية
  const pinTab = await TabManager.openPinterest();

  // 5. انتظار إشارة الـ CS ثم إرسال الـ job
  await TabManager.waitForContentScript(pinTab.id);
  chrome.tabs.sendMessage(pinTab.id, {
    type: MSG_TYPES.START_PIN_JOB,
    job:  serializeJob(job),  // ArrayBuffer → Base64 لأن messages لا تدعم ArrayBuffer
  });
}
```

### 5.4 Fetcher Module — background/fetcher.js

```javascript
/**
 * fetchMedia(url)
 * يجلب الصورة/الفيديو من أي URL داخل الـ Service Worker.
 * الـ SW يتخطى CORS تلقائياً — لا حاجة لـ headers خاصة.
 */
async function fetchMedia(url) {
  try {
    const response = await fetch(url, {
      method:      'GET',
      credentials: 'omit',    // لا نرسل cookies أبداً
      cache:       'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer   = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || guessMime(url);
    const filename = deriveFilename(url, mimeType);

    return { success: true, buffer, mimeType, filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function guessMime(url) {
  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp', mp4: 'video/mp4',
  };
  return map[ext] || 'image/jpeg';
}

function deriveFilename(url, mimeType) {
  const fromUrl = url.split('/').pop().split('?')[0];
  if (fromUrl && fromUrl.includes('.')) return fromUrl;
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  return `pin-${Date.now()}.${ext}`;
}
```

### 5.5 ConfigManager — background/config-manager.js

```javascript
const STORAGE_KEYS = {
  PROFILES:         'profiles',
  ACTIVE_PROFILE:   'activeProfileId',
  REMOTE_CONFIG:    'remoteConfig',
  CONFIG_LAST_SYNC: 'configLastSync',
  PENDING_JOBS:     'pendingJobs',
  SETTINGS:         'settings',
};

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 ساعات

async function syncRemoteIfStale() {
  const { configLastSync } = await chrome.storage.local.get(STORAGE_KEYS.CONFIG_LAST_SYNC);
  if (!configLastSync || Date.now() - configLastSync > SYNC_INTERVAL_MS) {
    await syncRemote();
  }
}

async function syncRemote() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const url = settings?.remoteConfigUrl;
  if (!url) return;

  try {
    const res    = await fetch(url);
    const config = await res.json();
    if (!Validator.validateRemoteConfig(config)) throw new Error('Schema invalid');
    await chrome.storage.local.set({
      [STORAGE_KEYS.REMOTE_CONFIG]:    config,
      [STORAGE_KEYS.CONFIG_LAST_SYNC]: Date.now(),
    });
  } catch (err) {
    // الفشل صامت — نحتفظ بالـ config المحفوظة ولا نكسر الإضافة أبداً
    console.warn('[PinFlow] Remote config sync failed:', err.message);
  }
}
```

---

## 6. Content Script — content/pin-builder.js

يُحقن فقط في `pinterest.com/pin-builder` و `pinterest.com/pin-creation-tool`. مسؤول عن الـ DOM automation حصراً.

### 6.1 Pinterest DOM Selectors (محققة يونيو 2025)

| Field | Selector | Type | Stability |
|---|---|---|---|
| File Upload Input | `[data-test-id="storyboard-upload-input"]` | input[type=file] | 🟢 عالية — data-test-id |
| Title Input | `#storyboard-selector-title` | input | 🟢 عالية — ID ثابت |
| Website/Link Input | `#WebsiteField` | input | 🟢 عالية — ID ثابت |
| Hashtags/Tags Input | `#combobox-storyboard-interest-tags` | input | 🟢 عالية — ID ثابت |
| Description Box | `[role="textbox"]` | div (ProseMirror) | 🟡 متوسطة — role attr |
| Publish Button | `[data-test-id*="save"]` | button | 🔴 منخفضة — يظهر بعد الرفع |

> **ملاحظة:** زر النشر لا يظهر في DOM إلا بعد رفع صورة. يجب استخدام `findPublishButton()` التي تعمل بـ polling مع timeout.

### 6.2 Main Execution Flow — runPinJob()

```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG_TYPES.START_PIN_JOB) {
    runPinJob(msg.job).then(sendResponse);
    return true; // إبقاء القناة مفتوحة للـ async response
  }
});

async function runPinJob(job) {
  try {
    updateStatus('uploading');

    // الخطوة 1: تحويل Base64 → File object
    const file = base64ToFile(job.mediaBuffer, job.filename, job.mimeType);

    // الخطوة 2: حقن الملف في الـ input المخفي
    await uploadFile(file);

    // الخطوة 3: انتظار معالجة بينتريست للرفع
    await Humanizer.delay(job.timing.uploadWaitMs);
    updateStatus('filling');

    // الخطوة 4: ملء الحقول بطريقة بشرية
    await fillField(job.selectors.titleInput,     job.title);
    await fillField(job.selectors.websiteInput,   job.websiteUrl);
    await fillField(job.selectors.descriptionBox, buildDescription(job));
    await fillTagsField(job.selectors.tagsInput,  job.hashtags);

    // الخطوة 5: إيجاد زر النشر والضغط عليه
    updateStatus('publishing');
    const publishBtn = await findPublishButton(job.selectors);
    await Humanizer.humanClick(publishBtn);
    await Humanizer.delay(job.timing.publishWaitMs);

    updateStatus('done');
    return { success: true };

  } catch (err) {
    updateStatus('error', err.message);
    return { success: false, error: err.message };
  }
}
```

### 6.3 uploadFile()

```javascript
async function uploadFile(file) {
  const selectors = await getSelectors();
  const input     = document.querySelector(selectors.fileInput);
  if (!input) throw new Error('Upload input not found: ' + selectors.fileInput);

  // DataTransfer هي الطريقة الوحيدة الموثوقة لحقن File في input
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  // dispatch 'input' و 'change' معاً — React يستمع للاثنين
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

> **بينتريست يستخدم React SyntheticEvent.** بدون `bubbles: true` لن يُفعَّل الـ onChange handler وسيفشل الرفع بصمت.

### 6.4 fillField()

```javascript
// يتعامل مع <input> و div[role="textbox"] (ProseMirror)
async function fillField(selector, value) {
  const el = await waitForElement(selector, 5000);
  if (!el) throw new Error('Field not found: ' + selector);

  el.focus();
  await Humanizer.delay(200, 400);

  // مسح المحتوى الموجود
  if (el.tagName === 'INPUT') {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // ProseMirror / contenteditable
    document.execCommand('selectAll');
    document.execCommand('delete');
  }

  // كتابة كل حرف مع جيتر بشري
  const words = value.split(' ');
  for (const word of words) {
    for (const char of word) {
      await Humanizer.typeChar(el, char);
    }
    if (word !== words[words.length - 1]) {
      await Humanizer.typeChar(el, ' ');
      await Humanizer.wordPause();
    }
  }
}
```

### 6.5 findPublishButton()

```javascript
async function findPublishButton(selectors, timeoutMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // المحاولة الأولى: الـ selector من الـ remote config
    let btn = document.querySelector(selectors.publishButton);
    if (btn && isVisible(btn)) return btn;

    // الـ fallback: أي button يحتوي على 'save' في aria-label أو data-test-id
    const buttons = [...document.querySelectorAll('button')];
    btn = buttons.find(b =>
      b.getAttribute('aria-label')?.toLowerCase().includes('save') ||
      b.textContent.trim().toLowerCase().includes('save')         ||
      b.getAttribute('data-test-id')?.includes('save')
    );
    if (btn && isVisible(btn)) return btn;

    await Humanizer.delay(300);
  }
  throw new Error('Publish button not found within timeout');
}
```

---

## 7. Humanizer Module — content/humanizer.js

كل تفاعل مع الـ DOM يمر من هنا. ممنوع استخدام `setTimeout` مباشرة في `pin-builder.js`.

```javascript
const Humanizer = {

  /**
   * delay(min, max?)
   * ينتظر مدة عشوائية بين min و max.
   * لو مُرِّر min فقط، يضيف ±20% jitter تلقائياً.
   */
  delay(min, max) {
    const ms = max
      ? min + Math.random() * (max - min)
      : min * (0.8 + Math.random() * 0.4);
    return new Promise(r => setTimeout(r, Math.round(ms)));
  },

  /**
   * typeChar(element, char)
   * يرسل: keydown → keypress → input → keyup لحرف واحد.
   * ثم ينتظر فترة عشوائية من الـ TimingConfig.
   */
  async typeChar(el, char) {
    const opts = {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown',  opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));

    if (el.tagName === 'INPUT') {
      el.value += char;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
    } else {
      document.execCommand('insertText', false, char);
    }

    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    await this.delay(this.cfg.typingMinMs, this.cfg.typingMaxMs);
  },

  /**
   * wordPause()
   * توقف إضافي بعد كل كلمة — يحاكي الإيقاع الطبيعي للكتابة.
   */
  async wordPause() {
    await this.delay(this.cfg.wordPauseMs * 0.7, this.cfg.wordPauseMs * 1.3);
  },

  /**
   * humanClick(element)
   * يحرك "الفأرة" نحو العنصر، ينتظر، ثم يضغط.
   * يرسل: mouseover → mouseenter → mousedown → mouseup → click
   */
  async humanClick(el) {
    const rect = el.getBoundingClientRect();
    // نقطة ضغط عشوائية داخل العنصر (ليس دائماً المركز)
    const x    = rect.left + rect.width  * (0.3 + Math.random() * 0.4);
    const y    = rect.top  + rect.height * (0.3 + Math.random() * 0.4);
    const evOpts = { bubbles: true, clientX: x, clientY: y };

    el.dispatchEvent(new MouseEvent('mouseover',  evOpts));
    el.dispatchEvent(new MouseEvent('mouseenter', evOpts));
    await this.delay(80, 200);
    el.dispatchEvent(new MouseEvent('mousedown',  evOpts));
    await this.delay(50, 120);
    el.dispatchEvent(new MouseEvent('mouseup',    evOpts));
    el.dispatchEvent(new MouseEvent('click',      evOpts));
  },

};
```

---

## 8. Toast Notification System — content/toast.js

الـ Toasts تُحقن في التاب المصدر (حيث ضغط المستخدم يمين) — ليس في تاب بينتريست.

### 8.1 ToastMessage Interface

```typescript
interface ToastMessage {
  status:   'fetching' | 'uploading' | 'filling' | 'publishing' | 'done' | 'error';
  message:  string;
  duration?: number;  // ms، الافتراضي 4000. 'error' تبقى حتى يُغلقها المستخدم
}

const TOAST_CONFIG = {
  fetching:   { icon: '⏳', color: '#2D3561', bg: '#EEF2FF' },
  uploading:  { icon: '📤', color: '#0F7173', bg: '#ECFDF5' },
  filling:    { icon: '✏️',  color: '#0F7173', bg: '#ECFDF5' },
  publishing: { icon: '🚀', color: '#D97706', bg: '#FFFBEB' },
  done:       { icon: '🎉', color: '#059669', bg: '#ECFDF5' },
  error:      { icon: '❌', color: '#DC2626', bg: '#FEF2F2' },
};
```

### 8.2 Injection Strategy

```javascript
function showToast({ status, message, duration = 4000 }) {
  // Shadow DOM لعزل CSS تماماً عن صفحة المضيف
  let host = document.getElementById('pinflow-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pinflow-toast-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);
    const style = document.createElement('style');
    style.textContent = TOAST_CSS;
    shadow.appendChild(style);
  }
  // ... إضافة الـ toast element داخل shadow root
}
```

> **Shadow DOM ضروري** لضمان أن styles الـ toast لن تتعارض مع أي موقع بغض النظر عن CSS المستخدمة فيه.

---

## 9. Popup UI — popup/popup.js

### 9.1 أقسام الـ UI

- **Active Profile Selector** — dropdown لاختيار البروفايل النشط
- **Profile List** — تعديل/حذف البروفايلات الموجودة
- **New Profile Form** — name, description, hashtags, websiteUrl
- **Settings Panel** — remote config URL، toggles لـ autoClose/batchMode/toasts
- **Queue Status** — عدد الـ pending jobs + زر "Run Now" (batch mode)
- **Sync Status** — وقت آخر sync + زر "Force Sync"

### 9.2 Functions في popup.js

| Function | Returns | Description |
|---|---|---|
| `init()` | void | تحميل الـ state، render الـ UI، ربط الـ events |
| `renderProfiles(profiles)` | void | إعادة render قائمة البروفايلات |
| `handleSaveProfile(e)` | Promise\<void\> | التحقق من الـ form، إرسال SAVE_PROFILE للـ SW |
| `handleDeleteProfile(id)` | Promise\<void\> | إرسال DELETE_PROFILE، تحديث القائمة |
| `handleSetActive(id)` | Promise\<void\> | إرسال SET_ACTIVE_PROFILE للـ SW |
| `handleForceSyncConfig()` | Promise\<void\> | إرسال FORCE_CONFIG_SYNC، إظهار feedback |
| `parseHashtags(input)` | string[] | تقسيم الـ tags المفصولة بفاصلة/مسافة، توحيد الـ # |
| `showInlineError(fieldId, msg)` | void | إظهار خطأ تحقق تحت حقل معين |

---

## 10. Remote Config — Hosted JSON

يُستضاف على GitHub Gist (raw URL). الـ Service Worker يجلبه عند الـ startup وكل 6 ساعات.

```json
{
  "version":   "1.0.0",
  "updatedAt": "2025-06-12T00:00:00Z",
  "selectors": {
    "fileInput":      "[data-test-id=\"storyboard-upload-input\"]",
    "titleInput":     "#storyboard-selector-title",
    "websiteInput":   "#WebsiteField",
    "tagsInput":      "#combobox-storyboard-interest-tags",
    "descriptionBox": "[role=\"textbox\"]",
    "publishButton":  "[data-test-id*=\"save\"]"
  },
  "timing": {
    "typingMinMs":   50,
    "typingMaxMs":   150,
    "wordPauseMs":   300,
    "stepMinMs":     1000,
    "stepMaxMs":     2500,
    "uploadWaitMs":  3000,
    "publishWaitMs": 2000
  }
}
```

> إذا فشل الـ remote config أو كان invalid، الإضافة تستخدم آخر config محفوظة في `chrome.storage.local` صامتةً — **يجب ألا تكسر أبداً بسبب config issue.**

---

## 11. Batch Mode Architecture

### 11.1 كيف يعمل الـ Batch Mode

1. المستخدم يفعّل batch mode من الـ Popup settings
2. كل كليك يمين → "Add to Pin Queue" يضيف `PinJob` لـ `pendingJobs` في الـ storage
3. القائمة تظهر في الـ Popup مع badge على أيقونة الإضافة
4. المستخدم يضغط "Publish Queue Now" (من قائمة الكليك يمين أو الـ Popup)
5. الـ SW يعالج الـ jobs بشكل متسلسل — تاب بينتريست واحد، job واحد في كل مرة
6. كل job يُغلق التاب ويفتح جديداً (أو يعيد استخدامه لو `autoCloseTab = false`)
7. Toast على التاب المصدر: "جاري رفع 3 من 7..."

### 11.2 Queue Constraints

- الحد الأقصى: 10 jobs (مُطبَّق في `handleBatchAdd`)
- المعالجة متسلسلة دائماً — ممنوع parallel لتجنب rate limits بينتريست
- الـ jobs الفاشلة تبقى في القائمة بحالة `error` للـ retry اليدوي
- القائمة محفوظة في `chrome.storage.local` — تصمد بعد إعادة تشغيل المتصفح

---

## 12. Error Handling Strategy

| Error Type | Where Caught | Recovery Action |
|---|---|---|
| Fetch failed (CORS / 4xx / 5xx) | `Fetcher.fetchMedia()` | Toast error على التاب المصدر. Job يُحدَّد بـ 'error'. |
| Selector not found in DOM | `waitForElement()` timeout | Retry بالـ fallback selector. لو فشلا معاً → error toast. |
| Remote config invalid schema | `ConfigManager.syncRemote()` | الاحتفاظ بآخر config صالحة. Log تحذير صامت. |
| المستخدم يغلق تاب بينتريست | `chrome.tabs.onRemoved` listener | Job يُحدَّد بـ 'error'. Toast للمستخدم. |
| لا يوجد active profile | `handleSinglePin()` pre-check | فتح الـ Popup تلقائياً. إظهار تحذير inline. |
| زر النشر لم يظهر | `findPublishButton()` 8s timeout | throw → caught في `runPinJob` → error toast. |

---

## 13. Development Phases

| # | Phase | Deliverables | Dependencies |
|---|---|---|---|
| 1 | Foundation | manifest.json, constants.js, validator.js, basic popup shell | — |
| 2 | Service Worker Core | service-worker.js, fetcher.js, config-manager.js, tab-manager.js | Phase 1 |
| 3 | Content Script | pin-builder.js, humanizer.js — single image flow end-to-end | Phase 2 |
| 4 | Toast System | toast.js على التاب المصدر، كل 6 حالات | Phase 2 |
| 5 | Popup UI | Profile CRUD كامل، settings، sync status | Phase 2 |
| 6 | Batch Mode | Queue logic، batch context menu، sequential processor | Phase 3+4+5 |
| 7 | Remote Config | GitHub Gist setup، sync logic، schema validation، fallback | Phase 1 |
| 8 | QA & Hardening | Anti-bot timing tuning، error scenarios، selector resilience | كل الـ phases |

---

## 14. Critical Engineering Rules

كل مهندس في الفريق يلتزم بهذه القواعد بدون استثناء.

### DOM Rules

- **ممنوع** استخدام class-based selectors مثل `.VTVmV8` — تتغير مع كل React build
- **دائماً** اتبع هذا الترتيب: `data-test-id` > `ID` > `role` > `aria-label`
- **دائماً** استخدم `waitForElement()` مع timeout — لا تفترض أبداً أن عنصراً موجود
- **دائماً** dispatch events مع `{ bubbles: true }` وإلا React لن يستجيب

### Service Worker Rules

- الـ Service Workers في MV3 مؤقتة — **ممنوع** حفظ state في متغيرات JS. استخدم `chrome.storage.local`
- `ArrayBuffer` لا يمكن إرساله عبر `chrome.runtime.sendMessage` — حوّله لـ Base64 أولاً
- الـ SW لا يملك أي وصول للـ DOM — كل DOM work يحدث في الـ Content Script فقط

### Timing Rules

- **ممنوع** استخدام `setTimeout` مباشرة في `pin-builder.js` — استخدم `Humanizer.delay()` دائماً
- **ممنوع** تنفيذ عمليتين DOM في نفس الـ tick — دائماً `await` بين الخطوات
- حد أدنى 1 ثانية بين الخطوات الرئيسية (رفع → ملء → نشر)

### Error Handling Rules

- **ممنوع** ترك promise rejection بدون معالجة — لا تكسر الـ Service Worker أبداً
- **دائماً** لفّ `runPinJob()` في try/catch واستدعِ `updateStatus('error')` عند الفشل
- **ممنوع** إظهار خطأ في console.error بدون toast مقابل يراه المستخدم

### Config Rules

- **ممنوع** كتابة selector string hardcoded في ملفات JS — اقرأها دائماً من `remoteConfig.selectors`
- **دائماً** validate الـ remote config مقابل الـ schema قبل حفظه في storage
- سلسلة الـ fallback: `remoteConfig` → `cachedConfig` → `hardcoded defaults في constants.js`

---

*PinFlow Engineering Spec v1.0.0*
