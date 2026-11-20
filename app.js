const BASE_CLIPS_URL = './clips.json';
const DB_NAME = 'nippleboard-db';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'board';
const THUMB_MAX = 400;

const els = {
  grid: document.getElementById('grid'),
  cardTemplate: document.getElementById('cardTemplate'),
  emptyState: document.getElementById('emptyState'),
  searchInput: document.getElementById('searchInput'),
  editToggle: document.getElementById('editToggle'),
  editHint: document.getElementById('editHint'),
  statusBar: document.getElementById('statusBar'),
  offlineBadge: document.getElementById('offlineBadge'),
  installBtn: document.getElementById('installBtn'),
  menuBtn: document.getElementById('menuBtn'),
  menuPanel: document.getElementById('menuPanel'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  resetDataBtn: document.getElementById('resetDataBtn'),
  storageHint: document.getElementById('storageHint'),
  iosHint: document.getElementById('iosHint'),
  cacheProgress: document.getElementById('cacheProgress'),
  cacheProgressText: document.getElementById('cacheProgressText'),
  cacheProgressFill: document.getElementById('cacheProgressFill'),
  playerOverlay: document.getElementById('playerOverlay'),
  playerMedia: document.getElementById('playerMedia'),
  playerTitle: document.getElementById('playerTitle'),
  editorModal: document.getElementById('editorModal'),
  editorForm: document.getElementById('editorForm'),
  editTitle: document.getElementById('editTitle'),
  editThumbPreview: document.getElementById('editThumbPreview'),
  editImageFile: document.getElementById('editImageFile'),
  framePickBtn: document.getElementById('framePickBtn'),
  resetImageBtn: document.getElementById('resetImageBtn'),
  framePicker: document.getElementById('framePicker'),
  frameVideo: document.getElementById('frameVideo'),
  frameSlider: document.getElementById('frameSlider'),
  captureFrameBtn: document.getElementById('captureFrameBtn'),
  editHidden: document.getElementById('editHidden'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
};

let baseClips = [];
let state = { version: 1, items: {} };
let order = [];
let currentClipId = null;
let editingClipId = null;
let editingImageBlob = undefined; // undefined = unchanged, null = reset to auto, Blob = custom
let deferredPrompt = null;
let db = null;
let useLocalStorageFallback = false;
const thumbCache = new Map(); // id -> data URL for auto thumbs
let dragState = null;
const playbackVideo = document.createElement('video');
playbackVideo.className = 'player-video';
playbackVideo.playsInline = true;
playbackVideo.preload = 'auto';

init();

async function init() {
  detectIOS();
  bindUI();
  await openStorage();
  await loadState();
  await refreshClips();
  renderGrid();
  registerServiceWorker();
  updateOnlineStatus();
  requestPersistence();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function bindUI() {
  els.searchInput.addEventListener('input', renderGrid);
  els.editToggle.addEventListener('change', () => {
    stopPlayback();
    document.body.classList.toggle('edit-mode', els.editToggle.checked);
    els.editHint.classList.toggle('hidden', !els.editToggle.checked);
    renderGrid();
  });
  els.menuBtn.addEventListener('click', () => {
    const open = els.menuPanel.classList.toggle('hidden');
    els.menuBtn.setAttribute('aria-expanded', String(!open));
  });
  els.exportBtn.addEventListener('click', exportSettings);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', handleImportFile);
  els.resetDataBtn.addEventListener('click', resetAppData);
  els.installBtn.addEventListener('click', installApp);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    els.installBtn.classList.add('hidden');
    setStatus('App installiert.');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.editorModal.classList.contains('hidden')) closeEditor();
      else if (currentClipId) stopPlayback();
    }
  });
  els.playerOverlay.addEventListener('click', () => {
    if (currentClipId) stopPlayback();
  });

  els.editorForm.addEventListener('submit', onEditorSubmit);
  els.cancelEditBtn.addEventListener('click', closeEditor);
  els.editorModal.addEventListener('click', (e) => { if (e.target === els.editorModal) closeEditor(); });
  els.editImageFile.addEventListener('change', onImageFileSelected);
  els.resetImageBtn.addEventListener('click', () => { editingImageBlob = null; renderEditorThumb(); });
  els.framePickBtn.addEventListener('click', openFramePicker);
  els.frameSlider.addEventListener('input', () => { els.frameVideo.currentTime = parseFloat(els.frameSlider.value || '0'); });
  els.captureFrameBtn.addEventListener('click', captureFrame);

  // Drag & drop (mouse)
  els.grid.addEventListener('dragstart', onDragStart);
  els.grid.addEventListener('dragover', onDragOver);
  els.grid.addEventListener('dragleave', onDragLeave);
  els.grid.addEventListener('drop', onDrop);
  els.grid.addEventListener('dragend', onDragEnd);
  // Touch drag
  els.grid.addEventListener('pointerdown', onPointerDown, { passive: false });
  // Card spotlight follows the pointer (pure visual, no interference with drag).
  els.grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.clip-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

