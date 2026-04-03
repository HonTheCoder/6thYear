// ============================================================
//  PARTICLE SYSTEMS — ENHANCED
//  Rich particles on all screens
// ============================================================

class ParticleSystem {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.options = {
      count:  options.count  || 70,
      colors: options.colors || ['#D4A843', '#E05D6E', '#8B5CF6', '#fff'],
      speed:  options.speed  || 0.4,
      size:   options.size   || 2.5,
      type:   options.type   || 'stars', // 'stars' | 'hearts' | 'mixed' | 'sparkle'
    };
    this.animId = null;
    this._init();
  }

  _init() {
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._spawn();
    this._animate();
  }

  _resize() {
    if (!this.canvas) return;
    this.canvas.width  = this.canvas.offsetWidth  || window.innerWidth;
    this.canvas.height = this.canvas.offsetHeight || window.innerHeight;
  }

  _spawn() {
    const { count, colors, size, type } = this.options;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      let pType;
      if (type === 'mixed')   pType = ['star', 'heart', 'circle', 'sparkle'][Math.floor(Math.random() * 4)];
      else if (type === 'hearts')  pType = 'heart';
      else if (type === 'sparkle') pType = 'sparkle';
      else pType = 'star';

      this.particles.push({
        x: Math.random() * (this.canvas?.width  || 400),
        y: Math.random() * (this.canvas?.height || 800),
        size:      Math.random() * size + 0.8,
        color:     colors[Math.floor(Math.random() * colors.length)],
        opacity:   Math.random(),
        opacityDir:(Math.random() > 0.5 ? 1 : -1) * (0.003 + Math.random() * 0.006),
        vy:       -(Math.random() * this.options.speed + 0.08),
        vx:        (Math.random() - 0.5) * 0.25,
        type:      pType,
        rotation:  Math.random() * 360,
        rotSpeed:  (Math.random() - 0.5) * 0.6,
        twinkle:   Math.random() * Math.PI * 2, // phase
        twinkleSpeed: 0.02 + Math.random() * 0.04,
      });
    }
  }

  _drawHeart(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 8);
    ctx.beginPath();
    const s = size * 0.55;
    ctx.moveTo(0, -s * 0.5);
    ctx.bezierCurveTo(s, -s * 1.6, s * 2.1, s * 0.4, 0, s * 1.6);
    ctx.bezierCurveTo(-s * 2.1, s * 0.4, -s, -s * 1.6, 0, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawStar(ctx, x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.beginPath();
    const spikes = 4;
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes;
      const r = i % 2 === 0 ? size : size * 0.35;
      if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else         ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawSparkle(ctx, x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    // 6-point sparkle
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const len = size * 1.8;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
    }
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = size * 0.4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  _animate() {
    if (!this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles.forEach(p => {
      p.y += p.vy;
      p.x += p.vx;
      p.rotation  += p.rotSpeed;
      p.twinkle   += p.twinkleSpeed;
      p.opacity   += p.opacityDir;

      // Twinkle effect
      const twinkledOpacity = p.opacity * (0.6 + 0.4 * Math.sin(p.twinkle));

      if (p.opacity >= 0.9 || p.opacity <= 0.05) p.opacityDir *= -1;
      if (p.y < -15) {
        p.y = this.canvas.height + 15;
        p.x = Math.random() * this.canvas.width;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, twinkledOpacity));
      ctx.fillStyle   = p.color;

      if (p.type === 'heart') {
        this._drawHeart(ctx, p.x, p.y, p.size * 1.6);
      } else if (p.type === 'sparkle') {
        this._drawSparkle(ctx, p.x, p.y, p.size, p.rotation);
      } else if (p.type === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this._drawStar(ctx, p.x, p.y, p.size * 1.6, p.rotation);
      }
      ctx.restore();
    });

    this.animId = requestAnimationFrame(() => this._animate());
  }

  stop() {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
  }
}

// ============================================================
//  FALLING PETALS (intro screen)
// ============================================================
function spawnPetals() {
  const container = document.getElementById('petals-container');
  if (!container) return;

  const petalSymbols = ['✿', '❀', '✽', '❁', '⁕', '✾', '❃'];
  const petalColors  = ['#D4A843', '#E05D6E', '#8B5CF6', 'rgba(255,255,255,0.7)', '#4A9B6F'];

  for (let i = 0; i < 22; i++) {
    const petal = document.createElement('div');
    petal.className = 'petal';
    petal.textContent = petalSymbols[Math.floor(Math.random() * petalSymbols.length)];
    petal.style.cssText = `
      left: ${Math.random() * 100}%;
      color: ${petalColors[Math.floor(Math.random() * petalColors.length)]};
      font-size: ${Math.random() * 18 + 7}px;
      animation-duration: ${Math.random() * 9 + 7}s;
      animation-delay: ${Math.random() * 6}s;
      opacity: ${Math.random() * 0.55 + 0.2};
      text-shadow: 0 0 8px currentColor;
    `;
    container.appendChild(petal);
  }
}

// ============================================================
//  GAME SCREEN AMBIENT PARTICLES
// ============================================================
let gameParticleSystem = null;

function startGameParticles() {
  if (gameParticleSystem) gameParticleSystem.stop();
  gameParticleSystem = new ParticleSystem('game-particles-canvas', {
    count:  45,
    colors: ['rgba(212,168,67,0.6)', 'rgba(224,93,110,0.5)', 'rgba(139,92,246,0.5)', 'rgba(255,255,255,0.3)'],
    type:   'mixed',
    speed:  0.25,
    size:   1.8,
  });
}

function stopGameParticles() {
  if (gameParticleSystem) gameParticleSystem.stop();
  gameParticleSystem = null;
}