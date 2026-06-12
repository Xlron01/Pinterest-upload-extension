var DEFAULT_TIMING = {
  typingMinMs: 5,
  typingMaxMs: 10,
  wordPauseMs: 10,
  stepMinMs: 100,
  stepMaxMs: 200,
  uploadWaitMs: 1500,
  publishWaitMs: 500,
};

var _cfg = null;

function getTimingConfig() {
  return _cfg || DEFAULT_TIMING;
}

var Humanizer = {
  setTimingConfig: function (cfg) {
    console.log('[PinFlow] Humanizer: timing config set', cfg);
    _cfg = cfg;
  },

  delay: function (min, max) {
    var ms = max
      ? min + Math.random() * (max - min)
      : min * (0.8 + Math.random() * 0.4);
    return new Promise(function (r) { setTimeout(r, Math.round(ms)); });
  },

  typeChar: async function (el, char) {
    var cfg = getTimingConfig();
    var opts = {
      key: char,
      code: char === ' ' ? 'Space' : 'Key' + char.toUpperCase(),
      bubbles: true,
      cancelable: true,
    };

    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      );
      if (nativeInputValueSetter) {
        nativeInputValueSetter.set.call(el, el.value + char);
      } else {
        el.value += char;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('insertText', false, char);
    }

    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    await this.delay(cfg.typingMinMs, cfg.typingMaxMs);
  },

  wordPause: async function () {
    var cfg = getTimingConfig();
    await this.delay(cfg.wordPauseMs * 0.7, cfg.wordPauseMs * 1.3);
  },

  humanClick: async function (el) {
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    var y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    var evOpts = { bubbles: true, clientX: x, clientY: y };

    el.dispatchEvent(new MouseEvent('mouseover', evOpts));
    el.dispatchEvent(new MouseEvent('mouseenter', evOpts));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(10, 20);
    el.dispatchEvent(new MouseEvent('mousedown', evOpts));
    await this.delay(5, 15);
    el.dispatchEvent(new MouseEvent('mouseup', evOpts));
    el.dispatchEvent(new MouseEvent('click', evOpts));
  },
};

window.PinFlowHumanizer = Humanizer;
console.log('[PinFlow] Humanizer module loaded');