function detectIOS() {
  const ua = window.navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone;
  if (iOS && !standalone) els.iosHint.classList.remove('hidden');
}

function setStatus(msg, timeout = 4000) {
  els.statusBar.textContent = msg || '';
  if (msg && timeout) setTimeout(() => { if (els.statusBar.textContent === msg) els.statusBar.textContent = ''; }, timeout);
}

/* ---------- Storage (IndexedDB with localStorage fallback) ---------- */
function openStorage() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) { useLocalStorageFallback = true; resolve(); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => { useLocalStorageFallback = true; setStatus('IndexedDB nicht verfügbar, nutze localStorage (ohne Bild-Blobs).'); resolve(); };
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbSet(key, val) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadState() {
  try {
    let loaded = null;
    if (db) loaded = await idbGet(STATE_KEY);
    else if (useLocalStorageFallback) {
      const raw = localStorage.getItem(DB_NAME + ':' + STATE_KEY);
      if (raw) loaded = JSON.parse(raw);
    }
    if (loaded && typeof loaded === 'object') {
      state = Object.assign({ version: 1, volume: 1, items: {} }, loaded);
      if (!state.items || typeof state.items !== 'object') state.items = {};
    }
  } catch (e) {
    console.warn('State laden fehlgeschlagen', e);
  }
}

async function saveState() {
  try {
    if (db) await idbSet(STATE_KEY, state);
    else if (useLocalStorageFallback) {
      // Blobs can't be stored in localStorage; strip them
      const copy = JSON.parse(JSON.stringify(state, (k, v) => (v instanceof Blob ? undefined : v)));
      for (const [id, it] of Object.entries(state.items || {})) {
        if (it && it.imageBlob instanceof Blob) {
          if (!copy.items[id]) copy.items[id] = {};
          copy.items[id].imageBlob = null;
        }
      }
      localStorage.setItem(DB_NAME + ':' + STATE_KEY, JSON.stringify(copy));
    }
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    setStatus('Speichern fehlgeschlagen: ' + e.message);
  }
}

/* ---------- Clips & merging ---------- */
async function loadClips() {
  try {
    const res = await fetch(BASE_CLIPS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Ungültiges Format');
    return data.filter(c => c && c.id && c.file);
  } catch (e) {
    console.warn('clips.json laden fehlgeschlagen', e);
    try {
      const res2 = await fetch(BASE_CLIPS_URL);
      const data = await res2.json();
      if (Array.isArray(data)) return data.filter(c => c && c.id && c.file);
    } catch (_) {}
    return [];
  }
}

async function refreshClips() {
  baseClips = await loadClips();
  reconcileState();
}

function reconcileState() {
  const baseIds = baseClips.map(c => c.id);
  const baseSet = new Set(baseIds);
  let savedOrder = Array.isArray(state.order) ? state.order.filter(id => baseSet.has(id)) : [];
  for (const id of baseIds) if (!savedOrder.includes(id)) savedOrder.push(id);
  order = savedOrder;
  state.order = order;
}

function getEffectiveClip(id) {
  const base = baseClips.find(c => c.id === id);
  if (!base) return null;
  const over = state.items[id] || {};
  return {
    ...base,
    title: (over.title != null && over.title !== '') ? over.title : base.title,
    hidden: !!over.hidden,
    imageBlob: over.imageBlob instanceof Blob ? over.imageBlob : (over.imageBlob === null ? null : undefined),
    imageDataUrl: (typeof over.imageDataUrl === 'string' && over.imageDataUrl) ? over.imageDataUrl : undefined,
  };
}

function visibleClips() {
  const q = (els.searchInput.value || '').trim().toLowerCase();
  const editMode = els.editToggle.checked;
  const list = [];
  for (const id of order) {
    const c = getEffectiveClip(id);
    if (!c) continue;
    if (!editMode && c.hidden) continue;
    if (q && !(c.title || '').toLowerCase().includes(q)) continue;
    list.push(c);
  }
  return list;
}

/* ---------- Rendering ---------- */
function renderGrid() {
  if (currentClipId) stopPlayback(false);
  const clips = visibleClips();
  els.grid.innerHTML = '';
  els.emptyState.classList.toggle('hidden', clips.length !== 0);
  const editMode = els.editToggle.checked;
  for (const [index, clip] of clips.entries()) {
    const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = clip.id;
    node.style.setProperty('--i', String(Math.min(index, 20)));
    node.setAttribute('aria-label', `${clip.title} abspielen`);
    node.querySelector('.title').textContent = clip.title || clip.id;
    node.classList.toggle('is-hidden', !!clip.hidden);
    node.draggable = editMode;
    const thumbEl = node.querySelector('.thumb');
    renderThumb(clip, thumbEl);
    node.addEventListener('click', (e) => onCardClick(e, clip.id));
    els.grid.appendChild(node);
  }
}

async function renderThumb(clip, thumbEl) {
  thumbEl.innerHTML = '';
  const over = state.items[clip.id] || {};
  if (over.imageBlob instanceof Blob) {
    const url = URL.createObjectURL(over.imageBlob);
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    thumbEl.appendChild(img);
    return;
  }
  if (typeof over.imageDataUrl === 'string' && over.imageDataUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = over.imageDataUrl;
    thumbEl.appendChild(img);
    return;
  }
  if (thumbCache.has(clip.id)) {
    const val = thumbCache.get(clip.id);
    if (val) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = val;
      thumbEl.appendChild(img);
      return;
    }
  }
  thumbEl.appendChild(makeFallback(clip.title));
  generateAutoThumb(clip).then((url) => {
    if (!url) return;
    thumbCache.set(clip.id, url);
    const card = els.grid.querySelector(`.clip-card[data-id="${CSS.escape(clip.id)}"] .thumb`);
    if (card) { card.innerHTML = ''; const img = document.createElement('img'); img.alt = ''; img.src = url; card.appendChild(img); }
  }).catch(() => {});
}

function makeFallback(title) {
  const d = document.createElement('span');
  d.className = 'thumb-fallback';
  d.textContent = title || 'Clip';
  let h = 0; for (let i = 0; i < (title || '').length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  d.style.background = `linear-gradient(135deg, hsl(${hue} 85% 55%), hsl(${(hue + 50) % 360} 80% 45%))`;
  return d;
}

function generateAutoThumb(clip) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const finish = (val) => { if (done) return; done = true; cleanup(); resolve(val); };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('loadeddata', onData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
    };
    const onError = () => finish(null);
    const onSeeked = () => {
      try {
        const w = video.videoWidth || 0, h = video.videoHeight || 0;
        if (!w || !h) { finish(null); return; }
        const c = document.createElement('canvas');
        const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext('2d');
        ctx.drawImage(video, 0, 0, c.width, c.height);
        finish(c.toDataURL('image/jpeg', 0.82));
      } catch (e) { finish(null); }
    };
    const seekToMiddle = () => {
      try {
        const d = video.duration || 0;
        const t = (isFinite(d) && d > 0) ? d * 0.5 : 0;
        if (isFinite(t) && t > 0) {
          if (Math.abs((video.currentTime || 0) - t) < 0.01) onSeeked();
          else video.currentTime = t;
        } else {
          onData();
        }
      } catch (e) { onSeeked(); }
    };
    const onMetadata = () => {
      // Wait for data so seeking/decoding a middle frame is reliable.
      if (video.readyState >= 2) seekToMiddle();
    };
    const onData = () => {
      if (done) return;
      seekToMiddle();
    };
    video.addEventListener('loadedmetadata', onMetadata, { once: true });
    video.addEventListener('loadeddata', onData, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = clip.file;
    video.load();
    setTimeout(() => finish(null), 7000);
  });
}

