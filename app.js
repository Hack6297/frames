/* Frames 6 desktop environment */

// ========== SETTINGS & THEME ==========
const LOCAL_KEYS = {
  settings: 'win7_settings',
  vfs: 'win7_vfs',
  messenger: 'win7_messenger',
  lastAccount: 'win7_last_account'
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAccountEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveDisplayName(email) {
  const localPart = String(email || '').trim().split('@')[0] || 'Martin';
  return localPart.replace(/[\\/:*?"<>|]/g, '').trim() || 'Martin';
}

function canUseAccountService() {
  return location.protocol === 'http:' || location.protocol === 'https:' || location.protocol === 'file:';
}

function getAccountServiceBase() {
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return 'http://127.0.0.1:8000';
}

function createDefaultSettings() {
  return {
    wallpaper: '7.jpg', aeroColor: 'rgba(30,60,110,0.45)',
    titlebarColor: 'rgba(255,255,255,0.15)', username: 'Martin',
    themes: [], activeTheme: null, clockFormat: '12h',
    stickyNotes: [], volume: 65,
    taskbarBrightness: 100, titlebarBrightness: 100,
    transparencyEffects: true,
    pinnedTaskbar: ['ie', 'explorer', 'mediaplayer'],
    defaultDesktopWidgetsPlaced: false
  };
}

let settings = createDefaultSettings();
try {
  const savedSettings = localStorage.getItem(LOCAL_KEYS.settings);
  if (savedSettings) settings = { ...settings, ...JSON.parse(savedSettings) };
} catch (e) {
  console.error("Settings load failed:", e);
}
if (!Array.isArray(settings.pinnedTaskbar) || settings.pinnedTaskbar.length === 0) settings.pinnedTaskbar = ['ie', 'explorer', 'mediaplayer'];

let messengerCache = null;
try {
  messengerCache = JSON.parse(localStorage.getItem(LOCAL_KEYS.messenger) || 'null');
} catch (e) {
  console.warn('Messenger cache load failed:', e);
}

let currentAccount = {
  email: normalizeAccountEmail(localStorage.getItem(LOCAL_KEYS.lastAccount) || ''),
  displayName: '',
  signedIn: false,
  serverAvailable: false,
  wsConnected: false,
  wsPort: 8765
};
let accountSaveTimer = null;
let accountSavePending = false;
let messengerSocket = null;
let messengerReconnectTimer = null;
let messengerPresence = {};
let signInInProgress = false;
let crashAudio = null;

// ========== SOUND SYSTEM ==========
const sounds = {
  startup: 'sounds/startup.wav',
  logon: 'sounds/logon.wav',
  logoff: 'sounds/logoff.wav',
  shutdown: 'sounds/shutdown.wav',
  critical: 'sounds/error.wav',
  exclamation: 'sounds/warning.wav',
  notify: 'sounds/info.wav',
  uac: 'sounds/warning.wav',
  ding: 'sounds/info.wav',
  default: 'sounds/info.wav',
  hardware_insert: 'sounds/info.wav',
  hardware_remove: 'sounds/info.wav',
  nav: 'sounds/info.wav',
  minimize: 'sounds/info.wav',
  restore: 'sounds/info.wav',
  recycle: 'sounds/info.wav',
  menu: 'sounds/info.wav'
};

function playSound(name) {
  try {
    if (!sounds[name]) return;
    const audio = new Audio(sounds[name]);
    audio.volume = (settings.volume || 65) / 100;
    audio.play().catch(e => console.log("Audio play blocked: " + e.message));
  } catch (err) {
    console.error("Sound error:", err);
  }
}

let bootSequenceStarted = false;

function buildBootOverlayMarkup() {
  return `
    <div id="boot-click-to-start">
      <img src="icons/vista_aero_icon.png" width="80" style="margin-bottom:20px;opacity:0.8">
      <h2>Click to start Frames 6...</h2>
      <p style="font-size:12px;opacity:0.6;margin-top:40px">Click to boot</p>
    </div>
    <video id="boot-video" src="videos/startup_bootload.mp4" style="display:none"></video>
  `;
}

function ensureBootOverlay() {
  let overlay = document.getElementById('boot-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'boot-overlay';
    overlay.innerHTML = buildBootOverlayMarkup();
    document.body.appendChild(overlay);
  }
  const clickToStart = overlay.querySelector('#boot-click-to-start');
  const video = overlay.querySelector('#boot-video');
  overlay.classList.remove('fade-out');
  overlay.classList.remove('video-active');
  overlay.style.display = 'flex';
  overlay.style.opacity = '';
  overlay.style.visibility = '';
  if (clickToStart) clickToStart.style.display = '';
  if (video) {
    video.pause();
    try { video.currentTime = 0; } catch (e) {}
    video.style.display = 'none';
  }
  return { overlay, video, clickToStart };
}

function startBootSequence(autoStart = false) {
  const { overlay, video, clickToStart } = ensureBootOverlay();
  if (!overlay || !video || !clickToStart) return;
  bootSequenceStarted = false;
  let bootFinished = false;

  const finishBoot = () => {
    if (bootFinished) return;
    bootFinished = true;
    overlay.classList.remove('video-active');
    overlay.classList.add('black-hold');
    clickToStart.style.display = 'none';
    video.pause();
    video.style.display = 'none';
    playSound('startup');
    setTimeout(() => {
      const ls = document.getElementById('lock-screen');
      if (ls) {
        showLockScreen(currentAccount.email || '');
      } else {
        playSound('logon');
      }
      if (overlay.parentNode) overlay.remove();
    }, 2000);
  };

  const beginPlayback = () => {
    if (bootSequenceStarted) return;
    bootSequenceStarted = true;
    overlay.classList.add('video-active');
    clickToStart.style.display = 'none';
    video.style.display = 'block';
    video.play().catch(err => {
      console.error("Video play failed:", err);
      finishBoot();
    });
  };

  clickToStart.onclick = (e) => {
    if (e) e.preventDefault();
    beginPlayback();
  };

  video.onended = finishBoot;

  if (autoStart) beginPlayback();
}

function initBootloader() {
  startBootSequence(false);
}

function unlockDesktop() {
  const ls = document.getElementById('lock-screen');
  if (ls) {
    ls.classList.add('fade-out');
    ls.classList.remove('lock-ui-ready');
    playSound('logon');
    setTimeout(() => {
      ls.classList.remove('fade-out');
      ls.style.display = 'none';
    }, 1000);
  }
}

function ensureLockScreen() {
  let lockScreen = document.getElementById('lock-screen');
  if (lockScreen) return lockScreen;
  lockScreen = document.createElement('div');
  lockScreen.id = 'lock-screen';
  lockScreen.innerHTML = `
    <div class="lock-user-area">
      <img src="templates/LogOn.png" class="lock-user-icon" onmouseenter="this.src='templates/LogOnGlow.png'" onmouseleave="this.src='templates/LogOn.png'">
      <div class="lock-username" id="lock-username">Sign in to Frames 6</div>
      <div class="lock-subtitle">Use your account email to load your desktop, files, wallpaper, and Messenger history.</div>
      <div class="lock-input-wrap">
        <input type="email" placeholder="Email address" id="lock-email" autocomplete="email">
        <button class="lock-button" onclick="signInFromLockScreen()" id="lock-btn" title="Sign in"></button>
      </div>
      <div class="lock-status" id="lock-status">Starting account service check...</div>
    </div>
  `;
  document.body.appendChild(lockScreen);
  return lockScreen;
}

function showLockScreen(prefillEmail = '') {
  toggleStartMenu(false);
  closeAllPopups();
  const lockScreen = ensureLockScreen();
  lockScreen.style.display = 'flex';
  lockScreen.classList.remove('fade-out');
  lockScreen.classList.add('lock-ui-ready');
  const input = document.getElementById('lock-email');
  if (input) input.value = prefillEmail;
  initAccountLockScreen();
}

function revealLockSignIn() {
  document.getElementById('lock-email')?.focus();
}

function saveSettings() {
  try {
    localStorage.setItem(LOCAL_KEYS.settings, JSON.stringify(settings));
  } catch (err) {
    console.warn('Settings save failed:', err);
  }
  scheduleAccountSave();
}

const DEFAULT_7CSS_GLASS_PATTERN = "linear-gradient(135deg,#fff5 70px,transparent 100px),linear-gradient(225deg,#fff5 70px,transparent 100px),linear-gradient(54deg,#0002 0 4%,#6661 6% 6%,#0002 8% 10%,#0002 15% 16%,#aaa1 17% 18%,#0002 23% 24%,#bbb2 25% 26%,#0002 31% 33%,#0002 34% 34.5%,#bbb2 36% 40%,#0002 41% 41.5%,#bbb2 44% 45%,#bbb2 46% 47%,#0002 48% 49%,#0002 50% 50.5%,#0002 56% 56.5%,#bbb2 57% 63%,#0002 67% 69%,#bbb2 69.5% 70%,#0002 73.5% 74%,#bbb2 74.5% 79%,#0002 80% 84%,#aaa2 85% 86%,#0002 87%,#bbb1 90%) left center/100vw 100vh no-repeat fixed";

function parseColor(color) {
  const value = String(color || '').trim();
  let match = value.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)$/i);
  if (match) {
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1
    };
  }
  match = value.match(/^#([0-9a-f]{6})$/i);
  if (match) {
    return {
      r: parseInt(match[1].slice(0, 2), 16),
      g: parseInt(match[1].slice(2, 4), 16),
      b: parseInt(match[1].slice(4, 6), 16),
      a: 1
    };
  }
  match = value.match(/^#([0-9a-f]{3})$/i);
  if (match) {
    return {
      r: parseInt(match[1][0] + match[1][0], 16),
      g: parseInt(match[1][1] + match[1][1], 16),
      b: parseInt(match[1][2] + match[1][2], 16),
      a: 1
    };
  }
  return { r: 69, g: 128, b: 196, a: 1 };
}

function rgbaStringFromParts(parts, alpha = parts.a) {
  return `rgba(${parts.r},${parts.g},${parts.b},${Math.max(0, Math.min(1, Number(alpha)) || 0)})`;
}

function colorToHex(color) {
  const { r, g, b } = parseColor(color);
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function buildWindowFrameFill(color, transparent) {
  const { r, g, b, a } = parseColor(color);
  const alpha = transparent ? Math.max(0.1, Math.min(0.58, a || 0.32)) : 1;
  return `rgba(${r},${g},${b},${alpha})`;
}

function build7cssGradient(color) {
  return `linear-gradient(to right, rgba(255,255,255,0.4), rgba(0,0,0,0.10), rgba(255,255,255,0.2)), ${solidifyAeroColor(color)}`;
}

function build7cssGlass(color, transparent) {
  const { r, g, b, a } = parseColor(color);
  const tintAlpha = transparent ? Math.max(0.1, Math.min(0.42, a || 0.24)) : 1;
  return `${DEFAULT_7CSS_GLASS_PATTERN}, linear-gradient(rgba(${r},${g},${b},${tintAlpha}), rgba(${r},${g},${b},${tintAlpha}))`;
}

function getGlassBlurAmount() {
  if (settings.themeType === 'basic' || settings.transparencyEffects === false) return 0;
  const alpha = parseColor(settings.aeroColor).a;
  const transparency = Math.max(0, Math.min(1, 1 - alpha));
  return Math.round(1 + transparency * 2);
}

function updateShellIdentity() {
  const label = document.getElementById('start-user-name');
  if (label) label.textContent = currentAccount.displayName || settings.username || 'Martin';
}

function applyTheme() {
  document.body.style.background = `url('${settings.wallpaper}') no-repeat center center fixed`;
  document.body.style.backgroundSize = 'cover';

  // Theme type (Aero vs Basic)
  if (settings.themeType === 'basic') {
    document.body.classList.add('basic-theme');
  } else {
    document.body.classList.remove('basic-theme');
  }
  document.body.classList.toggle('no-transparency', settings.transparencyEffects === false);

  const taskbarColor = 'rgba(82,88,96,0.42)';
  const titlebarColor = settings.titlebarColor || taskbarColor;
  const frameTransparent = settings.themeType !== 'basic' && settings.transparencyEffects !== false;
  const taskbarSolid = solidifyAeroColor(taskbarColor);
  const titlebarSolid = solidifyAeroColor(titlebarColor);

  document.documentElement.style.setProperty('--taskbar-color', taskbarColor);
  document.documentElement.style.setProperty('--titlebar-color', titlebarColor);
  document.documentElement.style.setProperty('--taskbar-solid-color', taskbarSolid);
  document.documentElement.style.setProperty('--titlebar-solid-color', titlebarSolid);
  document.documentElement.style.setProperty('--window-frame-fill', buildWindowFrameFill(taskbarColor, frameTransparent));
  document.documentElement.style.setProperty('--window-frame-solid', taskbarSolid);
  document.documentElement.style.setProperty('--w7-w-bg', titlebarSolid);
  document.documentElement.style.setProperty('--w7-w-grad', build7cssGradient(titlebarSolid));
  document.documentElement.style.setProperty('--w7-w-glass', settings.themeType === 'basic'
    ? build7cssGradient(titlebarSolid)
    : build7cssGlass(titlebarColor, frameTransparent));
  document.documentElement.style.setProperty('--glass-blur', `${getGlassBlurAmount()}px`);
  document.documentElement.style.setProperty('--taskbar-brightness', 1);
  document.documentElement.style.setProperty('--titlebar-brightness', (settings.titlebarBrightness || 100) / 100);
  updateShellIdentity();
}

function solidifyAeroColor(color) {
  const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return color || '#5a7fa8';
  return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

// ========== VFS ==========
let vfs = JSON.parse(localStorage.getItem(LOCAL_KEYS.vfs)) || createDefaultVFS();
function normalizeRecycleBin() {
  if (vfs['Recycle Bin'] && !vfs.RecycleBin) {
    vfs.RecycleBin = vfs['Recycle Bin'];
  }
  if (!vfs.RecycleBin) {
    vfs.RecycleBin = { type: 'recyclebin', children: {} };
  }
  if (vfs['Recycle Bin']) {
    delete vfs['Recycle Bin'];
  }
}
normalizeRecycleBin();
function getRecycleBinChildren() {
  normalizeRecycleBin();
  if (!vfs.RecycleBin.children) vfs.RecycleBin.children = {};
  return vfs.RecycleBin.children;
}
function getPrimaryUserFolder() {
  const users = getPathNode(['C:', 'Users']);
  if (!users) return 'Admin';
  const preferred = [settings.username, 'Admin', 'Martin'].filter(Boolean);
  for (const name of preferred) {
    if (users[name]) return name;
  }
  return Object.keys(users)[0] || 'Admin';
}
function getDesktopPath() {
  return ['C:', 'Users', getPrimaryUserFolder(), 'Desktop'];
}
function getDefaultDocumentsPath() {
  const user = getPrimaryUserFolder();
  const documentsPath = ['C:', 'Users', user, 'Documents'];
  return getPathNode(documentsPath) ? documentsPath : ['C:', 'Users', user];
}
function getPathChildren(path) {
  const node = getPathNode(path);
  if (!node) return null;
  return node.children || node;
}
function getUniqueItemName(children, preferredName) {
  if (!children[preferredName]) return preferredName;
  const dot = preferredName.lastIndexOf('.');
  const hasExt = dot > 0;
  const base = hasExt ? preferredName.slice(0, dot) : preferredName;
  const ext = hasExt ? preferredName.slice(dot) : '';
  let counter = 2;
  let nextName = `${base} (${counter})${ext}`;
  while (children[nextName]) {
    counter++;
    nextName = `${base} (${counter})${ext}`;
  }
  return nextName;
}
function getActiveVfsTarget() {
  if (rightClickedItem && rightClickedItem.type !== 'empty') {
    return rightClickedItem;
  }
  if (!selectedItem) return null;
  return { type: 'file', name: selectedItem, path: [...currentVfsPath] };
}
function createDefaultVFS(userName = 'Admin') {
  const normalizedUser = deriveDisplayName(userName) || 'Admin';
  return {
    'C:': {
      type: 'drive',
      children: {
        'Frames': { type: 'folder', children: {} },
        'Users': {
          type: 'folder',
          children: {
            [normalizedUser]: {
              type: 'folder',
              children: {
                'Desktop': { type: 'folder', children: {} },
                'Documents': {
                  type: 'folder',
                  children: {
                    'Project Proposal.txt': { type: 'file', content: 'Annual Report 2009 - Sample project document.', modified: '04/08/2009' },
                    'Budget.xlsx': { type: 'file', content: '{"A1":"Item","B1":"Cost","A2":"Rent","B2":"1200","A3":"Food","B3":"400"}', modified: '04/05/2009' },
                    'New Feature Ideas.txt': { type: 'file', content: '1. Glassmorphism icons\n2. Dynamic wallpaper engine\n3. Integrated search', modified: '04/08/2009' },
                    'readme.txt': { type: 'file', content: 'Welcome to Frames 6!', modified: '03/30/2009' }
                  }
                },
                'Downloads': { type: 'folder', children: {} },
                'Music': {
                  type: 'folder',
                  children: {
                    'Kalimba.mp3': { type: 'file', content: '', modified: '03/30/2009' },
                    'Maid with the Flaxen Hair.mp3': { type: 'file', content: '', modified: '03/30/2009' },
                    'Sleep Away.mp3': { type: 'file', content: '', modified: '03/30/2009' }
                  }
                },
                'Pictures': {
                  type: 'folder',
                  children: {
                    'Desert.jpg': { type: 'file', content: '', modified: '03/30/2009' },
                    'Hydrangeas.jpg': { type: 'file', content: '', modified: '03/30/2009' },
                    'Lighthouse.jpg': { type: 'file', content: '', modified: '03/30/2009' }
                  }
                },
                'Videos': {
                  type: 'folder',
                  children: {
                    'Wildlife.wmv': { type: 'file', content: '', modified: '03/30/2009' }
                  }
                }
              }
            }
          }
        },
        'Program Files': { type: 'folder', children: {} }
      }
    },
    'D:': { type: 'drive', children: {} },
    RecycleBin: { type: 'recyclebin', children: {} }
  };
}
function saveVfs() {
  try {
    localStorage.setItem(LOCAL_KEYS.vfs, JSON.stringify(vfs));
  } catch (err) {
    console.warn('VFS save failed:', err);
    if (!currentAccount.signedIn) {
      win7Alert('File Explorer', 'The files are available for this session, but there was not enough browser storage to save every imported file permanently.', 'warning');
    }
  }
  scheduleAccountSave();
}
function getPathNode(path) {
  let n = vfs;
  for (const p of path) {
    if (n[p]) n = n[p].children !== undefined ? n[p].children : n[p];
    else if (n.children && n.children[p]) n = n.children[p].children !== undefined ? n.children[p].children : n.children[p];
    else return null;
  }
  return n;
}

// ========== WINDOW MANAGEMENT ==========
let zIndex = 110, selectedItem = null, currentVfsPath = getDefaultDocumentsPath();
let navHistory = [[...currentVfsPath]], navIndex = 0, explorerQuery = '';
let activeWinFile = null;
let uploadedAssetStore = {};

function updateGlassLightAnchor() {}
function updateWindowGlass() {}
function updateGlassReflections() {}
function queueGlassReflectionUpdate() {}

function makeDraggable(win) {
  const bar = win.querySelector('.title-bar');
  if (!bar) return;
  let ox, oy, dragging = false;
  bar.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    dragging = true; bringToFront(win);
    const r = win.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    const onMove = (ev) => {
      if (!dragging) return;
      const x = ev.clientX - ox, y = ev.clientY - oy;
      win.style.left = x + 'px'; win.style.top = y + 'px';
      queueGlassReflectionUpdate();
    };
    const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
function makeResizable(win) {
  let h = win.querySelector('.resize-handle');
  if (!h) { h = document.createElement('div'); h.className = 'resize-handle'; win.appendChild(h); }
  h.onmousedown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sw = win.offsetWidth, sh = win.offsetHeight, sx = e.clientX, sy = e.clientY;
    const mm = (ev) => {
      win.style.width = Math.max(200, sw + ev.clientX - sx) + 'px';
      win.style.height = Math.max(100, sh + ev.clientY - sy) + 'px';
      queueGlassReflectionUpdate();
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  };
}
function bringToFront(win) {
  zIndex++; win.style.zIndex = zIndex;
  document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
  win.classList.add('active');
  const id = win.id.replace('window-', ''); setActiveTask(id);
  queueGlassReflectionUpdate();
}
function openWindow(id) {
  const win = document.getElementById('window-' + id);
  if (!win) return;
  if (!document.getElementById('task-' + id)) createTaskbarButton(id);
  setTaskRunning(id, true);
  win.style.display = 'block'; bringToFront(win);
  // Init apps
  if (id === 'paint') setTimeout(initPaint, 100);
  if (id === 'explorer') updateExplorer();
  if (id === 'recyclebin') setTimeout(updateRecycleBin, 100);
  if (id === 'messenger') setTimeout(initMessenger, 60);
  if (id === 'messengerchat') setTimeout(initMessengerChat, 60);
  if (id === 'mediaplayer') setTimeout(initWMP, 100);
  if (id === 'panel') setTimeout(initControlPanel, 50);
  if (id === 'personalization') setTimeout(() => persoSwitchTab('wallpaper'), 50);
  if (id === 'ie') setTimeout(() => ieShowHomePage(), 100);
  queueGlassReflectionUpdate();
  toggleStartMenu(false);
}
function closeWindow(win) {
  if (typeof win === 'string') win = document.getElementById('window-' + win);
  if (!win) return;
  // Auto-save before closing
  autoSaveApp(win.id.replace('window-', ''));
  win.style.display = 'none';
  const id = win.id.replace('window-', '');
  const task = document.getElementById('task-' + id);
  if (task && task.querySelector('span')) task.querySelector('span').textContent = nameMap[id] || id;
  setTaskRunning(id, false);
  if (task && !isTaskbarPinned(id)) task.remove();
  clearActiveTasks();
}
function minimizeWindow(win) {
  if (typeof win === 'string') win = document.getElementById('window-' + win);
  if (win) {
    playSound('minimize');
    win.style.display = 'none';
    setTaskRunning(win.id.replace('window-', ''), true);
  }
  clearActiveTasks();
}
function toggleMaximize(win) {
  if (typeof win === 'string') win = document.getElementById('window-' + win);
  if (win) {
    playSound('restore');
    win.classList.toggle('maximized');
    queueGlassReflectionUpdate();
  }
}
function minimizeAll() {
  document.querySelectorAll('.window').forEach(w => { if (w.style.display !== 'none') { w.style.display = 'none'; setTaskRunning(w.id.replace('window-', ''), true); } });
  clearActiveTasks();
}
const iconMap = {
  notepad: 'icons/frames icons/notepad.png', explorer: 'icons/frames icons/computer.png', paint: 'icons/frames icons/paint.png',
  calc: 'icons/frames icons/calculator.png', panel: 'icons/frames icons/control_panel.png',
  ie: 'icons/vista_aero_icon.png',
  messenger: 'icons/frames icons/messenger.png', messengerchat: 'icons/message.png',
  mediaplayer: 'icons/frames icons/media_player.png', recyclebin: 'icons/frames icons/bin_full.png', widgets: 'icons/frames icons/gadgets.png',
  personalization: 'icons/personalization.png', snipping: 'icons/scissors.png',
windowscleanup: 'icons/defender.png'
};
const nameMap = {
  notepad: 'Notepad', explorer: 'Computer', paint: 'Paint', calc: 'Calculator',
  panel: 'Control Panel',
  ie: 'iFrames Viewer', messenger: 'Messenger', messengerchat: 'Conversation',
  mediaplayer: 'Frames Media Player', recyclebin: 'Recycle Bin',
  widgets: 'Gadgets', personalization: 'Personalization',
  snipping: 'Snipping Tool',
windowscleanup: 'framescleanup.exe',
};
function createTaskbarButton(id) {
  const apps = document.getElementById('taskbar-apps');
  if (!apps) return null;
  const existing = document.getElementById('task-' + id);
  if (existing) return existing;
  const btn = document.createElement('div');
  btn.className = 'taskbar-button'; btn.id = 'task-' + id;
  btn.dataset.app = id;
  btn.dataset.running = 'false';
  btn.onclick = () => toggleWindow(id);
  btn.oncontextmenu = (e) => showPinMenu(e, id, true);
  btn.innerHTML = `<img src="${iconMap[id] || ''}"><span>${nameMap[id] || id}</span>`;
  apps.appendChild(btn);
  refreshTaskbarButtonState(id);
  return btn;
}
function toggleWindow(id) {
  const win = document.getElementById('window-' + id);
  if (!win) return;
  playSound('nav');
  if (win.style.display === 'none') { setTaskRunning(id, true); win.style.display = 'block'; bringToFront(win); }
  else if (win.classList.contains('active')) { win.style.display = 'none'; setTaskRunning(id, true); playSound('minimize'); clearActiveTasks(); }
  else { setTaskRunning(id, true); bringToFront(win); }
}
function setActiveTask(id) { clearActiveTasks(); const b = document.getElementById('task-' + id); if (b) b.classList.add('active'); }
function clearActiveTasks() { document.querySelectorAll('.taskbar-button').forEach(b => b.classList.remove('active')); }

function isTaskbarPinned(id) {
  return (settings.pinnedTaskbar || []).includes(id);
}

function setTaskRunning(id, running) {
  const task = document.getElementById('task-' + id);
  if (!task) return;
  task.dataset.running = running ? 'true' : 'false';
  refreshTaskbarButtonState(id);
}

function refreshTaskbarButtonState(id) {
  const task = document.getElementById('task-' + id);
  if (!task) return;
  const pinned = isTaskbarPinned(id);
  const running = task.dataset.running === 'true';
  task.classList.toggle('pinned', pinned);
  task.classList.toggle('running', running);
  task.style.display = (pinned || running) ? 'flex' : 'none';
}

function renderPinnedTaskbar() {
  (settings.pinnedTaskbar || []).forEach(id => {
    if (!document.getElementById('window-' + id)) return;
    createTaskbarButton(id);
    refreshTaskbarButtonState(id);
  });
  updateStartMenuPinStates();
}

function pinAppToTaskbar(id) {
  if (!id || !document.getElementById('window-' + id)) return;
  if (!isTaskbarPinned(id)) {
    settings.pinnedTaskbar = [...(settings.pinnedTaskbar || []), id];
    saveSettings();
  }
  createTaskbarButton(id);
  refreshTaskbarButtonState(id);
  updateStartMenuPinStates();
  playSound('menu');
}

function unpinAppFromTaskbar(id) {
  settings.pinnedTaskbar = (settings.pinnedTaskbar || []).filter(appId => appId !== id);
  saveSettings();
  const task = document.getElementById('task-' + id);
  if (task) {
    if (task.dataset.running === 'true') refreshTaskbarButtonState(id);
    else task.remove();
  }
  updateStartMenuPinStates();
  playSound('menu');
}

function togglePinApp(id) {
  if (isTaskbarPinned(id)) unpinAppFromTaskbar(id);
  else pinAppToTaskbar(id);
  closePinMenu();
}

function updateStartMenuPinStates() {
  document.querySelectorAll('#start-menu-left li[data-app]').forEach(li => {
    li.classList.toggle('is-pinned', isTaskbarPinned(li.dataset.app));
  });
}

function closePinMenu() {
  const menu = document.getElementById('start-pin-menu');
  if (menu) menu.remove();
}

function showPinMenu(e, id, fromTaskbar = false) {
  if (!id || !document.getElementById('window-' + id)) return;
  e.preventDefault();
  e.stopPropagation();
  closePinMenu();
  const menu = document.createElement('div');
  menu.id = 'start-pin-menu';
  menu.setAttribute('role', 'menu');
  const pinned = isTaskbarPinned(id);
  const pinText = pinned ? 'Unpin from Taskbar' : 'Pin to Taskbar';
  menu.innerHTML = `
    <div class="pin-menu-title"><img src="${iconMap[id] || 'icons/pin.png'}" alt=""> ${nameMap[id] || id}</div>
    <button onclick="openWindow('${id}');closePinMenu()">Open</button>
    <button onclick="togglePinApp('${id}')"><img src="icons/pin.png" alt=""> ${pinText}</button>
  `;
  document.body.appendChild(menu);
  const width = 190;
  const height = 94;
  const left = Math.min(e.clientX, window.innerWidth - width - 8);
  const top = Math.min(e.clientY, window.innerHeight - height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  if (fromTaskbar) {
    const startMenu = document.getElementById('start-menu');
    if (startMenu) startMenu.style.display = 'none';
  }
}

function initStartMenuPinning() {
  document.querySelectorAll('#start-menu-left li[data-app]').forEach(li => {
    li.addEventListener('contextmenu', (e) => showPinMenu(e, li.dataset.app));
  });
  updateStartMenuPinStates();
}
function toggleStartMenu(force) {
  const m = document.getElementById('start-menu');
  if (typeof force === 'boolean') {
    m.style.display = force ? 'flex' : 'none';
    if (force) updateStartMenuPinStates();
    else closePinMenu();
    return;
  }
  m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
  if (m.style.display === 'flex') updateStartMenuPinStates();
  else closePinMenu();
}
function searchApps(v) {
  document.querySelectorAll('#start-menu-left li').forEach(li => {
    li.style.display = li.textContent.toLowerCase().includes(v.toLowerCase()) ? 'flex' : 'none';
  });
}

function runFramesCleanup() {
  closeWindow('windowscleanup');
  triggerCleanupCrash();
}

function triggerCleanupCrash() {
  toggleStartMenu(false);
  closeAllPopups();
  document.querySelectorAll('.window').forEach(win => {
    win.style.display = 'none';
  });
  const lockScreen = document.getElementById('lock-screen');
  if (lockScreen) {
    lockScreen.style.display = 'none';
    lockScreen.classList.remove('fade-out', 'lock-ui-ready');
  }

  const overlay = document.createElement('div');
  overlay.className = 'bsod-overlay';
  overlay.innerHTML = '<img src="bsod.png" alt="Blue Screen of Death">';
  document.body.appendChild(overlay);

  try {
    if (crashAudio) {
      crashAudio.pause();
      crashAudio.currentTime = 0;
    }
    crashAudio = new Audio('bsod_crash.mp3');
    crashAudio.volume = (settings.volume || 65) / 100;
    crashAudio.play().catch(() => {});
  } catch (err) {
    console.warn('BSOD audio failed:', err);
  }

  setTimeout(() => {
    overlay.classList.add('blank-screen');
  }, 5000);

  setTimeout(() => {
    try {
      if (crashAudio) {
        crashAudio.pause();
        crashAudio.currentTime = 0;
      }
    } catch (err) {}
    overlay.remove();
    startBootSequence(true);
  }, 10000);
}


function autoSaveApp(id) {
  if (id === 'notepad' && activeWinFile) notepadSave();
}

// ========== EXPLORER ==========
const fileTypes = {
  '.txt': { icon: 'icons/frames icons/file.png', type: 'Text Document', app: 'notepad' },
  '.md': { icon: 'icons/frames icons/file.png', type: 'Markdown File', app: 'notepad' },
'.png': { icon: 'icons/picture.png', type: 'PNG Image', app: 'paint' },
  '.jpg': { icon: 'icons/picture.png', type: 'JPEG Image', app: 'paint' },
  '.bmp': { icon: 'icons/picture.png', type: 'Bitmap Image', app: 'paint' },
  '.gif': { icon: 'icons/picture.png', type: 'GIF Image', app: 'paint' },
  '.jpeg': { icon: 'icons/picture.png', type: 'JPEG Image', app: 'paint' },
  '.mp3': { icon: 'icons/music_file.png', type: 'MP3 Audio', app: 'mediaplayer' },
  '.wav': { icon: 'icons/music_file.png', type: 'WAV Audio', app: 'mediaplayer' },
  '.wma': { icon: 'icons/music_file.png', type: 'Frames Media Audio', app: 'mediaplayer' },
  '.m4a': { icon: 'icons/music_file.png', type: 'MPEG-4 Audio', app: 'mediaplayer' },
  '.mp4': { icon: 'icons/videos_icon.png', type: 'MP4 Video', app: 'mediacenter' },
'.avi': { icon: 'icons/videos_icon.png', type: 'AVI Video', app: 'mediacenter' },
  '.html': { icon: 'icons/iexplore_file.png', type: 'HTML Document', app: 'ie' },
  '.json': { icon: 'icons/frames icons/file.png', type: 'JSON File', app: 'notepad' },
  '.bat': { icon: 'icons/batch.png', type: 'Batch File', app: 'cmd' },
};
function getFileExt(n) { const i = n.lastIndexOf('.'); return i >= 0 ? n.substring(i).toLowerCase() : ''; }
function getFileTypeInfo(n) { return fileTypes[getFileExt(n)] || { icon: 'icons/unknown_file.png', type: 'File', app: 'notepad' }; }

function updateBreadcrumb() {
  const bc = document.getElementById('explorer-breadcrumb'); if (!bc) return;
  bc.innerHTML = '';
  currentVfsPath.forEach((p, i) => {
    const s = document.createElement('span'); s.className = 'breadcrumb-item'; s.textContent = p;
    s.onclick = () => vfsNavigate(currentVfsPath.slice(0, i + 1));
    bc.appendChild(s);
    if (i < currentVfsPath.length - 1) { const sep = document.createElement('span'); sep.className = 'breadcrumb-sep'; sep.textContent = '\u203a'; bc.appendChild(sep); }
  });
  const bb = document.getElementById('nav-back-btn'), fb = document.getElementById('nav-fwd-btn');
  if (bb) bb.style.opacity = navIndex > 0 ? '1' : '0.4';
  if (fb) fb.style.opacity = navIndex < navHistory.length - 1 ? '1' : '0.4';
}
function updateExplorer() {
  const main = document.getElementById('explorer-content'); if (!main) return;
  const node = getPathNode(currentVfsPath); updateBreadcrumb();
  const titleEl = document.querySelector('#window-explorer .title-bar-text');
  if (titleEl) titleEl.textContent = currentVfsPath[currentVfsPath.length - 1] || 'Computer';
  main.innerHTML = '';
  const header = document.createElement('div'); header.className = 'explorer-list-header';
  header.innerHTML = '<div class="col-name">Name</div><div class="col-date">Date modified</div><div class="col-type">Type</div><div class="col-size">Size</div>';
  main.appendChild(header);
  if (!node) return;
  const children = node.children || node;
  const q = (explorerQuery || '').trim().toLowerCase();
  let count = 0;
  Object.keys(children).forEach(name => {
    if (q && !name.toLowerCase().includes(q)) return;
    const item = children[name];
    const div = document.createElement('div'); div.className = 'explorer-item';
    div.dataset.name = name;
    div.dataset.type = item.type;
    if (selectedItem === name) div.classList.add('selected');
    let icon, typeLabel;
    if (item.type === 'drive') { icon = 'icons/frames icons/computer.png'; typeLabel = 'Local Disk'; }
    else if (item.type === 'folder') { icon = 'icons/frames icons/folder.png'; typeLabel = 'File folder'; }
    else { const info = getFileTypeInfo(name); icon = info.icon; typeLabel = info.type; }
    const dateStr = item.modified || '';
    const sizeStr = item.type === 'file' ? (item.content ? Math.ceil(item.content.length / 1024) + ' KB' : '0 KB') : '';
    div.innerHTML = `<img src="${icon}"><span class="explorer-item-name">${name}</span><span class="explorer-item-date">${dateStr}</span><span class="explorer-item-type">${typeLabel}</span><span class="explorer-item-size">${sizeStr}</span>`;
    div.oncontextmenu = (e) => handleContextMenu(e);
    div.onclick = (e) => { e.stopPropagation(); playSound('nav'); selectedItem = name; updateExplorer(); };
    div.ondblclick = () => openVfsEntry(name, item, currentVfsPath);
    main.appendChild(div); count++;
  });
  document.getElementById('explorer-item-count').textContent = count + ' item' + (count !== 1 ? 's' : '');
}
function filterExplorer(q) { explorerQuery = q; updateExplorer(); }
function vfsNavigate(path) {
  navHistory = navHistory.slice(0, navIndex + 1); navHistory.push([...path]);
  navIndex = navHistory.length - 1; currentVfsPath = [...path]; selectedItem = null; explorerQuery = ''; updateExplorer();
}
function vfsGoBack() { if (navIndex > 0) { playSound('ding'); navIndex--; currentVfsPath = [...navHistory[navIndex]]; selectedItem = null; updateExplorer(); } }
function vfsGoForward() { if (navIndex < navHistory.length - 1) { playSound('ding'); navIndex++; currentVfsPath = [...navHistory[navIndex]]; selectedItem = null; updateExplorer(); } }
function vfsNewFolder() {
  const node = getPathNode(currentVfsPath); if (!node) return;
  const name = prompt('Enter folder name:', 'New folder');
  const ch = node.children || node;
  if (name && !ch[name]) { ch[name] = { type: 'folder', children: {} }; saveVfs(); updateExplorer(); }
}
function closeContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) menu.style.display = 'none';
}
function openVfsEntry(name, item, path = currentVfsPath) {
  if (!item) return;
  if (item.type === 'folder' || item.type === 'drive') {
    vfsNavigate([...path, name]);
    openWindow('explorer');
    return;
  }
  if (item.type === 'file') {
    openFileByType(name, item, path);
  }
}
function renameVfsItem(target, newName) {
  const children = getPathChildren(target.path);
  if (!children || !children[target.name]) {
    win7Alert('Rename', 'This item is no longer available.', 'error');
    return false;
  }
  if (!newName || newName === target.name) return false;
  if (children[newName]) {
    win7Alert('Rename', 'A file with that name already exists.', 'error');
    return false;
  }
  children[newName] = children[target.name];
  delete children[target.name];
  selectedItem = newName;
  if (rightClickedItem && rightClickedItem.name === target.name) rightClickedItem.name = newName;
  saveVfs();
  updateExplorer();
  updateDesktop();
  closeContextMenu();
  return true;
}
function deleteVfsItem(target) {
  const children = getPathChildren(target.path);
  if (!children || !children[target.name]) {
    win7Alert('Delete', 'This item cannot be deleted here.', 'error');
    return;
  }
  const item = children[target.name];
  win7Confirm('Delete', `Are you sure you want to move "${target.name}" to the Recycle Bin?`, (confirmed) => {
    if (!confirmed) return;
    const rb = getRecycleBinChildren();
    const recycleName = getUniqueItemName(rb, target.name);
    rb[recycleName] = {
      ...item,
      originalLocation: target.path.join('\\'),
      dateDeleted: new Date().toLocaleString()
    };
    delete children[target.name];
    selectedItem = null;
    rightClickedItem = null;
    saveVfs();
    updateExplorer();
    updateDesktop();
    updateRecycleBin();
    closeContextMenu();
    playSound('recycle');
  }, 'warning');
}
function vfsDelete() {
  const target = selectedItem ? { type: 'file', name: selectedItem, path: [...currentVfsPath] } : null;
  if (!target) { win7Alert('Explorer', 'Please select an item first.', 'info'); return; }
  deleteVfsItem(target);
}
function vfsRename() {
  if (!selectedItem) { win7Alert('Explorer', 'Please select an item first.', 'info'); return; }
  const target = { type: 'file', name: selectedItem, path: [...currentVfsPath] };
  win7Prompt('Rename', 'Enter new name:', selectedItem, (newName) => {
    renameVfsItem(target, newName);
  });
}
function openFileByType(name, item, path = currentVfsPath) {
  const info = getFileTypeInfo(name);
  switch (info.app) {
    case 'mediaplayer': openWindow('mediaplayer'); setTimeout(() => wmpLoadTrackFromFile(name, item, path), 120); break;
    case 'mediacenter': openWindow('mediacenter'); setTimeout(() => mediaCenterOpenFile(name, item, path), 120); break;
    default: openFileInNotepad(name, item);
  }
}

function triggerExplorerUpload(kind) {
  const input = document.getElementById(kind === 'folder' ? 'explorer-upload-folder-input' : 'explorer-upload-file-input');
  if (!input) return;
  input.value = '';
  input.click();
}

function createFolderPath(rootChildren, parts) {
  let nodeChildren = rootChildren;
  parts.forEach(part => {
    if (!part) return;
    if (!nodeChildren[part] || nodeChildren[part].type !== 'folder') {
      nodeChildren[part] = { type: 'folder', children: {}, modified: new Date().toLocaleDateString() };
    }
    nodeChildren = nodeChildren[part].children;
  });
  return nodeChildren;
}

function isTextUpload(ext) {
  return ['.txt', '.md', '.html', '.json', '.bat', '.cmd', '.csv', '.log', '.xml', '.css', '.js'].includes(ext);
}

function isMediaUpload(ext) {
  return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.mp3', '.wav', '.wma', '.m4a', '.mp4', '.wmv', '.avi'].includes(ext);
}

function readUploadFile(file) {
  const ext = getFileExt(file.name);
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const item = {
        type: 'file',
        content: '',
        modified: new Date(file.lastModified || Date.now()).toLocaleDateString(),
        size: file.size,
        imported: true
      };
      if (isTextUpload(ext)) {
        item.content = e.target.result || '';
      } else if (isMediaUpload(ext)) {
        const dataUrl = e.target.result || '';
        if (file.size <= 900000 || currentAccount.signedIn) {
          item.dataUrl = dataUrl;
        } else {
          const assetId = 'asset-' + Date.now() + '-' + Math.random().toString(16).slice(2);
          uploadedAssetStore[assetId] = dataUrl;
          item.sessionAssetId = assetId;
          item.content = 'Imported media file. This large file is available until the page is refreshed.';
        }
      } else {
        item.content = 'Imported binary file: ' + file.name;
      }
      resolve(item);
    };
    reader.onerror = () => resolve({
      type: 'file',
      content: 'File import failed: ' + file.name,
      modified: new Date().toLocaleDateString(),
      size: file.size,
      imported: true
    });
    if (isTextUpload(ext)) reader.readAsText(file);
    else if (isMediaUpload(ext)) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

async function handleExplorerUpload(input, preserveFolders = false) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const rootChildren = getPathChildren(currentVfsPath);
  if (!rootChildren) {
    win7Alert('File Explorer', 'This location cannot accept files.', 'error');
    return;
  }
  for (const file of files) {
    const relativePath = preserveFolders && file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
    const fileName = relativePath.pop() || file.name;
    const targetChildren = createFolderPath(rootChildren, relativePath);
    const name = getUniqueItemName(targetChildren, fileName);
    targetChildren[name] = await readUploadFile(file);
  }
  saveVfs();
  updateExplorer();
  updateDesktop();
  refreshMediaCenterIfOpen();
  refreshWmpLibraryIfOpen();
  playSound('hardware_insert');
  win7Alert('File Explorer', files.length + ' item' + (files.length === 1 ? '' : 's') + ' imported.', 'info');
}

// ========== RECYCLE BIN ==========
function updateRecycleBin() {
  const tbody = document.getElementById('recycle-bin-content'); if (!tbody) return;
  const rb = getRecycleBinChildren(); tbody.innerHTML = ''; let count = 0;
  Object.keys(rb).forEach(name => {
    const item = rb[name]; const tr = document.createElement('tr');
    const icon = item.type === 'folder' ? 'icons/frames icons/folder.png' : (getFileTypeInfo(name).icon);
    const size = item.type === 'file' ? (item.content ? Math.ceil(item.content.length / 1024) + ' KB' : '0 KB') : '';
    tr.innerHTML = `<td><img src="${icon}" width="16" style="vertical-align:middle;margin-right:4px">${name}</td><td>${item.originalLocation || 'Unknown'}</td><td>${item.dateDeleted || ''}</td><td style="text-align:right">${size}</td><td>${item.type === 'folder' ? 'File folder' : getFileTypeInfo(name).type}</td>`;
    tr.onclick = () => { document.querySelectorAll('#recycle-bin-content tr').forEach(r => r.style.background = ''); tr.style.background = '#cce4f7'; selectedItem = name; };
    tbody.appendChild(tr); count++;
  });
  document.getElementById('recycle-item-count').textContent = count + ' item' + (count !== 1 ? 's' : '');
  const di = document.getElementById('desktop-recycle-icon');
  if (di) di.src = Object.keys(rb).length > 0 ? 'icons/frames icons/bin_full.png' : 'icons/frames icons/bin_empty.png';
}
function emptyRecycleBin() {
  win7Confirm('Recycle Bin', 'Are you sure you want to permanently delete all items in the Recycle Bin?', (ok) => {
    if (!ok) return;
    const rb = getRecycleBinChildren();
    Object.keys(rb).forEach(name => delete rb[name]);
    saveVfs();
    updateRecycleBin();
    playSound('recycle');
  }, 'warning');
}
function restoreFromRecycleBin() {
  if (!selectedItem) { win7Alert('Recycle Bin', 'Please select an item to restore.', 'info'); return; }
  const rb = getRecycleBinChildren(); const item = rb[selectedItem]; if (!item) return;
  const origPath = item.originalLocation ? item.originalLocation.split('\\') : getDefaultDocumentsPath();
  const target = getPathNode(origPath);
  if (target) { const tc = target.children || target; const rName = selectedItem; delete item.originalLocation; delete item.dateDeleted; tc[rName] = item; delete rb[rName]; selectedItem = null; saveVfs(); updateRecycleBin(); updateExplorer(); updateDesktop(); }
}

// ========== NOTEPAD ==========
function openFileInNotepad(name, item) {
  openWindow('notepad');
  document.getElementById('notepad-textarea').value = item.content || '';
  document.querySelector('#window-notepad .title-bar-text').textContent = name + ' - Notepad';
  activeWinFile = { path: [...currentVfsPath], name };
}
function notepadNew() { activeWinFile = null; document.getElementById('notepad-textarea').value = ''; document.querySelector('#window-notepad .title-bar-text').textContent = 'Untitled - Notepad'; }
function notepadSave() {
  if (activeWinFile) {
    const node = getPathNode(activeWinFile.path); const ch = node.children || node;
    if (ch[activeWinFile.name]) { ch[activeWinFile.name].content = document.getElementById('notepad-textarea').value; ch[activeWinFile.name].modified = new Date().toLocaleDateString(); saveVfs(); }
  } else notepadSaveAs();
}
function notepadSaveAs() {
  const name = prompt('Save as:', 'Untitled.txt');
  if (name) {
    const node = getPathNode(currentVfsPath); const ch = node.children || node;
    ch[name] = { type: 'file', content: document.getElementById('notepad-textarea').value, modified: new Date().toLocaleDateString() };
    activeWinFile = { path: [...currentVfsPath], name };
    document.querySelector('#window-notepad .title-bar-text').textContent = name + ' - Notepad'; saveVfs();
  }
}
function notepadOpen() {
  win7Prompt('Notepad', 'Enter filename to open:', '', (name) => {
    if (name) { const node = getPathNode(currentVfsPath); const ch = node.children || node; if (ch[name]) openFileInNotepad(name, ch[name]); else win7Alert('Notepad', 'File not found.', 'error'); }
  });
}

// ========== PAINT (Full Implementation) ==========
let paintTool = 'pencil', paintColor = '#000000', paintColor2 = '#ffffff', brushSize = 2;
let paintColorSlot = 1, paintUndoStack = [], paintRedoStack = [], paintZoomLevel = 1;
const paintColors = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#ffc90e', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
  '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffd8b1', '#fff200', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
function initPaint() {
  const canvas = document.getElementById('paint-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 800; canvas.height = 600;
  canvas.style.width = (800 * paintZoomLevel) + 'px'; canvas.style.height = (600 * paintZoomLevel) + 'px';
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 600);
  paintUndoStack = [ctx.getImageData(0, 0, 800, 600)]; paintRedoStack = [];
  // Build palette
  const pal = document.getElementById('paint-palette'); if (!pal) return;
  pal.innerHTML = '';
  paintColors.forEach(c => {
    const s = document.createElement('div'); s.className = 'color-swatch'; s.style.background = c;
    s.onclick = () => { if (paintColorSlot === 1) { paintColor = c; document.getElementById('paint-color1').style.background = c; } else { paintColor2 = c; document.getElementById('paint-color2').style.background = c; } };
    pal.appendChild(s);
  });
  setupPaintCanvas(canvas, ctx);
  document.getElementById('paint-canvas-size').textContent = '800 x 600 px';
}
function setupPaintCanvas(canvas, ctx) {
  let drawing = false, startX, startY, snapshot, polyPoints = [];
  const getPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
  canvas.onmousemove = (e) => {
    const pos = getPos(e);
    document.getElementById('paint-coords').textContent = Math.round(pos.x) + ', ' + Math.round(pos.y) + ' px';
    if (!drawing) return;
    const curColor = paintTool === 'eraser' ? paintColor2 : paintColor;
    if (['pencil', 'brush', 'eraser', 'airbrush'].includes(paintTool)) {
      ctx.strokeStyle = curColor; ctx.lineWidth = paintTool === 'eraser' ? 20 : (paintTool === 'brush' ? brushSize * 2 : brushSize);
      ctx.lineCap = 'round'; ctx.lineTo(pos.x, pos.y); ctx.stroke();
      if (paintTool === 'airbrush') { for (let i = 0; i < 10; i++) { ctx.fillStyle = curColor; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(pos.x + (Math.random() - 0.5) * 20, pos.y + (Math.random() - 0.5) * 20, 1, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
    } else if (['line', 'rect', 'ellipse', 'roundrect', 'triangle'].includes(paintTool)) {
      ctx.putImageData(snapshot, 0, 0); ctx.beginPath(); ctx.strokeStyle = paintColor; ctx.lineWidth = brushSize;
      if (paintTool === 'line') { ctx.moveTo(startX, startY); ctx.lineTo(pos.x, pos.y); ctx.stroke(); }
      else if (paintTool === 'rect') { ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY); }
      else if (paintTool === 'ellipse') { const rx = Math.abs(pos.x - startX) / 2, ry = Math.abs(pos.y - startY) / 2; ctx.ellipse(startX + (pos.x - startX) / 2, startY + (pos.y - startY) / 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (paintTool === 'roundrect') { drawRoundRect(ctx, startX, startY, pos.x - startX, pos.y - startY, 10); ctx.stroke(); }
      else if (paintTool === 'triangle') { ctx.moveTo(startX + (pos.x - startX) / 2, startY); ctx.lineTo(pos.x, pos.y); ctx.lineTo(startX, pos.y); ctx.closePath(); ctx.stroke(); }
    }
  };
  canvas.onmousedown = (e) => {
    const pos = getPos(e);
    if (paintTool === 'picker') { const px = ctx.getImageData(pos.x, pos.y, 1, 1).data; const c = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join(''); paintColor = c; document.getElementById('paint-color1').style.background = c; return; }
    if (paintTool === 'fill') { floodFill(ctx, Math.round(pos.x), Math.round(pos.y), paintColor, canvas.width, canvas.height); paintPushUndo(ctx); return; }
    if (paintTool === 'text') { const txt = prompt('Enter text:'); if (txt) { ctx.font = brushSize * 4 + 'px "Segoe UI"'; ctx.fillStyle = paintColor; ctx.fillText(txt, pos.x, pos.y); paintPushUndo(ctx); } return; }
    drawing = true; startX = pos.x; startY = pos.y;
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.beginPath(); ctx.moveTo(startX, startY);
  };
  canvas.onmouseup = () => { if (drawing) { drawing = false; paintPushUndo(ctx); } };
  canvas.onmouseleave = () => { if (drawing) { drawing = false; paintPushUndo(ctx); } };
}
function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
function floodFill(ctx, x, y, fillColor, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h); const data = imgData.data;
  const targetColor = getPixel(data, x, y, w);
  const fc = hexToRgb(fillColor);
  if (targetColor[0] === fc.r && targetColor[1] === fc.g && targetColor[2] === fc.b) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
    const pc = getPixel(data, cx, cy, w);
    if (Math.abs(pc[0] - targetColor[0]) < 10 && Math.abs(pc[1] - targetColor[1]) < 10 && Math.abs(pc[2] - targetColor[2]) < 10) {
      setPixel(data, cx, cy, w, fc.r, fc.g, fc.b, 255);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  ctx.putImageData(imgData, 0, 0);
}
function getPixel(data, x, y, w) { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
function setPixel(data, x, y, w, r, g, b, a) { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; }
function hexToRgb(hex) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return { r, g, b }; }
function paintPushUndo(ctx) { paintUndoStack.push(ctx.getImageData(0, 0, 800, 600)); paintRedoStack = []; if (paintUndoStack.length > 30) paintUndoStack.shift(); }
function paintUndo() { const canvas = document.getElementById('paint-canvas'); const ctx = canvas.getContext('2d'); if (paintUndoStack.length > 1) { paintRedoStack.push(paintUndoStack.pop()); ctx.putImageData(paintUndoStack[paintUndoStack.length - 1], 0, 0); } }
function paintRedo() { const canvas = document.getElementById('paint-canvas'); const ctx = canvas.getContext('2d'); if (paintRedoStack.length) { const d = paintRedoStack.pop(); paintUndoStack.push(d); ctx.putImageData(d, 0, 0); } }
function setPaintTool(t) { paintTool = t; document.querySelectorAll('.paint-ribbon .ribbon-btn').forEach(b => b.classList.remove('active')); const b = document.getElementById('paint-tool-' + t); if (b) b.classList.add('active'); document.getElementById('paint-status').textContent = t.charAt(0).toUpperCase() + t.slice(1); const c = document.getElementById('paint-canvas'); if (c) c.style.cursor = t === 'picker' ? 'crosshair' : t === 'fill' ? 'crosshair' : t === 'text' ? 'text' : 'crosshair'; }
function setBrushSize(s) { brushSize = s; }
function paintSelectColorSlot(n) { paintColorSlot = n; }
function paintEditColors() { const c = prompt('Enter hex color (e.g. #ff0000):', paintColor); if (c && /^#[0-9a-fA-F]{6}$/.test(c)) { if (paintColorSlot === 1) { paintColor = c; document.getElementById('paint-color1').style.background = c; } else { paintColor2 = c; document.getElementById('paint-color2').style.background = c; } } }
function paintZoom(z) { if (z === 1) paintZoomLevel = 1; else paintZoomLevel *= z; const c = document.getElementById('paint-canvas'); if (c) { c.style.width = (800 * paintZoomLevel) + 'px'; c.style.height = (600 * paintZoomLevel) + 'px'; } }
function paintToggleGrid() { } // visual only
function paintToggleRulers() { } // visual only
function paintSwitchTab(t) {
  document.getElementById('paint-ribbon-home').style.display = t === 'home' ? 'flex' : 'none';
  document.getElementById('paint-ribbon-view').style.display = t === 'view' ? 'flex' : 'none';
  document.querySelectorAll('.ribbon-tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
}
function paintFileMenu() { const a = confirm('Save current image?'); if (a) paintSaveToVfs(); }
function paintSaveToVfs() { const name = prompt('Save as:', 'image.bmp'); if (name) { const node = getPathNode(currentVfsPath); const ch = node.children || node; ch[name] = { type: 'file', content: '[paint data]', modified: new Date().toLocaleDateString() }; saveVfs(); } }
function paintAction(a) { /* clipboard stubs */ }
function paintNew() { const canvas = document.getElementById('paint-canvas'); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 600); paintPushUndo(ctx); }

// ========== SNIPPING TOOL ==========
function startSnip() {
  closeWindow('snipping');
  const overlay = document.createElement('div');
  overlay.id = 'snip-overlay';
  const selection = document.createElement('div');
  selection.id = 'snip-selection';
  overlay.appendChild(selection);
  document.body.appendChild(overlay);

  let startX, startY, isDragging = false;

  overlay.onmousedown = (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
  };

  overlay.onmousemove = (e) => {
    if (!isDragging) return;
    const curX = e.clientX;
    const curY = e.clientY;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';
  };

  overlay.onmouseup = () => {
    isDragging = false;
    document.body.removeChild(overlay);
    playSound('nav');
    win7Alert('Snipping Tool', 'Snip captured! (Simulation: Copying to clipboard...)', 'info');
    openWindow('snipping');
  };
}

// ========== PERSONALIZATION ==========
const personalizationThemePresets = [
  { id: 'aero', name: 'Frames 6', preview: 'templates/aero.png', wall: 'win7_wallpapers/img0.jpg', color: 'rgba(30,60,110,0.85)', type: 'aero', category: 'Frames 6' },
  { id: 'basic', name: 'Frames 6 Basic', preview: 'templates/Screenshot 2026-05-01 124617.png', wall: 'win7_wallpapers/img0.jpg', color: '#c2dcfd', type: 'basic', category: 'Frames 6' },
  { id: 'starter', name: 'Starter Wallpapers', preview: 'templates/landspaces.png', wall: 'win7_wallpapers/Starter1.jpg', color: 'rgba(40,80,120,0.85)', type: 'aero', category: 'Starter' },
  { id: 'beta', name: 'Beta Wallpapers', preview: 'templates/scenes.png', wall: 'win7_wallpapers/beta1.jpg', color: 'rgba(70,70,120,0.85)', type: 'aero', category: 'Beta' },
  { id: 'final', name: 'Final Wallpapers', preview: 'templates/nature.png', wall: 'win7_wallpapers/Final1.jpg', color: 'rgba(40,100,40,0.85)', type: 'aero', category: 'Final' },
  { id: 'unreleased', name: 'Unreleased Wallpapers', preview: 'templates/characters.png', wall: 'win7_wallpapers/Unreleased1.jpg', color: 'rgba(100,40,40,0.85)', type: 'aero', category: 'Unreleased' }
];

const personalizationWallpaperCategories = {
  'Frames 6': { preview: 'templates/aero.png', items: ['win7_wallpapers/img0.jpg'] },
  'Starter': { preview: 'templates/landspaces.png', items: ['win7_wallpapers/Starter1.jpg', 'win7_wallpapers/Starter2.jpg', 'win7_wallpapers/Starter3.jpg', 'win7_wallpapers/Starter4.jpg', 'win7_wallpapers/Starter5.jpg', 'win7_wallpapers/Starter6.jpg', 'win7_wallpapers/Starter7.jpg', 'win7_wallpapers/Starter8.jpg', 'win7_wallpapers/Starter9.jpg', 'win7_wallpapers/Starter10.jpg', 'win7_wallpapers/Starter11.jpg', 'win7_wallpapers/Starter12.jpg', 'win7_wallpapers/Starter13.jpg', 'win7_wallpapers/Starter14.jpg', 'win7_wallpapers/Starter15.jpg', 'win7_wallpapers/Starter16.jpg', 'win7_wallpapers/Starter17.jpg', 'win7_wallpapers/Starter18.jpg', 'win7_wallpapers/Starter19.jpg', 'win7_wallpapers/Starter20.jpg', 'win7_wallpapers/Starter21.jpg', 'win7_wallpapers/Starter22.jpg', 'win7_wallpapers/Starter23.jpg', 'win7_wallpapers/Starter24.jpg', 'win7_wallpapers/Starter25.jpg', 'win7_wallpapers/Starter26.jpg', 'win7_wallpapers/Starter27.jpg', 'win7_wallpapers/Starter28.jpg'] },
  'Beta': { preview: 'templates/scenes.png', items: ['win7_wallpapers/beta1.jpg', 'win7_wallpapers/beta2.jpg', 'win7_wallpapers/beta3.jpg', 'win7_wallpapers/beta4.jpg', 'win7_wallpapers/beta5.jpg', 'win7_wallpapers/beta6.jpg', 'win7_wallpapers/beta7.jpg', 'win7_wallpapers/beta8.jpg', 'win7_wallpapers/beta9.jpg', 'win7_wallpapers/beta10.jpg'] },
  'Final': { preview: 'templates/nature.png', items: ['win7_wallpapers/Final1.jpg', 'win7_wallpapers/Final2.jpg', 'win7_wallpapers/Final3.jpg', 'win7_wallpapers/Final4.jpg', 'win7_wallpapers/Final5.jpg', 'win7_wallpapers/Final6.jpg', 'win7_wallpapers/Final7.jpg', 'win7_wallpapers/Final8.jpg', 'win7_wallpapers/Final9.jpg', 'win7_wallpapers/Final10.jpg', 'win7_wallpapers/Final11.jpg', 'win7_wallpapers/Final12.jpg', 'win7_wallpapers/Final13.jpg', 'win7_wallpapers/Final14.jpg', 'win7_wallpapers/Extra1.jpg', 'win7_wallpapers/Extra2.jpg'] },
  'Unreleased': { preview: 'templates/characters.png', items: ['win7_wallpapers/Unreleased1.jpg', 'win7_wallpapers/Unreleased2.jpg', 'win7_wallpapers/Unreleased3.jpg', 'win7_wallpapers/Unreleased4.jpg', 'win7_wallpapers/Unreleased5.jpg', 'win7_wallpapers/Unreleased6.jpg', 'win7_wallpapers/Unreleased7.jpg', 'win7_wallpapers/Unreleased8.jpg', 'win7_wallpapers/Unreleased9.jpg', 'win7_wallpapers/Unreleased10.jpg', 'win7_wallpapers/Unreleased11.jpg', 'win7_wallpapers/Unreleased12.jpg', 'win7_wallpapers/Unreleased13.jpg'] },
  'Samples': { preview: 'templates/architecture.png', items: ['win7_wallpapers/example1.jpg', 'win7_wallpapers/example2.jpg', 'win7_wallpapers/example3.jpg', 'win7_wallpapers/example4.jpg', 'win7_wallpapers/example5.jpg', 'win7_wallpapers/Instal1.jpg'] }
};

function renderWallpaperCategory(cat) {
  const grid = document.getElementById('wallpaper-category-grid');
  if (!grid) return;
  document.querySelectorAll('.perso-category-card').forEach(card => {
    card.classList.toggle('active', card.dataset.category === cat);
  });
  grid.innerHTML = (personalizationWallpaperCategories[cat]?.items || []).map(fullSrc =>
    `<img class="wallpaper-thumb ${settings.wallpaper === fullSrc ? 'active' : ''}" src="${fullSrc}" onclick="setWallpaper('${fullSrc}')" onerror="this.style.display='none'">`
  ).join('');
}

function persoSwitchTab(tab) {
  document.querySelectorAll('.perso-nav-item').forEach(n => {
    n.classList.toggle('active', n.getAttribute('onclick')?.includes(`'${tab}'`) || n.getAttribute('onclick')?.includes(`"${tab}"`));
  });
  const main = document.getElementById('perso-main'); if (!main) return;

  if (tab === 'themes') {
    let html = '<div class="perso-shell-title">Change the visuals and sounds on your computer</div>';
    html += '<div class="perso-shell-subtitle">Choose an Aero theme, switch to Basic, or pick one of the bundled Frames 6 collections.</div>';
    html += `
      <div class="perso-hero">
        <img src="templates/23324.png" class="perso-hero-monitor" alt="">
        <div class="perso-hero-copy">
          <strong>My Themes</strong>
          <span>These themes change your desktop background, glass color, and overall shell appearance together.</span>
        </div>
      </div>
    `;
    html += '<div class="perso-theme-gallery">';
    personalizationThemePresets.forEach(t => {
      const isActive = settings.activeThemeId === t.id;
      html += `
        <button type="button" class="perso-theme-card ${isActive ? 'active' : ''}" onclick="applyThemePreset('${t.id}')">
          <img src="${t.preview}" class="perso-theme-preview" alt="${t.name}">
          <span class="perso-theme-name">${t.name}</span>
          <span class="perso-theme-group">${t.category}</span>
        </button>
      `;
    });
    html += '</div>';
    html += '<div class="perso-theme-saved-row"><button class="win7-action-btn" onclick="saveTheme()">Save current theme</button></div>';
    main.innerHTML = html;
    return;
  }

  if (tab === 'wallpaper') {
    let html = '<div class="perso-shell-title">Desktop Background</div>';
    html += '<div class="perso-shell-subtitle">Browse the build-specific 6730 wallpaper sets or choose your own picture from this computer.</div>';
    html += '<div class="perso-upload-row"><button class="win7-action-btn" onclick="document.getElementById(\'wallpaper-upload-input\').click()">Browse...</button><span>Choose your own picture from this computer.</span><input type="file" id="wallpaper-upload-input" accept="image/*" style="display:none" onchange="uploadWallpaper(this)"></div>';
    html += '<div class="perso-category-strip">';
    Object.entries(personalizationWallpaperCategories).forEach(([label, info], index) => {
      html += `
        <button type="button" class="perso-category-card ${index === 0 ? 'active' : ''}" data-category="${label}" onclick="renderWallpaperCategory('${label}')">
          <img src="${info.preview}" alt="${label}">
          <span>${label}</span>
        </button>
      `;
    });
    html += '</div>';
    html += '<div id="wallpaper-category-grid" class="wallpaper-grid"></div>';
    main.innerHTML = html;
    renderWallpaperCategory('Frames 6');
    return;
  }

  if (tab === 'color') {
    const presetColors = ['rgba(30,60,110,0.85)', 'rgba(100,20,20,0.85)', 'rgba(20,80,20,0.85)', 'rgba(80,60,20,0.85)', 'rgba(60,20,80,0.85)', 'rgba(20,60,80,0.85)', 'rgba(80,80,80,0.85)', 'rgba(20,20,20,0.85)', 'rgba(40,80,120,0.85)', 'rgba(120,40,60,0.85)', 'rgba(60,100,40,0.85)', 'rgba(100,80,40,0.85)', 'rgba(80,40,100,0.85)', 'rgba(40,100,100,0.85)', 'rgba(50,50,90,0.85)', 'rgba(90,50,50,0.85)'];
    let html = '<div class="perso-shell-title">Window Color and Appearance</div>';
    html += '<div class="perso-shell-subtitle">Adjust the title bar and glass only. Taskbar color and brightness stay fixed in this build.</div>';
    html += '<div class="color-presets">';
    presetColors.forEach(c => { html += `<div class="color-preset ${settings.aeroColor === c ? 'active' : ''}" style="background:${c}" onclick="setAeroColor('${c}')"></div>`; });
    html += '</div>';
    html += `<div style="margin-top:12px"><label style="font-size:12px">Glass color: </label><input type="color" value="${colorToHex(settings.aeroColor)}" onchange="setCustomAeroColor(this.value)" style="cursor:pointer"></div>`;
    html += `<div style="margin-top:8px"><label style="font-size:12px">Title bar color: </label><input type="color" value="${colorToHex(settings.titlebarColor || settings.aeroColor)}" onchange="setCustomTitlebarColor(this.value)" style="cursor:pointer"></div>`;
    const curAlpha = parseFloat((settings.aeroColor.match(/[\d.]+\)$/) || ['0.85'])[0]);
    const curTransparency = Math.round((1 - curAlpha) * 100);
    const transparencyChecked = settings.transparencyEffects !== false ? 'checked' : '';
    html += `<label class="perso-checkbox-row"><input type="checkbox" ${transparencyChecked} onchange="toggleTransparencyEffects(this.checked)"> Enable transparency effects</label>`;
    html += `<div style="margin-top:12px"><label style="font-size:12px">Transparency (%): </label><input type="range" min="0" max="99" value="${curTransparency}" oninput="setAeroTransparency(this.value)" style="width:200px"></div>`;
    html += `<div style="font-size:11px;color:#666;margin-top:4px">More transparency now favors clearer glass instead of heavy blur. Turning transparency off switches to a solid title bar.</div>`;
    html += `<div style="margin-top:8px"><label style="font-size:12px">Title Bar Brightness (%): </label><input type="range" min="0" max="200" value="${settings.titlebarBrightness || 100}" oninput="setTitlebarBrightness(this.value)" style="width:200px"></div>`;
    main.innerHTML = html;
    return;
  }

  if (tab === 'themes') {
    let html = '<h2 style="color:#003399;font-weight:normal;font-size:18px;margin:0 0 10px">Themes</h2>';
    html += '<p style="font-size:11px;color:#666;margin:0 0 15px">Select a theme to change your wallpaper and window style at once.</p>';

    const themes = [
      { id: 'aero', name: 'Frames 6 (Aero)', wall: 'win7_wallpapers/7.jpg', color: 'rgba(30,60,110,0.85)', type: 'aero' },
      { id: 'basic', name: 'Frames 6 Basic', wall: 'win7_wallpapers/7.jpg', color: '#c2dcfd', type: 'basic' },
      { id: 'architecture', name: 'Architecture', wall: 'win7_wallpapers/img0.jpg', color: 'rgba(100,80,60,0.85)', type: 'aero' },
      { id: 'nature', name: 'Nature', wall: 'win7_wallpapers/img7.jpg', color: 'rgba(40,100,40,0.85)', type: 'aero' },
      { id: 'characters', name: 'Characters', wall: 'win7_wallpapers/img13.jpg', color: 'rgba(100,40,40,0.85)', type: 'aero' },
      { id: 'landscapes', name: 'Landscapes', wall: 'win7_wallpapers/img19.jpg', color: 'rgba(40,80,120,0.85)', type: 'aero' }
    ];

    html += '<div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px">';
    themes.forEach(t => {
      const isActive = settings.activeThemeId === t.id;
      html += `
        <div class="theme-card ${isActive ? 'active' : ''}" onclick="applyThemePreset('${t.id}')" 
             style="cursor:pointer; border:1px solid ${isActive ? '#0078d7' : '#ccc'}; padding:10px; border-radius:4px; background:${isActive ? '#f0f7ff' : '#fff'}; text-align:center">
          <img src="${t.wall}" style="width:100%; height:60px; object-fit:cover; border:1px solid #999; margin-bottom:5px">
          <div style="font-size:12px; font-weight:600">${t.name}</div>
        </div>
      `;
    });
    html += '</div>';
    main.innerHTML = html;
  } else if (tab === 'wallpaper') {
    let html = '<h2 style="color:#003399;font-weight:normal;font-size:18px;margin:0 0 10px">Desktop Background</h2>';
    html += '<p style="font-size:11px;color:#666;margin:0 0 10px">Choose a category and select a picture to set as your wallpaper.</p>';
    html += '<div class="perso-upload-row"><button class="win7-action-btn" onclick="document.getElementById(\'wallpaper-upload-input\').click()">Browse...</button><span>Choose your own picture from this computer.</span><input type="file" id="wallpaper-upload-input" accept="image/*" style="display:none" onchange="uploadWallpaper(this)"></div>';

    const categories = {
      'Frames 6': ['7.jpg', 'img0.jpg', 'img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg', 'img5.jpg', 'img6.jpg', 'img7.jpg', 'img8.jpg', 'img9.jpg', 'img10.jpg', 'img11.jpg', 'img12.jpg', 'img13.jpg', 'img14.jpg', 'img15.jpg', 'img16.jpg', 'img17.jpg', 'img18.jpg', 'img19.jpg', 'img20.jpg', 'img21.jpg', 'img22.jpg', 'img23.jpg', 'img24.jpg', 'img25.jpg', 'img26.jpg', 'img27.jpg', 'img28.jpg', 'img29.jpg', 'img30.jpg'],
      'Starter': Array.from({ length: 28 }, (_, i) => `win7_wallpapers/Starter${i + 1}.jpg`),
      'Beta/Unreleased': [...Array.from({ length: 13 }, (_, i) => `win7_wallpapers/Unreleased${i + 1}.jpg`), ...Array.from({ length: 10 }, (_, i) => `win7_wallpapers/beta${i + 1}.jpg`), 'win7_wallpapers/beta3 вЂ” РєРѕРїРёСЏ.jpg'],
      'Final/Extra': ['win7_wallpapers/Extra1.jpg', 'win7_wallpapers/Extra2.jpg', ...Array.from({ length: 14 }, (_, i) => `win7_wallpapers/Final${i + 1}.jpg`), 'win7_wallpapers/Final2 вЂ” РєРѕРїРёСЏ.jpg', 'win7_wallpapers/Final9 вЂ” РєРѕРїРёСЏ.jpg'],
      'Sample': Array.from({ length: 5 }, (_, i) => `win7_wallpapers/example${i + 1}.jpg`)
    };

    html += '<div style="margin-bottom:15px"><label style="font-size:12px;font-weight:600">Category: </label><select id="wallpaper-cat-select" onchange="renderWallpaperCategory(this.value)" style="font-size:11px;padding:2px"><option value="Frames 6">Frames 6 (Default)</option><option value="Starter">Starter Edition</option><option value="Beta/Unreleased">Beta & Unreleased</option><option value="Final/Extra">Final & Extras</option><option value="Sample">Sample Wallpapers</option></select></div>';
    html += '<div id="wallpaper-category-grid" class="wallpaper-grid"></div>';
    main.innerHTML = html;
    window.renderWallpaperCategory = (cat) => {
      const grid = document.getElementById('wallpaper-category-grid');
      let gHtml = '';
      categories[cat].forEach(src => {
        const fullSrc = src.startsWith('win7_wallpapers') ? src : 'win7_wallpapers/' + src;
        gHtml += `<img class="wallpaper-thumb ${settings.wallpaper === fullSrc ? 'active' : ''}" src="${fullSrc}" onclick="setWallpaper('${fullSrc}')" onerror="this.style.display='none'">`;
      });
      grid.innerHTML = gHtml;
    };
    renderWallpaperCategory('Frames 6');
  } else if (tab === 'color') {
    const presetColors = ['rgba(30,60,110,0.85)', 'rgba(100,20,20,0.85)', 'rgba(20,80,20,0.85)', 'rgba(80,60,20,0.85)', 'rgba(60,20,80,0.85)', 'rgba(20,60,80,0.85)', 'rgba(80,80,80,0.85)', 'rgba(20,20,20,0.85)', 'rgba(40,80,120,0.85)', 'rgba(120,40,60,0.85)', 'rgba(60,100,40,0.85)', 'rgba(100,80,40,0.85)', 'rgba(80,40,100,0.85)', 'rgba(40,100,100,0.85)', 'rgba(50,50,90,0.85)', 'rgba(90,50,50,0.85)'];
    let html = '<h2 style="color:#003399;font-weight:normal;font-size:18px;margin:0 0 10px">Window Color and Appearance</h2>';
    html += '<p style="font-size:11px;color:#666;margin:0 0 10px">Taskbar appearance is fixed in this build. You can still change the title bar tint and glass transparency.</p>';
    html += '<div class="color-presets">';
    presetColors.forEach(c => { html += `<div class="color-preset ${settings.aeroColor === c ? 'active' : ''}" style="background:${c}" onclick="setAeroColor('${c}')"></div>`; });
    html += '</div>';
    html += `<div style="margin-top:12px"><label style="font-size:12px">Glass color: </label><input type="color" value="${colorToHex(settings.aeroColor)}" onchange="setCustomAeroColor(this.value)" style="cursor:pointer"></div>`;
    html += `<div style="margin-top:8px"><label style="font-size:12px">Title bar color: </label><input type="color" value="${colorToHex(settings.titlebarColor || settings.aeroColor)}" onchange="setCustomTitlebarColor(this.value)" style="cursor:pointer"></div>`;
    // Transparency slider with current value from settings
    const curAlpha = parseFloat((settings.aeroColor.match(/[\d.]+\)$/) || ['0.85'])[0]);
    const curTransparency = Math.round((1 - curAlpha) * 100);
    const transparencyChecked = settings.transparencyEffects !== false ? 'checked' : '';
    html += `<label class="perso-checkbox-row"><input type="checkbox" ${transparencyChecked} onchange="toggleTransparencyEffects(this.checked)"> Enable transparency effects</label>`;
    html += `<div style="margin-top:12px"><label style="font-size:12px">Transparency (%): </label><input type="range" min="0" max="99" value="${curTransparency}" oninput="setAeroTransparency(this.value)" style="width:200px"></div>`;
    html += `<div style="font-size:11px;color:#666;margin-top:4px">More transparency now increases the Aero blur. Turning transparency off switches to a solid title bar.</div>`;
    // Title bar Brightness slider
    html += `<div style="margin-top:8px"><label style="font-size:12px">Title Bar Brightness (%): </label><input type="range" min="0" max="200" value="${settings.titlebarBrightness || 100}" oninput="setTitlebarBrightness(this.value)" style="width:200px"></div>`;
    main.innerHTML = html;
  } else if (tab === 'themes') {
    let html = '<h2 style="color:#003399;font-weight:normal;font-size:18px;margin:0 0 10px">Themes</h2>';
    html += '<button onclick="saveTheme()" style="font-size:11px;padding:4px 12px;margin-bottom:10px;cursor:pointer">Save Current Theme</button>';
    html += '<div class="theme-list">';
    (settings.themes || []).forEach((t, i) => {
      html += `<div class="theme-item" onclick="loadTheme(${i})"><div class="theme-color-preview" style="background:${t.aeroColor}"></div><span>${t.name}</span><button onclick="event.stopPropagation();deleteTheme(${i})" style="margin-left:auto;font-size:10px;cursor:pointer">X</button></div>`;
    });
    html += '</div>'; main.innerHTML = html;
  }
}
function setWallpaper(src) {
  settings.wallpaper = src; saveSettings(); applyTheme();
  document.querySelectorAll('.wallpaper-thumb').forEach(t => t.classList.toggle('active', t.src.includes(src)));
}
function uploadWallpaper(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Apply immediately
    document.body.style.background = `url('${dataUrl}') no-repeat center center fixed`;
    document.body.style.backgroundSize = 'cover';
    // Try to persist (may fail for very large images depending on localStorage quota)
    try { settings.wallpaper = dataUrl; saveSettings(); } catch (ex) {
      // If quota exceeded, still keep it in memory for this session
      settings.wallpaper = dataUrl;
    }
    // Add a custom thumb to the wallpaper grid
    const grid = document.querySelector('.wallpaper-grid');
    if (grid) {
      const thumb = document.createElement('img');
      thumb.src = dataUrl; thumb.className = 'wallpaper-thumb active';
      thumb.onclick = () => setWallpaper(dataUrl);
      thumb.style.border = '2px solid #1e90ff';
      document.querySelectorAll('.wallpaper-thumb').forEach(t => t.classList.remove('active'));
      grid.prepend(thumb);
    }
  };
  reader.readAsDataURL(file);
}
function setAeroColor(c) {
  settings.titlebarColor = (settings.themeType === 'basic' || settings.transparencyEffects === false)
    ? solidifyAeroColor(c)
    : c.replace(/[\d.]+\)$/, '0.3)');
  saveSettings(); applyTheme();
  document.querySelectorAll('.color-preset').forEach(p => p.classList.toggle('active', p.style.background === c));
}
function setCustomAeroColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  setAeroColor(`rgba(${r},${g},${b},0.85)`);
}
function setCustomTitlebarColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const alpha = settings.themeType === 'basic' || settings.transparencyEffects === false ? 1 : Math.max(0.18, Math.min(0.6, parseColor(settings.titlebarColor || settings.aeroColor).a || 0.3));
  settings.titlebarColor = `rgba(${r},${g},${b},${alpha})`;
  applyTheme();
  saveSettings();
}
function setAeroTransparency(v) {
  const cur = settings.titlebarColor || settings.aeroColor;
  const parts = cur.match(/rgba?\((\d+),(\d+),(\d+)/);
  const alpha = 1 - (parseInt(v) / 100);
  // Lower the floor to 0.01 for "max transparency"
  if (parts) {
    const nextAlpha = Math.max(0.01, alpha.toFixed(2));
    const titleParts = parseColor(settings.titlebarColor || settings.aeroColor);
    const titleAlpha = settings.themeType === 'basic' || settings.transparencyEffects === false ? 1 : Math.max(0.12, Math.min(0.4, alpha * 0.32));
    settings.titlebarColor = `rgba(${parts[1]},${parts[2]},${parts[3]},${settings.themeType === 'basic' || settings.transparencyEffects === false ? 1 : titleAlpha})`;
    saveSettings();
    applyTheme();
  }
}
function toggleTransparencyEffects(enabled) {
  settings.transparencyEffects = !!enabled;
  if (!enabled) {
    settings.titlebarColor = rgbaStringFromParts(parseColor(settings.titlebarColor || settings.aeroColor), 1);
  } else if (settings.themeType !== 'basic') {
    settings.titlebarColor = rgbaStringFromParts(parseColor(settings.titlebarColor || settings.aeroColor), Math.max(0.12, Math.min(0.4, parseColor(settings.titlebarColor || settings.aeroColor).a || 0.24)));
  }
  saveSettings();
  applyTheme();
  queueGlassReflectionUpdate();
}
function setTaskbarBrightness(v) { settings.taskbarBrightness = 100; applyTheme(); saveSettings(); }
function setTitlebarBrightness(v) { settings.titlebarBrightness = parseInt(v); applyTheme(); saveSettings(); }
function saveTheme() {
  const name = prompt('Theme name:', 'My Theme');
  if (name) {
    if (!settings.themes) settings.themes = [];
    settings.themes.push({
      name,
      wallpaper: settings.wallpaper,
      aeroColor: settings.aeroColor,
      titlebarColor: settings.titlebarColor,
      transparencyEffects: settings.transparencyEffects,
      taskbarBrightness: settings.taskbarBrightness,
      titlebarBrightness: settings.titlebarBrightness,
      themeType: settings.themeType || 'aero'
    });
    saveSettings();
    persoSwitchTab('themes');
  }
}
function loadTheme(i) {
  const t = settings.themes[i]; if (!t) return;
  settings.wallpaper = t.wallpaper; settings.aeroColor = t.aeroColor; settings.titlebarColor = t.titlebarColor;
  if (typeof t.transparencyEffects === 'boolean') settings.transparencyEffects = t.transparencyEffects;
  if (typeof t.taskbarBrightness === 'number') settings.taskbarBrightness = t.taskbarBrightness;
  if (typeof t.titlebarBrightness === 'number') settings.titlebarBrightness = t.titlebarBrightness;
  if (t.themeType) settings.themeType = t.themeType;
  saveSettings(); applyTheme();
}
function deleteTheme(i) { settings.themes.splice(i, 1); saveSettings(); persoSwitchTab('themes'); }

function applyThemePreset(id) {
  const preset = personalizationThemePresets.find(theme => theme.id === id);
  if (preset) {
    settings.wallpaper = preset.wall;
    settings.aeroColor = preset.color;
    settings.titlebarColor = preset.type === 'basic' ? preset.color : preset.color.replace(/[\d.]+\)$/, '0.3)');
    settings.themeType = preset.type;
    settings.transparencyEffects = preset.type !== 'basic';
    settings.taskbarBrightness = 100;
    settings.titlebarBrightness = 100;
    settings.activeThemeId = id;
    saveSettings();
    applyTheme();
    persoSwitchTab('themes');
    return;
  }
  const themes = {
    'aero': { wall: 'win7_wallpapers/img0.jpg', color: 'rgba(30,60,110,0.85)', type: 'aero' },
    'basic': { wall: 'win7_wallpapers/img0.jpg', color: '#c2dcfd', type: 'basic' },
    'architecture': { wall: 'win7_wallpapers/img0.jpg', color: 'rgba(100,80,60,0.85)', type: 'aero' },
    'nature': { wall: 'win7_wallpapers/img7.jpg', color: 'rgba(40,100,40,0.85)', type: 'aero' },
    'characters': { wall: 'win7_wallpapers/img13.jpg', color: 'rgba(100,40,40,0.85)', type: 'aero' },
    'landscapes': { wall: 'win7_wallpapers/img19.jpg', color: 'rgba(40,80,120,0.85)', type: 'aero' }
  };
  const t = themes[id];
  settings.wallpaper = t.wall;
  settings.aeroColor = t.color;
  settings.titlebarColor = t.type === 'basic' ? t.color : t.color.replace(/[\d.]+\)$/, '0.3)');
  settings.themeType = t.type;
  settings.transparencyEffects = t.type !== 'basic';
  settings.taskbarBrightness = 100;
  settings.titlebarBrightness = 100;
  settings.activeThemeId = id;
  saveSettings();
  applyTheme();
  persoSwitchTab('themes');
}

// ========== FRAMES MESSENGER ==========
const defaultMessengerContacts = [
  { id: 'alex', name: 'Alex Mercer', group: 'Favorites', status: 'Online', note: 'Trying the new Aero shell tonight.', color: '#45b6ff', kind: 'demo' },
  { id: 'sophie', name: 'Sophie Lane', group: 'Favorites', status: 'Busy', note: 'Rendering some icons.', color: '#7a9dff', kind: 'demo' },
  { id: 'nina', name: 'Nina Shah', group: 'Friends', status: 'Online', note: 'Listening to Kalimba.', color: '#4fd3b3', kind: 'demo' },
  { id: 'owen', name: 'Owen Park', group: 'Friends', status: 'Away', note: 'Back after dinner.', color: '#ffb34d', kind: 'demo' },
  { id: 'lena', name: 'Lena Morse', group: 'Family', status: 'Online', note: 'At the family computer.', color: '#f48aa8', kind: 'demo' },
  { id: 'leo', name: 'Leo Hart', group: 'Family', status: 'Offline', note: 'Signed out.', color: '#8ca2ba', kind: 'demo' },
  { id: 'paul', name: 'Paul Tan', group: 'Work', status: 'Busy', note: 'Fixing title-bar polish.', color: '#64d8ff', kind: 'demo' },
  { id: 'yumi', name: 'Yumi Cole', group: 'Work', status: 'Offline', note: 'Be right back tomorrow.', color: '#9a92ff', kind: 'demo' }
];
const messengerReplyLines = {
  alex: ['The Messenger layout already feels a lot closer to 2006.', 'That fixed glass reflection looks right now.'],
  sophie: ['I like the smaller shutdown button better.', 'Try pinning Messenger when you are done.'],
  nina: ['Kalimba still sounds perfect in Frames 6.', 'Send me the wallpaper you picked later.'],
  owen: ['I am still testing the pinned taskbar buttons.', 'iFrames Viewer finally has the right Frames glow.'],
  lena: ['This looks like the old family PC again.', 'Frames Messenger was always my favorite.'],
  leo: ['I will check the emulator again when I am back online.'],
  paul: ['The title bar reflection is reading much more like 7.css now.', 'Messenger should sit nicely beside IE and Explorer.'],
  yumi: ['Great work on the contact list.', 'Make sure the conversation window uses the message icon too.']
};
const defaultMessengerConversations = {
  alex: [
    { from: 'them', text: 'Did you finish the Frames 6 Messenger shell?', time: '6:12 PM' },
    { from: 'me', text: 'I am almost there. I just need the contact window and chat layout to feel authentic.', time: '6:14 PM' }
  ],
  sophie: [
    { from: 'them', text: 'Use the messenger icon for the app and the message icon for chats.', time: '5:48 PM' }
  ],
  nina: [
    { from: 'them', text: 'Send me the WLM build when the glass is done.', time: '4:31 PM' }
  ],
  owen: [
    { from: 'them', text: 'Can you pin Messenger to the taskbar from Start now?', time: '3:05 PM' }
  ],
  lena: [
    { from: 'them', text: 'That old contact list instantly brings back memories.', time: '2:42 PM' }
  ],
  leo: [],
  paul: [
    { from: 'them', text: 'Match the Frames 6 Alpha reflection more closely.', time: '1:16 PM' }
  ],
  yumi: []
};
function createDefaultMessengerState() {
  return {
    status: 'Online',
    personalMessage: 'Back on Frames Messenger.',
    search: '',
    selected: 'alex',
    currentChat: 'alex',
    showOffline: true,
    groups: { Favorites: true, Friends: true, Family: true, Work: true, 'Frames Network': true }
  };
}

function messengerContactId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'contact';
}

function messengerColorForValue(value) {
  const palette = ['#45b6ff', '#7a9dff', '#4fd3b3', '#ffb34d', '#f48aa8', '#64d8ff', '#9a92ff', '#8ca2ba'];
  const key = String(value || 'contact');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function normalizeMessengerContact(contact) {
  const email = normalizeAccountEmail(contact && contact.email);
  return {
    id: contact && contact.id ? contact.id : messengerContactId(email || (contact && contact.name) || 'contact'),
    name: contact && contact.name ? contact.name : deriveDisplayName(email || 'contact'),
    group: contact && contact.group ? contact.group : 'Friends',
    status: contact && contact.status ? contact.status : 'Offline',
    note: contact && contact.note ? contact.note : (email || 'Available on Frames Messenger'),
    color: contact && contact.color ? contact.color : messengerColorForValue(email || (contact && contact.name) || 'contact'),
    email,
    kind: contact && contact.kind ? contact.kind : (email ? 'account' : 'demo')
  };
}

function normalizeMessengerContacts(list, allowEmpty = false) {
  const source = Array.isArray(list) ? list : [];
  const seen = new Set();
  const normalized = source
    .map(normalizeMessengerContact)
    .filter(contact => {
      if (seen.has(contact.id)) return false;
      seen.add(contact.id);
      return true;
    });
  if (!normalized.length && !allowEmpty) {
    return deepClone(defaultMessengerContacts).map(normalizeMessengerContact);
  }
  return normalized;
}

function normalizeMessengerConversations(source) {
  const result = {};
  const input = source && typeof source === 'object' ? source : {};
  Object.keys(input).forEach(key => {
    const items = Array.isArray(input[key]) ? input[key] : [];
    result[key] = items.map(item => ({
      from: item && item.from === 'me' ? 'me' : 'them',
      text: String((item && item.text) || ''),
      time: String((item && item.time) || messengerTimestamp())
    }));
  });
  return result;
}

const messengerInitialState = messengerCache && typeof messengerCache === 'object' ? messengerCache : {};
let messengerContacts = normalizeMessengerContacts(messengerInitialState.contacts);
let messengerConversations = Object.keys(normalizeMessengerConversations(messengerInitialState.conversations)).length
  ? normalizeMessengerConversations(messengerInitialState.conversations)
  : deepClone(defaultMessengerConversations);
let messengerState = { ...createDefaultMessengerState(), ...((messengerInitialState && messengerInitialState.state) || {}) };

function messengerInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function messengerStatusClass(status) {
  return ({
    Online: 'online',
    Busy: 'busy',
    Away: 'away',
    'Appear Offline': 'offline',
    Offline: 'offline'
  })[status] || 'offline';
}

function saveMessenger() {
  try {
    localStorage.setItem(LOCAL_KEYS.messenger, JSON.stringify({
      contacts: messengerContacts,
      conversations: messengerConversations,
      state: messengerState
    }));
  } catch (err) {
    console.warn('Messenger save failed:', err);
  }
  scheduleAccountSave();
}

function messengerGetContact(id) {
  return messengerContacts.find(contact => contact.id === id) || null;
}

function messengerResolveContactStatus(contact) {
  if (!contact) return 'Offline';
  const email = normalizeAccountEmail(contact.email);
  if (!email) return contact.status || 'Offline';
  if (currentAccount.signedIn && email === currentAccount.email) return messengerState.status || 'Online';
  const presence = messengerPresence[email];
  if (presence && presence.online) return presence.status || 'Online';
  return 'Offline';
}

function messengerResolveContactNote(contact) {
  if (!contact) return '';
  const email = normalizeAccountEmail(contact.email);
  if (!email) return contact.note || '';
  const presence = messengerPresence[email];
  if (presence && presence.personalMessage) return presence.personalMessage;
  return contact.note || email;
}

function messengerGroupNames() {
  const ordered = ['Favorites', 'Friends', 'Family', 'Work', 'Frames Network'];
  messengerContacts.forEach(contact => {
    const group = contact.group || 'Friends';
    if (!ordered.includes(group)) ordered.push(group);
  });
  return ordered;
}

function messengerEnsureSelection() {
  const visible = messengerVisibleContacts();
  if (!visible.length) {
    messengerState.selected = '';
    messengerState.currentChat = '';
    return;
  }
  if (!visible.find(contact => contact.id === messengerState.selected)) {
    messengerState.selected = visible[0].id;
  }
  if (!visible.find(contact => contact.id === messengerState.currentChat)) {
    messengerState.currentChat = messengerState.selected || visible[0].id;
  }
}

function messengerVisibleContacts() {
  const query = (messengerState.search || '').trim().toLowerCase();
  return messengerContacts.filter(contact => {
    const status = messengerResolveContactStatus(contact);
    const note = messengerResolveContactNote(contact);
    if (!messengerState.showOffline && messengerStatusClass(status) === 'offline') return false;
    if (!query) return true;
    return [contact.name, contact.group, note, status, contact.email || '']
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

function messengerSetStatus(value) {
  messengerState.status = value;
  const select = document.getElementById('wlm-status-select');
  if (select) select.value = value;
  messengerRenderSummary();
  updateMessengerServiceStatus();
  saveMessenger();
  messengerSendPresence();
}

function messengerSetPersonalMessage(value) {
  messengerState.personalMessage = value;
  saveMessenger();
  messengerSendPresence();
}

function messengerFilterContacts(value) {
  messengerState.search = value || '';
  messengerRenderContactPane();
}

function messengerToggleOfflineContacts() {
  messengerState.showOffline = !messengerState.showOffline;
  messengerRenderContactPane();
  saveMessenger();
}

function messengerToggleGroup(group) {
  messengerState.groups[group] = !messengerState.groups[group];
  messengerRenderContactPane();
  saveMessenger();
}

function messengerSelectContact(id) {
  messengerState.selected = id;
  messengerRenderContactPane();
  saveMessenger();
}

function messengerCycleSelection(step) {
  const visible = messengerVisibleContacts();
  if (!visible.length) return;
  const currentIndex = visible.findIndex(contact => contact.id === messengerState.selected);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + step + visible.length) % visible.length;
  messengerSelectContact(visible[nextIndex].id);
}

function messengerRenderSummary() {
  const visible = messengerVisibleContacts();
  const online = visible.filter(contact => messengerStatusClass(messengerResolveContactStatus(contact)) !== 'offline').length;
  const summary = document.getElementById('wlm-summary');
  if (summary) summary.textContent = `${online} of ${visible.length} contacts online`;
}

function updateMessengerServiceStatus() {
  const badge = document.getElementById('wlm-service-status');
  const live = document.getElementById('wlm-live-summary');
  const online = currentAccount.signedIn && currentAccount.wsConnected;
  const text = !currentAccount.signedIn
    ? 'Offline mode'
    : online
      ? 'Connected'
      : currentAccount.serverAvailable
        ? 'Reconnecting'
        : 'Service offline';
  if (badge) {
    badge.textContent = text;
    badge.classList.remove('online', 'offline');
    badge.classList.add(online ? 'online' : 'offline');
  }
  if (live) {
    live.textContent = !currentAccount.signedIn
      ? 'Sign in on the lock screen for online Messenger'
      : online
        ? `Signed in as ${currentAccount.email}`
        : 'Messenger service offline';
  }
}

function messengerRenderContactPane() {
  const pane = document.getElementById('wlm-contact-pane');
  if (!pane) return;
  messengerEnsureSelection();
  const visible = messengerVisibleContacts();
  const groups = messengerGroupNames();
  let html = '';
  if (!visible.length) {
    pane.innerHTML = currentAccount.signedIn
      ? '<div class="wlm-empty-state">No contacts match your search.<br><button class="win7-action-btn" onclick="messengerAddContact()">Add a contact</button></div>'
      : '<div class="wlm-empty-state">No contacts match your search.</div>';
    messengerRenderSummary();
    updateMessengerServiceStatus();
    return;
  }
  groups.forEach(group => {
    const contacts = visible.filter(contact => contact.group === group);
    if (!contacts.length) return;
    const expanded = messengerState.groups[group] !== false;
    html += `<div class="wlm-group">
      <button class="wlm-group-toggle" onclick="messengerToggleGroup('${group}')">${expanded ? '-' : '+'} ${group} (${contacts.length})</button>
      <div class="wlm-group-list" style="display:${expanded ? 'block' : 'none'}">`;
    contacts.forEach(contact => {
      const resolvedStatus = messengerResolveContactStatus(contact);
      const statusClass = messengerStatusClass(resolvedStatus);
      const selected = contact.id === messengerState.selected ? ' selected' : '';
      html += `<div class="wlm-contact-row${selected}" onclick="messengerSelectContact('${contact.id}')" ondblclick="messengerOpenChat('${contact.id}')">
        <div class="wlm-contact-avatar ${statusClass}" style="--wlm-accent:${contact.color}">${messengerInitials(contact.name)}</div>
        <div class="wlm-contact-copy">
          <strong>${escapeHtml(contact.name)}</strong>
          <span>${escapeHtml(messengerResolveContactNote(contact))}</span>
        </div>
        <div class="wlm-contact-state ${statusClass}">${escapeHtml(resolvedStatus)}</div>
      </div>`;
    });
    html += '</div></div>';
  });
  pane.innerHTML = html;
  messengerRenderSummary();
  updateMessengerServiceStatus();
}

function messengerOpenChatFromSelection() {
  const visible = messengerVisibleContacts();
  const target = messengerState.selected || (visible[0] && visible[0].id);
  if (!target) {
    if (currentAccount.signedIn) {
      messengerAddContact();
      return;
    }
    win7Alert('Frames Messenger', 'There are no contacts available to chat with.', 'info');
    return;
  }
  messengerOpenChat(target);
}

function messengerOpenChat(id) {
  const contact = messengerGetContact(id);
  if (!contact) return;
  messengerState.selected = id;
  messengerState.currentChat = id;
  saveMessenger();
  openWindow('messengerchat');
  initMessenger();
  initMessengerChat();
}

function messengerTimestamp() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initMessenger() {
  const displayName = document.getElementById('wlm-display-name');
  const picture = document.getElementById('wlm-display-picture');
  const status = document.getElementById('wlm-status-select');
  const personal = document.getElementById('wlm-personal-message');
  const email = document.getElementById('wlm-account-email');
  if (displayName) displayName.textContent = currentAccount.displayName || settings.username || 'Martin';
  if (picture) picture.textContent = messengerInitials(currentAccount.displayName || settings.username || 'Martin');
  if (email) email.textContent = currentAccount.email || 'guest@offline';
  if (status) status.value = messengerState.status;
  if (personal) personal.value = messengerState.personalMessage;
  messengerRenderContactPane();
  updateMessengerServiceStatus();
}

function initMessengerChat() {
  messengerEnsureSelection();
  messengerRenderChat();
}

function messengerRenderChat() {
  const contact = messengerGetContact(messengerState.currentChat);
  const title = document.getElementById('wlm-chat-title');
  const name = document.getElementById('wlm-chat-name');
  const status = document.getElementById('wlm-chat-status');
  const avatar = document.getElementById('wlm-chat-avatar');
  const log = document.getElementById('wlm-chat-log');
  if (!log) return;
  if (!contact) {
    log.innerHTML = '<div class="wlm-empty-state">Select a contact to start chatting.</div>';
    if (title) title.innerHTML = '<img src="icons/message.png" class="wlm-title-icon" alt=""> Conversation';
    if (name) name.textContent = 'No contact selected';
    if (status) status.textContent = 'Frames Messenger';
    return;
  }
  const resolvedStatus = messengerResolveContactStatus(contact);
  const resolvedNote = messengerResolveContactNote(contact);
  if (title) title.innerHTML = `<img src="icons/message.png" class="wlm-title-icon" alt=""> ${escapeHtml(contact.name)}`;
  if (name) name.textContent = contact.name;
  if (status) status.textContent = `${resolvedStatus} - ${resolvedNote}`;
  if (avatar) {
    avatar.textContent = messengerInitials(contact.name);
    avatar.className = `wlm-chat-avatar ${messengerStatusClass(resolvedStatus)}`;
    avatar.style.setProperty('--wlm-accent', contact.color);
  }
  const messages = messengerConversations[contact.id] || [];
  log.innerHTML = messages.map(message => `
    <div class="wlm-chat-bubble ${message.from === 'me' ? 'mine' : 'theirs'}">
      <strong>${message.from === 'me' ? escapeHtml(settings.username || 'Martin') : escapeHtml(contact.name)}</strong>
      <p>${escapeHtml(message.text)}</p>
      <span>${escapeHtml(message.time)}</span>
    </div>
  `).join('');
  log.scrollTop = log.scrollHeight;
  const taskLabel = document.querySelector('#task-messengerchat span');
  if (taskLabel) taskLabel.textContent = contact.name;
}

function messengerHandleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messengerSendMessage();
  }
}

function messengerInsertQuickText(text) {
  const input = document.getElementById('wlm-chat-input');
  if (!input) return;
  input.value = (input.value ? `${input.value} ` : '') + text;
  input.focus();
}

async function messengerAddContact() {
  if (!currentAccount.signedIn) {
    win7Alert('Frames Messenger', 'Sign in on the lock screen to add contacts and chat online.', 'info');
    return;
  }
  win7Prompt('Add Contact', 'Enter the email address you want to add:', '', async (value) => {
    const friendEmail = normalizeAccountEmail(value);
    if (!friendEmail) return;
    try {
      const data = await apiPost('/api/friends', {
        email: currentAccount.email,
        friendEmail
      });
      messengerContacts = normalizeMessengerContacts(data.contacts, true);
      messengerState.selected = data.contactId || messengerContactId(friendEmail);
      messengerState.currentChat = messengerState.selected;
      saveMessenger();
      initMessenger();
      initMessengerChat();
      messengerSendPresence();
    } catch (err) {
      console.error('Add contact failed:', err);
      win7Alert('Frames Messenger', 'That contact could not be added right now.', 'error');
    }
  });
}

function messengerEnsureAccountContact(email, name) {
  const normalizedEmail = normalizeAccountEmail(email);
  const existing = messengerContacts.find(contact => normalizeAccountEmail(contact.email) === normalizedEmail);
  if (existing) {
    if (name && existing.name !== name) existing.name = name;
    if (!existing.note) existing.note = normalizedEmail;
    existing.kind = 'account';
    return existing;
  }
  const contact = normalizeMessengerContact({
    id: messengerContactId(normalizedEmail),
    name: name || deriveDisplayName(normalizedEmail),
    email: normalizedEmail,
    group: 'Friends',
    note: normalizedEmail,
    kind: 'account'
  });
  messengerContacts.push(contact);
  return contact;
}

function messengerSendMessage() {
  const contact = messengerGetContact(messengerState.currentChat);
  const input = document.getElementById('wlm-chat-input');
  if (!contact || !input) return;
  const text = input.value.trim();
  if (!text) return;
  if (contact.kind === 'account' && contact.email && !currentAccount.wsConnected) {
    win7Alert('Frames Messenger', 'Messenger is offline right now. Wait for it to reconnect before sending online messages.', 'warning');
    return;
  }
  const stamp = messengerTimestamp();
  if (!messengerConversations[contact.id]) messengerConversations[contact.id] = [];
  messengerConversations[contact.id].push({ from: 'me', text, time: stamp });
  input.value = '';
  saveMessenger();
  messengerRenderChat();
  if (contact.kind === 'account' && contact.email) {
    messengerSocketSend({
      type: 'chat_message',
      toEmail: contact.email,
      toName: contact.name,
      fromName: currentAccount.displayName || settings.username || deriveDisplayName(currentAccount.email),
      text,
      time: stamp
    });
    return;
  }
  setTimeout(() => messengerAutoReply(contact.id), 700);
}

function messengerAutoReply(contactId) {
  const contact = messengerGetContact(contactId);
  if (!contact) return;
  const replies = messengerReplyLines[contactId] || ['Sounds good to me.'];
  if (!messengerConversations[contactId]) messengerConversations[contactId] = [];
  const replyIndex = messengerConversations[contactId].filter(message => message.from === 'them').length % replies.length;
  const nextLine = replies[replyIndex];
  messengerConversations[contactId].push({ from: 'them', text: nextLine, time: messengerTimestamp() });
  saveMessenger();
  if (messengerState.currentChat === contactId) messengerRenderChat();
}

function messengerApplyPresenceSnapshot(users) {
  messengerPresence = {};
  (Array.isArray(users) ? users : []).forEach(user => {
    const email = normalizeAccountEmail(user && user.email);
    if (!email) return;
    messengerPresence[email] = {
      online: true,
      displayName: user.displayName || deriveDisplayName(email),
      status: user.status || 'Online',
      personalMessage: user.personalMessage || ''
    };
  });
  if (document.getElementById('window-messenger').style.display === 'block') initMessenger();
  if (document.getElementById('window-messengerchat').style.display === 'block') initMessengerChat();
}

function messengerApplyPresenceUpdate(payload) {
  const email = normalizeAccountEmail(payload && payload.email);
  if (!email) return;
  if (payload.online === false) {
    delete messengerPresence[email];
  } else {
    messengerPresence[email] = {
      online: true,
      displayName: payload.displayName || deriveDisplayName(email),
      status: payload.status || 'Online',
      personalMessage: payload.personalMessage || ''
    };
  }
  if (document.getElementById('window-messenger').style.display === 'block') initMessenger();
  if (document.getElementById('window-messengerchat').style.display === 'block') initMessengerChat();
}

function messengerReceiveOnlineMessage(payload) {
  const contact = messengerEnsureAccountContact(payload.fromEmail, payload.fromName);
  if (!messengerConversations[contact.id]) messengerConversations[contact.id] = [];
  messengerConversations[contact.id].push({
    from: 'them',
    text: String(payload.text || ''),
    time: String(payload.time || messengerTimestamp())
  });
  messengerState.selected = contact.id;
  if (!messengerState.currentChat) messengerState.currentChat = contact.id;
  saveMessenger();
  playSound('notify');
  if (messengerState.currentChat === contact.id || document.getElementById('window-messengerchat').style.display === 'block') {
    messengerRenderChat();
  }
  if (document.getElementById('window-messenger').style.display === 'block') {
    messengerRenderContactPane();
  }
}

function messengerSocketSend(payload) {
  if (!messengerSocket || messengerSocket.readyState !== WebSocket.OPEN) return;
  messengerSocket.send(JSON.stringify(payload));
}

function messengerSendPresence() {
  if (!currentAccount.signedIn) return;
  messengerSocketSend({
    type: 'presence_update',
    status: messengerState.status,
    personalMessage: messengerState.personalMessage,
    displayName: currentAccount.displayName || settings.username || deriveDisplayName(currentAccount.email)
  });
}

function connectMessengerSocket() {
  if (!currentAccount.signedIn) return;
  if (messengerReconnectTimer) {
    clearTimeout(messengerReconnectTimer);
    messengerReconnectTimer = null;
  }
  if (messengerSocket && (messengerSocket.readyState === WebSocket.OPEN || messengerSocket.readyState === WebSocket.CONNECTING)) {
    messengerSocket.close();
  }
  const accountHost = location.hostname || '127.0.0.1';
  const serviceBase = getAccountServiceBase();
  const secure = serviceBase.startsWith('https://');
  const host = location.protocol === 'file:' ? '127.0.0.1' : accountHost;
  const socketUrl = `${secure ? 'wss' : 'ws'}://${host}:${currentAccount.wsPort || 8765}/ws`;
  try {
    messengerSocket = new WebSocket(socketUrl);
  } catch (err) {
    console.error('Messenger socket open failed:', err);
    currentAccount.wsConnected = false;
    updateMessengerServiceStatus();
    return;
  }
  messengerSocket.onopen = () => {
    currentAccount.wsConnected = true;
    updateMessengerServiceStatus();
    messengerSocketSend({
      type: 'auth',
      email: currentAccount.email,
      displayName: currentAccount.displayName || settings.username || deriveDisplayName(currentAccount.email),
      status: messengerState.status,
      personalMessage: messengerState.personalMessage
    });
  };
  messengerSocket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'presence_snapshot') messengerApplyPresenceSnapshot(payload.users);
      if (payload.type === 'presence_update') messengerApplyPresenceUpdate(payload);
      if (payload.type === 'message') messengerReceiveOnlineMessage(payload);
      if (payload.type === 'contact_added' && payload.contact) {
        messengerEnsureAccountContact(payload.contact.email, payload.contact.name);
        saveMessenger();
        initMessenger();
      }
    } catch (err) {
      console.error('Messenger socket message failed:', err);
    }
  };
  messengerSocket.onclose = () => {
    currentAccount.wsConnected = false;
    messengerPresence = {};
    updateMessengerServiceStatus();
    if (currentAccount.signedIn) {
      messengerReconnectTimer = setTimeout(connectMessengerSocket, 2500);
    }
  };
  messengerSocket.onerror = () => {
    currentAccount.wsConnected = false;
    updateMessengerServiceStatus();
  };
}

