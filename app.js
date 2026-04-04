// ============================================================
//  APP — MAIN GAME CONTROLLER
//  • Firebase Firestore for progress + photo URLs (shared across devices)
//  • Cloudinary for image hosting (permanent URLs, free tier, no expiry)
//  • Auto-play piano music on first user interaction
//  • Anniversary date display (April 4 — counts days since / until)
//  • Typewriter modal messages
//  • Card flip animation on reveal
//  • Polaroid develop effect on photos
//  • Click sound on every button
//  • Desktop drag fix (pointer capture on scratch canvas)
//  • Share button via html2canvas
//  • Gallery page for album photos
// ============================================================

// ── Cloudinary config ───────────────────────────────────────
const CLOUDINARY_CLOUD_NAME    = 'dtou9fm83';
const CLOUDINARY_UPLOAD_PRESET = 'anniversary_upload';

// ── Anniversary date (April 4, 2020) ───────────────────────────
const START_YEAR        = 2020;
const ANNIVERSARY_MONTH = 4;  // April
const ANNIVERSARY_DAY   = 4;

function getAnniversaryYear() {
  const now = new Date();
  const annivThisYear = new Date(now.getFullYear(), ANNIVERSARY_MONTH - 1, ANNIVERSARY_DAY);
  let yearCount = now.getFullYear() - START_YEAR;
  // If it's already passed this year, it's the next anniversary year we're looking forward to
  if (now > annivThisYear && (now.getMonth() !== ANNIVERSARY_MONTH - 1 || now.getDate() !== ANNIVERSARY_DAY)) {
    yearCount++;
  }
  return yearCount;
}

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─────────────────────────────────────────────────────────────
let unlockedCount     = 0;
let scratchInstances  = {};
let confettiEngine    = null;
let introParticles    = null;
let finaleParticles   = null;
let currentlyLocked   = new Set([2, 3, 4, 5, 6]);
let currentModalIndex = -1;
let typewriterTimer   = null;
let musicEnabled      = false;
let _photosCache      = [];   // Array of {id, url, timestamp}

// ── Keep in-memory _photosCache in sync with real Firestore IDs ──
// Called by DB layer once addDoc resolves and we get the real doc ID
window._onPhotoIdResolved = (tempId, realId) => {
  const idx = _photosCache.findIndex(p => p.id === tempId);
  if (idx !== -1) _photosCache[idx].id = realId;
};
// Called after a background Firestore sync so in-memory IDs are always real
window._onPhotosRefreshed = (freshPhotos) => {
  // NEVER replace _photosCache with fewer photos than we have in memory.
  // If Firestore returns 0, the write hasn't propagated yet — keep what we have.
  if (!Array.isArray(freshPhotos) || freshPhotos.length < _photosCache.length) return;
  _photosCache = freshPhotos;
  const gallery = document.getElementById('gallery-screen');
  if (gallery && gallery.classList.contains('open')) {
    renderUploadGrid();
    updateGalleryBadge();
  }
};
// Called on local delete so UI stays consistent
window._onPhotoCacheInvalidated = () => {
  // Nothing extra needed here; delete handler already filters _photosCache
};

// Album slider state
let currentSlide = 0;
let totalSlides  = 0;
let isSliding    = false;

// ============================================================
//  AUDIO ENGINE
// ============================================================
const Audio = (() => {
  let ctx = null;
  const buffers = {};
  let scratchNode  = null, scratchGain  = null, scratchPlaying = false;
  let bgMusicNode  = null, bgMusicGain  = null, bgMusicOn      = false;

  // AudioContext is created ONLY after a user gesture — never on page load
  let _pendingLoads = []; // queue loads before ctx exists

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e) { return null; }
    }
    return ctx;
  }

  async function _loadNow(name, url) {
    try {
      const ac  = getCtx();
      if (!ac) return;
      if (ac.state === 'suspended') { try { await ac.resume(); } catch(e) {} }
      const res = await fetch(url);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      buffers[name] = await ac.decodeAudioData(arr);
    } catch(e) {}
  }

  async function load(name, url) {
    // Store for later if AudioContext hasn't been unlocked yet
    _pendingLoads.push({ name, url });
  }

  async function flushPendingLoads() {
    const loads = [..._pendingLoads];
    _pendingLoads = [];
    await Promise.all(loads.map(({ name, url }) => _loadNow(name, url)));
  }

  function makeReverb(duration = 1.2, decay = 2.5) {
    const ac = getCtx();
    if (!ac) return null;
    const len = ac.sampleRate * duration;
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    const conv = ac.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  function playOnce(name, volume = 1.0, pitch = 1.0) {
    if (!buffers[name]) return;
    try {
      const ac = getCtx();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      const src  = ac.createBufferSource();
      src.buffer = buffers[name];
      src.playbackRate.value = pitch;
      const gain = ac.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(ac.destination);
      src.start();
    } catch(e) {}
  }

  function playClick() { playOnce('click', 0.35, 1.0 + (Math.random() * 0.1 - 0.05)); }

  function startScratch() {
    if (scratchPlaying) return;
    if (!buffers['scratch']) return;
    try {
      const ac = getCtx();
      if (!ac || ac.state === 'suspended') return;
      scratchGain = ac.createGain();
      scratchGain.gain.value = 0;
      const reverb     = makeReverb(0.6, 3);
      const reverbGain = ac.createGain();
      reverbGain.gain.value = 0.12;
      scratchNode = ac.createBufferSource();
      scratchNode.buffer = buffers['scratch'];
      scratchNode.loop   = true;
      scratchNode.playbackRate.value = 0.92 + Math.random() * 0.16;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2800;
      filter.Q.value = 0.7;
      scratchNode.connect(filter);
      filter.connect(scratchGain);
      scratchGain.connect(ac.destination);
      if (reverb) {
        filter.connect(reverb);
        reverb.connect(reverbGain);
        reverbGain.connect(ac.destination);
      }
      scratchNode.start();
      scratchGain.gain.setTargetAtTime(0.18, ac.currentTime, 0.04);
      scratchPlaying = true;
    } catch(e) {}
  }

  function stopScratch() {
    if (!scratchPlaying || !scratchGain) return;
    try {
      const ac = getCtx();
      scratchGain.gain.setTargetAtTime(0, ac.currentTime, 0.08);
      const nodeToStop = scratchNode;
      const gainToNull = scratchGain;
      // Mark as not playing IMMEDIATELY so a quick re-start doesn't double-stack
      scratchPlaying = false;
      scratchNode    = null;
      scratchGain    = null;
      setTimeout(() => {
        try { nodeToStop?.stop(); } catch(e) {}
      }, 300);
    } catch(e) { scratchPlaying = false; scratchNode = null; scratchGain = null; }
  }

  function startBgMusic() {
    if (!buffers['piano'] || bgMusicOn) return;
    try {
      const ac = getCtx();
      if (!ac || ac.state === 'suspended') return;
      bgMusicGain = ac.createGain();
      bgMusicGain.gain.value = 0;
      bgMusicNode = ac.createBufferSource();
      bgMusicNode.buffer = buffers['piano'];
      bgMusicNode.loop   = true;
      bgMusicNode.connect(bgMusicGain);
      bgMusicGain.connect(ac.destination);
      bgMusicNode.start();
      bgMusicGain.gain.setTargetAtTime(0.3, ac.currentTime, 2.0);
      bgMusicOn = true;
    } catch(e) {}
  }

  function stopBgMusic() {
    if (!bgMusicOn || !bgMusicGain) return;
    try {
      const ac = getCtx();
      if (!ac) { bgMusicOn = false; return; }
      bgMusicGain.gain.setTargetAtTime(0, ac.currentTime, 1.0);
      setTimeout(() => {
        try { bgMusicNode?.stop(); } catch(e) {}
        bgMusicOn = false; bgMusicNode = null; bgMusicGain = null;
      }, 2500);
    } catch(e) { bgMusicOn = false; }
  }

  async function unlock() {
    try {
      const ac = getCtx();
      if (!ac) return;
      if (ac.state === 'suspended') await ac.resume().catch(() => {});
      // Now load all queued audio files
      await flushPendingLoads();
    } catch(e) {}
  }

  function isMusicOn() { return bgMusicOn; }

  return { load, playOnce, playClick, startScratch, stopScratch, startBgMusic, stopBgMusic, isMusicOn, unlock };
})();

// ============================================================
//  HAPTIC
// ============================================================
function haptic(pattern = [30]) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch(e) {}
}

