// shell.js — title, pause, game over and win screens, plus toasts.
//
// One DOM overlay on top of the game canvas. Language comes from the
// `lang` option or `?lang=` (en | ar | ru | zh); Arabic flips the shell to
// right-to-left. Works without a DOM (Node tests): only t() is useful there.

export const LANGS = ['en', 'ar', 'ru', 'zh'];

export const STRINGS = {
  en: {
    play: 'Play', retry: 'Retry', paused: 'Paused', resume: 'Resume', score: 'Score',
    best: 'Best', gameOver: 'Game over', win: 'You win!', level: 'Level', time: 'Time',
    pause: 'Pause', sound: 'Sound', on: 'On', off: 'Off', share: 'Share',
    tapToStart: 'Tap to start', madeWith: 'Made with', makeOwn: 'Make your own game',
    makeOwnSub: 'Describe it. BrainDaemon builds it.', touchHint: 'Drag left side to move',
    keysHint: 'WASD / arrows to move',
  },
  ar: {
    play: 'العب', retry: 'أعد المحاولة', paused: 'متوقف مؤقتًا', resume: 'تابع', score: 'النقاط',
    best: 'الأفضل', gameOver: 'انتهت اللعبة', win: 'لقد فزت!', level: 'المستوى', time: 'الوقت',
    pause: 'إيقاف مؤقت', sound: 'الصوت', on: 'تشغيل', off: 'إيقاف', share: 'مشاركة',
    tapToStart: 'اضغط للبدء', madeWith: 'صُنعت بواسطة', makeOwn: 'اصنع لعبتك الخاصة',
    makeOwnSub: 'صِفها، وBrainDaemon يبنيها.', touchHint: 'اسحب في الجهة اليسرى للتحرك',
    keysHint: 'WASD / الأسهم للتحرك',
  },
  ru: {
    play: 'Играть', retry: 'Ещё раз', paused: 'Пауза', resume: 'Продолжить', score: 'Очки',
    best: 'Рекорд', gameOver: 'Игра окончена', win: 'Победа!', level: 'Уровень', time: 'Время',
    pause: 'Пауза', sound: 'Звук', on: 'Вкл', off: 'Выкл', share: 'Поделиться',
    tapToStart: 'Нажмите, чтобы начать', madeWith: 'Сделано в', makeOwn: 'Создай свою игру',
    makeOwnSub: 'Опиши её, BrainDaemon её соберёт.', touchHint: 'Ведите слева, чтобы двигаться',
    keysHint: 'WASD / стрелки — движение',
  },
  zh: {
    play: '开始', retry: '重试', paused: '已暂停', resume: '继续', score: '得分',
    best: '最佳', gameOver: '游戏结束', win: '你赢了！', level: '关卡', time: '时间',
    pause: '暂停', sound: '声音', on: '开', off: '关', share: '分享',
    tapToStart: '点击开始', madeWith: '制作工具', makeOwn: '制作你自己的游戏',
    makeOwnSub: '描述它，BrainDaemon 来构建。', touchHint: '在左侧拖动来移动',
    keysHint: 'WASD / 方向键移动',
  },
};

/** language from ?lang=, falling back to English */
export function detectLang(fallback = 'en') {
  try {
    const l = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (LANGS.includes(l)) return l;
  } catch { /* no location */ }
  return fallback;
}

/** translate a key for a language (falls back to English, then to the key) */
export function tr(lang, key) {
  const table = STRINGS[lang] || STRINGS.en;
  return table[key] ?? STRINGS.en[key] ?? key;
}