async function apiPost(path, body) {
  const response = await fetch(`${getAccountServiceBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function buildAccountSnapshot() {
  return {
    settings: deepClone(settings),
    vfs: deepClone(vfs),
    messenger: {
      contacts: deepClone(messengerContacts),
      conversations: deepClone(messengerConversations),
      state: deepClone(messengerState)
    }
  };
}

function cacheDesktopStateLocally() {
  try {
    localStorage.setItem(LOCAL_KEYS.settings, JSON.stringify(settings));
  } catch (err) {
    console.warn('Local settings cache failed:', err);
  }
  try {
    localStorage.setItem(LOCAL_KEYS.vfs, JSON.stringify(vfs));
  } catch (err) {
    console.warn('Local VFS cache failed:', err);
  }
  try {
    localStorage.setItem(LOCAL_KEYS.messenger, JSON.stringify({
      contacts: messengerContacts,
      conversations: messengerConversations,
      state: messengerState
    }));
  } catch (err) {
    console.warn('Local Messenger cache failed:', err);
  }
  if (currentAccount.email) localStorage.setItem(LOCAL_KEYS.lastAccount, currentAccount.email);
}

function applyAccountState(payload) {
  const defaults = createDefaultSettings();
  settings = { ...defaults, ...((payload && payload.settings) || {}) };
  currentAccount.displayName = (payload && payload.profile && payload.profile.displayName)
    || currentAccount.displayName
    || settings.username
    || deriveDisplayName(currentAccount.email);
  settings.username = currentAccount.displayName;
  if (!Array.isArray(settings.pinnedTaskbar)) settings.pinnedTaskbar = defaults.pinnedTaskbar.slice();
  vfs = payload && payload.vfs ? payload.vfs : createDefaultVFS(currentAccount.displayName);
  normalizeRecycleBin();
  currentVfsPath = getDefaultDocumentsPath();
  navHistory = [[...currentVfsPath]];
  navIndex = 0;
  selectedItem = null;

  const messengerData = payload && payload.messenger ? payload.messenger : {};
  messengerContacts = normalizeMessengerContacts(messengerData.contacts, true);
  messengerConversations = normalizeMessengerConversations(messengerData.conversations);
  messengerState = { ...createDefaultMessengerState(), ...((messengerData && messengerData.state) || {}) };
  messengerEnsureSelection();
  cacheDesktopStateLocally();

  applyTheme();
  renderPinnedTaskbar();
  updateStartMenuPinStates();

  updateExplorer();
  updateRecycleBin();
  loadStickyNotes();
  updateDesktop();
  initMessenger();
  initMessengerChat();
  updateClock();
}

function scheduleAccountSave() {
  cacheDesktopStateLocally();
  if (!currentAccount.signedIn) return;
  accountSavePending = true;
  if (accountSaveTimer) clearTimeout(accountSaveTimer);
  accountSaveTimer = setTimeout(flushAccountSave, 420);
}

async function flushAccountSave() {
  if (!accountSavePending || !currentAccount.signedIn) return;
  accountSavePending = false;
  try {
    await apiPost('/api/state', {
      email: currentAccount.email,
      profile: { displayName: currentAccount.displayName || settings.username || deriveDisplayName(currentAccount.email) },
      state: buildAccountSnapshot()
    });
    currentAccount.serverAvailable = true;
    updateMessengerServiceStatus();
  } catch (err) {
    console.error('Account save failed:', err);
    currentAccount.serverAvailable = false;
    updateMessengerServiceStatus();
  }
}

function setLockStatus(message, state = '') {
  const status = document.getElementById('lock-status');
  if (!status) return;
  status.className = `lock-status${state ? ` ${state}` : ''}`;
  status.textContent = message;
}

function updateLockIdentityPreview(value) {
  const label = document.getElementById('lock-username');
  if (!label) return;
  label.textContent = String(value || '').trim() ? deriveDisplayName(value) : 'Sign in to Frames 6';
}

async function checkAccountService() {
  if (!canUseAccountService()) {
    currentAccount.serverAvailable = false;
    setLockStatus('Run python server.py to enable account sync and online Messenger.', 'error');
    return false;
  }
  try {
    const response = await fetch(`${getAccountServiceBase()}/api/ping`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Ping failed: ${response.status}`);
    const data = await response.json();
    currentAccount.serverAvailable = true;
    currentAccount.wsPort = data.wsPort || data.ws_port || 8765;
    setLockStatus('Account service ready. Sign in to restore your desktop and Messenger.', 'ready');
    updateMessengerServiceStatus();
    return true;
  } catch (err) {
    console.warn('Account service unavailable:', err);
    currentAccount.serverAvailable = false;
    setLockStatus('Start python server.py to use account sync and Messenger online.', 'error');
    updateMessengerServiceStatus();
    return false;
  }
}