// ============================================================
//  CLICK SOUND — global delegation
// ============================================================
function attachClickSounds() {
  document.addEventListener('click', (e) => {
    const targets = '#start-btn,#back-btn,#dialog-cancel,#dialog-confirm,' +
      '#modal-close,#modal-backdrop,#modal-prev,#modal-next,' +
      '#album-prev,#album-next,#finale-review-btn,#finale-share-btn,' +
      '#music-btn,#album-upload-btn,#share-close-btn,#share-backdrop,.album-dot,' +
      '#gallery-close-btn,.gallery-card,#gallery-btn,#gallery-add-photo-header-btn,#gallery-reset-btn';
    if (e.target.closest(targets)) Audio.playClick();
  }, true);
}

// ============================================================
//  ANNIVERSARY DATE — April 4 (no emojis — icons only)
// ============================================================
function renderAnniversaryDate() {
  const el = document.getElementById('anniversary-date');
  if (!el) return;

  const now      = new Date();
  const thisYear = now.getFullYear();
  const anniv    = new Date(thisYear, ANNIVERSARY_MONTH - 1, ANNIVERSARY_DAY);
  const todayMD  = now.getMonth() * 100 + now.getDate();
  const annivMD  = (ANNIVERSARY_MONTH - 1) * 100 + ANNIVERSARY_DAY;

  const yearCount = getAnniversaryYear();
  const ordinal   = getOrdinal(yearCount);

  // Update badge and titles throughout the site
  updateAnniversaryText(yearCount, ordinal);

  const heartIcon = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
  const starIcon  = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const clockIcon = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  if (now.getMonth() === ANNIVERSARY_MONTH - 1 && now.getDate() === ANNIVERSARY_DAY) {
    el.innerHTML = `${starIcon}<strong>Happy Anniversary!</strong> ${heartIcon} Today is our ${ordinal} year`;
    el.classList.add('is-anniversary');
    document.title = `Happy ${ordinal} Anniversary`;
    return;
  }

  let nextAnniv;
  if (todayMD > annivMD) {
    nextAnniv = new Date(thisYear + 1, ANNIVERSARY_MONTH - 1, ANNIVERSARY_DAY);
  } else {
    nextAnniv = anniv;
  }

  const msLeft   = nextAnniv - now;
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  if (msLeft > 0 && msLeft < 24 * 60 * 60 * 1000) {
    // Less than 24 hours left — start live countdown
    startLiveCountdown(nextAnniv, el, clockIcon, heartIcon, ordinal);
    return;
  }

  if (daysLeft === 1) {
    el.innerHTML = `${clockIcon}<strong>Tomorrow</strong> is our ${ordinal} Anniversary ${heartIcon}`;
  } else {
    el.innerHTML = `${clockIcon}<strong>${daysLeft} days</strong> until our ${ordinal} Anniversary ${heartIcon} April 4`;
  }
}

function startLiveCountdown(targetDate, el, clockIcon, heartIcon, ordinal) {
  function update() {
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
      renderAnniversaryDate(); // Refresh to "Today is our day" state
      return;
    }

    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    el.innerHTML = `${clockIcon}<strong>${timeStr}</strong> until our ${ordinal} Anniversary ${heartIcon}`;
    requestAnimationFrame(() => setTimeout(update, 1000));
  }
  update();
}

function updateAnniversaryText(year, ordinal) {
  // Intro badge
  const badge = document.querySelector('.intro-badge');
  if (badge) {
    badge.innerHTML = `<span class="badge-dot"></span>${ordinal} Anniversary<span class="badge-dot"></span>`;
  }

  // Intro title
  const title = document.querySelector('.intro-title');
  if (title) {
    title.innerHTML = `${year} Years,<br/><em>${CARDS_DATA.length} Messages</em>`;
  }

  // Finale footer (used in sharing)
  const footerLabel = document.querySelector('.finale-badge');
  if (footerLabel && unlockedCount >= CARDS_DATA.length) {
    footerLabel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>All ${CARDS_DATA.length} Messages Unlocked`;
  }
}

// ============================================================
//  MUSIC TOGGLE — auto-starts on first interaction
// ============================================================
let _autoMusicFired = false;

async function autoStartMusic() {
  if (_autoMusicFired) return;
  _autoMusicFired = true;
  await Audio.unlock();
  Audio.startBgMusic();
  musicEnabled = true;
  updateMusicBtn();
}

function setupMusicToggle() {
  const btn = document.getElementById('music-btn');
  if (!btn) return;
  updateMusicBtn();
  btn.addEventListener('click', async () => {
    _autoMusicFired = true;
    musicEnabled = !musicEnabled;
    if (musicEnabled) {
      await Audio.unlock();
      Audio.startBgMusic();
      const toast = document.getElementById('music-nudge-toast');
      if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2800);
      }
    } else {
      Audio.stopBgMusic();
    }
    updateMusicBtn();
  });
}

function updateMusicBtn() {
  const btn = document.getElementById('music-btn');
  if (!btn) return;
  btn.classList.toggle('music-off', !musicEnabled);
  btn.title = musicEnabled ? 'Mute music' : 'Play music';
}

// ============================================================
//  TYPEWRITER EFFECT
// ============================================================
function typewriterEffect(el, text, speed = 22) {
  if (typewriterTimer) clearInterval(typewriterTimer);
  el.textContent = '';
  el.classList.add('typewriter-active');
  let i = 0;
  typewriterTimer = setInterval(() => {
    if (i < text.length) { el.textContent += text[i]; i++; }
    else {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      el.classList.remove('typewriter-active');
      el.classList.add('typewriter-done');
    }
  }, speed);
}

// ============================================================
//  IMGBB UPLOAD — returns a hosted URL
// ============================================================
// Upload image file to Cloudinary (unsigned upload).
// Returns a permanent URL that never expires.
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file',         file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`);
  const json = await res.json();
  if (!json.secure_url) throw new Error(json.error?.message || 'Cloudinary error');
  return json.secure_url; // permanent HTTPS image URL
}

// ============================================================
//  LOADING SCREEN
// ============================================================
function showLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) el.classList.remove('hidden');
}

function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  // Fill bar to 100% first, then fade out after it completes
  const fill = el.querySelector('.loading-bar-fill');
  if (fill) {
    fill.style.transition = 'width 0.4s ease';
    fill.style.width = '100%';
  }
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 650);
  }, 450); // wait for bar to visually finish
}

// ============================================================
//  INIT — DOMContentLoaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Queue sounds (loaded after first gesture)
  Audio.load('scratch', 'msc/scratch.mp3');
  Audio.load('chime',   'msc/chime.mp3');
  Audio.load('sparkle', 'msc/sparkle.mp3');
  Audio.load('piano',   'msc/piano1.mp3');
  Audio.load('click',   'msc/clickclick.mp3');

  attachClickSounds();
  renderAnniversaryDate();
  setupMusicToggle();

  // ── The loading screen IS the first gesture ──
  // Tapping anywhere on it unlocks AudioContext + starts music immediately
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    const onLoadingTap = () => {
      autoStartMusic();
    };
    loadingScreen.addEventListener('click',      onLoadingTap, { once: true, passive: true });
    loadingScreen.addEventListener('touchstart', onLoadingTap, { once: true, passive: true });
  }

  // Fallback: any other interaction also starts music
  const autoMusicEvents = ['click', 'touchstart', 'keydown'];
  const autoMusicHandler = () => {
    autoStartMusic();
    autoMusicEvents.forEach(ev => document.removeEventListener(ev, autoMusicHandler));
  };
  autoMusicEvents.forEach(ev => document.addEventListener(ev, autoMusicHandler, { once: false, passive: true }));

  // Wire up all static button listeners
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('back-btn').addEventListener('click', onBackClick);
  document.getElementById('dialog-cancel').addEventListener('click', closeBackDialog);
  document.getElementById('dialog-confirm').addEventListener('click', goBackToIntro);
  document.getElementById('modal-prev').addEventListener('click', () => navigateModal(-1));
  document.getElementById('modal-next').addEventListener('click', () => navigateModal(1));
  document.getElementById('album-prev').addEventListener('click', () => goToSlide(currentSlide - 1));
  document.getElementById('album-next').addEventListener('click', () => goToSlide(currentSlide + 1));
  document.getElementById('finale-review-btn').addEventListener('click', reviewAllMemories);
  document.getElementById('finale-share-btn').addEventListener('click', shareStory);
  document.getElementById('share-close-btn').addEventListener('click', closeShareOverlay);
  document.getElementById('share-backdrop').addEventListener('click', closeShareOverlay);
  document.getElementById('album-upload-btn').addEventListener('click', () => {
    document.getElementById('album-file-input').click();
  });
  document.getElementById('album-file-input').addEventListener('change', onPhotoSelected);

  document.getElementById('gallery-btn').addEventListener('click', openGallery);
  document.getElementById('gallery-close-btn').addEventListener('click', closeGallery);
  document.getElementById('gallery-backdrop').addEventListener('click', closeGallery);
  document.getElementById('gallery-add-photo-header-btn').addEventListener('click', () => {
    // Just trigger the input click directly from the user click
    document.getElementById('album-file-input').click();
  });
  document.getElementById('game-reset-btn').addEventListener('click', showResetModal);
  
  // Custom Reset Modal listeners
  document.getElementById('reset-cancel').addEventListener('click', hideResetModal);
  document.getElementById('reset-confirm').addEventListener('click', confirmResetProgress);
  
  // Custom Delete Modal listeners
  document.getElementById('delete-cancel').addEventListener('click', hideDeleteModal);
  document.getElementById('delete-confirm').addEventListener('click', handleConfirmDelete);

  // Custom Edit Modal listeners
  document.getElementById('edit-cancel').addEventListener('click', hideEditModal);
  document.getElementById('edit-confirm').addEventListener('click', handleConfirmEdit);
  
  // Custom Caption Modal listeners
  document.getElementById('caption-cancel').addEventListener('click', () => handleCaptionSubmit(''));
  document.getElementById('caption-confirm').addEventListener('click', () => {
    const val = document.getElementById('photo-caption-input').value;
    handleCaptionSubmit(val);
  });
  document.getElementById('lightbox-close').addEventListener('click', closeGalleryLightbox);
  document.getElementById('lightbox-backdrop').addEventListener('click', closeGalleryLightbox);
  
  const lbDeleteBtn = document.getElementById('lightbox-delete-btn');
  if (lbDeleteBtn) {
    lbDeleteBtn.addEventListener('click', () => {
      if (lightboxCurrentCard) showDeleteModal(lightboxCurrentCard.id);
    });
  }

  const lbEditBtn = document.getElementById('lightbox-edit-btn');
  if (lbEditBtn) {
    lbEditBtn.addEventListener('click', () => {
      if (lightboxCurrentCard) showEditModal(lightboxCurrentCard.id, lightboxCurrentCard.title);
    });
  }

  setupModalSwipe();
  setupAlbumSwipe();

  // DB is always ready instantly (serves from localStorage cache)
  bootstrapFromFirebase();
});

