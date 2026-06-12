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

    var file = base64ToFile(job.mediaBuffer, job.filename, job.mimeType);
    console.log('[PinFlow] File created:', file.name, file.type, file.size, 'bytes');

    await uploadFile(job.selectors.fileInput, file);
    console.log('[PinFlow] File uploaded, waiting for Pinterest to process...');

    await Humanizer.delay(job.timing.uploadWaitMs, job.timing.uploadWaitMs + 2000);
    updateStatus(job.jobId, 'filling');

    console.log('[PinFlow] Filling title field...');
    await fillField(job.selectors.titleInput, job.title);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    console.log('[PinFlow] Filling website field...');
    await fillField(job.selectors.websiteInput, job.websiteUrl);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    var description = buildDescription(job.description, job.hashtags);
    console.log('[PinFlow] Filling description field...');
    await fillField(job.selectors.descriptionBox, description);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    console.log('[PinFlow] Filling tags field...');
    await fillTagsField(job.selectors.tagsInput, job.hashtags);

    updateStatus(job.jobId, 'publishing');
    console.log('[PinFlow] Looking for publish button...');
    var publishBtn = await findPublishButton(job.selectors);
    console.log('[PinFlow] Publish button found, clicking...');
    await Humanizer.humanClick(publishBtn);
    await Humanizer.delay(job.timing.publishWaitMs, job.timing.publishWaitMs + 1500);

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

async function uploadFile(selector, file) {
  console.log('[PinFlow] Uploading file, looking for selector:', selector);
  var input = await waitForElement(selector, 10000);
  if (!input) throw new Error('Upload input not found: ' + selector);

  console.log('[PinFlow] Upload input found:', input.tagName, input.type);

  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[PinFlow] File dispatched to input');
}

async function fillField(selector, value) {
  if (!value) return;

  console.log('[PinFlow] Filling field:', selector, 'with value length:', value.length);
  var el = await waitForElement(selector, 8000);
  if (!el) throw new Error('Field not found: ' + selector);

  el.focus();
  await Humanizer.delay(200, 400);

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    );
    if (nativeInputValueSetter) {
      nativeInputValueSetter.set.call(el, '');
    } else {
      el.value = '';
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));

    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      if (nativeInputValueSetter) {
        nativeInputValueSetter.set.call(el, el.value + ch);
      } else {
        el.value += ch;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await Humanizer.delay(getTimingConfigSafe().typingMinMs, getTimingConfigSafe().typingMaxMs);
      if (ch === ' ') {
        await Humanizer.wordPause();
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    await Humanizer.delay(100, 200);

    for (var j = 0; j < value.length; j++) {
      var ch2 = value[j];
      document.execCommand('insertText', false, ch2);
      await Humanizer.delay(getTimingConfigSafe().typingMinMs, getTimingConfigSafe().typingMaxMs);
      if (ch2 === ' ') {
        await Humanizer.wordPause();
      }
    }
  }

  console.log('[PinFlow] Field filled successfully');
}

function getTimingConfigSafe() {
  return Humanizer._cfg || Humanizer._timing || DEFAULT_TIMING;
}

var DEFAULT_TIMING = {
  typingMinMs: 50,
  typingMaxMs: 150,
  wordPauseMs: 300,
  stepMinMs: 1000,
  stepMaxMs: 2500,
  uploadWaitMs: 3000,
  publishWaitMs: 2000,
};

async function fillTagsField(selector, hashtags) {
  if (!hashtags || hashtags.length === 0) return;

  console.log('[PinFlow] Filling tags:', hashtags.join(', '));
  var el = await waitForElement(selector, 8000);
  if (!el) throw new Error('Tags field not found: ' + selector);

  el.focus();
  await Humanizer.delay(200, 400);

  for (var i = 0; i < hashtags.length; i++) {
    var tag = hashtags[i];
    for (var j = 0; j < tag.length; j++) {
      await Humanizer.typeChar(el, tag[j]);
    }

    if (i < hashtags.length - 1) {
      await Humanizer.delay(100, 200);
    }

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await Humanizer.delay(300, 600);
  }
}

async function findPublishButton(selectors, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  var start = Date.now();

  while (Date.now() - start < timeoutMs) {
    var btn = document.querySelector(selectors.publishButton);
    if (btn && isVisible(btn)) {
      console.log('[PinFlow] Publish button found via selector:', selectors.publishButton);
      return btn;
    }

    var buttons = [].slice.call(document.querySelectorAll('button'));
    btn = buttons.find(function (b) {
      var ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
      var text = (b.textContent || '').trim().toLowerCase();
      var testId = (b.getAttribute('data-test-id') || '').toLowerCase();
      return ariaLabel.indexOf('save') !== -1 ||
        text.indexOf('save') !== -1 ||
        testId.indexOf('save') !== -1 ||
        ariaLabel.indexOf('publish') !== -1 ||
        text.indexOf('publish') !== -1 ||
        ariaLabel.indexOf('pin') !== -1 ||
        text.indexOf('pin it') !== -1;
    });
    if (btn && isVisible(btn)) {
      console.log('[PinFlow] Publish button found via fallback search');
      return btn;
    }

    await Humanizer.delay(500);
  }

  throw new Error('Publish button not found within timeout');
}

function isVisible(el) {
  if (!el) return false;
  var style = window.getComputedStyle(el);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity) > 0 &&
    el.offsetParent !== null;
}

function buildDescription(description, hashtags) {
  var tagStr = (hashtags && hashtags.length > 0)
    ? '\n\n' + hashtags.join(' ')
    : '';
  return (description || '') + tagStr;
}

function waitForElement(selector, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function (resolve) {
    var el = document.querySelector(selector);
    if (el) {
      console.log('[PinFlow] Element found immediately:', selector);
      return resolve(el);
    }

    console.log('[PinFlow] Waiting for element:', selector);
    var observer = new MutationObserver(function () {
      var el = document.querySelector(selector);
      if (el) {
        console.log('[PinFlow] Element found via observer:', selector);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(function () {
      observer.disconnect();
      var el = document.querySelector(selector);
      if (el) {
        console.log('[PinFlow] Element found on timeout:', selector);
        resolve(el);
      } else {
        console.warn('[PinFlow] Element NOT found after timeout:', selector);
        resolve(null);
      }
    }, timeoutMs);
  });
}

function updateStatus(jobId, status, error) {
  chrome.runtime.sendMessage({
    type: MSG_TYPES.JOB_STATUS_UPDATE,
    jobId: jobId,
    status: status,
    error: error || undefined,
  }).catch(function () {});
}