function initAccountLockScreen() {
  const input = document.getElementById('lock-email');
  if (!input) return;
  if (currentAccount.email && !input.value) input.value = currentAccount.email;
  updateLockIdentityPreview(input.value);
  input.oninput = () => updateLockIdentityPreview(input.value);
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') signInFromLockScreen();
  };
  input.focus();
  checkAccountService();
}



function setLockControlsDisabled(disabled) {
  const input = document.getElementById('lock-email');
  const button = document.getElementById('lock-btn');
  if (input) input.disabled = !!disabled;
  if (button) button.disabled = !!disabled;
}

async function signInFromLockScreen() {
  if (signInInProgress) return;
  const input = document.getElementById('lock-email');
  const rawEmail = String((input && input.value) || '').trim();
  const email = normalizeAccountEmail(rawEmail);
  if (!email || !email.includes('@')) {
    setLockStatus('Enter a valid email address to load your account.', 'error');
    return;
  }
  signInInProgress = true;
  setLockControlsDisabled(true);
  setLockStatus('Signing in and restoring your desktop...', '');
  const serviceReady = await checkAccountService();
  if (!serviceReady) {
    signInInProgress = false;
    setLockControlsDisabled(false);
    return;
  }
  try {
    const data = await apiPost('/api/login', {
      email,
      displayName: deriveDisplayName(rawEmail)
    });
    currentAccount.email = email;
    currentAccount.displayName = (data.profile && data.profile.displayName) || deriveDisplayName(email);
    currentAccount.signedIn = true;
    currentAccount.serverAvailable = true;
    currentAccount.wsPort = data.wsPort || data.ws_port || currentAccount.wsPort || 8765;
    applyAccountState({ profile: data.profile || { displayName: currentAccount.displayName }, ...((data && data.state) || {}) });
    localStorage.setItem(LOCAL_KEYS.lastAccount, currentAccount.email);
    unlockDesktop();
    connectMessengerSocket();
  } catch (err) {
    console.error('Sign-in failed:', err);
    setLockStatus('That account could not be loaded. Check that server.py is running.', 'error');
    signInInProgress = false;
    setLockControlsDisabled(false);
  }
}

