const DEFAULT_TIMING = {
  typingMinMs: 50,
  typingMaxMs: 150,
  wordPauseMs: 300,
  stepMinMs: 1000,
  stepMaxMs: 2500,
  uploadWaitMs: 3000,
  publishWaitMs: 2000,
};

let _cfg = null;

function getTimingConfig() {
  return _cfg || DEFAULT_TIMING;
}

const Humanizer = {
  setTimingConfig(cfg) {
    _cfg = cfg;
  },

  delay(min, max) {
    const ms = max
      ? min + Math.random() * (max - min)
      : min * (0.8 + Math.random() * 0.4);
    return new Promise(r => setTimeout(r, Math.round(ms)));
  },

  async typeChar(el, char) {
    const cfg = getTimingConfig();
    const opts = {
      key: char,
      code: 'Key' + char.toUpperCase(),
      bubbles: true,
      cancelable: true,
    };

    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));

    if (el.tagName === 'INPUT') {
      el.value += char;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
    } else {
      document.execCommand('insertText', false, char);
    }

    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    await this.delay(cfg.typingMinMs, cfg.typingMaxMs);
  },

  async wordPause() {
    const cfg = getTimingConfig();
    await this.delay(cfg.wordPauseMs * 0.7, cfg.wordPauseMs * 1.3);
  },

  async humanClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    const evOpts = { bubbles: true, clientX: x, clientY: y };

    el.dispatchEvent(new MouseEvent('mouseover', evOpts));
    el.dispatchEvent(new MouseEvent('mouseenter', evOpts));
    await this.delay(80, 200);
    el.dispatchEvent(new MouseEvent('mousedown', evOpts));
    await this.delay(50, 120);
    el.dispatchEvent(new MouseEvent('mouseup', evOpts));
    el.dispatchEvent(new MouseEvent('click', evOpts));
  },
};

window.PinFlowHumanizer = Humanizer;