/* ---------- Playback ---------- */
function onCardClick(e, id) {
  if (els.editToggle.checked) {
    openEditor(id);
    return;
  }
  playClip(id);
}

function playClip(id) {
  const clip = getEffectiveClip(id);
  if (!clip) return;
  if (currentClipId === id && !playbackVideo.paused) {
    stopPlayback();
    return;
  }
  stopPlayback(false);
  els.playerMedia.innerHTML = '';
  els.playerMedia.appendChild(playbackVideo);
  els.playerTitle.textContent = clip.title || clip.id;
  els.playerOverlay.setAttribute('aria-label', `${clip.title || clip.id} abspielen`);
  els.playerOverlay.classList.remove('hidden');
  playbackVideo.src = clip.file;
  playbackVideo.currentTime = 0;
  currentClipId = id;
  highlightActive();
  const p = playbackVideo.play();
  if (p && p.catch) p.catch((err) => {
    console.warn('Playback failed', err);
    setStatus('Wiedergabe fehlgeschlagen: ' + (err && err.message ? err.message : 'unbekannt'));
    stopPlayback();
  });
  playbackVideo.onended = () => { if (currentClipId === id) stopPlayback(); };
  playbackVideo.onerror = () => { if (currentClipId === id) { setStatus('Clip konnte nicht abgespielt werden.'); stopPlayback(); } };
}

