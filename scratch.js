// ============================================================
//  SCRATCH CARD ENGINE
//  • Sound only fires on actual movement (not tap/press)
//  • Desktop uses setPointerCapture so mouse drag doesn't
//    leak up to the album slider while scratching
//  • Multi-touch supported on mobile
// ============================================================

class ScratchCard {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { willReadFrequently: true });
    this.isScratching = false;
    this.isMoving     = false;
    this.scratchedPercent = 0;
    this.onComplete     = options.onComplete     || (() => {});
    this.onProgress     = options.onProgress     || (() => {});
    this.onScratchStart = options.onScratchStart || (() => {});
    this.onScratchEnd   = options.onScratchEnd   || (() => {});
    this.color       = options.color       || '#C9A84C';
    this.threshold   = options.threshold   || 65;
    this.completed   = false;
    this.brushRadius = options.brushRadius || 14;
    this._lastPos    = null;
    this._init();
  }

  _init() { this._resize(); this._draw(); this._bindEvents(); }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width  = rect.width  || 300;
    this.canvas.height = rect.height || 160;
  }

  _draw() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0,    lightenColor(this.color, 25));
    grad.addColorStop(0.25, this.color);
    grad.addColorStop(0.5,  lightenColor(this.color, 40));
    grad.addColorStop(0.75, this.color);
    grad.addColorStop(1,    darkenColor(this.color, 25));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.06; ctx.fillStyle = '#fff';
    for (let i = 0; i < w; i += 6)
      for (let j = 0; j < h; j += 6)
        if ((i + j) % 12 === 0) ctx.fillRect(i, j, 3, 3);

    ctx.globalAlpha = 0.08;
    const sg = ctx.createLinearGradient(0, 0, w * 0.6, h);
    sg.addColorStop(0, 'transparent'); sg.addColorStop(0.4, 'rgba(255,255,255,0.9)');
    sg.addColorStop(0.6, 'rgba(255,255,255,0.9)'); sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;

    ctx.strokeStyle = lightenColor(this.color, 50); ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3; ctx.strokeRect(1, 1, w - 2, h - 2); ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = 'bold 13px DM Sans, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2736  SCRATCH HERE  \u2736', w / 2, h / 2 - 12);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.font = '10px DM Sans, sans-serif';
    ctx.fillText('scratch firmly to reveal', w / 2, h / 2 + 10);
  }

  _getPos(e) {
    const rect  = this.canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) * (this.canvas.width  / rect.width),
      y: (touch.clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  _hasMovedEnough(pos) {
    if (!this._lastPos) return true;
    const dx = pos.x - this._lastPos.x, dy = pos.y - this._lastPos.y;
    return Math.sqrt(dx * dx + dy * dy) > 2;
  }

  _scratch(x, y) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(x, y, this.brushRadius, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x, y, this.brushRadius * 0.5, x, y, this.brushRadius * 1.4);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, this.brushRadius * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this._checkCompletion();
  }

  _checkCompletion() {
    if (this.completed) return;
    const data   = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const total  = data.length / 4;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] < 128) transparent++;
    this.scratchedPercent = Math.min(100, (transparent / (total / 4)) * 100);
    this.onProgress(this.scratchedPercent);
    if (this.scratchedPercent >= this.threshold) { this.completed = true; this._completeReveal(); }
  }

  _completeReveal() {
    let alpha = 1;
    const fade = () => {
      alpha -= 0.04;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (alpha > 0) {
        this.ctx.globalAlpha = alpha; this._draw(); this.ctx.globalAlpha = 1;
        requestAnimationFrame(fade);
      } else {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.onComplete();
      }
    };
    requestAnimationFrame(fade);
  }

  _bindEvents() {
    const c = this.canvas;

    // ── MOUSE / DESKTOP (pointer events + capture) ─────────────────
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      e.stopPropagation();
      c.setPointerCapture(e.pointerId); // lock mouse to canvas — slider won't pan
      this.isScratching = true;
      this.isMoving     = false;
      this._lastPos     = this._getPos(e);
    });

    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || !this.isScratching) return;
      e.stopPropagation();
      const pos = this._getPos(e);
      if (this._hasMovedEnough(pos)) {
        if (!this.isMoving) { this.isMoving = true; this.onScratchStart(); }
        this._scratch(pos.x, pos.y);
        this._lastPos = pos;
      }
    });

    c.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.isMoving) this.onScratchEnd();
      this.isScratching = false; this.isMoving = false; this._lastPos = null;
    });

    c.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.isMoving) this.onScratchEnd();
      this.isScratching = false; this.isMoving = false; this._lastPos = null;
    });

    // ── TOUCH / MOBILE ──────────────────────────────────────────────
    c.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.isScratching = true; this.isMoving = false;
      const rect = c.getBoundingClientRect(), t = e.touches[0];
      this._lastPos = {
        x: (t.clientX - rect.left) * (c.width  / rect.width),
        y: (t.clientY - rect.top)  * (c.height / rect.height),
      };
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.isScratching) return;
      const rect = c.getBoundingClientRect();
      for (let i = 0; i < e.touches.length; i++) {
        const t   = e.touches[i];
        const pos = {
          x: (t.clientX - rect.left) * (c.width  / rect.width),
          y: (t.clientY - rect.top)  * (c.height / rect.height),
        };
        if (this._hasMovedEnough(pos)) {
          if (!this.isMoving) { this.isMoving = true; this.onScratchStart(); }
          this._scratch(pos.x, pos.y);
          this._lastPos = pos;
        }
      }
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      e.stopPropagation();
      if (this.isMoving) this.onScratchEnd();
      this.isScratching = false; this.isMoving = false; this._lastPos = null;
    });
  }

  reset() {
    this.completed = false; this.scratchedPercent = 0;
    this.isMoving = false; this._lastPos = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._draw();
  }
}

// ============================================================
//  COLOR UTILITIES
// ============================================================
function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ============================================================
//  CONFETTI ENGINE
// ============================================================
class Confetti {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.particles = []; this.running = false;
  }

  burst(colors = ['#D4A843', '#E05D6E', '#8B5CF6', '#4A9B6F', '#fff']) {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.particles = []; this.running = true;
    for (let i = 0; i < 150; i++) {
      const type = ['rect','circle','star'][Math.floor(Math.random() * 3)];
      this.particles.push({
        x: Math.random() * this.canvas.width, y: -20 - Math.random() * 60,
        w: Math.random() * 10 + 4, h: Math.random() * 5 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 5, vy: Math.random() * 5 + 2,
        opacity: 1, type, size: Math.random() * 8 + 4,
      });
    }
    this._animate();
  }

  _animate() {
    if (!this.running) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rotation += p.rotSpeed;
      p.vy += 0.1; p.vx *= 0.99;
      if (p.y > this.canvas.height * 0.8) p.opacity -= 0.025;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
      ctx.fillStyle = p.color;
      if (p.type === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      else if (p.type === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * 4 * Math.PI) / 5 - Math.PI / 2, r = p.size / 2;
          i === 0 ? ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r) : ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
        }
        ctx.closePath(); ctx.fill();
      } else { ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      ctx.restore();
    });
    this.particles = this.particles.filter(p => p.opacity > 0);
    if (this.particles.length > 0) requestAnimationFrame(() => this._animate());
    else { this.running = false; ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  }
}