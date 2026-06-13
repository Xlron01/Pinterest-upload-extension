var MSG_TYPES = {
  START_PIN_JOB: 'START_PIN_JOB',
  JOB_STATUS_UPDATE: 'JOB_STATUS_UPDATE',
  SHOW_TOAST: 'SHOW_TOAST',
  GET_STATE: 'GET_STATE',
  SAVE_PROFILE: 'SAVE_PROFILE',
  DELETE_PROFILE: 'DELETE_PROFILE',
  SET_ACTIVE_PROFILE: 'SET_ACTIVE_PROFILE',
  FORCE_CONFIG_SYNC: 'FORCE_CONFIG_SYNC',
  STATE_UPDATED: 'STATE_UPDATED',
};

var Humanizer = window.PinFlowHumanizer;

var DEFAULT_TIMING = {
  typingMinMs: 50,
  typingMaxMs: 150,
  wordPauseMs: 300,
  stepMinMs: 1000,
  stepMaxMs: 2500,
  uploadWaitMs: 3000,
  publishWaitMs: 2000,
};

function getTiming() {
  return Humanizer._cfg || DEFAULT_TIMING;
}

var FIELD_SELECTORS = {
  fileInput: [
    '[data-test-id="storyboard-upload-input"]',
    'input[type="file"]',
    'input[accept*="image"]',
    'input[accept*="video"]',
  ],
  titleInput: [
    '[data-test-id="storyboard-selector-title"]',
    '#storyboard-selector-title',
    'input[name*="title"]',
    'input[placeholder*="title" i]',
    'input[aria-label*="title" i]',
  ],
  websiteInput: [
    '#WebsiteField',
    '[data-test-id="website-field"]',
    'input[name*="website"]',
    'input[placeholder*="website" i]',
    'input[placeholder*="link" i]',
    'input[aria-label*="website" i]',
    'input[aria-label*="link" i]',
    'input[placeholder*="URL" i]',
    'input[placeholder*="url" i]',
    'input[placeholder*="رابط" i]',
  ],
  descriptionBox: [
    // الأولوية: المحدد الأكثر استقراراً بالـ data-test-id
    '[data-test-id="storyboard-description-field-container"] [contenteditable="true"]',
    '[data-test-id="editor-with-mentions"] [contenteditable="true"]',
    '[data-test-id="comment-editor-container"] .public-DraftEditor-content[contenteditable="true"]',
    // النصوص العربية الممكنة (تتغير حسب locale)
    'div[contenteditable="true"][aria-label="أضف وصفًا مفصلاً"]',
    'div[contenteditable="true"][aria-label="إضافة وصف مفصل"]',
    'div[contenteditable="true"][aria-label*="وصف"]',
    // الـ fallback العام
    '.public-DraftEditor-content[contenteditable="true"][role="combobox"]',
    '[role="combobox"][contenteditable="true"].notranslate',
    '[contenteditable="true"][aria-label*="description" i]',
  ],
  tagsInput: [
    '#combobox-storyboard-interest-tags',
    '[data-test-id="storyboard-interest-tags"]',
    'input[placeholder*="tag" i]',
    'input[placeholder*="search topic" i]',
    'input[aria-label*="tag" i]',
    'input[aria-label*="topic" i]',
    'input[role="combobox"][aria-autocomplete="list"]',
    'input[role="combobox"]',
  ],
  publishButton: [
    '[data-test-id="storyboard-creation-nav-done"] button',
    '[data-test-id*="save"] button',
    '[data-test-id*="storyboard-creation-nav-done"] button',
  ],
};