function stopPlayback(rerender = true) {
  const id = currentClipId;
  playbackVideo.onended = null;
  playbackVideo.onerror = null;
  try { playbackVideo.pause(); } catch (_) {}
  playbackVideo.removeAttribute('src');
  playbackVideo.load();
  if (playbackVideo.parentElement) playbackVideo.parentElement.removeChild(playbackVideo);
  els.playerOverlay.classList.add('hidden');
  currentClipId = null;
  highlightActive();
  if (rerender && id) {
    const card = els.grid.querySelector(`.clip-card[data-id="${CSS.escape(id)}"]`);
    const clip = getEffectiveClip(id);
    if (card && clip) renderThumb(clip, card.querySelector('.thumb'));
  }
}

function highlightActive() {
  els.grid.querySelectorAll('.clip-card').forEach(card => {
    card.classList.toggle('playing', card.dataset.id === currentClipId);
  });
}

/* ---------- Editor ---------- */
function openEditor(id) {
  stopPlayback();
  const clip = getEffectiveClip(id);
  if (!clip) return;
  editingClipId = id;
  editingImageBlob = undefined;
  els.editTitle.value = clip.title || '';
  els.editHidden.checked = !!clip.hidden;
  els.framePicker.classList.add('hidden');
  els.frameVideo.removeAttribute('src');
  els.frameVideo.load();
  renderEditorThumb();
  els.editorModal.classList.remove('hidden');
  els.editTitle.focus();
}

function closeEditor() {
  els.editorModal.classList.add('hidden');
  editingClipId = null;
  editingImageBlob = undefined;
  els.editImageFile.value = '';
  els.framePicker.classList.add('hidden');
  els.frameVideo.pause();
  els.frameVideo.removeAttribute('src');
}

