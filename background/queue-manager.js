import { STORAGE_KEYS, MSG_TYPES } from '../shared/constants.js';
import { ConfigManager } from './config-manager.js';
import { Fetcher } from './fetcher.js';
import { TabManager } from './tab-manager.js';

const TAB_CLOSE_DELAY_MS = 300;

export const queueManager = {
  async start() {
    await navigator.locks.request('pinflow_queue_lock', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        console.log('[PinFlow] Queue already running (locked), ignoring call.');
        return;
      }

      console.log('[PinFlow] Queue processing started');

      const data = await chrome.storage.local.get(STORAGE_KEYS.PENDING_JOBS);
      let jobs = data[STORAGE_KEYS.PENDING_JOBS] || [];

      if (jobs.length === 0) {
        return;
      }

      const settings = await ConfigManager.getSettings();
      const profile = await ConfigManager.getActiveProfile();
      const config = await ConfigManager.getConfig();
      const totalJobs = jobs.length;

      // افتح التاب مرة واحدة فقط قبل بدء السلسلة لمنع تكرار فتح النوافذ
      let pinTab = await TabManager.openPinterest();
      let tabNeedsNavigation = false;

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.status === 'done') continue;

        console.log('[PinFlow] Processing job ' + (i + 1) + '/' + totalJobs);

        // إذا كنا قد رفعنا صورة في الدورة السابقة، نحتاج للعودة لصفحة الرفع
        if (tabNeedsNavigation) {
          console.log('[PinFlow] Navigating tab back to pin builder for next job...');
          await chrome.tabs.update(pinTab.id, { url: 'https://www.pinterest.com/pin-creation-tool/' });
          await TabManager.waitForPageLoad(pinTab.id, 15000);
        }

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

        try {
          // تأكد من أن الـ content script جاهز
          await TabManager.waitForContentScript(pinTab.id, 20000);

          // حماية بمهلة أقصاها دقيقتان لمنع التجميد النهائي
          const response = await Promise.race([
            chrome.tabs.sendMessage(pinTab.id, {
              type: MSG_TYPES.START_PIN_JOB,
              job,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Content script timed out after 2 minutes')), 120000))
          ]);

          job.status = (response && response.success) ? 'done' : 'error';
          if (!response || !response.success) {
            job.errorMessage = (response && response.error) || 'Unknown error';
          }
        } catch (err) {
          console.error('[PinFlow] Job failed:', err);
          job.status = 'error';
          job.errorMessage = err.message || String(err);
        }

        await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_JOBS]: jobs });

        // نحدد أن التاب يحتاج تحديث للوظيفة القادمة
        tabNeedsNavigation = true;

        await new Promise(r => setTimeout(r, TAB_CLOSE_DELAY_MS));

        const remaining = jobs.filter(j => j.status !== 'done').length;
        chrome.action.setBadgeText({ text: String(remaining) });
      }

      // إغلاق التاب بعد انتهاء جميع الوظائف
      if (pinTab) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: pinTab.id },
            func: () => { window.onbeforeunload = null; }
          }).catch(() => { });
          await chrome.tabs.remove(pinTab.id);
        } catch (e) {
          console.warn('[PinFlow] Could not close tab:', e);
        }
      }

      console.log('[PinFlow] Queue processing complete');

      chrome.action.setBadgeText({ text: '' });
    });
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