// ============================================================
//  BOOTSTRAP — waits for Firestore data (with timeout fallback)
// ============================================================
async function bootstrapFromFirebase() {
  showLoadingScreen();

  const fill = document.querySelector('.loading-bar-fill');
  const setText = (t) => {
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = t;
  };

  function setBar(pct, duration = 0.3) {
    if (!fill) return;
    fill.style.transition = `width ${duration}s ease`;
    fill.style.width = pct + '%';
  }

  // Step 1: Read from localStorage instantly — no network call
  setBar(30);
  setText('Loading our story…');

  let progress = { unlockedIds: [], lockedIds: [2,3,4,5,6] };
  let photos   = [];

  try {
    const rawProgress = localStorage.getItem('ann_progress_v1');
    if (rawProgress) progress = JSON.parse(rawProgress);
  } catch(e) {}

  try {
    const rawPhotos = localStorage.getItem('ann_photos_v1');
    if (rawPhotos) {
      const p = JSON.parse(rawPhotos);
      if (Array.isArray(p)) photos = p;
    }
  } catch(e) {}

  setBar(80);
  setText('Ready ♡');

  // Apply state immediately
  const unlockedIds = progress.unlockedIds || [];
  const lockedIds   = progress.lockedIds   || [2,3,4,5,6];
  currentlyLocked   = new Set(lockedIds);
  unlockedCount     = unlockedIds.length;
  _photosCache      = photos;

  unlockedIds.forEach(id => {
    scratchInstances[id] = { completed: true };
  });

  setBar(100, 0.2);

  const tapHint = document.getElementById('loading-tap-hint');
  if (tapHint) {
    tapHint.style.transition = 'opacity 0.5s';
    tapHint.style.opacity = '1';
  }

  // Tiny delay just for the bar to visually finish
  await new Promise(r => setTimeout(r, 300));

  hideLoadingScreen();

  spawnPetals();
  introParticles = new ParticleSystem('particles-canvas', {
    count: 65, colors: ['#D4A843','#B8912E','rgba(255,255,255,0.8)','#E05D6E','#8B5CF6'],
    type: 'mixed', speed: 0.28, size: 2.8,
  });

  setTimeout(() => {
    const introScreen = document.getElementById('intro-screen');
    introScreen.classList.remove('hidden');
    introScreen.classList.add('fade-in');
  }, 300);

  // Step 2: Sync Firestore silently in the background AFTER the app is showing
  // This updates localStorage cache for next visit — never blocks the UI
  _syncFirestoreInBackground();
}

function _syncFirestoreInBackground() {
  // Wait for Firestore to connect (up to 8s), then quietly update the cache
  const waitAndSync = async () => {
    if (!window.DB) return;
    const ready = await new Promise(resolve => {
      if (window.DB._isFirestoreReady && window.DB._isFirestoreReady()) { resolve(true); return; }
      const timer = setTimeout(() => resolve(false), 8000);
      window.addEventListener('firestore-ready', () => { clearTimeout(timer); resolve(true); }, { once: true });
    });
    if (!ready) return;
    try {
      const [freshProgress, freshPhotos] = await Promise.all([
        window.DB._fetchProgressDirect(),
        window.DB._fetchPhotosDirect(),
      ]);
      // Update photos only if Firestore returns MORE than we already have
      // Never downgrade — if we have 3 in memory and Firestore returns 0,
      // that means the write hasn't propagated yet, so keep what we have
      if (freshPhotos && Array.isArray(freshPhotos) && freshPhotos.length > 0 && freshPhotos.length >= _photosCache.length) {
        _photosCache = freshPhotos;
        // Re-render gallery if it's open
        const gallery = document.getElementById('gallery-screen');
        if (gallery && gallery.classList.contains('open')) {
          renderUploadGrid();
          updateGalleryBadge();
        }
      }
      if (freshProgress) {
        // Only update progress if Firestore shows MORE unlocked (never downgrade)
        const fsUnlocked = freshProgress.unlockedIds || [];
        if (fsUnlocked.length > unlockedCount) {
          currentlyLocked = new Set(freshProgress.lockedIds || []);
          unlockedCount   = fsUnlocked.length;
          fsUnlocked.forEach(id => { scratchInstances[id] = { completed: true }; });
        }
      }
    } catch(e) { /* offline — that's fine, cache is already correct */ }
  };
  waitAndSync();
}

// ============================================================
//  PHOTO UPLOAD — ImgBB → Firestore → album
// ============================================================
let _pendingFile = null;

let _originalHeaderContent = '';

async function onPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    e.target.value = '';
    return;
  }

  // Capture original button HTML RIGHT NOW — before anything changes it
  const headerBtn = document.getElementById('gallery-add-photo-header-btn');
  if (headerBtn) {
    _originalHeaderContent = headerBtn.innerHTML;
  }

  // Store file and show custom caption modal
  _pendingFile = file;
  document.getElementById('photo-caption-input').value = '';
  document.getElementById('caption-modal').classList.remove('hidden');
  e.target.value = '';
}

async function handleCaptionSubmit(caption) {
  document.getElementById('caption-modal').classList.add('hidden');

  if (!_pendingFile) {
    _originalHeaderContent = '';
    return;
  }

  const file = _pendingFile;
  _pendingFile = null;

  const headerBtn    = document.getElementById('gallery-add-photo-header-btn');
  const savedBtnHTML = _originalHeaderContent;
  _originalHeaderContent = '';

  if (headerBtn) {
    headerBtn.innerHTML = `<div class="upload-spinner"></div><span>Uploading…</span>`;
    headerBtn.disabled  = true;
  }

  try {
    // 1. Upload to Cloudinary — permanent URL, never expires
    const url = await uploadToCloudinary(file);

    // 2. Add to _photosCache immediately with a temp ID
    const tempId   = 'temp_' + Date.now();
    const newPhoto = { id: tempId, url, caption: caption || '', timestamp: Date.now() };
    _photosCache.unshift(newPhoto);

    // 3. Restore button & show UI RIGHT NOW — don't wait for Firestore
    if (headerBtn) {
      headerBtn.innerHTML = savedBtnHTML || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Add Photos`;
      headerBtn.disabled = false;
    }

    switchGalleryTab('photos');
    renderUploadGrid();
    updateGalleryBadge();
    showUploadToast();
    haptic([20, 10, 20]);

    const uploadGrid = document.getElementById('upload-grid');
    if (uploadGrid) uploadGrid.scrollTop = 0;
    const galleryPane = document.getElementById('pane-photos');
    if (galleryPane) galleryPane.scrollTop = 0;

    // 4. Save to Firestore in background — doesn't block the UI at all
    if (window.DB) {
      window.DB.savePhotoToAlbum(url, caption || '').then(resolvedId => {
        if (resolvedId && resolvedId !== tempId) {
          const idx = _photosCache.findIndex(p => p.id === tempId);
          if (idx !== -1) _photosCache[idx].id = resolvedId;
        }
      }).catch(e => console.error('[Upload] Firestore save failed:', e));
    }

  } catch(err) {
    console.error('[Upload] Cloudinary failed:', err);
    alert('Photo upload failed: ' + err.message);
    // Restore button on error
    if (headerBtn) {
      headerBtn.innerHTML = savedBtnHTML || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Add Photos`;
      headerBtn.disabled = false;
    }
  }
}