// ========== FRAMES MEDIA PLAYER ==========
let wmpAudio = new Audio();
let wmpIsPlaying = false;
let wmpCurrentTrack = null;
let wmpAnimationStarted = false;
let wmpArtwork = new Image();
let wmpArtworkReady = false;
let wmpTracks = [];
const bundledWmpMedia = {
  'Kalimba.mp3': { title: 'Kalimba', artist: 'Mr. Scruff', src: 'wmp_sample_music/Kalimba.mp3', art: 'templates/1.Kalimba.png' },
  'Maid with the Flaxen Hair.mp3': { title: 'Maid with the Flaxen Hair', artist: 'Richard Stoltzman', src: 'wmp_sample_music/Maid with the Flaxen Hair.mp3', art: 'templates/2.MaidWithFlax.png' },
  'Sleep Away.mp3': { title: 'Sleep Away', artist: 'Bob Acri', src: 'wmp_sample_music/Sleep Away.mp3', art: 'templates/3.SleepAway.png' }
};
const mediaExts = {
  music: ['.mp3', '.wav', '.wma', '.m4a'],
  videos: ['.mp4', '.wmv', '.avi'],
  pictures: ['.png', '.jpg', '.jpeg', '.gif', '.bmp']
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getStoredMediaUrl(item) {
  if (!item) return '';
  if (item.dataUrl) return item.dataUrl;
  if (item.sessionAssetId && uploadedAssetStore[item.sessionAssetId]) return uploadedAssetStore[item.sessionAssetId];
  return '';
}

function getBundledMedia(name) {
  return bundledWmpMedia[name] || null;
}

function getMediaKindForName(name) {
  const ext = getFileExt(name);
  if (mediaExts.music.includes(ext)) return 'music';
  if (mediaExts.videos.includes(ext)) return 'videos';
  if (mediaExts.pictures.includes(ext)) return 'pictures';
  return '';
}

function getVfsFileEntries() {
  const results = [];
  const visit = (children, path) => {
    if (!children) return;
    Object.keys(children).forEach(name => {
      const item = children[name];
      if (!item) return;
      if (item.type === 'folder' || item.type === 'drive') {
        visit(item.children || {}, [...path, name]);
      } else if (item.type === 'file') {
        results.push({ name, item, path });
      }
    });
  };
  visit(vfs, []);
  return results;
}

function makeMediaEntry(entry) {
  const bundled = getBundledMedia(entry.name);
  const src = bundled ? bundled.src : getStoredMediaUrl(entry.item);
  const title = bundled ? bundled.title : entry.name.replace(/\.[^.]+$/, '');
  const artist = bundled ? bundled.artist : 'Imported media';
  const kind = getMediaKindForName(entry.name);
  return {
    title,
    artist,
    name: entry.name,
    kind,
    src,
    art: bundled ? bundled.art : (kind === 'pictures' ? src : 'icons/frames icons/media_player.png'),
    path: entry.path,
    item: entry.item
  };
}

function getMediaLibrary(kind) {
  return getVfsFileEntries()
    .filter(entry => getMediaKindForName(entry.name) === kind)
    .map(makeMediaEntry);
}

function refreshWmpTracks() {
  wmpTracks = getMediaLibrary('music').filter(track => track.src);
  if (!wmpTracks.length) {
    wmpTracks = Object.keys(bundledWmpMedia).map(name => makeMediaEntry({
      name,
      path: ['C:', 'Users', getPrimaryUserFolder(), 'Music'],
      item: { type: 'file' }
    }));
  }
}

function refreshWmpLibraryIfOpen() {
  const win = document.getElementById('window-mediaplayer');
  if (win && win.style.display !== 'none') initWMP(true);
}

function findMediaTrackIndex(entry) {
  const entryPath = (entry.path || []).join('\\');
  return wmpTracks.findIndex(track =>
    track.name === entry.name &&
    (track.path || []).join('\\') === entryPath
  );
}

function renderWmpLibrary(activeIndex = -1) {
  const panel = document.getElementById('wmp-lib-panel');
  if (!panel) return;
  let html = '<div class="wmp-lib-section"><div class="wmp-lib-title">Library</div>';
  html += '<div class="wmp-lib-item wmp-folder-row active"><img src="icons/music.png" alt=""> Music</div>';
  html += '<div class="wmp-lib-item wmp-folder-row" onclick="openWindow(\'mediacenter\')"><img src="icons/media_center.png" alt=""> Media Center</div>';
  html += '</div><div class="wmp-lib-section"><div class="wmp-lib-title">Album</div>';
  if (!wmpTracks.length) {
    html += '<div class="wmp-empty-row">No playable music files were found.</div>';
  } else {
    wmpTracks.forEach((track, index) => {
      const active = index === activeIndex ? ' active' : '';
      html += `<div class="wmp-lib-item wmp-track-row${active}" onclick="wmpLoadTrack(${index})" id="wmp-track-${index}"><img src="${track.art || 'icons/frames icons/media_player.png'}" alt=""><span><strong>${escapeHtml(track.title)}</strong><small>${escapeHtml(track.artist)}</small></span></div>`;
    });
  }
  html += '</div>';
  panel.innerHTML = html;
}

function setWmpArtwork(src) {
  wmpArtworkReady = false;
  wmpArtwork = new Image();
  wmpArtwork.onload = () => { wmpArtworkReady = true; };
  wmpArtwork.onerror = () => { wmpArtworkReady = false; };
  if (src) wmpArtwork.src = src;
}

function updateWmpPlayButton() {
  const icon = document.getElementById('wmp-play-icon');
  if (icon) icon.src = wmpIsPlaying ? 'templates/Pause.png' : 'templates/Play.png';
  const btn = document.getElementById('wmp-play-btn');
  if (btn) btn.title = wmpIsPlaying ? 'Pause' : 'Play';
}

function initWMP(force = false) {
  const win = document.getElementById('window-mediaplayer');
  if (!win) return;
  refreshWmpTracks();
  const currentIndex = wmpCurrentTrack ? findMediaTrackIndex(wmpCurrentTrack) : -1;
  renderWmpLibrary(currentIndex);

  wmpAudio.ontimeupdate = () => {
    const p = (wmpAudio.currentTime / (wmpAudio.duration || 1)) * 100;
    const fill = win.querySelector('.wmp-seek-fill');
    if (fill) fill.style.width = p + '%';
    const timeDisplay = document.getElementById('wmp-time');
    if (timeDisplay) timeDisplay.textContent = formatTime(wmpAudio.currentTime) + '/' + formatTime(wmpAudio.duration || 0);
  };
  wmpAudio.onended = () => { wmpNext(); };
  updateWmpPlayButton();
  if (!wmpAnimationStarted) wmpAnimate();
  if (force && wmpCurrentTrack) renderWmpLibrary(findMediaTrackIndex(wmpCurrentTrack));
}

function wmpLoadTrackFromFile(name, item, path = currentVfsPath) {
  refreshWmpTracks();
  const entry = makeMediaEntry({ name, item, path });
  if (!entry.src) {
    win7Alert('Frames Media Player', 'This file is in the library, but it does not have playable audio data in this session. Import an audio file from File Explorer to play it.', 'warning');
    return;
  }
  let index = findMediaTrackIndex(entry);
  if (index < 0) {
    wmpTracks.unshift(entry);
    index = 0;
  }
  renderWmpLibrary(index);
  wmpLoadTrack(index);
}

function wmpLoadTrack(idx) {
  const track = wmpTracks[idx];
  if (!track) return;
  if (!track.src) {
    win7Alert('Frames Media Player', 'This track is not playable until it is imported with audio data.', 'warning');
    return;
  }
  wmpCurrentTrack = track;
  document.querySelectorAll('.wmp-lib-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('wmp-track-' + idx);
  if (el) el.classList.add('active');
  const info = document.querySelector('.wmp-track-info');
  if (info) info.innerHTML = `<strong>${escapeHtml(wmpCurrentTrack.title)}</strong><br><span>${escapeHtml(wmpCurrentTrack.artist)}</span>`;

  setWmpArtwork(wmpCurrentTrack.art);
  wmpAudio.src = wmpCurrentTrack.src;
  wmpPlay();
}

function wmpTogglePlay() {
  if (wmpIsPlaying) wmpPause(); else wmpPlay();
}

function wmpPlay() {
  if (!wmpAudio.src && wmpTracks.length > 0) { wmpLoadTrack(0); return; }
  if (!wmpAudio.src) {
    win7Alert('Frames Media Player', 'No playable music is selected.', 'info');
    return;
  }
  wmpIsPlaying = true;
  updateWmpPlayButton();
  wmpAudio.play().catch(e => {
    console.log("Audio play failed", e);
    wmpIsPlaying = false;
    updateWmpPlayButton();
  });
}

function wmpPause() { wmpAudio.pause(); wmpIsPlaying = false; updateWmpPlayButton(); }
function wmpStop() { wmpAudio.pause(); wmpAudio.currentTime = 0; wmpIsPlaying = false; updateWmpPlayButton(); }
function wmpNext() {
  if (!wmpCurrentTrack) return;
  let next = wmpTracks.indexOf(wmpCurrentTrack) + 1;
  if (next >= wmpTracks.length) next = 0;
  wmpLoadTrack(next);
}
function wmpPrev() {
  if (!wmpCurrentTrack) return;
  let prev = wmpTracks.indexOf(wmpCurrentTrack) - 1;
  if (prev < 0) prev = wmpTracks.length - 1;
  wmpLoadTrack(prev);
}
function wmpSetVolume(v) { wmpAudio.volume = parseInt(v) / 100; }
function formatTime(s) { if (isNaN(s)) return "0:00"; return Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2); }
function wmpSeek(e) {
  const r = e.target.getBoundingClientRect();
  const p = (e.clientX - r.left) / r.width;
  wmpAudio.currentTime = p * (wmpAudio.duration || 0);
}
function wmpSwitchView(v) {
  document.querySelectorAll('.wmp-nav-tab').forEach(tab => {
    const isActive = (v === 'playing' && tab.textContent.includes('Now')) || (v === 'library' && tab.textContent.includes('Library'));
    tab.classList.toggle('active', isActive);
  });
  const player = document.querySelector('.wmp-legacy');
  if (player) player.classList.toggle('library-view', v === 'library');
}
function wmpLibSelect(v) {
  document.querySelectorAll('.wmp-lib-item').forEach(item => item.classList.remove('active'));
}
function wmpAnimate() {
  const canvas = document.getElementById('wmp-canvas'); if (!canvas || wmpAnimationStarted) return;
  wmpAnimationStarted = true;
  const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    if (wmpArtworkReady && wmpArtwork && wmpArtwork.complete && wmpArtwork.naturalWidth) {
      const scale = Math.min(w / wmpArtwork.naturalWidth, h / wmpArtwork.naturalHeight);
      const dw = wmpArtwork.naturalWidth * scale;
      const dh = wmpArtwork.naturalHeight * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillRect(dx - 9, dy - 9, dw + 18, dh + 18);
      ctx.strokeStyle = 'rgba(85,105,135,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx - 9, dy - 9, dw + 18, dh + 18);
      ctx.drawImage(wmpArtwork, dx, dy, dw, dh);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#e8f5ff');
      bg.addColorStop(0.48, '#76b9e8');
      bg.addColorStop(1, '#0e3774');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w * 0.64, h * 0.36, 8, w * 0.64, h * 0.36, w * 0.54);
      glow.addColorStop(0, 'rgba(255,255,255,0.74)');
      glow.addColorStop(0.42, 'rgba(114,202,255,0.32)');
      glow.addColorStop(1, 'rgba(5,24,58,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }

    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.08)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);

    const bars = 24; const barW = w / bars - 5;
    for (let i = 0; i < bars; i++) {
      const barH = wmpIsPlaying ? (Math.random() * h * 0.18 + 4) : 2;
      const x = i * (barW + 4) + 2;
      const y = h - barH - 2;
      ctx.fillStyle = 'rgba(67, 146, 209, 0.38)';
      ctx.fillRect(x, y, barW, barH);
      ctx.fillStyle = 'rgba(255,255,255,0.56)';
      ctx.fillRect(x, y, barW, 1.5);
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ========== CALCULATOR ==========
let calcBuffer = '';
function calcInput(v) { calcBuffer += v; document.getElementById('calc-display').value = calcBuffer; }
function calcOp(op) { calcBuffer += ' ' + op + ' '; document.getElementById('calc-display').value = calcBuffer; }
function calculate() { try { document.getElementById('calc-display').value = eval(calcBuffer); calcBuffer = eval(calcBuffer).toString(); } catch { document.getElementById('calc-display').value = 'Error'; calcBuffer = ''; } }
function clearCalc() { calcBuffer = ''; document.getElementById('calc-display').value = ''; }
function calcBackspace() { calcBuffer = calcBuffer.slice(0, -1); document.getElementById('calc-display').value = calcBuffer; }
function calcToggleSign() { if (calcBuffer) { calcBuffer = calcBuffer.startsWith('-') ? calcBuffer.slice(1) : '-' + calcBuffer; document.getElementById('calc-display').value = calcBuffer; } }
function calcPercent() { try { calcBuffer = (eval(calcBuffer) / 100).toString(); document.getElementById('calc-display').value = calcBuffer; } catch { } }

// ========== CONTROL PANEL ==========
function initControlPanel() {
  const body = document.getElementById('cp-body'); if (!body) return;
  body.innerHTML = '<div style="padding:15px;border-bottom:1px solid #eee"><h1 style="margin:0;font-size:18px;color:#003399;font-weight:normal">Adjust your computer\'s settings</h1></div><div class="cp-grid">' +
    '<div class="cp-item" onclick="cpOpenPage(\'system\')"><img src="icons/frames icons/computer.png" width="48"><div class="cp-text"><strong>System and Security</strong><small>Review computer status, back up your computer</small></div></div>' +
    '<div class="cp-item" onclick="cpOpenPage(\'accounts\')"><img src="icons/user_person.png" width="48"><div class="cp-text"><strong>User Accounts</strong><small>Change account type, password</small></div></div>' +
    '<div class="cp-item" onclick="cpOpenPage(\'network\')"><img src="icons/network.png" width="48"><div class="cp-text"><strong>Network and Internet</strong><small>View network status</small></div></div>' +
    '<div class="cp-item" onclick="openWindow(\'personalization\')"><img src="icons/personalization.png" width="48"><div class="cp-text"><strong>Appearance and Personalization</strong><small>Change desktop background, colors</small></div></div>' +
    '<div class="cp-item" onclick="cpOpenPage(\'hardware\')"><img src="icons/sound.png" width="48"><div class="cp-text"><strong>Hardware and Sound</strong><small>View devices, adjust sound</small></div></div>' +
    '<div class="cp-item" onclick="cpOpenPage(\'clock\')"><img src="icons/time.png" width="48"><div class="cp-text"><strong>Clock, Language, and Region</strong><small>Change date, time, number formats</small></div></div></div>';
}
function cpOpenPage(page) {
  const body = document.getElementById('cp-body'); if (!body) return;
  const back = '<button onclick="initControlPanel()" style="font-size:11px;margin-bottom:10px;cursor:pointer"><img src="back.png" width="12" style="vertical-align:middle"> Back</button>';
  if (page === 'system') {
    body.innerHTML = '<div class="cp-subpage">' + back + '<h2>System and Security</h2>' +
      '<div class="cp-setting"><label>Computer Name:</label><input value="WIN7-PC" id="cp-compname"></div>' +
      '<div class="cp-setting"><label>Frames Firewall:</label><select id="cp-firewall"><option>On (recommended)</option><option>Off</option></select></div>' +
      '<div class="cp-setting"><label>Auto Updates:</label><select id="cp-updates"><option>On</option><option>Off</option></select></div>' +
      '<div class="cp-setting"><label>System Restore:</label><button onclick="win7Alert(\'System Restore\',\'System restore point created.\',\'info\')">Create Restore Point</button></div>' +
      '<button onclick="cpSaveSettings()" style="margin-top:10px;padding:4px 12px;cursor:pointer">Save</button></div>';
  } else if (page === 'accounts') {
    body.innerHTML = '<div class="cp-subpage">' + back + '<h2>User Accounts</h2>' +
      '<div class="cp-setting"><label>Username:</label><input value="' + (settings.username || 'Admin') + '" id="cp-username"></div>' +
      '<div class="cp-setting"><label>Account Type:</label><select><option>Administrator</option><option>Standard User</option></select></div>' +
      '<div class="cp-setting"><label>Password:</label><button onclick="win7Alert(\'User Accounts\',\'Password changed.\',\'info\')">Change Password</button></div>' +
      '<button onclick="settings.username=document.getElementById(\'cp-username\').value;saveSettings();win7Alert(\'User Accounts\',\'Saved.\',\'info\')" style="margin-top:10px;padding:4px 12px;cursor:pointer">Save</button></div>';
  } else if (page === 'network') {
    body.innerHTML = '<div class="cp-subpage">' + back + '<h2>Network and Internet</h2>' +
      '<div class="cp-setting"><label>Connection:</label><span>Connected to HomeWiFi</span></div>' +
      '<div class="cp-setting"><label>IPv4 Address:</label><span>192.168.1.100</span></div>' +
      '<div class="cp-setting"><label>Subnet Mask:</label><span>255.255.255.0</span></div>' +
      '<div class="cp-setting"><label>Default Gateway:</label><span>192.168.1.1</span></div>' +
      '<div class="cp-setting"><label>DNS Server:</label><input value="8.8.8.8" id="cp-dns"></div>' +
      '<button onclick="win7Alert(\'Network and Internet\',\'Settings saved.\',\'info\')" style="margin-top:10px;padding:4px 12px;cursor:pointer">Apply</button></div>';
  } else if (page === 'hardware') {
    body.innerHTML = '<div class="cp-subpage">' + back + '<h2>Hardware and Sound</h2>' +
      '<div class="cp-setting"><label>Default Playback:</label><select><option>Speakers (Realtek)</option><option>Headphones</option></select></div>' +
      '<div class="cp-setting"><label>Volume:</label><input type="range" min="0" max="100" value="' + (settings.volume || 65) + '"></div>' +
      '<div class="cp-setting"><label>System Sounds:</label><select><option>Frames Default</option><option>No Sounds</option></select></div>' +
      '<button onclick="win7Alert(\'Hardware and Sound\',\'Settings saved.\',\'info\')" style="margin-top:10px;padding:4px 12px;cursor:pointer">Apply</button></div>';
  } else if (page === 'clock') {
    body.innerHTML = '<div class="cp-subpage">' + back + '<h2>Clock, Language, and Region</h2>' +
      '<div class="cp-setting"><label>Time Format:</label><select id="cp-clock" onchange="settings.clockFormat=this.value;saveSettings()"><option value="12h"' + (settings.clockFormat === '12h' ? ' selected' : '') + '>12-hour</option><option value="24h"' + (settings.clockFormat === '24h' ? ' selected' : '') + '>24-hour</option></select></div>' +
      '<div class="cp-setting"><label>Date Format:</label><select><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></div>' +
      '<div class="cp-setting"><label>Timezone:</label><select><option>(UTC-08:00) Pacific Time</option><option>(UTC-05:00) Eastern Time</option><option>(UTC+00:00) UTC</option><option>(UTC+01:00) Central European</option></select></div>' +
      '<div class="cp-setting"><label>Language:</label><select><option>English (United States)</option><option>Spanish</option><option>French</option><option>German</option></select></div>' +
      '<button onclick="win7Alert(\'Clock, Language, and Region\',\'Settings saved.\',\'info\')" style="margin-top:10px;padding:4px 12px;cursor:pointer">Apply</button></div>';
  }
}
function cpSaveSettings() { win7Alert('Control Panel', 'Settings saved.', 'info'); }

// ========== IFRAMES VIEWER ==========
let ieHistory = [], ieHistIdx = -1, ieTabs = [{ url: 'about:home', title: 'New Tab' }], ieActiveTab = 0;

function ieGetFrame() { return document.getElementById('ie-frame'); }
function ieGetAddr() { return document.getElementById('ie-address'); }
function ieGetStatus() { return document.getElementById('ie-status'); }

function ieSetStatus(text) { const s = ieGetStatus(); if (s) s.textContent = text; }

function ieNavigate(urlOverride) {
  const addr = urlOverride || ieGetAddr().value.trim();
  if (!addr) return;
  const frame = ieGetFrame(); if (!frame) return;
  ieSetStatus('Loading...');

  // Resolve URL
  let url = addr;
  if (!url.startsWith('http') && !url.startsWith('about:') && !url.startsWith('file:')) {
    url = url.includes('.') ? 'https://' + url : 'https://www.bing.com/search?q=' + encodeURIComponent(url);
  }

  ieHistory = ieHistory.slice(0, ieHistIdx + 1);
  ieHistory.push(url); ieHistIdx = ieHistory.length - 1;
  if (ieGetAddr()) ieGetAddr().value = url;

  const titleEl = document.getElementById('ie-title-text');
  const tabTitle = document.getElementById('ie-tab-title-0');

  if (url === 'about:home' || url === 'about:blank') {
    ieShowHomePage();
    if (titleEl) titleEl.textContent = 'New Tab - iFrames Viewer';
    if (tabTitle) tabTitle.textContent = 'New Tab';
    ieSetStatus('Done');
    return;
  }

  // External URLs вЂ” note: most will be blocked by browser CORS/X-Frame-Options
  try {
    frame.style.display = 'block';
    frame.src = url;
    frame.onload = () => {
      ieSetStatus('Done');
      try {
        const t = frame.contentDocument?.title || url;
        if (titleEl) titleEl.textContent = t + ' - iFrames Viewer';
        if (tabTitle) tabTitle.textContent = t.substring(0, 24) || 'Page';
      } catch (e) { }
    };
  } catch (e) {
    ieSetStatus('Error loading page');
  }
}

function ieShowHomePage() {
  const frame = ieGetFrame(); if (!frame) return;
  frame.style.display = 'block';
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><style>
    body{margin:0;font-family:"Segoe UI",sans-serif;background: #000 url('https://images.unsplash.com/photo-1441974231531-c6227db76b6e?ixlib=rb-1.2.1&auto=format&fit=crop&w=1920&q=80') center center / cover no-repeat; overflow:hidden;}
    .overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.15);}
    .header{position:relative;z-index:1;padding:10px 20px;display:flex;gap:20px;color:white;font-size:12px;background:rgba(0,0,0,0.3);}
    .nav-item{cursor:pointer;opacity:0.8;}
    .nav-item:hover{opacity:1;text-decoration:underline;}
    .nav-item.active{font-weight:bold;opacity:1;}
    .search-container{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:80vh;}
    .bing-search-box{background:rgba(255,255,255,0.85);border-radius:4px;padding:5px;display:flex;align-items:center;width:400px;box-shadow:0 4px 10px rgba(0,0,0,0.3);border:1px solid #aaa;}
    .bing-logo{color:#1e4ca8;font-size:28px;font-weight:bold;margin-right:15px;letter-spacing:-1px;display:flex;align-items:center;}
    .bing-logo span{color:#ff9000;margin-left:1px;font-size:32px;line-height:0;}
    .search-input{flex:1;border:none!important;background:transparent;outline:none;font-size:16px;padding:5px;color:#333;}
    .search-btn{background:none;border:none;cursor:pointer;padding:5px;display:flex;align-items:center;justify-content:center;color:#444;font-size:20px;}
    .footer{position:fixed;bottom:10px;left:0;right:0;z-index:1;display:flex;justify-content:space-between;padding:0 20px;color:white;font-size:11px;text-shadow:0 1px 2px rgba(0,0,0,0.5);}
  </style></head><body>
  <div class="overlay"></div>
  <div class="header">
    <div class="nav-item active">Web</div><div class="nav-item">Images</div><div class="nav-item">Videos</div><div class="nav-item">Maps</div><div class="nav-item">News</div><div class="nav-item">Shopping</div><div class="nav-item">More</div>
  </div>
  <div class="search-container">
    <div class="bing-search-box">
      <div class="bing-logo">bing</div>
      <input type="text" id="hs" class="search-input" placeholder="Search..." onkeydown="if(event.key==='Enter'){ window.parent.ieBingSearch(this.value); }">
      <button class="search-btn" onclick="window.parent.ieBingSearch(document.getElementById('hs').value)"><img src="icons/find.png" alt="Search" style="width:16px;height:16px"></button>
    </div>
  </div>
  <div class="footer">
    <div>&copy; 2026 Frames Project</div>
    <div style="display:flex;gap:15px"><span>Privacy</span><span>Terms</span><span>Help</span></div>
  </div>
  </body></html>`);
  doc.close();
}

function ieRefresh() {
  const addr = ieGetAddr()?.value;
  if (addr) ieNavigate(addr);
}

function ieBingSearch(q) {
  if (!q) return;
  ieNavigate('https://www.bing.com/search?q=' + encodeURIComponent(q));
}

function ieHome() { ieNavigate('about:home'); }

function ieBack() {
  if (ieHistIdx > 0) {
    ieHistIdx--;
    const url = ieHistory[ieHistIdx];
    if (ieGetAddr()) ieGetAddr().value = url;
    ieNavigate(url);
  }
}

function ieForward() {
  if (ieHistIdx < ieHistory.length - 1) {
    ieHistIdx++;
    const url = ieHistory[ieHistIdx];
    if (ieGetAddr()) ieGetAddr().value = url;
    ieNavigate(url);
  }
}

function ieNewTab() {
  // For simplicity, go to home
  ieNavigate('about:home');
}

function ieCloseTab(idx) {
  // For now just show home page
  ieShowHomePage();
}

function ieFavorites() { win7Alert('iFrames Viewer', 'Favorites not implemented in this simulation.', 'info'); }

function ieToolsMenu() { win7Alert('iFrames Viewer', 'Tools: Internet Options, Security Settings, Developer Tools<br><br>(Simulated вЂ” not functional)', 'info'); }



// ========== WIDGETS ==========
function startWidgetDrag(e, type) {
  e.preventDefault();
  const ghost = document.createElement('div');
  ghost.className = `widget-drag-ghost widget-drag-ghost-${type}`;
  ghost.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;';
  if (type === 'stickynote') ghost.innerHTML = '<div class="gadget-ghost gadget-ghost-note"></div>';
  else if (type === 'slideshow') ghost.innerHTML = '<div class="gadget-ghost gadget-ghost-slideshow"></div>';
  else if (type === 'calendar') ghost.innerHTML = '<div class="gadget-ghost gadget-ghost-calendar"><span>12</span></div>';
  else ghost.innerHTML = '<div class="gadget-ghost gadget-ghost-clock"></div>';
  document.body.appendChild(ghost);
  const move = (ev) => { ghost.style.left = (ev.clientX - 80) + 'px'; ghost.style.top = (ev.clientY - 60) + 'px'; };
  const drop = (ev) => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', drop); document.body.removeChild(ghost); createDesktopWidget(type, ev.clientX - 80, ev.clientY - 60); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', drop); move(e);
}
function createGadgetShell(type, x, y, innerHtml) {
  const widget = document.createElement('div');
  widget.className = `desktop-widget gadget gadget-${type}`;
  widget.style.left = x + 'px';
  widget.style.top = y + 'px';
  widget.innerHTML = `<button class="gadget-close" title="Close gadget" onclick="event.stopPropagation();this.parentElement.remove()">X</button>${innerHtml}`;
  document.getElementById('desktop').appendChild(widget);
  makeWidgetDraggable(widget);
  return widget;
}
function updateCalendarGadget(widget) {
  if (!widget || !document.body.contains(widget)) return;
  const now = new Date();
  const weekday = widget.querySelector('[data-calendar-weekday]');
  const month = widget.querySelector('[data-calendar-month]');
  const date = widget.querySelector('[data-calendar-date]');
  const year = widget.querySelector('[data-calendar-year]');
  if (weekday) weekday.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
  if (month) month.textContent = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  if (date) date.textContent = now.getDate();
  if (year) year.textContent = now.getFullYear();
}
function createDesktopWidget(type, x, y) {
  const desktop = document.getElementById('desktop');
  if (!desktop) return;
  if (type === 'stickynote') {
    const note = document.createElement('div'); note.className = 'sticky-note'; note.style.left = x + 'px'; note.style.top = y + 'px';
    note.innerHTML = '<div class="sticky-note-header"><button class="sticky-note-close" onclick="this.closest(\'.sticky-note\').remove();saveStickyNotes()">X</button></div><div class="sticky-note-body"><textarea placeholder="Type a note..." oninput="saveStickyNotes()"></textarea></div>';
    desktop.appendChild(note); makeStickyDraggable(note);
    saveStickyNotes();
  } else if (type === 'slideshow') {
    const widget = createGadgetShell(type, x, y, '<div class="gadget-surface gadget-slideshow-surface"><div class="gadget-slideshow-frame"><img src="templates/slideshow_1.jpg" alt="Slide Show"></div><div class="gadget-label">Slide Show</div></div>');
    const slideshowImages = [
      'templates/slideshow_1.jpg',
      'win7_wallpapers/img0.jpg',
      'win7_wallpapers/Starter1.jpg',
      'win7_wallpapers/Starter6.jpg',
      'win7_wallpapers/Starter12.jpg',
      'win7_wallpapers/Final1.jpg',
      'win7_wallpapers/Final6.jpg',
      'win7_wallpapers/Unreleased1.jpg',
      'win7_wallpapers/Unreleased7.jpg',
      'win7_wallpapers/example1.jpg'
    ];
    let frame = 0;
    setInterval(() => {
      if (!document.body.contains(widget)) return;
      frame = (frame + 1) % slideshowImages.length;
      const image = widget.querySelector('img');
      if (image) image.src = slideshowImages[frame];
    }, 4000);
    widget.ondblclick = () => widget.remove();
  } else if (type === 'clock') {
    const widgetId = 'widget-clock-' + Date.now();
    const widget = createGadgetShell(type, x, y, `<div class="gadget-surface gadget-clock-surface"><div class="gadget-clock-frame"><canvas width="146" height="146" id="${widgetId}"></canvas><div class="gadget-clock-gloss"></div></div></div>`);
    const canvas = widget.querySelector('canvas');
    setInterval(() => { drawAnalogClock(canvas); }, 1000);
    drawAnalogClock(canvas);
  } else if (type === 'calendar') {
    const widget = createGadgetShell(type, x, y, '<div class="gadget-surface gadget-calendar-surface"><div class="gadget-calendar-page"><div class="gadget-calendar-date" data-calendar-date></div><div class="gadget-calendar-month" data-calendar-month></div><div class="gadget-calendar-year" data-calendar-year></div></div><div class="gadget-calendar-clock"><span>12</span><span>3</span><span>6</span><span>9</span><i></i><b></b></div></div>');
    updateCalendarGadget(widget);
    setInterval(() => updateCalendarGadget(widget), 60000);
  }
}
function ensureDefaultDesktopWidgets() {
  if (settings.defaultDesktopWidgetsPlaced) return;
  const desktop = document.getElementById('desktop');
  if (!desktop) return;
  const startX = Math.max(240, window.innerWidth - 230);
  createDesktopWidget('clock', startX, 18);
  createDesktopWidget('stickynote', startX, 196);
  createDesktopWidget('slideshow', startX, 378);
  settings.defaultDesktopWidgetsPlaced = true;
  saveSettings();
}
function drawAnalogClock(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const faceImage = drawAnalogClock.faceImage || (drawAnalogClock.faceImage = new Image());
  if (!drawAnalogClock.faceImageInitialized) {
    faceImage.src = 'templates/clock.png';
    drawAnalogClock.faceImageInitialized = true;
  }
  ctx.clearRect(0, 0, w, h);
  if (faceImage.complete && faceImage.naturalWidth) {
    ctx.drawImage(faceImage, 0, 0, w, h);
  } else {
    faceImage.onload = () => drawAnalogClock(canvas);
    return;
  }

  const now = new Date();
  const hr = now.getHours() % 12;
  const mn = now.getMinutes();

  const hourAngle = (hr + mn / 60) * Math.PI / 6 - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(hourAngle) * 21, cy + Math.sin(hourAngle) * 21);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  const minuteAngle = (mn + now.getSeconds() / 60) * Math.PI / 30 - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(minuteAngle) * 31, cy + Math.sin(minuteAngle) * 31);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();
}
function makeWidgetDraggable(el) {
  let ox, oy, dragging = false;
  el.onmousedown = (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return; dragging = true; const r = el.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
    const move = (ev) => { if (!dragging) return; el.style.left = (ev.clientX - ox) + 'px'; el.style.top = (ev.clientY - oy) + 'px'; };
    const stop = () => { dragging = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop);
  };
}
function makeStickyDraggable(el) {
  const header = el.querySelector('.sticky-note-header'); if (!header) return;
  let ox, oy, dragging = false;
  header.onmousedown = (e) => {
    if (e.target.tagName === 'BUTTON') return; dragging = true; const r = el.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
    const move = (ev) => { if (!dragging) return; el.style.left = (ev.clientX - ox) + 'px'; el.style.top = (ev.clientY - oy) + 'px'; };
    const stop = () => { dragging = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop); saveStickyNotes(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop);
  };
}
function saveStickyNotes() {
  const notes = []; document.querySelectorAll('.sticky-note').forEach(n => {
    notes.push({ x: n.style.left, y: n.style.top, text: n.querySelector('textarea').value });
  });
  settings.stickyNotes = notes; saveSettings();
}
function loadStickyNotes() {
  (settings.stickyNotes || []).forEach(n => {
    const note = document.createElement('div'); note.className = 'sticky-note'; note.style.left = n.x; note.style.top = n.y;
    note.innerHTML = '<div class="sticky-note-header"><button class="sticky-note-close" onclick="this.closest(\'.sticky-note\').remove();saveStickyNotes()">X</button></div><div class="sticky-note-body"><textarea oninput="saveStickyNotes()">' + n.text + '</textarea></div>';
    document.getElementById('desktop').appendChild(note); makeStickyDraggable(note);
  });
}



// ========== POPUPS ==========
function togglePopup(type) {
  closeAllPopups();
  const popup = document.getElementById(type + '-popup'); if (!popup) return;
  if (popup.style.display === 'block') return;
  playSound('notify');
  popup.style.display = 'block';
  popup.style.bottom = '44px';
  popup.style.right = '10px';
  popup.style.left = 'auto'; popup.style.top = 'auto';
}
function closeAllPopups() {
  ['battery', 'sound', 'security', 'network'].forEach(t => { const p = document.getElementById(t + '-popup'); if (p) p.style.display = 'none'; });
}
function updateVolumeLevel(v) { const d = document.getElementById('volume-display'); if (d) d.textContent = v + '%'; }
function shutdownPC() {
  playSound('shutdown');
  document.body.innerHTML = '<div style="background:#000;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px;font-family:Segoe UI,sans-serif;flex-direction:column;gap:20px"><img src="templates/ShutdownGlow.png" width="92" height="42" style="opacity:0.95">Shutting down...</div>';
}

// ========== CUSTOM MESSAGE BOXES ==========
function win7Alert(title, message, type = 'info') {
  const soundMap = { info: 'ding', error: 'critical', warning: 'exclamation' };
  const iconMap = { info: 'icons/frames icons/info.png', error: 'icons/frames icons/error.png', warning: 'icons/frames icons/warning.png' };
  playSound(soundMap[type] || 'ding');

  const overlay = document.createElement('div');
  overlay.className = 'msgbox-overlay';
  overlay.innerHTML = `
    <div class="msgbox">
      <div class="msgbox-title"><span>${title}</span></div>
      <div class="msgbox-body">
        <img src="${iconMap[type] || iconMap.info}" class="msgbox-icon">
        <div class="msgbox-content">${message}</div>
      </div>
      <div class="msgbox-buttons">
        <button class="msgbox-btn default" id="msgbox-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const okBtn = overlay.querySelector('#msgbox-ok');
  okBtn.focus();
  okBtn.onclick = () => overlay.remove();
}

function win7Confirm(title, message, callback, type = 'warning') {
  const soundMap = { info: 'ding', error: 'critical', warning: 'exclamation' };
  const iconMap = { info: 'icons/frames icons/info.png', error: 'icons/frames icons/error.png', warning: 'icons/frames icons/warning.png' };
  playSound(soundMap[type] || 'exclamation');

  const overlay = document.createElement('div');
  overlay.className = 'msgbox-overlay';
  overlay.innerHTML = `
    <div class="msgbox">
      <div class="msgbox-title"><span>${title}</span></div>
      <div class="msgbox-body">
        <img src="${iconMap[type] || iconMap.warning}" class="msgbox-icon">
        <div class="msgbox-content">${message}</div>
      </div>
      <div class="msgbox-buttons">
        <button class="msgbox-btn default" id="msgbox-yes">Yes</button>
        <button class="msgbox-btn" id="msgbox-no">No</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#msgbox-yes').onclick = () => { overlay.remove(); callback(true); };
  overlay.querySelector('#msgbox-no').onclick = () => { overlay.remove(); callback(false); };
  overlay.querySelector('#msgbox-yes').focus();
}

function win7Prompt(title, message, defaultValue, callback) {
  playSound('ding');
  const overlay = document.createElement('div');
  overlay.className = 'msgbox-overlay';
  overlay.innerHTML = `
    <div class="msgbox">
      <div class="msgbox-title"><span>${title}</span></div>
      <div class="msgbox-body">
        <img src="icons/frames icons/info.png" class="msgbox-icon">
        <div class="msgbox-content">
          <div>${message}</div>
          <input type="text" id="msgbox-input" style="width:100%;margin-top:10px;padding:3px;border:1px solid #ccc;outline:none" value="${defaultValue || ''}">
        </div>
      </div>
      <div class="msgbox-buttons">
        <button class="msgbox-btn default" id="msgbox-ok">OK</button>
        <button class="msgbox-btn" id="msgbox-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#msgbox-input');
  input.focus(); input.select();
  input.onkeydown = (e) => { if (e.key === 'Enter') overlay.querySelector('#msgbox-ok').click(); if (e.key === 'Escape') overlay.querySelector('#msgbox-cancel').click(); };
  overlay.querySelector('#msgbox-ok').onclick = () => { overlay.remove(); callback(input.value); };
  overlay.querySelector('#msgbox-cancel').onclick = () => { overlay.remove(); callback(null); };
}

// ========== CLOCK ==========
function updateLockCoverClock() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const timeEl = document.getElementById('lock-cover-time');
  const dateEl = document.getElementById('lock-cover-date');
  if (timeEl) timeEl.textContent = time;
  if (dateEl) dateEl.textContent = date;
}

function updateClock() {
  const n = new Date();
  const t = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const d = n.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const c = document.getElementById('clock');
  if (c) c.innerHTML = '<div class="time">' + t + '</div><div class="date">' + d + '</div>';
  updateLockCoverClock();
}

// ========== CONTEXT MENU ==========
let rightClickedItem = null; // { type, name, path }

function handleContextMenu(e) {
  const icon = e.target.closest('.desktop-icon');
  const explorerItem = e.target.closest('.explorer-item');
  const explorerSurface = e.target.closest('#window-explorer .explorer-main');
  const winEl = e.target.closest('.window');
  const taskbar = e.target.closest('#taskbar');
  const start = e.target.closest('#start-menu');

  if (winEl || taskbar || start) {
    if (!icon && !explorerItem && !explorerSurface) return;
  }

  e.preventDefault();
  const menu = document.getElementById('context-menu');
  if (!menu) return;

  if (icon) {
    const name = icon.querySelector('span').textContent;
    rightClickedItem = { type: 'icon', name, path: getDesktopPath(), surface: 'desktop' };
    selectedItem = name;
  } else if (explorerItem) {
    const name = explorerItem.dataset.name;
    rightClickedItem = { type: 'file', name, path: [...currentVfsPath], surface: 'explorer' };
    selectedItem = name;
  } else {
    rightClickedItem = {
      type: 'empty',
      path: explorerSurface ? [...currentVfsPath] : getDesktopPath(),
      surface: explorerSurface ? 'explorer' : 'desktop'
    };
    selectedItem = null;
  }

  document.querySelectorAll('.context-file-op').forEach(el => {
    el.style.display = (rightClickedItem.type !== 'empty') ? 'block' : 'none';
  });
  document.querySelectorAll('.context-empty-op').forEach(el => {
    el.style.display = (rightClickedItem.type === 'empty') ? 'block' : 'none';
  });
  document.querySelectorAll('.context-desktop-only').forEach(el => {
    el.style.display = (rightClickedItem.surface === 'desktop' && rightClickedItem.type === 'empty') ? 'block' : 'none';
  });
  document.querySelectorAll('.context-explorer-op').forEach(el => {
    el.style.display = (rightClickedItem.surface === 'explorer') ? 'block' : 'none';
  });

  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
}

function vfsNewFile(type) {
  const path = rightClickedItem && rightClickedItem.type === 'empty' ? rightClickedItem.path : currentVfsPath;
  const ch = getPathChildren(path);
  if (!ch) {
    win7Alert('Explorer', 'This location is not available.', 'error');
    return;
  }

  let baseName = "New Folder";
  let ext = "";
  let content = "";

  if (type === 'txt') { baseName = "New Text Document"; ext = ".txt"; content = ""; }

  const name = getUniqueItemName(ch, baseName + ext);

  if (type === 'folder') {
    ch[name] = { type: 'folder', children: {}, modified: new Date().toLocaleDateString() };
  } else {
    ch[name] = { type: 'file', content, modified: new Date().toLocaleDateString() };
  }

  selectedItem = name;
  rightClickedItem = null;
  saveVfs();
  updateExplorer();
  updateDesktop();
  closeContextMenu();
  playSound('nav');
}

function vfsRenameNode() {
  const target = getActiveVfsTarget();
  if (!target) return;
  const oldName = target.name;
  win7Prompt('Rename', `Enter new name for "${oldName}":`, oldName, (newName) => {
    renameVfsItem(target, newName);
  });
}

function vfsDeleteNode() {
  const target = getActiveVfsTarget();
  if (!target) return;
  deleteVfsItem(target);
}

function vfsOpenItem() {
  const target = getActiveVfsTarget();
  if (!target) return;
  const item = getPathChildren(target.path)?.[target.name];
  if (!item) {
    win7Alert('Explorer', 'This item is no longer available.', 'error');
    return;
  }
  openVfsEntry(target.name, item, target.path);
  closeContextMenu();
}
function vfsShowProperties() {
  const target = getActiveVfsTarget();
  if (!target) return;
  const item = getPathChildren(target.path)?.[target.name];
  if (!item) {
    win7Alert('Properties', 'This item is no longer available.', 'error');
    return;
  }
  const typeLabel = item.type === 'folder' ? 'File folder' : item.type === 'drive' ? 'Local Disk' : getFileTypeInfo(target.name).type;
  const sizeLabel = item.type === 'file' ? `${item.content ? Math.ceil(item.content.length / 1024) : 0} KB` : `${Object.keys(item.children || {}).length} items`;
  const modified = item.modified || 'Not available';
  win7Alert(
    'Properties',
    `<strong>${target.name}</strong><br>Type: ${typeLabel}<br>Location: ${target.path.join('\\')}<br>Size: ${sizeLabel}<br>Modified: ${modified}`,
    'info'
  );
  closeContextMenu();
}

// ========== AERO PEEK ==========
function initAeroPeek() {
  const showDesktopBtn = document.getElementById('minimize-all-btn');
  if (!showDesktopBtn) return;
  showDesktopBtn.addEventListener('mouseenter', () => {
    document.body.classList.add('peek-active');
  });
  showDesktopBtn.addEventListener('mouseleave', () => {
    document.body.classList.remove('peek-active');
  });
}

// ========== INIT ==========
function updateDesktop() {
  const desktop = document.getElementById('desktop');
  if (!desktop) return;

  // Clear existing dynamic icons (keep fixed ones if any, but better to clear all and re-render)
  // We identify dynamic icons as those not having a specific fixed ID if needed
  const icons = desktop.querySelectorAll('.desktop-icon');
  icons.forEach(ic => ic.remove());

  const path = getDesktopPath();
  const node = getPathNode(path);
  if (!node) return;

  const ch = node.children || node;
  let offsetX = 20;
  let offsetY = 20;

  // Add system icons first (Recycle Bin, Computer)
  const recycleBinChildren = getRecycleBinChildren();
  const systemIcons = [
    { name: 'Computer', icon: 'icons/frames icons/computer.png', action: () => openWindow('explorer') },
    { name: 'Recycle Bin', icon: (Object.keys(recycleBinChildren).length > 0 ? 'icons/frames icons/bin_full.png' : 'icons/frames icons/bin_empty.png'), action: () => openWindow('recyclebin'), id: 'desktop-recycle-icon' },
    { name: 'Desktop Gadgets', icon: 'icons/frames icons/gadgets.png', action: () => openWindow('widgets'), id: 'desktop-widgets-icon' }
  ];

  systemIcons.forEach(sys => {
    const div = document.createElement('div');
    div.className = 'desktop-icon';
    div.style.left = offsetX + 'px';
    div.style.top = offsetY + 'px';
    div.ondblclick = sys.action;
    div.oncontextmenu = (e) => handleContextMenu(e);
    div.innerHTML = `<img src="${sys.icon}" ${sys.id ? `id="${sys.id}"` : ''}><span>${sys.name}</span>`;
    desktop.appendChild(div);
    offsetY += 90;
    if (offsetY > window.innerHeight - 150) { offsetY = 20; offsetX += 90; }
  });

  // Add VFS files/folders
  Object.keys(ch).forEach(name => {
    const item = ch[name];
    const div = document.createElement('div');
    div.className = 'desktop-icon';
    div.style.left = offsetX + 'px';
    div.style.top = offsetY + 'px';
    div.dataset.name = name;

    const icon = item.type === 'folder' ? 'icons/frames icons/folder.png' : getFileTypeInfo(name).icon;
    div.innerHTML = `<img src="${icon}"><span>${name}</span>`;

    div.ondblclick = () => {
      openVfsEntry(name, item, path);
    };

    div.oncontextmenu = (e) => handleContextMenu(e);

    desktop.appendChild(div);
    offsetY += 90;
    if (offsetY > window.innerHeight - 150) { offsetY = 20; offsetX += 90; }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initBootloader();
  applyTheme();
  initAeroPeek();
  document.querySelectorAll('.window').forEach(w => { makeDraggable(w); makeResizable(w); });
  renderPinnedTaskbar();
  initStartMenuPinning();

  setInterval(updateClock, 1000); updateClock();
  updateGlassLightAnchor();
  queueGlassReflectionUpdate();
  updateMessengerServiceStatus();
  updateLockIdentityPreview(currentAccount.email);

  // Context menu on desktop/explorer background
  document.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('resize', () => { updateGlassLightAnchor(); queueGlassReflectionUpdate(); });

  // Close context menu and start menu on outside click
  document.addEventListener('click', (e) => {
    const cm = document.getElementById('context-menu');
    if (cm && !cm.contains(e.target)) closeContextMenu();
    const pm = document.getElementById('start-pin-menu');
    if (pm && !pm.contains(e.target)) closePinMenu();
    const sm = document.getElementById('start-menu'), sb = document.getElementById('start-button');
    if (sm && sb && !sm.contains(e.target) && !sb.contains(e.target) && !e.target.closest('#start-pin-menu')) sm.style.display = 'none';
  });

  // Background clicks clear selection in Explorer
  document.addEventListener('click', (e) => {
    if (e.target.closest('.explorer-main') && !e.target.closest('.explorer-item')) {
      selectedItem = null;
      updateExplorer();
    }
  });

  // Marquee Selection Logic for Desktop
  let marquee = null, mStartX, mStartY;
  document.addEventListener('mousedown', (e) => {
    // Only on desktop background, not inside windows or other elements
    if (e.button !== 0 || e.target.closest('.window') || e.target.closest('#taskbar') || e.target.closest('#start-menu') || e.target.closest('.desktop-icon')) return;

    mStartX = e.clientX; mStartY = e.clientY;
    marquee = document.createElement('div');
    marquee.className = 'selection-marquee';
    marquee.style.left = mStartX + 'px'; marquee.style.top = mStartY + 'px';
    document.body.appendChild(marquee);

    // Clear all desktop selections
    document.querySelectorAll('.desktop-icon').forEach(ic => ic.classList.remove('selected'));

    const onMove = (ev) => {
      if (!marquee) return;
      const curX = ev.clientX, curY = ev.clientY;
      const x = Math.min(mStartX, curX), y = Math.min(mStartY, curY);
      const h = Math.abs(mStartY - curY), w = Math.abs(mStartX - curX);
      marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
      marquee.style.width = w + 'px'; marquee.style.height = h + 'px';

      const rect = marquee.getBoundingClientRect();
      document.querySelectorAll('.desktop-icon').forEach(ic => {
        const icRect = ic.getBoundingClientRect();
        if (!(rect.right < icRect.left || rect.left > icRect.right || rect.bottom < icRect.top || rect.top > icRect.bottom)) {
          ic.classList.add('selected');
        } else {
          ic.classList.remove('selected');
        }
      });
    };
    const onUp = () => { if (marquee) { marquee.remove(); marquee = null; } document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });

  // Universal Title Bar Control delegation
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[aria-label="Close"]');
    if (btn) { e.stopPropagation(); playSound('nav'); const win = btn.closest('.window'); if (win) closeWindow(win.id.replace('window-', '')); }
    const minBtn = e.target.closest('button[aria-label="Minimize"]');
    if (minBtn) { e.stopPropagation(); const win = minBtn.closest('.window'); if (win) minimizeWindow(win.id.replace('window-', '')); }
    const maxBtn = e.target.closest('button[aria-label="Maximize"]');
    if (maxBtn) { e.stopPropagation(); const win = maxBtn.closest('.window'); if (win) toggleMaximize(win.id.replace('window-', '')); }
  });

  // Global sound effects for interactive elements
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('button') || t.closest('[role="menuitem"]') || t.closest('.office-btn') || t.closest('.calc-btn') || t.closest('.desktop-icon')) {
      if (!t.closest('.title-bar-controls')) playSound('nav');
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { paintUndo(); e.preventDefault(); }
    if (e.ctrlKey && e.key === 'y') { paintRedo(); e.preventDefault(); }
  });

  updateExplorer();
  updateRecycleBin();
  loadStickyNotes();
  updateDesktop(); // Initialize desktop icons
  ensureDefaultDesktopWidgets();
});

window.addEventListener('beforeunload', () => {
  if (messengerReconnectTimer) clearTimeout(messengerReconnectTimer);
  if (messengerSocket && messengerSocket.readyState === WebSocket.OPEN) {
    try {
      messengerSocket.close();
    } catch (err) {
      console.warn('Messenger socket close failed:', err);
    }
  }
  if (!currentAccount.signedIn || !navigator.sendBeacon) return;
  try {
    const payload = JSON.stringify({
      email: currentAccount.email,
      profile: { displayName: currentAccount.displayName || settings.username || deriveDisplayName(currentAccount.email) },
      state: buildAccountSnapshot()
    });
    navigator.sendBeacon(`${getAccountServiceBase()}/api/state`, new Blob([payload], { type: 'application/json' }));
  } catch (err) {
    console.warn('Account beacon save failed:', err);
  }
});

function signInAsGuest() {
  if (typeof signInInProgress !== 'undefined' && signInInProgress) return;
  if (typeof signInInProgress !== 'undefined') signInInProgress = false;
  if (typeof setLockControlsDisabled === 'function') setLockControlsDisabled(false);
  if (typeof messengerSocket !== 'undefined' && messengerSocket) {
    try { messengerSocket.close(); } catch (err) {}
    messengerSocket = null;
  }
  currentAccount.email = normalizeAccountEmail('guest@offline');
  currentAccount.displayName = 'Guest';
  currentAccount.signedIn = true;
  currentAccount.serverAvailable = false;
  currentAccount.wsConnected = false;
  settings.username = 'Guest';
  try {
    localStorage.setItem(LOCAL_KEYS.lastAccount, currentAccount.email);
  } catch (err) {
    console.warn('Guest account cache failed:', err);
  }
  saveSettings();
  updateShellIdentity();
  if (typeof updateMessengerServiceStatus === 'function') updateMessengerServiceStatus();
  unlockDesktop();
}