console.log('[PinFlow] Pin-Builder content script loaded');

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'PING') {
    console.log('[PinFlow] PING received, responding');
    sendResponse({ pong: true });
    return;
  }

  if (msg.type === MSG_TYPES.START_PIN_JOB) {
    console.log('[PinFlow] START_PIN_JOB received', msg.job);
    runPinJob(msg.job).then(function (result) {
      console.log('[PinFlow] Job result:', result);
      sendResponse(result);
    }).catch(function (err) {
      console.error('[PinFlow] Job error:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true;
  }
});

async function runPinJob(job) {
  try {
    console.log('[PinFlow] Starting pin job for:', job.filename);
    updateStatus(job.jobId, 'uploading');

    Humanizer.setTimingConfig(job.timing);

    // Initial delay to allow Pinterest's React app to fully render
    console.log('[PinFlow] Waiting 2000ms for initial React render...');
    await Humanizer.delay(2000);

    var file = base64ToFile(job.mediaBuffer, job.filename, job.mimeType);
    console.log('[PinFlow] File created:', file.name, file.type, file.size, 'bytes');

    var uploadInput = await findElement(FIELD_SELECTORS.fileInput, 30000);
    if (!uploadInput) throw new Error('Upload input not found');
    await doFileUpload(uploadInput, file);
    console.log('[PinFlow] File uploaded, waiting for Pinterest to process...');

    // ← الإصلاح 1: استبدال الانتظار الثابت بمراقبة ديناميكية لاكتمال الرفع
    var uploadMaxWait = (job.timing && job.timing.uploadWaitMs) ? Math.max(job.timing.uploadWaitMs, 8000) : 12000;
    await waitForUploadToComplete(uploadMaxWait);
    await Humanizer.delay(job.timing.stepMinMs || 800);

    updateStatus(job.jobId, 'filling');
    console.log('[PinFlow] === Starting field fill phase ===');

    var usedElements = [];

    var titleEl = await findDistinctElement(FIELD_SELECTORS.titleInput, usedElements, 8000);
    if (titleEl) {
      console.log('[PinFlow] Title field FOUND:', titleEl.selector);
      await fillInputElement(titleEl.element, job.title);
      usedElements.push(titleEl.element);
      await Humanizer.delay(job.timing.stepMinMs);
    } else {
      console.warn('[PinFlow] Title field NOT found');
    }

    var websiteEl = await findDistinctElement(FIELD_SELECTORS.websiteInput, usedElements, 5000);
    if (websiteEl) {
      console.log('[PinFlow] Website field FOUND:', websiteEl.selector);
      await fillInputElement(websiteEl.element, job.websiteUrl);
      usedElements.push(websiteEl.element);
      await Humanizer.delay(job.timing.stepMinMs);
    } else {
      console.warn('[PinFlow] Website field NOT found');
    }

    var descEl = await findDistinctElement(FIELD_SELECTORS.descriptionBox, usedElements, 5000);
    if (descEl) {
      console.log('[PinFlow] Description field FOUND:', descEl.selector);
      await fillContentEditable(descEl.element, job.description || '');
      usedElements.push(descEl.element);
      await Humanizer.delay(job.timing.stepMinMs);
    } else {
      console.warn('[PinFlow] Description field NOT found');
    }

    var tagsEl = await findDistinctElement(FIELD_SELECTORS.tagsInput, usedElements, 5000);
    if (tagsEl && job.hashtags && job.hashtags.length > 0) {
      console.log('[PinFlow] Tags field FOUND:', tagsEl.selector);
      var cleanTags = (job.hashtags || []).map(function (t) { return t.replace(/^#/, ''); }).filter(function (t) { return t.length > 0; });
      await fillTagsField(tagsEl.element, cleanTags);
      usedElements.push(tagsEl.element);
      await Humanizer.delay(job.timing.stepMinMs);
    } else {
      console.warn('[PinFlow] Tags field NOT found or no hashtags');
    }

    updateStatus(job.jobId, 'publishing');
    console.log('[PinFlow] Looking for publish button...');
    var publishBtn = await findPublishButton(10000);
    console.log('[PinFlow] Publish button found, clicking...', publishBtn);
    await Humanizer.humanClick(publishBtn);

    var publishResult = await waitForPublishToComplete();
    console.log('[PinFlow] Publish result:', publishResult);

    updateStatus(job.jobId, 'done');
    console.log('[PinFlow] Pin job completed successfully!');
    return { success: true };
  } catch (err) {
    console.error('[PinFlow] Pin job failed:', err.message || err);
    updateStatus(job.jobId, 'error', err.message || String(err));
    return { success: false, error: err.message || String(err) };
  }
}

function base64ToFile(base64, filename, mimeType) {
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  var blob = new Blob([bytes], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}

async function doFileUpload(input, file) {
  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[PinFlow] File dispatched to input');
}

async function fillInputElement(el, value) {
  if (!value) return;

  el.focus();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await Humanizer.delay(50);

  var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  if (nativeSetter) {
    nativeSetter.set.call(el, '');
  } else {
    el.value = '';
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));

  await Humanizer.delay(30);

  for (var i = 0; i < value.length; i++) {
    var ch = value[i];
    if (nativeSetter) {
      nativeSetter.set.call(el, el.value + ch);
    } else {
      el.value += ch;
    }
el.dispatchEvent(new Event('input', { bubbles: true }));
      await Humanizer.delay(getTiming().typingMinMs);
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  console.log('[PinFlow] INPUT field filled. Final value:', el.value);
}

async function fillContentEditable(el, value) {
  if (!value) return;

  var innerSpan = el.querySelector('span[data-offset-key]');

  el.focus();
  await Humanizer.delay(30);

  var selection = window.getSelection();
  var range = document.createRange();

  if (innerSpan) {
    console.log('[PinFlow] Description: using inner span approach');
    range.selectNodeContents(innerSpan);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, value);
  } else {
    console.log('[PinFlow] Description: no inner span, using direct approach');
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, value);
  }

  el.blur();
  await Humanizer.delay(30);

  console.log('[PinFlow] Description filled. Text length:', (el.textContent || '').length);
}

async function fillTagsField(el, tags) {
  if (!tags || tags.length === 0) return;

  console.log('[PinFlow] Filling tags:', tags.join(', '));

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await Humanizer.delay(30);

  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i].trim();
    if (!tag) continue;

    console.log('[PinFlow] === Typing tag ' + (i + 1) + '/' + tags.length + ':', tag);

    el.focus();
    await Humanizer.delay(30);

    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (nativeSetter) {
      nativeSetter.set.call(el, '');
    } else {
      el.value = '';
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));

    for (var j = 0; j < tag.length; j++) {
      var ch = tag[j];
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true, cancelable: true }));
      if (nativeSetter) {
        nativeSetter.set.call(el, el.value + ch);
      } else {
        el.value += ch;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true }));
      await Humanizer.delay(getTiming().typingMinMs);
    }

    console.log('[PinFlow] Typed tag text, waiting for dropdown...');
    await Humanizer.delay(500);

    var suggestionClicked = await findAndClickFirstSuggestion(el);
    if (suggestionClicked) {
      console.log('[PinFlow] Tag suggestion clicked for:', tag);
    } else {
      console.log('[PinFlow] No suggestion found for tag: "' + tag + '" - skipping');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }

    await Humanizer.delay(200);
  }

  el.blur();
  console.log('[PinFlow] Tags fill completed');
}