function applyPhotoToCard(cardId, url) {
  const slot = document.getElementById(`photo-${cardId}`);
  if (!slot) return;
  slot.classList.remove('no-photo');

  let img = slot.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = ''; img.draggable = false;
    const overlay = document.createElement('div');
    overlay.className = 'photo-overlay';
    slot.appendChild(img);
    slot.appendChild(overlay);
  }

  img.onerror = () => {
    slot.classList.add('no-photo');
    img.remove();
    const ov = slot.querySelector('.photo-overlay');
    if (ov) ov.remove();
  };

  img.src = url;
  img.style.opacity = '0';

  // Polaroid develop: white flash → colour fade-in
  slot.classList.add('polaroid-developing');
  setTimeout(() => {
    slot.classList.remove('polaroid-developing');
    img.style.transition = 'opacity 1.2s ease, filter 1.8s ease';
    img.style.filter  = 'brightness(2) saturate(0)';
    img.style.opacity = '0.3';
    requestAnimationFrame(() => {
      setTimeout(() => {
        img.style.filter  = 'brightness(0.85) saturate(1)';
        img.style.opacity = '0.75';
      }, 80);
    });
  }, 400);
}

// ============================================================
//  GALLERY SCREEN — two tabs: Messages | Our Photos
// ============================================================
let _currentGalleryTab = 'messages';
let _galleryPollTimer  = null;

function openGallery() {
  const gallery = document.getElementById('gallery-screen');

  // Show gallery immediately with whatever we have in memory
  renderGalleryMessages();
  renderUploadGrid();
  updateGalleryBadge();
  gallery.style.display = 'flex';
  gallery.style.pointerEvents = 'all';
  requestAnimationFrame(() => requestAnimationFrame(() => gallery.classList.add('open')));

  // Initial fetch
  _fetchAndRefreshGallery();

  // Live poll every 5 seconds while gallery is open
  _galleryPollTimer = setInterval(_fetchAndRefreshGallery, 5000);
}

function _fetchAndRefreshGallery() {
  if (!window.DB || !window.DB._isFirestoreReady || !window.DB._isFirestoreReady()) return;
  window.DB._fetchPhotosDirect().then(freshPhotos => {
    if (!freshPhotos || !Array.isArray(freshPhotos)) return;
    // Only update if there are changes
    if (freshPhotos.length !== _photosCache.length ||
        freshPhotos.some((p, i) => p.id !== (_photosCache[i]?.id))) {
      _photosCache = freshPhotos;
      renderUploadGrid();
      updateGalleryBadge();
    }
  }).catch(() => {});
}

function closeGallery() {
  const gallery = document.getElementById('gallery-screen');
  gallery.classList.remove('open');
  gallery.style.pointerEvents = 'none';

  // Stop live polling
  if (_galleryPollTimer) { clearInterval(_galleryPollTimer); _galleryPollTimer = null; }
  
  setTimeout(() => { 
    gallery.style.display = 'none';
    updateProgress();
  }, 400);
}

// ── General Upload (from gallery header) ────────────────────────
// This function is no longer needed since onPhotoSelected handles the flow

// ── Reset Progress ──────────────────────────────────────────
function showResetModal() {
  document.getElementById('reset-modal').classList.remove('hidden');
}

function hideResetModal() {
  document.getElementById('reset-modal').classList.add('hidden');
}

async function confirmResetProgress() {
  hideResetModal();

  // 1. Reset progress state in memory
  unlockedCount    = 0;
  currentlyLocked  = new Set([2, 3, 4, 5, 6]);
  scratchInstances = {};

  // 2. Persist reset to localStorage immediately (don't wait for Firestore)
  try { localStorage.setItem('ann_progress_v1', JSON.stringify({ unlockedIds: [], lockedIds: [2,3,4,5,6] })); } catch(e) {}
  // Fire-and-forget to Firestore
  if (window.DB) window.DB.saveProgress([], [2, 3, 4, 5, 6]).catch(() => {});

  // 3. Hide finale / intro, show game screen
  const finaleScreen = document.getElementById('finale-screen');
  const introScreen  = document.getElementById('intro-screen');
  const gameScreen   = document.getElementById('game-screen');

  if (finaleScreen && !finaleScreen.classList.contains('hidden')) {
    if (finaleParticles) { finaleParticles.stop(); finaleParticles = null; }
    finaleScreen.classList.add('hidden');
    finaleScreen.classList.remove('fade-in', 'fade-out');
  }
  if (introScreen && !introScreen.classList.contains('hidden')) {
    introScreen.classList.add('hidden');
    introScreen.classList.remove('fade-in', 'fade-out');
    if (introParticles) { introParticles.stop(); introParticles = null; }
  }
  if (gameScreen) {
    gameScreen.classList.remove('hidden', 'fade-out', 'fade-in');
    // Force a reflow so the game screen is fully painted before we measure canvases
    void gameScreen.offsetHeight;
  }

  if (!gameParticleSystem) startGameParticles();

  // 4. _photosCache is already correct in memory — do NOT refetch from Firestore
  //    (it might be offline, and the cache already has the right photos)
  //    Only reload from localStorage as a safety net
  try {
    const raw = localStorage.getItem('ann_photos_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) _photosCache = parsed;
    }
  } catch(e) {}

  // 5. Rebuild the album — game screen is visible so canvas dimensions will be real
  renderAlbum();

  // 6. After a frame so the DOM has painted, go to slide 0 and re-init scratch cards
  requestAnimationFrame(() => {
    goToSlide(0, false);
    updateProgress();
  });

  // 7. Refresh gallery grids
  renderGalleryMessages();
  renderUploadGrid();
  updateGalleryBadge();

  // 8. Success toast
  let toastEl = document.getElementById('upload-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'upload-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Cards reset — scratch to unlock!`;
  toastEl.classList.add('show');
  clearTimeout(toastEl._hideTimer);
  toastEl._hideTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

function switchGalleryTab(tab) {
  _currentGalleryTab = tab;
  document.getElementById('tab-messages').classList.toggle('active', tab === 'messages');
  document.getElementById('tab-photos').classList.toggle('active', tab === 'photos');
  document.getElementById('pane-messages').classList.toggle('active', tab === 'messages');
  document.getElementById('pane-photos').classList.toggle('active', tab === 'photos');
  if (tab === 'photos') renderUploadGrid();
}

// ── Tab 1: Messages grid ──────────────────────────────────────
function renderGalleryMessages() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  CARDS_DATA.forEach(card => {
    // Messages use STATIC photos from cards.js only
    const photoUrl = card.photo || null;

    const isUnlocked = scratchInstances[card.id]?.completed ||
                       (!currentlyLocked.has(card.id) && CARDS_DATA.indexOf(card) < unlockedCount);
    const isLocked = !isUnlocked;

    const item = document.createElement('div');
    item.className = `gallery-card ${isLocked ? 'gallery-locked' : 'gallery-unlocked'} ${photoUrl ? 'gallery-has-photo' : ''}`;
    item.style.setProperty('--card-color', card.color);
    item.style.setProperty('--card-glow',  card.glowColor);

    if (isLocked) {
      item.innerHTML = `
        <div class="gallery-img-wrap gallery-locked-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="gallery-lock-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-year" style="color:${card.color}">${card.year}</span>
          <span class="gallery-card-theme">Locked</span>
        </div>`;
    } else {
      const msgPreview = card.message.length > 68 ? card.message.slice(0, 68) + '…' : card.message;
      item.innerHTML = `
        <div class="gallery-img-wrap" style="${!photoUrl ? 'background:linear-gradient(145deg,#1c1c30,#0f0f1e);display:flex;align-items:center;justify-content:center;' : ''}">
          ${photoUrl ? `<img src="${photoUrl}" alt="" draggable="false" loading="lazy" onerror="this.remove();this.nextElementSibling&&this.nextElementSibling.remove();"/>
                        <div class="gallery-img-overlay"></div>` : ''}
          <div class="gallery-memory-icon">${getRevealIcon(card.iconType)}</div>
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-year" style="color:${card.color}">${card.year}</span>
          <span class="gallery-card-theme-title">${card.title}</span>
          <span class="gallery-card-msg-preview">${msgPreview}</span>
        </div>`;

      item.addEventListener('click', () => {
        closeGallery();
        setTimeout(() => openModal(card), 300);
      });
    }
    grid.appendChild(item);
  });
}

// ============================================================
//  UPLOAD SUCCESS TOAST
// ============================================================
function showUploadToast() {
  let toast = document.getElementById('upload-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'upload-toast';
    toast.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Photo saved!`;
    document.body.appendChild(toast);
  }
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── Tab 2: Upload grid ────────────────────────────────────────
function renderUploadGrid() {
  const grid = document.getElementById('upload-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!_photosCache || _photosCache.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted); font-family: 'Cormorant Garamond', serif; font-style: italic;">
        No photos in our gallery yet.<br/>Tap "Add Photos" to start our collection.
      </div>`;
    return;
  }

  _photosCache.forEach((photo) => {
    const item = document.createElement('div');
    item.className = 'upload-card has-photo';

    item.innerHTML = `
      <div class="upload-photo-area" id="upload-area-${photo.id}">
        <img src="${photo.url}" alt="" draggable="false" loading="lazy" onerror="this.remove()"/>
        <div class="upload-img-overlay"></div>
        <div class="upload-change-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>View Photo</span>
        </div>
        ${photo.caption ? `<div class="photo-caption-tag">${photo.caption}</div>` : ''}
        <div class="photo-card-actions">
          <button class="photo-card-btn edit" title="Edit caption">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="photo-card-btn delete" title="Delete from gallery">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;

    const photoArea = item.querySelector(`#upload-area-${photo.id}`);
    photoArea.style.cursor = 'pointer';
    photoArea.addEventListener('click', (e) => {
      if (e.target.closest('.photo-card-btn')) return;
      e.stopPropagation();
      openGalleryLightbox({ id: photo.id, year: 'Gallery', theme: 'Our Memory', title: photo.caption || '' }, photo.url);
    });

    const delBtn = item.querySelector('.photo-card-btn.delete');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteModal(photo.id);
    });

    const editBtn = item.querySelector('.photo-card-btn.edit');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditModal(photo.id, photo.caption || '');
    });

    grid.appendChild(item);
  });
}