function renderEditorThumb() {
  if (!editingClipId) return;
  const clip = getEffectiveClip(editingClipId);
  const over = state.items[editingClipId] || {};
  els.editThumbPreview.innerHTML = '';
  let shown = false;
  if (editingImageBlob instanceof Blob) {
    const img = document.createElement('img'); img.src = URL.createObjectURL(editingImageBlob); els.editThumbPreview.appendChild(img); shown = true;
  } else if (editingImageBlob === null) {
    els.editThumbPreview.appendChild(makeFallback(clip.title)); shown = true;
  } else if (over.imageBlob instanceof Blob) {
    const img = document.createElement('img'); img.src = URL.createObjectURL(over.imageBlob); els.editThumbPreview.appendChild(img); shown = true;
  } else if (over.imageDataUrl) {
    const img = document.createElement('img'); img.src = over.imageDataUrl; els.editThumbPreview.appendChild(img); shown = true;
  } else if (thumbCache.has(editingClipId) && thumbCache.get(editingClipId)) {
    const img = document.createElement('img'); img.src = thumbCache.get(editingClipId); els.editThumbPreview.appendChild(img); shown = true;
  }
  if (!shown) els.editThumbPreview.appendChild(makeFallback(clip.title));
}

async function onImageFileSelected() {
  const f = els.editImageFile.files && els.editImageFile.files[0];
  if (!f) return;
  try {
    editingImageBlob = await resizeImageFile(f, THUMB_MAX, THUMB_MAX);
    renderEditorThumb();
  } catch (e) { setStatus('Bild konnte nicht geladen werden.'); }
}

function resizeImageFile(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxW / w, maxH / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob); else reject(new Error('Kein Blob'));
        }, 'image/jpeg', 0.85);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bildfehler')); };
    img.src = url;
  });
}

function openFramePicker() {
  if (!editingClipId) return;
  const clip = getEffectiveClip(editingClipId);
  if (!clip) return;
  els.framePicker.classList.remove('hidden');
  els.frameVideo.src = clip.file;
  els.frameVideo.addEventListener('loadedmetadata', () => {
    const d = isFinite(els.frameVideo.duration) ? els.frameVideo.duration : 0;
    els.frameSlider.max = String(d);
    els.frameSlider.value = String(Math.min(0.1, d));
    els.frameVideo.currentTime = parseFloat(els.frameSlider.value);
  }, { once: true });
}