async function findAndClickFirstSuggestion(inputEl) {
  var container = inputEl.closest('[class*="combobox"], [class*="Combobox"], [role="combobox"]');
  if (!container) {
    container = inputEl.parentElement;
  }

  for (var attempt = 0; attempt < 3; attempt++) {
    var lists = document.querySelectorAll('[role="listbox"]');
    for (var li = 0; li < lists.length; li++) {
      var list = lists[li];
      if (!isVisible(list)) continue;

      var options = list.querySelectorAll('[role="option"]');
      if (options.length > 0) {
        var firstOption = options[0];
        if (isVisible(firstOption)) {
          console.log('[PinFlow] Clicking first suggestion:', (firstOption.textContent || '').trim().substring(0, 50));
          firstOption.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          await Humanizer.delay(10);
          await Humanizer.humanClick(firstOption);
          return true;
        }
      }

      var items = list.querySelectorAll('li');
      if (items.length > 0 && isVisible(items[0])) {
        console.log('[PinFlow] Clicking first li suggestion:', (items[0].textContent || '').trim().substring(0, 50));
        items[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await Humanizer.delay(10);
        await Humanizer.humanClick(items[0]);
        return true;
      }
    }

    var allOptions = document.querySelectorAll('[role="option"]');
    var visibleOptions = [];
    for (var k = 0; k < allOptions.length; k++) {
      if (isVisible(allOptions[k])) {
        visibleOptions.push(allOptions[k]);
      }
    }
    if (visibleOptions.length > 0) {
      console.log('[PinFlow] Clicking visible option:', (visibleOptions[0].textContent || '').trim().substring(0, 50));
      visibleOptions[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await Humanizer.delay(10);
      await Humanizer.humanClick(visibleOptions[0]);
      return true;
    }

    if (attempt < 2) {
      console.log('[PinFlow] No suggestions found, retrying... (attempt ' + (attempt + 1) + ')');
      await Humanizer.delay(300);
    }
  }

  console.log('[PinFlow] No suggestions found after all attempts');
  return false;
}

async function findPublishButton(timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  var start = Date.now();

  while (Date.now() - start < timeoutMs) {
    for (var s = 0; s < FIELD_SELECTORS.publishButton.length; s++) {
      var el = document.querySelector(FIELD_SELECTORS.publishButton[s]);
      if (el && isVisible(el)) {
        console.log('[PinFlow] Publish button found via:', FIELD_SELECTORS.publishButton[s]);
        return el;
      }
    }

    var buttons = [].slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (!isVisible(b)) continue;

      var text = (b.textContent || '').trim().toLowerCase();
      var ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
      var testId = (b.getAttribute('data-test-id') || '').toLowerCase();

      if (text === 'نشر' || text === 'publish' || text === 'save' ||
          ariaLabel.indexOf('save') !== -1 || ariaLabel.indexOf('publish') !== -1 ||
          testId.indexOf('save') !== -1 || testId.indexOf('publish') !== -1 ||
          testId.indexOf('done') !== -1) {
        console.log('[PinFlow] Publish button found via fallback:', text || ariaLabel || testId);
        return b;
      }
    }

    var publishDiv = document.querySelector('[data-test-id="storyboard-creation-nav-done"]');
    if (publishDiv) {
      var btn = publishDiv.querySelector('button');
      if (btn && isVisible(btn)) {
        console.log('[PinFlow] Publish button found via storyboard-creation-nav-done');
        return btn;
      }
    }

    await Humanizer.delay(500);
  }

  throw new Error('Publish button not found within timeout');
}

function findElement(selectorsList, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function (resolve) {
    var result = tryFindElement(selectorsList);
    if (result) {
      console.log('[PinFlow] Element found immediately:', result.selector);
      return resolve(result.element);
    }

    var observer = new MutationObserver(function () {
      var result = tryFindElement(selectorsList);
      if (result) {
        console.log('[PinFlow] Element found via observer:', result.selector);
        observer.disconnect();
        resolve(result.element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(function () {
      observer.disconnect();
      var result = tryFindElement(selectorsList);
      if (result) {
        console.log('[PinFlow] Element found on timeout:', result.selector);
        resolve(result.element);
      } else {
        console.warn('[PinFlow] Element NOT found. Tried:', selectorsList);
        resolve(null);
      }
    }, timeoutMs);
  });
}

function findDistinctElement(selectorsList, excludeElements, timeoutMs) {
  return findElement(selectorsList, timeoutMs).then(function (el) {
    if (!el) return null;

    for (var i = 0; i < excludeElements.length; i++) {
      if (excludeElements[i] === el) {
        console.warn('[PinFlow] Found element already used for another field, skipping');
        return null;
      }
    }

    return { element: el, selector: 'distinct' };
  });
}

function tryFindElement(selectorsList) {
  for (var i = 0; i < selectorsList.length; i++) {
    var el = document.querySelector(selectorsList[i]);
    if (el) {
      return { element: el, selector: selectorsList[i] };
    }
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  var style = window.getComputedStyle(el);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity) > 0 &&
    (el.offsetWidth > 0 || el.offsetHeight > 0);
}

function updateStatus(jobId, status, error) {
  chrome.runtime.sendMessage({
    type: MSG_TYPES.JOB_STATUS_UPDATE,
    jobId: jobId,
    status: status,
    error: error || undefined,
  }).catch(function () {});
}

/**
 * waitForUploadToComplete(timeoutMs)
 * يراقب الـ DOM ديناميكياً حتى تظهر إشارة نجاح رفع الصورة،
 * بدلاً من الانتظار الثابت uploadWaitMs.
 */
function waitForUploadToComplete(timeoutMs) {
  timeoutMs = timeoutMs || 12000;
  var UPLOAD_SUCCESS_SELECTORS = [
    '[data-test-id="storyboard-thumbnail"]',
    '[data-test-id="story-pin-image-block"]',
    '[data-test-id="storyboard-pin-card"]',
    '[data-test-id="storyboard-draft-rep"]',
    // مؤشر بديل: ظهور حقل العنوان يعني Pinterest جاهز
    '#storyboard-selector-title',
  ];

  console.log('[PinFlow] Waiting dynamically for upload completion...');

  return new Promise(function (resolve) {
    // فحص فوري — قد تكون الصورة رُفعت بالفعل
    for (var i = 0; i < UPLOAD_SUCCESS_SELECTORS.length; i++) {
      var el = document.querySelector(UPLOAD_SUCCESS_SELECTORS[i]);
      if (el && isVisible(el)) {
        console.log('[PinFlow] Upload already complete, found:', UPLOAD_SUCCESS_SELECTORS[i]);
        return resolve('immediate');
      }
    }

    var observer = new MutationObserver(function () {
      for (var i = 0; i < UPLOAD_SUCCESS_SELECTORS.length; i++) {
        var el = document.querySelector(UPLOAD_SUCCESS_SELECTORS[i]);
        if (el && isVisible(el)) {
          console.log('[PinFlow] Upload complete detected via observer:', UPLOAD_SUCCESS_SELECTORS[i]);
          observer.disconnect();
          clearTimeout(uploadTimeout);
          resolve('observer');
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    var uploadTimeout = setTimeout(function () {
      observer.disconnect();
      console.warn('[PinFlow] Upload timeout reached, proceeding anyway...');
      resolve('timeout');
    }, timeoutMs);
  });
}

/**
 * waitForPublishToComplete()
 * الإصلاح الشامل: مراقبة متعددة الإشارات لضمان عدم غلق التبويب
 * قبل اكتمال النشر الفعلي على السيرفر.
 *
 * الإشارات المراقبة (بالترتيب):
 *   1. نص "جاري النشر" يظهر ثم يختفي في الـ DOM
 *   2. اختفاء [data-test-id="drafts-container"] كلياً (يختفي بعد النشر)
 *   3. تغيير الـ URL إلى /created/ أو /pins/ (إعادة توجيه ما بعد النشر)
 *   4. ظهور عنصر يحمل saving-status-saved
 *   5. حد أقصى آمن 35 ثانية — لا يُغلق التبويب أبداً قبلها في حالة الفشل
 */
function waitForPublishToComplete() {
  return new Promise(function (resolve) {
    console.log('[PinFlow] *** Publish guardian started — tab will NOT close until confirmed ***');

    var resolved = false;
    var startedPublishing = false;
    var startTime = Date.now();

    // الحد الأقصى المطلق: 35 ثانية
    var ABSOLUTE_MAX_MS = 35000;
    // الحد الأدنى الآمن بعد الضغط على الزر: 3 ثوانٍ دائماً
    var SAFE_MIN_MS = 3000;

    function done(reason) {
      if (resolved) return;
      var elapsed = Date.now() - startTime;
      // ضمان الحد الأدنى الآمن دائماً
      var remainingMin = Math.max(0, SAFE_MIN_MS - elapsed);
      setTimeout(function () {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        clearInterval(pollInterval);
        clearTimeout(absoluteTimeout);
        console.log('[PinFlow] Publish complete! Reason:', reason, '| Elapsed:', (Date.now() - startTime) + 'ms');
        resolve(reason);
      }, remainingMin);
    }

    // الإشارة 1+2: MutationObserver يراقب نص النشر واختفاء drafts-container
    var observer = new MutationObserver(function () {
      // الإشارة 4: عنصر saving-status-saved ظهر
      if (document.querySelector('[data-test-id="saving-status-saved"]')) {
        console.log('[PinFlow] Signal: saving-status-saved appeared!');
        startedPublishing = true;
        done('saving-status-saved');
        return;
      }

      var draftsContainer = document.querySelector('[data-test-id="drafts-container"]');

      if (!draftsContainer) {
        if (startedPublishing) {
          console.log('[PinFlow] Signal: drafts-container disappeared after publishing started!');
          done('drafts-container-gone');
        }
        return;
      }

      var text = (draftsContainer.innerText || '').toLowerCase();
      var publishingKeywords = [
        'جاري النشر', 'publishing', 'saving', 'creating', 'uploading'
      ];

      var hasPublishingText = publishingKeywords.some(function (kw) {
        return text.indexOf(kw) !== -1;
      });

      if (!startedPublishing && hasPublishingText) {
        startedPublishing = true;
        console.log('[PinFlow] Signal: Publishing text detected in DOM!');
      }

      if (startedPublishing && !hasPublishingText) {
        console.log('[PinFlow] Signal: Publishing text disappeared — server confirmed done!');
        done('publishing-text-gone');
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // الإشارة 1+2+3+4 عبر polling كل 500ms
    var pollInterval = setInterval(function () {
      if (resolved) { clearInterval(pollInterval); return; }

      // الإشارة 3: تغيير URL — Pinterest يعيد توجيه لصفحة الدبوس الجديد بعد النشر
      var url = window.location.href;
      if (url.indexOf('/pin-creation-tool') === -1) {
        console.log('[PinFlow] Signal: URL changed away from pin-creation-tool:', url);
        startedPublishing = true;
        done('url-changed');
        return;
      }

      // الإشارة 4
      if (document.querySelector('[data-test-id="saving-status-saved"]')) {
        console.log('[PinFlow] Signal (poll): saving-status-saved detected!');
        startedPublishing = true;
        done('saving-status-saved-poll');
        return;
      }

      // الإشارة 1+2
      var draftsContainer = document.querySelector('[data-test-id="drafts-container"]');
      if (!draftsContainer && startedPublishing) {
        console.log('[PinFlow] Signal (poll): drafts-container gone!');
        done('drafts-gone-poll');
        return;
      }

      if (draftsContainer) {
        var text = (draftsContainer.innerText || '').toLowerCase();
        if (!startedPublishing && (text.indexOf('جاري النشر') !== -1 || text.indexOf('publishing') !== -1)) {
          startedPublishing = true;
          console.log('[PinFlow] Signal (poll): Publishing text detected!');
        }
        if (startedPublishing && text.indexOf('جاري النشر') === -1 && text.indexOf('publishing') === -1) {
          console.log('[PinFlow] Signal (poll): Publishing text gone!');
          done('publishing-text-gone-poll');
        }
      }
    }, 500);

    // الحد الأقصى المطلق: بعد 35 ثانية يُفترض أن السيرفر استجاب
    var absoluteTimeout = setTimeout(function () {
      console.warn('[PinFlow] Absolute timeout (35s) reached. startedPublishing was:', startedPublishing);
      done('absolute-timeout');
    }, ABSOLUTE_MAX_MS);
  });
}