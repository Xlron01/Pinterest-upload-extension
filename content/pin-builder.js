const MSG_TYPES = {
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

const Humanizer = window.PinFlowHumanizer;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ pong: true });
    return;
  }

  if (msg.type === MSG_TYPES.START_PIN_JOB) {
    runPinJob(msg.job).then(sendResponse);
    return true;
  }
});

async function runPinJob(job) {
  try {
    updateStatus(job.jobId, 'uploading');

    Humanizer.setTimingConfig(job.timing);

    const file = base64ToFile(job.mediaBuffer, job.filename, job.mimeType);

    await uploadFile(job.selectors.fileInput, file);

    await Humanizer.delay(job.timing.uploadWaitMs);
    updateStatus(job.jobId, 'filling');

    await fillField(job.selectors.titleInput, job.title);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    await fillField(job.selectors.websiteInput, job.websiteUrl);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    const description = buildDescription(job.description, job.hashtags);
    await fillField(job.selectors.descriptionBox, description);
    await Humanizer.delay(job.timing.stepMinMs, job.timing.stepMaxMs);

    await fillTagsField(job.selectors.tagsInput, job.hashtags);

    updateStatus(job.jobId, 'publishing');
    const publishBtn = await findPublishButton(job.selectors);
    await Humanizer.humanClick(publishBtn);
    await Humanizer.delay(job.timing.publishWaitMs);

    updateStatus(job.jobId, 'done');
    return { success: true };
  } catch (err) {
    updateStatus(job.jobId, 'error', err.message);
    return { success: false, error: err.message };
  }
}

function base64ToFile(base64, filename, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}

async function uploadFile(selector, file) {
  const input = await waitForElement(selector, 8000);
  if (!input) throw new Error('Upload input not found: ' + selector);

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillField(selector, value) {
  if (!value) return;

  const el = await waitForElement(selector, 5000);
  if (!el) throw new Error('Field not found: ' + selector);

  el.focus();
  await Humanizer.delay(200, 400);

  if (el.tagName === 'INPUT') {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
  }

  const words = value.split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (const char of word) {
      await Humanizer.typeChar(el, char);
    }
    if (i < words.length - 1) {
      await Humanizer.typeChar(el, ' ');
      await Humanizer.wordPause();
    }
  }
}

async function fillTagsField(selector, hashtags) {
  if (!hashtags || hashtags.length === 0) return;

  const el = await waitForElement(selector, 5000);
  if (!el) throw new Error('Tags field not found: ' + selector);

  el.focus();
  await Humanizer.delay(200, 400);

  for (let i = 0; i < hashtags.length; i++) {
    const tag = hashtags[i];
    for (const char of tag) {
      await Humanizer.typeChar(el, char);
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
  timeoutMs = timeoutMs || 8000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    let btn = document.querySelector(selectors.publishButton);
    if (btn && isVisible(btn)) return btn;

    const buttons = [].slice.call(document.querySelectorAll('button'));
    btn = buttons.find(function (b) {
      return (b.getAttribute('aria-label') && b.getAttribute('aria-label').toLowerCase().indexOf('save') !== -1) ||
        (b.textContent.trim().toLowerCase().indexOf('save') !== -1) ||
        (b.getAttribute('data-test-id') && b.getAttribute('data-test-id').indexOf('save') !== -1);
    });
    if (btn && isVisible(btn)) return btn;

    await Humanizer.delay(300);
  }

  throw new Error('Publish button not found within timeout');
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    el.offsetParent !== null;
}

function buildDescription(description, hashtags) {
  const tagStr = (hashtags && hashtags.length > 0)
    ? '\n\n' + hashtags.join(' ')
    : '';
  return (description || '') + tagStr;
}

function waitForElement(selector, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  return new Promise(function (resolve) {
    var el = document.querySelector(selector);
    if (el) return resolve(el);

    var observer = new MutationObserver(function () {
      var el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(function () {
      observer.disconnect();
      resolve(document.querySelector(selector));
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