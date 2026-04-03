// ============================================================
//  APP — MAIN GAME CONTROLLER
//  • Firebase Firestore for progress + photo URLs (shared across devices)
//  • ImgBB for free image hosting (upload → get URL → save to Firestore)
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

// ── ImgBB API key ──────────────────────────────────────────
const IMGBB_API_KEY = 'fb54f76ee4dd21a3d5d4de19020c2d64';

// ── Anniversary date (April 4) ─────────────────────────────
const ANNIVERSARY_MONTH = 4;  // April
const ANNIVERSARY_DAY   = 4;

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
let _photosCache      = {};   // cardId → url, loaded from Firebase at startup

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
      '#gallery-close-btn,.gallery-card';
    if (e.target.closest(targets)) Audio.playClick();
  }, true);
}

// ============================================================
//  ANNIVERSARY DATE — April 4 (no emojis — icons only)
// ============================================================
function renderAnniversaryDate() {
  const el = document.getElementById('anniversary-date');
  if (!el) return;

  const now     = new Date();
  const thisYear = now.getFullYear();

  const anniv  = new Date(thisYear, ANNIVERSARY_MONTH - 1, ANNIVERSARY_DAY);
  const todayMD = now.getMonth() * 100 + now.getDate();
  const annivMD = (ANNIVERSARY_MONTH - 1) * 100 + ANNIVERSARY_DAY;

  const heartIcon = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
  const starIcon  = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const clockIcon = `<svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  if (now.getMonth() === ANNIVERSARY_MONTH - 1 && now.getDate() === ANNIVERSARY_DAY) {
    el.innerHTML = `${starIcon}<strong>Happy Anniversary!</strong> ${heartIcon} Today is our special day`;
    el.classList.add('is-anniversary');
    document.title = 'Happy Anniversary';
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

  if (daysLeft === 1) {
    el.innerHTML = `${clockIcon}<strong>Tomorrow</strong> is our Anniversary ${heartIcon}`;
  } else {
    el.innerHTML = `${clockIcon}<strong>${daysLeft} days</strong> until our Anniversary ${heartIcon} April 4`;
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
async function uploadToImgBB(file) {
  const formData = new FormData();
  formData.append('image', file);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) throw new Error(`ImgBB upload failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'ImgBB error');
  return json.data.url; // permanent image URL
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
  document.getElementById('lightbox-close').addEventListener('click', closeGalleryLightbox);
  document.getElementById('lightbox-backdrop').addEventListener('click', closeGalleryLightbox);

  setupModalSwipe();
  setupAlbumSwipe();

  // DB is always ready instantly (serves from localStorage cache)
  bootstrapFromFirebase();
});

// ============================================================
//  BOOTSTRAP — instant from cache, bar tied to real steps
// ============================================================
async function bootstrapFromFirebase() {
  showLoadingScreen();

  const fill = document.querySelector('.loading-bar-fill');
  const setText = (t) => {
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = t;
  };

  function setBar(pct, duration = 0.35) {
    if (!fill) return;
    fill.style.transition = `width ${duration}s ease`;
    fill.style.width = pct + '%';
  }

  // Step 1 — start
  setBar(15);
  setText('Loading our story…');

  await new Promise(r => setTimeout(r, 120)); // tiny breath so bar is visible

  try {
    // Step 2 — load data (instant from cache)
    setBar(50);
    const [progress, photos] = await Promise.all([
      window.DB.getProgress(),
      window.DB.getAllPhotos(),
    ]);
    const unlockedIds = progress.unlockedIds || [];
    const lockedIds   = progress.lockedIds   || [2,3,4,5,6];
    currentlyLocked   = new Set(lockedIds);
    unlockedCount     = unlockedIds.length;
    _photosCache      = photos;
  } catch(e) {
    console.warn('Bootstrap failed, using defaults:', e);
    _photosCache = {};
  }

  // Step 3 — preparing visuals
  setBar(80);
  setText('Almost ready…');
  await new Promise(r => setTimeout(r, 200));

  // Step 4 — done
  setBar(100, 0.3);
  setText('Ready ♡');

  // Reveal the tap hint after bar finishes
  const tapHint = document.getElementById('loading-tap-hint');
  if (tapHint) {
    setTimeout(() => { tapHint.style.transition = 'opacity 0.5s'; tapHint.style.opacity = '1'; }, 350);
  }

  await new Promise(r => setTimeout(r, 500)); // let bar + hint settle visually

  // Now hide loading and show intro
  hideLoadingScreen();

  spawnPetals();
  introParticles = new ParticleSystem('particles-canvas', {
    count: 65, colors: ['#D4A843','#B8912E','rgba(255,255,255,0.8)','#E05D6E','#8B5CF6'],
    type: 'mixed', speed: 0.28, size: 2.8,
  });

  // Show intro after loading screen starts fading
  setTimeout(() => {
    const introScreen = document.getElementById('intro-screen');
    introScreen.classList.remove('hidden');
    introScreen.classList.add('fade-in');
  }, 300);
}