const CSS = `
.gk-shell{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic","PingFang SC","Noto Sans SC",sans-serif;color:#EAF2FF;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.gk-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:calc(24px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));background:radial-gradient(120% 90% at 50% 45%,rgba(14,19,34,.12),rgba(6,8,16,.72));backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;visibility:hidden;transition:opacity .28s ease,visibility 0s linear .28s;pointer-events:auto;text-align:center}
.gk-screen.gk-on{opacity:1;visibility:visible;transition:opacity .28s ease}
.gk-title{font-size:clamp(34px,9vw,72px);font-weight:900;letter-spacing:-.02em;line-height:1;margin:0;background:linear-gradient(180deg,#fff,#86B4FF 70%,#4C86FF);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 24px rgba(42,99,238,.55))}
.gk-sub{font-size:clamp(14px,3.6vw,18px);opacity:.82;margin:0;max-width:34em}
.gk-big{font-size:clamp(28px,7vw,52px);font-weight:800;margin:0}
.gk-score{font-size:clamp(18px,4.6vw,24px);opacity:.9;margin:0;font-variant-numeric:tabular-nums}
.gk-btn{pointer-events:auto;appearance:none;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:clamp(17px,4.6vw,21px);color:#fff;padding:14px 38px;min-width:168px;border-radius:999px;background:linear-gradient(180deg,#4C86FF,#2A63EE);box-shadow:0 10px 30px rgba(42,99,238,.45),inset 0 1px 0 rgba(255,255,255,.35);transition:transform .12s ease,box-shadow .12s ease}
.gk-btn:active{transform:scale(.95);box-shadow:0 4px 16px rgba(42,99,238,.5),inset 0 1px 0 rgba(255,255,255,.3)}
.gk-btn:focus-visible{outline:3px solid #FCD34D;outline-offset:3px}
.gk-hint{font-size:13px;opacity:.6;margin-top:4px}
.gk-hud{position:absolute;top:calc(10px + env(safe-area-inset-top));inset-inline-end:calc(10px + env(safe-area-inset-right));display:flex;gap:8px;pointer-events:auto}
.gk-icon{appearance:none;border:1px solid rgba(134,180,255,.35);width:44px;height:44px;border-radius:14px;background:rgba(14,19,34,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#EAF2FF;font-size:18px;display:grid;place-items:center;cursor:pointer;transition:transform .12s}
.gk-icon:active{transform:scale(.9)}
.gk-hud.gk-hide{display:none}
.gk-toast{position:absolute;left:50%;top:calc(18% + env(safe-area-inset-top));transform:translate(-50%,-8px);padding:10px 20px;border-radius:999px;background:rgba(14,19,34,.78);border:1px solid rgba(134,180,255,.4);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-weight:700;font-size:16px;opacity:0;transition:opacity .2s,transform .2s;white-space:nowrap;pointer-events:none}
.gk-toast.gk-on{opacity:1;transform:translate(-50%,0)}
`;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {string} [o.lang]   en|ar|ru|zh, default from ?lang=
 * @param {() => void} [o.onStart]
 * @param {() => void} [o.onRetry]
 * @param {(paused:boolean) => void} [o.onPause]   (extra) pause button/menu toggled
 * @param {(on:boolean) => void} [o.onSound]       (extra) sound toggle; hides the button when absent
 * @param {HTMLElement} [o.root]  where to mount (default document.body)
 * @param {string|{touch?:string,keys?:string}} [o.hint]  the control hint under Play
 *   (a string for both, or one per input kind); default: the Kit's "drag left side" / "WASD" lines
 */