let _pendingDeleteId = null;
function showDeleteModal(photoId) {
  _pendingDeleteId = photoId;
  document.getElementById('delete-modal').classList.remove('hidden');
}
function hideDeleteModal() {
  _pendingDeleteId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}
async function handleConfirmDelete() {
  if (!_pendingDeleteId) return;
  const photoId = _pendingDeleteId;
  hideDeleteModal();
  
  try {
    if (window.DB) await window.DB.deletePhotoFromAlbum(photoId);
    _photosCache = _photosCache.filter(p => p.id !== photoId);
    renderUploadGrid();
    updateGalleryBadge();
  } catch(e) { console.error('Delete failed:', e); }
}

let _pendingEditId = null;
function showEditModal(photoId, currentCaption) {
  _pendingEditId = photoId;
  const input = document.getElementById('edit-caption-input');
  if (input) input.value = currentCaption;
  document.getElementById('edit-modal').classList.remove('hidden');
}
function hideEditModal() {
  _pendingEditId = null;
  document.getElementById('edit-modal').classList.add('hidden');
}
async function handleConfirmEdit() {
  if (!_pendingEditId) return;
  const photoId = _pendingEditId;
  const input = document.getElementById('edit-caption-input');
  const newCaption = input ? input.value : '';
  hideEditModal();

  try {
    if (window.DB) await window.DB.updatePhotoCaption(photoId, newCaption);
    const idx = _photosCache.findIndex(p => p.id === photoId);
    if (idx !== -1) _photosCache[idx].caption = newCaption;
    renderUploadGrid();
    
    // Also update lightbox if it's open
    const lbTitle = document.getElementById('lightbox-title');
    if (lbTitle && lightboxCurrentCard && lightboxCurrentCard.id === photoId) {
      lbTitle.textContent = newCaption;
      lightboxCurrentCard.title = newCaption;
    }
  } catch(e) { console.error('Edit failed:', e); }
}