// ============================================================
//  PHOTO UPLOAD — ImgBB → Firestore → card
// ============================================================
async function onPhotoSelected(e) {
  const file   = e.target.files[0];
  if (!file) return;
  const cardId = CARDS_DATA[currentSlide]?.id;
  if (!cardId) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    e.target.value = '';
    return;
  }

  // Show spinner on upload button
  const btn = document.getElementById('album-upload-btn');
  btn.classList.add('uploading');
  btn.disabled = true;

  try {
    console.log(`[Upload] Starting upload for card ${cardId}...`);

    // 1. Upload image to ImgBB → get permanent URL
    const url = await uploadToImgBB(file);
    console.log(`[Upload] ImgBB URL:`, url);

    // 2. Save URL to Firestore
    if (window.DB) {
      await window.DB.savePhoto(cardId, url);
      console.log(`[DB] Saved photo for card ${cardId}`);
    }

    // 3. Update local cache
    _photosCache[String(cardId)] = url;

    // 4. Apply to the card on screen
    applyPhotoToCard(cardId, url);

    // 5. Refresh gallery if it's open
    if (!document.getElementById('gallery-screen').classList.contains('hidden')) {
      renderGallery();
    }

    haptic([20, 10, 20]);
  } catch(err) {
    console.error('[Upload] Photo upload failed:', err);
    alert('Photo upload failed — please check your internet and try again.\n' + err.message);
  } finally {
    btn.classList.remove('uploading');
    btn.disabled = false;
  }

  e.target.value = '';
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
//  GALLERY SCREEN
// ============================================================
function openGallery() {
  const gallery = document.getElementById('gallery-screen');
  renderGallery();
  gallery.style.display = 'flex';
  // Small timeout so display:flex is applied before transition starts
  requestAnimationFrame(() => requestAnimationFrame(() => gallery.classList.add('open')));
}

function closeGallery() {
  const gallery = document.getElementById('gallery-screen');
  gallery.classList.remove('open');
  setTimeout(() => { gallery.style.display = ''; }, 400);
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  CARDS_DATA.forEach(card => {
    const photoUrl = _photosCache[String(card.id)] || _photosCache[card.id] || card.photo || null;
    const isUnlocked = scratchInstances[card.id]?.completed ||
                       (!currentlyLocked.has(card.id) && CARDS_DATA.indexOf(card) < unlockedCount);
    const isLocked = !isUnlocked;

    const item = document.createElement('div');
    item.className = `gallery-card ${isLocked ? 'gallery-locked' : 'gallery-unlocked'}`;
    item.style.setProperty('--card-color', card.color);
    item.style.setProperty('--card-glow',  card.glowColor);

    if (isLocked) {
      // Locked — dim placeholder
      item.innerHTML = `
        <div class="gallery-img-wrap gallery-locked-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="gallery-lock-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-year" style="color:var(--card-color)">${card.year}</span>
          <span class="gallery-card-theme">Locked</span>
        </div>`;
    } else {
      // Unlocked — show memory with photo background if available
      const msgPreview = card.message.length > 72 ? card.message.slice(0, 72) + '…' : card.message;
      item.innerHTML = `
        <div class="gallery-img-wrap gallery-memory-wrap" style="${photoUrl ? '' : 'background:linear-gradient(145deg,#1c1c30,#0f0f1e)'}">
          ${photoUrl ? `<img src="${photoUrl}" alt="" draggable="false" loading="lazy"/>
                        <div class="gallery-img-overlay"></div>` : ''}
          <div class="gallery-memory-icon">${getRevealIcon(card.iconType)}</div>
        </div>
        <div class="gallery-card-info gallery-card-info-memory">
          <span class="gallery-card-year" style="color:var(--card-color)">${card.year}</span>
          <span class="gallery-card-theme-title">${card.title}</span>
          <span class="gallery-card-msg-preview">${msgPreview}</span>
          ${!photoUrl ? `<button class="gallery-add-photo-btn" data-id="${card.id}">+ Add Photo</button>` : ''}
        </div>`;

      // Tap card → open the full memory modal
      item.addEventListener('click', (e) => {
        // If they tapped the add photo button, handle upload instead
        if (e.target.closest('.gallery-add-photo-btn')) {
          e.stopPropagation();
          const originalSlide = currentSlide;
          const targetIndex   = CARDS_DATA.findIndex(c => c.id === card.id);
          if (targetIndex !== -1) currentSlide = targetIndex;
          const input = document.getElementById('album-file-input');
          input.onchange = async (ev) => {
            await onPhotoSelected(ev);
            currentSlide = originalSlide;
            input.onchange = null;
            renderGallery(); // refresh gallery after upload
          };
          input.click();
          return;
        }
        // Otherwise open the memory modal
        closeGallery();
        setTimeout(() => openModal(card), 300);
      });
    }

    grid.appendChild(item);
  });
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

  img.src = url;
  year.textContent  = card.year;
  theme.textContent = card.theme;
  title.textContent = card.title;

  lb.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => lb.classList.add('open')));
}