async function captureFrame() {
  try {
    const v = els.frameVideo;
    if (!v.videoWidth) return;
    const c = document.createElement('canvas');
    const scale = Math.min(1, THUMB_MAX / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    if (blob) { editingImageBlob = blob; renderEditorThumb(); setStatus('Frame übernommen.'); }
  } catch (e) { setStatus('Frame konnte nicht übernommen werden.'); }
}

async function onEditorSubmit(e) {
  e.preventDefault();
  if (!editingClipId) return;
  const id = editingClipId;
  const base = baseClips.find(c => c.id === id);
  if (!base) return;
  const item = Object.assign({}, state.items[id] || {});
  const title = els.editTitle.value.trim() || base.title || id;
  item.title = title;
  item.hidden = els.editHidden.checked;
  if (editingImageBlob === null) {
    item.imageBlob = null;
    delete item.imageDataUrl;
    thumbCache.delete(id);
  } else if (editingImageBlob instanceof Blob) {
    if (db && !useLocalStorageFallback) {
      item.imageBlob = editingImageBlob;
      delete item.imageDataUrl;
    } else {
      item.imageDataUrl = await blobToDataUrl(editingImageBlob);
      item.imageBlob = null;
    }
    thumbCache.delete(id);
  }
  state.items[id] = item;
  await saveState();
  closeEditor();
  renderGrid();
  setStatus('Gespeichert.');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ---------- Drag & Drop reorder ---------- */
function onDragStart(e) {
  if (!els.editToggle.checked) { e.preventDefault(); return; }
  const card = e.target.closest('.clip-card');
  if (!card) return;
  dragState = { id: card.dataset.id, pointer: false };
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
}
function onDragOver(e) {
  if (!els.editToggle.checked || !dragState) return;
  e.preventDefault();
  const card = e.target.closest('.clip-card');
  clearDropTargets();
  if (card && card.dataset.id !== dragState.id) card.classList.add('drop-target');
}
function onDragLeave(e) {
  const card = e.target.closest('.clip-card');
  if (card) card.classList.remove('drop-target');
}
async function onDrop(e) {
  if (!els.editToggle.checked || !dragState) return;
  e.preventDefault();
  const card = e.target.closest('.clip-card');
  clearDropTargets();
  if (card && card.dataset.id !== dragState.id) {
    reorder(dragState.id, card.dataset.id);
    await saveState();
    renderGrid();
  }
}
function onDragEnd() {
  if (dragState) {
    const el = els.grid.querySelector(`.clip-card[data-id="${CSS.escape(dragState.id)}"]`);
    if (el) el.classList.remove('dragging');
  }
  dragState = null;
  clearDropTargets();
}
function clearDropTargets() { els.grid.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')); }

function reorder(fromId, toId) {
  const from = order.indexOf(fromId); const to = order.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(from, 1);
  order.splice(to, 0, fromId);
  state.order = order;
}

// Pointer-based drag for touch
function onPointerDown(e) {
  if (!els.editToggle.checked) return;
  const card = e.target.closest('.clip-card');
  if (!card) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const startX = e.clientX, startY = e.clientY;
  let started = false;
  let overId = null;
  const id = card.dataset.id;
  const onMove = (ev) => {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!started) {
      if (Math.hypot(dx, dy) < 10) return;
      started = true;
      dragState = { id, pointer: true };
      card.classList.add('dragging');
      try { card.setPointerCapture(ev.pointerId); } catch (_) {}
    }
    ev.preventDefault();
    const elem = document.elementFromPoint(ev.clientX, ev.clientY);
    const over = elem ? elem.closest('.clip-card') : null;
    clearDropTargets();
    overId = null;
    if (over && over.dataset.id !== id) { over.classList.add('drop-target'); overId = over.dataset.id; }
  };
  const onUp = async (ev) => {
    card.releasePointerCapture?.(ev.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (started && overId) { reorder(id, overId); await saveState(); }
    if (started) { card.classList.remove('dragging'); clearDropTargets(); dragState = null; renderGrid(); }
  };
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/* ---------- Export / Import ---------- */
async function exportSettings() {
  try {
    const itemsOut = {};
    for (const [id, item] of Object.entries(state.items || {})) {
      const out = { ...item };
      if (item.imageBlob instanceof Blob) {
        out.imageDataUrl = await blobToDataUrl(item.imageBlob);
        delete out.imageBlob;
      }
      itemsOut[id] = out;
    }
    const payload = {
      format: 'nippleboard-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      order: state.order || order,
      items: itemsOut,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nippleboard-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus('Einstellungen exportiert.');
  } catch (e) { setStatus('Export fehlgeschlagen: ' + e.message); }
}

async function handleImportFile() {
  const f = els.importFile.files && els.importFile.files[0];
  els.importFile.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('Ungültige Datei');
    if (Array.isArray(data.order)) state.order = data.order.filter(x => typeof x === 'string');
    const items = data.items && typeof data.items === 'object' ? data.items : {};
    for (const [id, it] of Object.entries(items)) {
      if (!it || typeof it !== 'object') continue;
      const target = { ...(state.items[id] || {}) };
      if (typeof it.title === 'string') target.title = it.title;
      if (typeof it.hidden === 'boolean') target.hidden = it.hidden;
      if (typeof it.imageDataUrl === 'string' && it.imageDataUrl.startsWith('data:')) {
        if (db && !useLocalStorageFallback) {
          target.imageBlob = dataUrlToBlob(it.imageDataUrl);
          delete target.imageDataUrl;
        } else {
          target.imageDataUrl = it.imageDataUrl;
          target.imageBlob = null;
        }
        thumbCache.delete(id);
      } else if (it.imageBlob === null || it.imageDataUrl === null) {
        target.imageBlob = null; delete target.imageDataUrl; thumbCache.delete(id);
      }
      state.items[id] = target;
    }
    await saveState();
    await loadState();
    reconcileState();
    renderGrid();
    setStatus('Einstellungen importiert.');
  } catch (e) { setStatus('Import fehlgeschlagen: ' + e.message); }
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const meta = parts[0] || '';
  const b64 = parts.slice(1).join(',');
  const m = /data:([^;]+);base64/.exec(meta);
  const mime = m ? m[1] : 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ---------- Reset ---------- */
function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function resetAppData() {
  const ok = window.confirm(
    'App-Daten wirklich zurücksetzen?\n\n' +
    'Dadurch werden lokal gespeicherte Einstellungen gelöscht (Titel, Reihenfolge, eigene/ausgeblendete Vorschaubilder).\n' +
    'Clips-Dateien in der App bleiben erhalten. Vorschaubilder werden neu aus der Videomitte erzeugt.'
  );
  if (!ok) return;
  try {
    stopPlayback();
    if (db) {
      await idbDelete(STATE_KEY);
    }
    try { localStorage.removeItem(DB_NAME + ':' + STATE_KEY); } catch (_) {}
    state = { version: 1, items: {} };
    thumbCache.clear();
    await loadState();
    await refreshClips();
    renderGrid();
    setStatus('App-Daten zurückgesetzt. Vorschaubilder werden neu erzeugt.');
  } catch (e) {
    console.error('Reset fehlgeschlagen', e);
    setStatus('Zurücksetzen fehlgeschlagen: ' + e.message);
  }
}

/* ---------- PWA / Service Worker ---------- */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus('Service Worker wird nicht unterstützt.');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CACHE_CLIPS', clips: baseClips.map(c => c.file) });
    } else {
      navigator.serviceWorker.ready.then(() => {
        reg.active && reg.active.postMessage({ type: 'CACHE_CLIPS', clips: baseClips.map(c => c.file) });
      });
    }
    reg.addEventListener('updatefound', () => setStatus('Update wird geladen…'));
  } catch (e) {
    console.warn('SW Registrierung fehlgeschlagen', e);
  }
}

function onSwMessage(event) {
  const msg = event.data || {};
  if (msg.type === 'CACHE_PROGRESS') {
    els.cacheProgress.classList.remove('hidden');
    const { done, total } = msg;
    els.cacheProgressText.textContent = `Lade Clips für Offline-Nutzung: ${done}/${total}`;
    const pct = total ? Math.round((done / total) * 100) : 0;
    els.cacheProgressFill.style.width = pct + '%';
    if (done >= total) setTimeout(() => els.cacheProgress.classList.add('hidden'), 1500);
  } else if (msg.type === 'CACHE_DONE') {
    els.cacheProgressText.textContent = 'Clips für Offline-Nutzung bereit.';
    els.cacheProgressFill.style.width = '100%';
    setTimeout(() => els.cacheProgress.classList.add('hidden'), 2000);
  } else if (msg.type === 'CACHE_ERROR') {
    setStatus('Einige Clips konnten nicht gecacht werden.');
  }
}

function updateOnlineStatus() {
  els.offlineBadge.classList.toggle('hidden', navigator.onLine);
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (_) {}
  deferredPrompt = null;
  els.installBtn.classList.add('hidden');
}

async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) {
        const granted = await navigator.storage.persist();
        els.storageHint.textContent = granted
          ? 'Speicher: dauerhafte Speicherung gewährt.'
          : 'Speicher: dauerhafte Speicherung nicht gewährt (Browser kann Daten bei Platzmangel löschen).';
      } else {
        els.storageHint.textContent = 'Speicher: dauerhafte Speicherung aktiv.';
      }
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.quota) {
          const used = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
          const quota = (est.quota / (1024 * 1024)).toFixed(0);
          els.storageHint.textContent += ` Belegt ca. ${used} MB von ${quota} MB.`;
        }
      }
    } else {
      els.storageHint.textContent = 'Hinweis: Dauerhafte Speicherung wird von diesem Browser nicht unterstützt.';
    }
  } catch (e) { /* ignore */ }
}