function updateGalleryBadge() {
  const count = _photosCache.length;
  const tab = document.getElementById('tab-photos');
  if (!tab) return;
  
  let badge = tab.querySelector('.gallery-tab-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'gallery-tab-badge';
    tab.appendChild(badge);
  }
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

function triggerUploadForCard(card, index, btn) {
  const savedSlide = currentSlide;
  currentSlide = index;
  const input = document.getElementById('album-file-input');

  // Show spinner
  btn.classList.add('uploading');
  const labelEl = document.getElementById(`upload-btn-label-${card.id}`);
  const origLabel = labelEl ? labelEl.textContent : '';
  if (labelEl) {
    btn.innerHTML = `<div class="upload-spinner"></div><span>Uploading…</span>`;
  }

  input.onchange = async (ev) => {
    if (!ev.target.files[0]) {
      btn.classList.remove('uploading');
      if (labelEl) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span id="upload-btn-label-${card.id}">${origLabel}</span>`;
      currentSlide = savedSlide;
      input.onchange = null;
      return;
    }
    try {
      await onPhotoSelected(ev);
      // After success, refresh both tabs
      renderGalleryMessages();
      renderUploadGrid();
    } catch(e) {}
    currentSlide = savedSlide;
    input.onchange = null;
  };
  input.click();
}

// ============================================================
//  GALLERY LIGHTBOX
// ============================================================
let lightboxCurrentCard = null;
let lightboxCurrentUrl  = null;

function openGalleryLightbox(card, url) {
  lightboxCurrentCard = card;
  lightboxCurrentUrl  = url;

  const lb    = document.getElementById('gallery-lightbox');
  const img   = document.getElementById('lightbox-img');
  const year  = document.getElementById('lightbox-year');
  const theme = document.getElementById('lightbox-theme');
  const title = document.getElementById('lightbox-title');
  const delBtn = document.getElementById('lightbox-delete-btn');

  // Show delete button only if it's a gallery photo (not a static message photo)
  if (delBtn) {
    const isGalleryPhoto = _photosCache.some(p => p.id === card.id);
    delBtn.style.display = isGalleryPhoto ? 'flex' : 'none';
  }

  img.src = url;
  year.textContent  = card.year || 'Gallery';
  theme.textContent = card.theme || 'Our Memory';
  title.textContent = card.title || '';

  lb.classList.remove('hidden');
  lb.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => lb.classList.add('open')));
}

function closeGalleryLightbox() {
  const lb = document.getElementById('gallery-lightbox');
  lb.classList.remove('open');
  setTimeout(() => { 
    lb.classList.add('hidden');
    lb.style.display = 'none'; 
    lightboxCurrentCard = null;
    lightboxCurrentUrl = null;
  }, 350);
}

// ============================================================
//  START GAME
// ============================================================
function startGame() {
  Audio.unlock();
  const intro = document.getElementById('intro-screen');
  const game  = document.getElementById('game-screen');
  intro.classList.add('fade-out');
  setTimeout(() => {
    intro.classList.add('hidden');
    game.classList.remove('hidden');
    game.classList.add('fade-in');
    if (introParticles) introParticles.stop();
    startGameParticles();
    renderAlbum();
  }, 700);
}

// ============================================================
//  BACK BUTTON
// ============================================================
function onBackClick() {
  document.getElementById('back-dialog').classList.remove('hidden');
}
function closeBackDialog() {
  document.getElementById('back-dialog').classList.add('hidden');
}
function goBackToIntro() {
  closeBackDialog();
  stopGameParticles();
  const game  = document.getElementById('game-screen');
  const intro = document.getElementById('intro-screen');
  game.classList.add('fade-out');
  setTimeout(() => {
    game.classList.add('hidden');
    game.classList.remove('fade-out', 'fade-in');
    intro.classList.remove('hidden', 'fade-out');
    intro.classList.add('fade-in');
    introParticles = new ParticleSystem('particles-canvas', {
      count: 65, colors: ['#D4A843','#B8912E','rgba(255,255,255,0.8)','#E05D6E','#8B5CF6'],
      type: 'mixed', speed: 0.28, size: 2.8,
    });
  }, 700);
}

// ============================================================
//  RENDER ALBUM SLIDER
// ============================================================
function renderAlbum() {
  const track    = document.getElementById('album-track');
  const dotsWrap = document.getElementById('album-dots');
  if (!track || !dotsWrap) return; // safety check
  
  track.innerHTML    = '';
  dotsWrap.innerHTML = '';
  totalSlides = CARDS_DATA.length;
  document.getElementById('slide-total').textContent = totalSlides;

  // Clear existing scratch instances — DOM is being fully rebuilt so no need to destroy()
  scratchInstances = {};

  CARDS_DATA.forEach((card, index) => {
    const isLocked = currentlyLocked.has(card.id);
    const isDone   = (unlockedCount > 0 && !isLocked && index < unlockedCount);
    
    if (isDone) {
      scratchInstances[card.id] = { completed: true };
    }

    const slide  = document.createElement('div');
    slide.className = 'album-slide';
    slide.id = `slide-${card.id}`;

    const wrap3d = document.createElement('div');
    wrap3d.className = 'scratch-card-3d-wrap';
    wrap3d.id = `wrap3d-${card.id}`;
    setup3DTilt(wrap3d);

    const el = document.createElement('div');
    el.className = `scratch-card-wrapper ${isLocked ? 'locked' : ''} ${isDone ? 'done' : ''}`;
    el.id = `card-wrapper-${card.id}`;
    el.style.setProperty('--card-color', card.color);
    el.style.setProperty('--card-glow',  card.glowColor);

    // Use Firebase-loaded photo if available, else fall back to cards.js photo
    const cachedPhoto = _photosCache.find(p => p.id === String(card.id) || p.id === card.id);
    const photoSrc = cachedPhoto?.url || card.photo || null;

    const photoHTML = photoSrc
      ? `<div class="card-photo-slot" id="photo-${card.id}">
           <img src="${photoSrc}" alt="" draggable="false" onerror="this.closest('.card-photo-slot').classList.add('no-photo');this.remove();this.nextElementSibling&&this.nextElementSibling.remove();"/>
           <div class="photo-overlay"></div>
         </div>`
      : `<div class="card-photo-slot no-photo" id="photo-${card.id}"></div>`;

    el.innerHTML = `
      <div class="card-shine" id="shine-${card.id}"></div>
      <div class="card-inner">
        <div class="card-header">
          <span class="card-year">${card.year}</span>
          <span class="card-icon">${getCardIcon(card.iconType)}</span>
        </div>
        <div class="card-theme">${card.theme}</div>
        <div class="scratch-area ${isDone ? 'revealed' : ''}" id="scratch-area-${card.id}">
          ${photoHTML}
          <canvas class="scratch-canvas" id="canvas-${card.id}"></canvas>
          <div class="card-reveal-preview" id="reveal-${card.id}">
            <div class="reveal-icon">${getRevealIcon(card.iconType)}</div>
            <div class="reveal-title">${card.title}</div>
            <div class="reveal-tap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Tap to read
            </div>
          </div>
          <div class="scratch-progress-ring" id="ring-${card.id}">
            <svg viewBox="0 0 28 28">
              <circle class="scratch-ring-bg"   cx="14" cy="14" r="11"/>
              <circle class="scratch-ring-fill" cx="14" cy="14" r="11"
                id="ring-fill-${card.id}" style="stroke:${card.color}"/>
            </svg>
          </div>
        </div>
        ${isLocked ? `
        <div class="card-lock" id="lock-${card.id}">
          <span class="lock-icon">${getLockIcon()}</span>
          <span class="lock-text">Unlock card ${index}<br/>first</span>
        </div>` : ''}
      </div>
    `;

    const badge = document.createElement('div');
    badge.className = `card-done-badge ${isDone ? 'visible' : ''}`;
    badge.id = `done-badge-${card.id}`;
    badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    wrap3d.appendChild(el);
    wrap3d.appendChild(badge);
    slide.appendChild(wrap3d);
    track.appendChild(slide);

    const dot = document.createElement('div');
    dot.className = `album-dot ${index === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToSlide(index));
    dotsWrap.appendChild(dot);

    if (isDone && !scratchInstances[card.id]) {
      scratchInstances[card.id] = { completed: true };
    }

    if (!isLocked) initScratchCard(card, index);
  });

  updateProgress();
  goToSlide(0, false);
}

// ============================================================
//  ALBUM SLIDE NAVIGATION
// ============================================================
function goToSlide(index, animate = true) {
  if (index < 0 || index >= totalSlides || isSliding) return;
  if (animate) { isSliding = true; setTimeout(() => { isSliding = false; }, 580); }
  currentSlide = index;
  const track = document.getElementById('album-track');
  if (!track) return;
  track.style.transition = animate ? 'transform 0.55s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
  track.style.transform  = `translateX(-${index * 100}%)`;
  document.getElementById('slide-current').textContent = index + 1;
  document.querySelectorAll('.album-dot').forEach((dot, i) => dot.classList.toggle('active', i === index));
  const prevBtn = document.getElementById('album-prev');
  const nextBtn = document.getElementById('album-next');
  if (prevBtn) prevBtn.disabled = index === 0;
  if (nextBtn) nextBtn.disabled = index === totalSlides - 1;
}

// ============================================================
//  ALBUM SWIPE + DESKTOP DRAG
// ============================================================
function setupAlbumSwipe() {
  const viewport = document.getElementById('album-viewport');
  if (!viewport) return;

  let startX = 0, startY = 0, isDragging = false;

  // ── Touch ──
  viewport.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) + 10) {
      const track = document.getElementById('album-track');
      if (track) { track.style.transition = 'none'; track.style.transform = `translateX(calc(-${currentSlide * 100}% + ${dx}px))`; }
    }
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? goToSlide(currentSlide + 1) : goToSlide(currentSlide - 1);
    } else goToSlide(currentSlide);
  }, { passive: true });

  // ── Mouse / pointer (desktop) ──
  let pointerStartX = 0, pointerDown = false, hasDragged = false;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.target.classList.contains('scratch-canvas')) return;
    pointerStartX = e.clientX;
    pointerDown   = true;
    hasDragged    = false;
    viewport.setPointerCapture(e.pointerId);
    viewport.style.cursor = 'grabbing';
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointerDown || e.pointerType === 'touch') return;
    const dx = e.clientX - pointerStartX;
    if (Math.abs(dx) > 5) {
      hasDragged = true;
      const track = document.getElementById('album-track');
      if (track) { track.style.transition = 'none'; track.style.transform = `translateX(calc(-${currentSlide * 100}% + ${dx}px))`; }
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (!pointerDown || e.pointerType === 'touch') return;
    pointerDown = false; viewport.style.cursor = '';
    const dx = e.clientX - pointerStartX;
    if (hasDragged && Math.abs(dx) > 60) {
      dx < 0 ? goToSlide(currentSlide + 1) : goToSlide(currentSlide - 1);
    } else goToSlide(currentSlide);
    hasDragged = false;
  });

  viewport.addEventListener('pointercancel', () => {
    pointerDown = false; viewport.style.cursor = '';
    goToSlide(currentSlide);
  });
}

// ============================================================
//  3D TILT
// ============================================================
function setup3DTilt(wrap) {
  const TILT_MAX = 10;

  function applyTilt(x, y, rect, card) {
    const dx = (x - rect.left - rect.width  / 2) / (rect.width  / 2);
    const dy = (y - rect.top  - rect.height / 2) / (rect.height / 2);
    card.style.transform  = `rotateX(${-dy * TILT_MAX}deg) rotateY(${dx * TILT_MAX}deg) scale(1.015)`;
    card.style.transition = 'transform 0.1s ease';
    const shineEl = card.querySelector('.card-shine');
    if (shineEl) shineEl.style.background = `radial-gradient(circle at ${50 + dx * 35}% ${50 + dy * 35}%, rgba(255,255,255,0.13) 0%, transparent 65%)`;
  }

  function resetTilt(card) {
    card.style.transform  = 'rotateX(0deg) rotateY(0deg) scale(1)';
    card.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)';
    const shineEl = card.querySelector('.card-shine');
    if (shineEl) shineEl.style.background = 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08) 0%, transparent 60%)';
  }

  wrap.addEventListener('mousemove', (e) => {
    const card = wrap.querySelector('.scratch-card-wrapper');
    if (!card || card.classList.contains('locked')) return;
    applyTilt(e.clientX, e.clientY, wrap.getBoundingClientRect(), card);
  });
  wrap.addEventListener('mouseleave', () => {
    const card = wrap.querySelector('.scratch-card-wrapper');
    if (card) resetTilt(card);
  });
  wrap.addEventListener('touchmove', (e) => {
    const card = wrap.querySelector('.scratch-card-wrapper');
    if (!card || card.classList.contains('locked') || e.touches.length !== 1) return;
    const t = e.touches[0], rect = wrap.getBoundingClientRect();
    const dx = (t.clientX - rect.left - rect.width  / 2) / (rect.width  / 2);
    const dy = (t.clientY - rect.top  - rect.height / 2) / (rect.height / 2);
    card.style.transform  = `rotateX(${-dy * TILT_MAX * 0.4}deg) rotateY(${dx * TILT_MAX * 0.4}deg) scale(1.01)`;
    card.style.transition = 'transform 0.1s ease';
  }, { passive: true });
  wrap.addEventListener('touchend', () => {
    const card = wrap.querySelector('.scratch-card-wrapper');
    if (card) resetTilt(card);
  });
}