function closeGalleryLightbox() {
  const lb = document.getElementById('gallery-lightbox');
  lb.classList.remove('open');
  setTimeout(() => { lb.style.display = ''; }, 350);
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
  track.innerHTML    = '';
  dotsWrap.innerHTML = '';
  totalSlides = CARDS_DATA.length;
  document.getElementById('slide-total').textContent = totalSlides;

  CARDS_DATA.forEach((card, index) => {
    const isLocked = currentlyLocked.has(card.id);
    const isDone   = scratchInstances[card.id]?.completed === true ||
                     (unlockedCount > 0 && !isLocked && index < unlockedCount);

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
    const photoSrc = _photosCache[String(card.id)] || _photosCache[card.id] || card.photo || null;

    const photoHTML = photoSrc
      ? `<div class="card-photo-slot" id="photo-${card.id}">
           <img src="${photoSrc}" alt="" draggable="false"/>
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
function getCardIcon(type) {
  const icons = {
    heart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    star:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    smile:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    moon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    feather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
    flame:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-7 7 7 7 0 01-7-7c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>`,
  };
  return icons[type] || icons.heart;
}
function getRevealIcon(type) {
  const s = `style="width:32px;height:32px;color:var(--card-color,#D4A843)"`;
  const icons = {
    heart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    star:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    smile:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/></svg>`,
    moon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    feather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76z"/><line x1="16" y1="8" x2="2" y2="22"/></svg>`,
    flame:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${s}><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-7 7 7 7 0 01-7-7c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>`,
  };
  return icons[type] || icons.heart;
}
function getLockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;color:#6B6070"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
}
function getModalIcon(type) {
  const icons = {
    heart:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
    star:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    smile:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    moon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    feather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5l6.74-6.76z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
    flame:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-7 7 7 7 0 01-7-7c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>`,
  };
  return icons[type] || icons.heart;
}

// ============================================================
//  INIT SCRATCH CARD
// ============================================================
function initScratchCard(card, index) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
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
        preview.addEventListener('click', () => openModal(card));
      }
      return;
    }

    const w = area.getBoundingClientRect().width;
    const h = area.getBoundingClientRect().height;
    canvas.width  = w || area.offsetWidth  || 300;
    canvas.height = h || area.offsetHeight || 400;

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

    const preview = document.getElementById(`reveal-${card.id}`);
    const scratchArea = document.getElementById(`scratch-area-${card.id}`);
    // Wire tap on the whole area (not just preview) so nothing blocks the click
    if (scratchArea) {
      scratchArea.addEventListener('click', () => {
        if (scratcher.completed) {
          // Hide canvas so it can't block future taps
          canvas.style.display = 'none';
          openModal(card);
        }
      });
    }
    if (preview) {
      preview.style.cursor = 'pointer';
    }
  }));
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
  navLabel.textContent = `Memory ${cardIndex + 1} of ${unlockedCount}`;
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
  title.textContent = '6 Years, 6 Secrets';
  grid.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;';

  CARDS_DATA.forEach((card) => {
    const item = document.createElement('div');
    item.style.cssText = `background:linear-gradient(145deg,#1a1a2e,#0d0d1a);border:1px solid ${card.color}44;border-radius:12px;padding:14px;text-align:center;box-shadow:0 0 20px ${card.glowColor};`;
    const photo = _photosCache[String(card.id)] || _photosCache[card.id];
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