export function createShell({ title = '', subtitle = '', lang, onStart, onRetry, onPause, onSound, root, hint } = {}) {
  const L = LANGS.includes(lang) ? lang : detectLang();
  const t = (key) => tr(L, key);
  const hasDom = typeof document !== 'undefined' && !!document.createElement;
  /** the hint text for a touch (true) or keyboard (false) player */
  const hintFor = (touch, h = hint) => {
    if (typeof h === 'string') return h;
    const own = h && typeof h === 'object' ? (touch ? h.touch : h.keys) : null;
    return typeof own === 'string' ? own : t(touch ? 'touchHint' : 'keysHint');
  };

  // Node / headless: keep the same API but do nothing visible.
  if (!hasDom) {
    const noop = () => {};
    return {
      lang: L, t, hintFor, showTitle: noop, hideTitle: noop, pause: noop, gameOver: noop, win: noop, toast: noop, hideAll: noop,
      setHint: noop, destroy: noop, el: null,
    };
  }

  if (!document.getElementById('gk-shell-css')) {
    const style = document.createElement('style');
    style.id = 'gk-shell-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'gk-shell';
  el.dir = L === 'ar' ? 'rtl' : 'ltr';
  el.lang = L;

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (label, fn, cls = 'gk-btn') => {
    const b = mk('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    // keep pointer events from reaching the game input under the shell
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  };

  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // Title screen
  const sTitle = mk('div', 'gk-screen');
  sTitle.append(mk('h1', 'gk-title', title));
  if (subtitle) sTitle.append(mk('p', 'gk-sub', subtitle));
  const playBtn = button(t('play'), () => { hide(sTitle); setHud(true); onStart && onStart(); });
  const hintEl = mk('div', 'gk-hint', hintFor(touch));
  sTitle.append(playBtn, hintEl);

  // Pause screen
  const sPause = mk('div', 'gk-screen');
  sPause.append(mk('p', 'gk-big', t('paused')), button(t('resume'), () => api.pause(false)));

  // End screens (game over / win)
  const sEnd = mk('div', 'gk-screen');
  const endHead = mk('p', 'gk-big');
  const endScore = mk('p', 'gk-score');
  sEnd.append(endHead, endScore, button(t('retry'), () => { hide(sEnd); setHud(true); onRetry && onRetry(); }));

  // HUD buttons (pause, sound)
  const hud = mk('div', 'gk-hud gk-hide');
  const pauseBtn = button('❚❚', () => api.pause(true), 'gk-icon');
  pauseBtn.setAttribute('aria-label', t('pause'));
  hud.append(pauseBtn);
  if (onSound) {
    let soundOn = true;
    const sBtn = button('♪', () => { soundOn = !soundOn; sBtn.style.opacity = soundOn ? '1' : '.45'; onSound(soundOn); }, 'gk-icon');
    sBtn.setAttribute('aria-label', t('sound'));
    hud.append(sBtn);
  }

  const toastEl = mk('div', 'gk-toast');
  el.append(sTitle, sPause, sEnd, hud, toastEl);
  (root || document.body).appendChild(el);

  function show(s) { s.classList.add('gk-on'); }
  function hide(s) { s.classList.remove('gk-on'); }
  function setHud(on) { hud.classList.toggle('gk-hide', !on); }

  // Escape / P toggles pause while playing.
  let playing = false;
  const onKey = (e) => {
    if ((e.code === 'Escape' || e.code === 'KeyP') && playing) api.pause(!sPause.classList.contains('gk-on'));
    else if ((e.code === 'Enter' || e.code === 'Space') && sTitle.classList.contains('gk-on')) { e.preventDefault(); playBtn.click(); }
  };
  window.addEventListener('keydown', onKey);

  let toastTimer = 0;
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString(L === 'ar' ? 'ar-EG' : L) : String(n ?? ''));

  function end(head, score) {
    playing = false; setHud(false);
    endHead.textContent = head;
    endScore.textContent = score != null ? `${t('score')}: ${fmt(score)}` : '';
    show(sEnd);
  }

  const api = {
    lang: L,
    el,
    t,
    hintFor,
    showTitle() { playing = false; setHud(false); hide(sPause); hide(sEnd); show(sTitle); },
    hideTitle() { hide(sTitle); setHud(true); playing = true; },
    pause(b = true) {
      if (b) show(sPause); else hide(sPause);
      onPause && onPause(!!b);
    },
    /** title: your own heading instead of "Game over" */
    gameOver({ score, title: head } = {}) { end(typeof head === 'string' && head ? head : t('gameOver'), score); },
    /** title: your own heading instead of "You win!" (e.g. "Realm explored") */
    win({ score, title: head } = {}) { end(typeof head === 'string' && head ? head : t('win'), score); },
    /** change the title-screen hint later: a string, or { touch, keys } */
    setHint(h) { hintEl.textContent = hintFor(touch, h); },
    toast(text, ms = 1600) {
      toastEl.textContent = text;
      toastEl.classList.add('gk-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('gk-on'), ms);
    },
    hideAll() { hide(sTitle); hide(sPause); hide(sEnd); },
    destroy() { window.removeEventListener('keydown', onKey); el.remove(); },
  };
  // Starting the game from the Play button also marks the shell as "playing".
  playBtn.addEventListener('click', () => { playing = true; });
  sEnd.querySelector('.gk-btn').addEventListener('click', () => { playing = true; });
  return api;
}