// ============================================================
//  SVG ICONS
// ============================================================
function getIcon(type, options = {}) {
  const { width = 24, height = 24, strokeWidth = 1.5, color = 'currentColor', extraStyle = '' } = options;
  const s = `width="${width}" height="${height}" stroke-width="${strokeWidth}" style="color:${color};${extraStyle}"`;
  
  const icons = {
    heart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    star:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    smile:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    moon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    feather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
    flame:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${s} stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-7 7 7 7 0 01-7-7c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>`,
  };
  return icons[type] || icons.heart;
}

function getCardIcon(type) {
  return getIcon(type);
}

function getRevealIcon(type) {
  return getIcon(type, { width: 32, height: 32, color: 'var(--card-color, #D4A843)' });
}

function getLockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;color:#6B6070"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
}

function getModalIcon(type) {
  return getIcon(type);
}

// ============================================================
//  INIT SCRATCH CARD
// ============================================================
function initScratchCard(card, index) {
  // Use a small delay to ensure the DOM has been painted and has real dimensions
  const _doInit = () => {
    const canvas = document.getElementById(`canvas-${card.id}`);
    const area   = document.getElementById(`scratch-area-${card.id}`);
    if (!canvas || !area) return;

    // Already completed — hide canvas and wire tap
    if (scratchInstances[card.id]?.completed) {
      canvas.style.display = 'none';
      const ringWrap = document.getElementById(`ring-${card.id}`);
      if (ringWrap) ringWrap.style.display = 'none';
      const preview = document.getElementById(`reveal-${card.id}`);
      if (preview) {
        preview.style.cursor = 'pointer';
        preview.style.pointerEvents = 'auto';
      }
      // Attach to the whole scratch-area so the full card is tappable
      if (!area._modalListenerAttached) {
        area._modalListenerAttached = true;
        area.style.cursor = 'pointer';
        area.addEventListener('click', () => openModal(card));
      }
      return;
    }

    const rect = area.getBoundingClientRect();
    const w = rect.width  || area.offsetWidth  || 300;
    const h = rect.height || area.offsetHeight || 400;

    // If dimensions are still zero, the slide isn't visible yet — retry once after a frame
    if (w < 10 || h < 10) {
      requestAnimationFrame(() => setTimeout(_doInit, 80));
      return;
    }

    canvas.width  = w;
    canvas.height = h;

    const CIRCUMFERENCE = 2 * Math.PI * 11;

    const scratcher = new ScratchCard(canvas, {
      color:       card.scratchColor,
      threshold:   65,
      brushRadius: 16,
      onScratchStart: () => { Audio.startScratch(); haptic([10]); },
      onScratchEnd:   () => { Audio.stopScratch(); },
      onProgress: (pct) => {
        const ringWrap = document.getElementById(`ring-${card.id}`);
        const ringFill = document.getElementById(`ring-fill-${card.id}`);
        if (ringWrap && ringFill) {
          ringWrap.classList.add('active');
          ringFill.style.strokeDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
          if (pct >= 65)      ringFill.style.stroke = '#4A9B6F';
          else if (pct >= 40) ringFill.style.stroke = card.color;
          else                 ringFill.style.stroke = darkenColor(card.color, 15);
        }
        const photoSlot = document.getElementById(`photo-${card.id}`);
        if (photoSlot?.querySelector('img')) {
          photoSlot.querySelector('img').style.opacity = 0.25 + (pct / 100) * 0.6;
        }
      },
      onComplete: () => {
        // Animate ring to 100% then hide it
        const ringWrap = document.getElementById(`ring-${card.id}`);
        const ringFill = document.getElementById(`ring-fill-${card.id}`);
        if (ringWrap && ringFill) {
          ringFill.style.stroke = '#4A9B6F';
          ringFill.style.strokeDashoffset = '0';
          setTimeout(() => {
            ringWrap.style.transition = 'opacity 0.4s ease';
            ringWrap.style.opacity = '0';
            setTimeout(() => { ringWrap.style.display = 'none'; }, 450);
          }, 600);
        }
        onCardScratched(card, index);
      }
    });

    scratchInstances[card.id] = scratcher;

    const scratchArea = document.getElementById(`scratch-area-${card.id}`);
    const preview = document.getElementById(`reveal-${card.id}`);
    if (scratchArea && !scratchArea._modalListenerAttached) {
      scratchArea._modalListenerAttached = true;
      scratchArea.addEventListener('click', () => {
        if (scratcher.completed) {
          canvas.style.display = 'none';
          openModal(card);
        }
      });
    }
    if (preview) {
      preview.style.cursor = 'pointer';
    }
  };

  requestAnimationFrame(() => requestAnimationFrame(_doInit));
}
// ============================================================
//  CARD SCRATCHED — save to Firebase
// ============================================================
async function onCardScratched(card, index) {
  unlockedCount++;
  updateProgress();

  // Save progress to Firebase
  currentlyLocked.delete(card.id);
  const unlockedIds = CARDS_DATA.filter(c => scratchInstances[c.id]?.completed || c.id === card.id).map(c => c.id);
  const lockedIds   = [...currentlyLocked];
  if (window.DB) window.DB.saveProgress(unlockedIds, lockedIds).catch(() => {});

  Audio.stopScratch();
  Audio.playOnce('chime', 0.9, 1.0);
  setTimeout(() => Audio.playOnce('sparkle', 0.7, 1.0 + Math.random() * 0.1), 180);
  haptic([40, 20, 80, 20, 40]);

  // Card flip animation
  const area = document.getElementById(`scratch-area-${card.id}`);
  if (area) {
    area.classList.add('flipping');
    setTimeout(() => { area.classList.remove('flipping'); area.classList.add('revealed'); }, 600);
  }

  const badge = document.getElementById(`done-badge-${card.id}`);
  if (badge) setTimeout(() => badge.classList.add('visible'), 300);

  const wrapper = document.getElementById(`card-wrapper-${card.id}`);
  if (wrapper) wrapper.classList.add('done');

  // Polaroid full reveal
  const photoSlot = document.getElementById(`photo-${card.id}`);
  if (photoSlot?.querySelector('img')) {
    const img = photoSlot.querySelector('img');
    img.style.transition = 'opacity 1s ease, filter 1.5s ease';
    img.style.filter  = 'brightness(2) saturate(0)';
    img.style.opacity = '0.5';
    setTimeout(() => { img.style.filter = 'brightness(0.85) saturate(1.1)'; img.style.opacity = '0.85'; }, 300);
  }

  // Unlock next card
  const nextCard = CARDS_DATA[index + 1];
  if (nextCard) {
    currentlyLocked.delete(nextCard.id);
    unlockNextCard(nextCard, index + 1);
  }

  if (!confettiEngine) confettiEngine = new Confetti(document.getElementById('confetti-canvas'));
  confettiEngine.burst([card.color, '#fff', '#D4A843', '#E05D6E']);

  setTimeout(() => openModal(card), 600);
  setTimeout(() => { if (nextCard && currentSlide === index) goToSlide(index + 1); }, 2200);

  if (unlockedCount >= CARDS_DATA.length) setTimeout(() => showFinale(), 2200);
}

// ============================================================
//  UNLOCK NEXT CARD
// ============================================================
function unlockNextCard(card, index) {
  const wrapper = document.getElementById(`card-wrapper-${card.id}`);
  const lock    = document.getElementById(`lock-${card.id}`);
  if (lock) {
    lock.classList.add('unlocking');
    setTimeout(() => {
      lock.remove();
      wrapper?.classList.remove('locked');
      wrapper?.classList.add('unlocking-anim');
      initScratchCard(card, index);
    }, 600);
  }
}

// ============================================================
//  MODAL
// ============================================================
function openModal(card) {
  currentModalIndex = CARDS_DATA.indexOf(card);
  const modal = document.getElementById('reveal-modal');
  _populateModal(card);
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('open'));
}

function _populateModal(card) {
  document.getElementById('modal-year').textContent  = card.year;
  document.getElementById('modal-theme').textContent = card.theme;
  document.getElementById('modal-title').textContent = card.title;
  document.getElementById('modal-icon-wrap').innerHTML = getModalIcon(card.iconType);

  const modalCard = document.getElementById('modal-card');
  modalCard.style.setProperty('--modal-color', card.color);
  modalCard.style.setProperty('--modal-glow',  card.glowColor);

  const msgEl = document.getElementById('modal-message');
  msgEl.classList.remove('typewriter-done');
  setTimeout(() => typewriterEffect(msgEl, card.message, 20), 350);

  const cardIndex = CARDS_DATA.indexOf(card);
  const prevBtn   = document.getElementById('modal-prev');
  const nextBtn   = document.getElementById('modal-next');
  const navLabel  = document.getElementById('modal-nav-label');

  const hasPrev = cardIndex > 0 && scratchInstances[CARDS_DATA[cardIndex - 1].id]?.completed;
  const hasNext = cardIndex < CARDS_DATA.length - 1 && scratchInstances[CARDS_DATA[cardIndex + 1].id]?.completed;
  prevBtn.disabled = !hasPrev;
  nextBtn.disabled = !hasNext;
  navLabel.textContent = `Message ${cardIndex + 1} of ${unlockedCount}`;
}

function navigateModal(direction) {
  const newIndex = currentModalIndex + direction;
  if (newIndex < 0 || newIndex >= CARDS_DATA.length) return;
  const targetCard = CARDS_DATA[newIndex];
  if (!scratchInstances[targetCard.id]?.completed) return;
  currentModalIndex = newIndex;

  const card = document.getElementById('modal-card');
  card.style.opacity    = '0';
  card.style.transform  = `translateY(10px) translateX(${direction > 0 ? '15px' : '-15px'})`;
  card.style.transition = 'opacity 0.15s, transform 0.15s';

  setTimeout(() => {
    _populateModal(targetCard);
    card.style.transform = `translateY(5px) translateX(${direction > 0 ? '-8px' : '8px'})`;
    requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0) translateX(0)'; });
  }, 150);
}

function closeModal() {
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
  const modal = document.getElementById('reveal-modal');
  modal.classList.remove('open');
  setTimeout(() => modal.classList.add('hidden'), 400);
}

// ============================================================
//  SWIPE DOWN TO CLOSE MODAL
// ============================================================
function setupModalSwipe() {
  const card = document.getElementById('modal-card');
  let startY = 0, isDragging = false;
  card.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; isDragging = true; card.style.transition = 'none'; }, { passive: true });
  card.addEventListener('touchmove',  (e) => { if (!isDragging) return; const d = e.touches[0].clientY - startY; if (d > 0) card.style.transform = `translateY(${d}px)`; }, { passive: true });
  card.addEventListener('touchend',   (e) => {
    if (!isDragging) return; isDragging = false;
    const d = e.changedTouches[0].clientY - startY;
    card.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    if (d > 80) { closeModal(); setTimeout(() => { card.style.transform = ''; }, 400); }
    else card.style.transform = '';
  }, { passive: true });
}

// ============================================================
//  PROGRESS
// ============================================================
function updateProgress() {
  const fill = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');
  const pct  = (unlockedCount / CARDS_DATA.length) * 100;
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `${unlockedCount} of ${CARDS_DATA.length} unlocked`;
}

// ============================================================
//  FINALE SCREEN
// ============================================================
function showFinale() {
  stopGameParticles();
  const game   = document.getElementById('game-screen');
  const finale = document.getElementById('finale-screen');
  game.classList.add('fade-out');
  setTimeout(() => {
    game.classList.add('hidden');
    finale.classList.remove('hidden');
    finale.classList.add('fade-in');
    document.getElementById('finale-message').textContent = FINALE_MESSAGE;

    // Dynamic next year for secret card
    const nextYearLabel = document.querySelector('.secret-year');
    if (nextYearLabel) {
      nextYearLabel.textContent = `Year ${getAnniversaryYear() + 1}?`;
    }

    Audio.playOnce('chime', 1.0, 0.85);
    haptic([60, 30, 60, 30, 120]);
    finaleParticles = new ParticleSystem('finale-particles', {
      count: 85, colors: ['#D4A843','#E05D6E','#8B5CF6','#4A9B6F','rgba(255,255,255,0.8)'],
      type: 'mixed', speed: 0.22, size: 2.2,
    });
    initSecretCard();
  }, 700);
}

// ============================================================
//  REVIEW ALL MEMORIES
// ============================================================
function reviewAllMemories() {
  if (finaleParticles) { finaleParticles.stop(); finaleParticles = null; }
  const finale = document.getElementById('finale-screen');
  const game   = document.getElementById('game-screen');
  finale.classList.add('fade-out');
  setTimeout(() => {
    finale.classList.add('hidden');
    finale.classList.remove('fade-out', 'fade-in');
    game.classList.remove('hidden');
    game.classList.add('fade-in');
    startGameParticles();
    goToSlide(0, false);
  }, 700);
}

// ============================================================
//  SHARE
// ============================================================
function shareStory() {
  const overlay = document.getElementById('share-overlay');
  const preview = document.getElementById('share-preview');
  overlay.classList.remove('hidden');
  preview.innerHTML = '<div class="share-loading">Generating your story…</div>';

  const grid = document.createElement('div');
  grid.style.cssText = `position:fixed;left:-9999px;top:0;width:560px;padding:28px;background:linear-gradient(135deg,#0d0d1a 0%,#1a1028 100%);font-family:Georgia,serif;border-radius:20px;`;

  const title = document.createElement('div');
  title.style.cssText = 'text-align:center;color:#D4A843;font-size:22px;margin-bottom:20px;letter-spacing:0.1em;';
  title.textContent = '6 Years, 6 Messages';
  grid.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;';

  CARDS_DATA.forEach((card) => {
    const item = document.createElement('div');
    item.style.cssText = `background:linear-gradient(145deg,#1a1a2e,#0d0d1a);border:1px solid ${card.color}44;border-radius:12px;padding:14px;text-align:center;box-shadow:0 0 20px ${card.glowColor};`;
    const cachedPhoto = _photosCache.find(p => p.id === String(card.id) || p.id === card.id);
    const photo = cachedPhoto?.url || null;
    if (photo) {
      const img = document.createElement('img');
      img.src = photo;
      img.style.cssText = 'width:100%;height:70px;object-fit:cover;border-radius:8px;margin-bottom:8px;';
      item.appendChild(img);
    }
    const yr = document.createElement('div');
    yr.style.cssText = `font-size:10px;color:${card.color};letter-spacing:0.2em;margin-bottom:4px;`;
    yr.textContent = card.year;
    const th = document.createElement('div');
    th.style.cssText = 'font-size:11px;color:#F0EAD6;font-style:italic;';
    th.textContent = card.theme;
    item.appendChild(yr); item.appendChild(th);
    row.appendChild(item);
  });

  grid.appendChild(row);
  const footer = document.createElement('div');
  footer.style.cssText = 'text-align:center;color:#8A7F6E;font-size:10px;margin-top:16px;letter-spacing:0.1em;';
  footer.textContent = 'Happy 6th Anniversary';
  grid.appendChild(footer);
  document.body.appendChild(grid);

  if (window.html2canvas) {
    html2canvas(grid, { backgroundColor: null, scale: 2, useCORS: true, allowTaint: true })
      .then(canvas => {
        document.body.removeChild(grid);
        preview.innerHTML = '';
        canvas.style.cssText = 'max-width:100%;border-radius:12px;display:block;margin:0 auto;';
        preview.appendChild(canvas);
      })
      .catch(() => { document.body.removeChild(grid); preview.innerHTML = '<div class="share-loading">Could not generate image.</div>'; });
  } else {
    document.body.removeChild(grid);
    preview.innerHTML = '<div class="share-loading">html2canvas not loaded — try again.</div>';
  }
}

function closeShareOverlay() {
  document.getElementById('share-overlay').classList.add('hidden');
}

// ============================================================
//  SECRET 7TH CARD
// ============================================================
function initSecretCard() {
  const canvas = document.getElementById('secret-canvas');
  const area   = document.getElementById('secret-scratch');
  if (!canvas || !area) return;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    canvas.width  = area.getBoundingClientRect().width  || area.offsetWidth  || 300;
    canvas.height = area.getBoundingClientRect().height || area.offsetHeight || 180;

    new ScratchCard(canvas, {
      color: '#1a1240', threshold: 60, brushRadius: 18,
      onScratchStart: () => Audio.startScratch(),
      onScratchEnd:   () => Audio.stopScratch(),
      onComplete: () => {
        document.getElementById('secret-reveal').classList.add('glowing');
        Audio.playOnce('chime', 1.0, 0.78);
        setTimeout(() => Audio.playOnce('sparkle', 0.8), 200);
        haptic([80, 40, 80, 40, 200]);
        
        if (!confettiEngine) confettiEngine = new Confetti(document.getElementById('confetti-canvas'));
        confettiEngine.shower(6000, ['#D4A843', '#E05D6E', '#fff', '#8B5CF6']);

        if (finaleParticles) {
          finaleParticles.stop();
          finaleParticles = new ParticleSystem('finale-particles', {
            count: 110, colors: ['#D4A843','#E05D6E','rgba(255,255,255,0.9)'],
            type: 'hearts', speed: 0.2, size: 3,
          });
        }
      }
    });
  }));
}