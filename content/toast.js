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

var TOAST_CONFIG = {
  fetching:   { icon: '\u23F3', color: '#2D3561', bg: '#EEF2FF' },
  uploading:  { icon: '\uD83D\uDCE4', color: '#0F7173', bg: '#ECFDF5' },
  filling:    { icon: '\u270F\uFE0F',  color: '#0F7173', bg: '#ECFDF5' },
  publishing: { icon: '\uD83D\uDE80', color: '#D97706', bg: '#FFFBEB' },
  done:       { icon: '\uD83C\uDF89', color: '#059669', bg: '#ECFDF5' },
  error:      { icon: '\u274C', color: '#DC2626', bg: '#FEF2F2' },
};

var TOAST_CSS = '\
  @keyframes pinflow-slide-in {\
    from { transform: translateX(100%); opacity: 0; }\
    to { transform: translateX(0); opacity: 1; }\
  }\
  @keyframes pinflow-slide-out {\
    from { transform: translateX(0); opacity: 1; }\
    to { transform: translateX(100%); opacity: 0; }\
  }\
  @keyframes pinflow-spin {\
    from { transform: rotate(0deg); }\
    to { transform: rotate(360deg); }\
  }\
  .pinflow-toast {\
    position: fixed;\
    bottom: 20px;\
    right: 20px;\
    padding: 12px 18px;\
    border-radius: 8px;\
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
    font-size: 14px;\
    display: flex;\
    align-items: center;\
    gap: 10px;\
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);\
    z-index: 2147483647;\
    animation: pinflow-slide-in 0.3s ease-out;\
    cursor: default;\
    max-width: 360px;\
    line-height: 1.4;\
  }\
  .pinflow-toast.removing {\
    animation: pinflow-slide-out 0.3s ease-in forwards;\
  }\
  .pinflow-toast-icon {\
    font-size: 18px;\
    flex-shrink: 0;\
  }\
  .pinflow-toast-icon.spinning {\
    animation: pinflow-spin 1s linear infinite;\
  }\
  .pinflow-toast-msg {\
    flex: 1;\
    min-width: 0;\
  }\
  .pinflow-toast-close {\
    background: none;\
    border: none;\
    font-size: 16px;\
    cursor: pointer;\
    opacity: 0.5;\
    padding: 0 0 0 8px;\
    line-height: 1;\
    color: inherit;\
  }\
  .pinflow-toast-close:hover {\
    opacity: 1;\
  }\
';

function showToast(options) {
  var status = options.status || 'fetching';
  var message = options.message || '';
  var duration = options.duration !== undefined ? options.duration : (status === 'error' ? 0 : 4000);
  var config = TOAST_CONFIG[status] || TOAST_CONFIG.fetching;

  var host = document.getElementById('pinflow-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pinflow-toast-host';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = TOAST_CSS;
    shadow.appendChild(style);

    var container = document.createElement('div');
    container.id = 'pinflow-toast-container';
    shadow.appendChild(container);

    document.body.appendChild(host);
  }

  var shadow = host.shadowRoot;
  var container = shadow.getElementById('pinflow-toast-container');

  var toast = document.createElement('div');
  toast.className = 'pinflow-toast';
  toast.style.color = config.color;
  toast.style.backgroundColor = config.bg;

  var isSpinning = status === 'fetching' || status === 'uploading' || status === 'filling' || status === 'publishing';

  var iconSpan = document.createElement('span');
  iconSpan.className = 'pinflow-toast-icon' + (isSpinning ? ' spinning' : '');
  iconSpan.textContent = config.icon;

  var msgSpan = document.createElement('span');
  msgSpan.className = 'pinflow-toast-msg';
  msgSpan.textContent = message;

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);

  if (status === 'error') {
    var closeBtn = document.createElement('button');
    closeBtn.className = 'pinflow-toast-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', function () {
      removeToast(toast);
    });
    toast.appendChild(closeBtn);
  }

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(function () {
      removeToast(toast);
    }, duration);
  }

  while (container.children.length > 3) {
    removeToast(container.firstElementChild, 0);
  }
}

function removeToast(toast, animDuration) {
  if (!toast || !toast.parentElement) return;
  var dur = animDuration !== undefined ? animDuration : 300;
  toast.classList.add('removing');
  setTimeout(function () {
    if (toast.parentElement) toast.remove();
  }, dur);
}

chrome.runtime.onMessage.addListener(function (msg) {
  if (msg.type === MSG_TYPES.SHOW_TOAST) {
    showToast(msg.toast);
  }
});