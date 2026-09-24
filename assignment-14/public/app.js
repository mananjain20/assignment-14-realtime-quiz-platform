/**
 * app.js
 * Shared client utilities, sound effects synthesizer (Web Audio API), and toast notification manager.
 */

// Toast notification helper
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'error' ? '⚠️' : (type === 'success' ? '✅' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Web Audio API Sound Synthesizer (No external assets required!)
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  playBeep(freq = 440, type = 'sine', duration = 0.1, gainVal = 0.15) {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Ignore audio context block
    }
  }

  playTick() {
    this.playBeep(880, 'triangle', 0.05, 0.08);
  }

  playLock() {
    this.playBeep(600, 'sine', 0.15, 0.2);
  }

  playCorrect() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playBeep(freq, 'sine', 0.2, 0.2);
        }, idx * 80);
      });
    } catch (e) {}
  }

  playWrong() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const notes = [280, 240, 200];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playBeep(freq, 'sawtooth', 0.25, 0.2);
        }, idx * 120);
      });
    } catch (e) {}
  }

  playFanfare() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const melody = [
        { f: 523.25, d: 150 },
        { f: 523.25, d: 150 },
        { f: 523.25, d: 150 },
        { f: 659.25, d: 400 },
        { f: 783.99, d: 400 },
        { f: 1046.50, d: 800 }
      ];

      let elapsed = 0;
      melody.forEach(note => {
        setTimeout(() => {
          this.playBeep(note.f, 'triangle', note.d / 1000, 0.25);
        }, elapsed);
        elapsed += note.d + 50;
      });
    } catch (e) {}
  }
}

const sounds = new SoundManager();

// Unlock audio on first user gesture
document.addEventListener('click', () => sounds.init(), { once: true });
document.addEventListener('touchstart', () => sounds.init(), { once: true });
