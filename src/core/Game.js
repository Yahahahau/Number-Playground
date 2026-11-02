// Orchestrates every system and runs the main loop (fixed-step physics + interpolated rendering).
import * as THREE from 'three';
import { PhysicsWorld, STEP } from '../physics/PhysicsWorld.js';
import { Events } from './Events.js';
import { SaveSystem } from '../save/Save.js';
import { getQuality } from '../settings/Quality.js';
import { Collection } from '../collection/Collection.js';
import { Daily, todayKey } from '../collection/Daily.js';
import { World } from '../world/World.js';
import { createSky } from '../world/Sky.js';
import { Challenge } from './Challenge.js';
import { SCREEN } from '../blocks/BlockMaterials.js';
import { Effects } from '../effects/Effects.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Player } from '../player/Player.js';
import { Input } from '../player/Input.js';
import { BlockManager } from '../blocks/BlockManager.js';
import { PhysicsGun } from '../weapons/PhysicsGun.js';
import { UI } from '../ui/UI.js';


export class Game {
  static async create(canvas, appEl, status) {
    const g = new Game(canvas, appEl);
    await g.init(status);
    return g;
  }

  constructor(canvas, appEl) {
    this.canvas = canvas;
    this.appEl = appEl;
    this.running = false;
    this.time = 0;
    this.acc = 0;
    this.last = 0;
    this.frameId = 0;
    this.lostContext = false;
    this.events = new Events();
    this.save = new SaveSystem();
    this.quality = getQuality(this.save.data.settings.quality);
  }

  async init(status = () => {}) {
    // ---- renderer
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error('Your browser could not start WebGL, which this game needs. Please try another browser or update your device.');
    }
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    this.maxAniso = Math.min(4, r.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 9 / 16, 0.05, 420);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lostContext = true;
      this.events.emit('toast', { text: 'Graphics were interrupted. Reloading…', kind: 'warn' });
    });
    this.canvas.addEventListener('webglcontextrestored', () => location.reload());

    // ---- physics
    status('Loading physics…');
    try {
      this.physics = await PhysicsWorld.create();
    } catch (e) {
      console.error(e);
      throw new Error('The physics engine could not be loaded. Check your connection and reload.');
    }

    // ---- data systems (the very first "1" is registered silently, before challenges exist)
    status('Preparing your collection…');
    this.collection = new Collection(this.save, this.events);
    this.collection.discover(1n, { countFind: false });
    this.daily = new Daily(this.save, this.collection, this.events);
    this.audio = new AudioSystem(this.save);

    // ---- world
    status('Building the world…');
    this.world = new World(this.scene, this.physics, this.quality);
    // the pond is gone: a no-op stand-in keeps every old `game.water.*` call site harmless
    this.water = { setQuality() {}, update() {}, setFoamSources() {}, addRipple() {}, surfaceY: () => -1000 };
    this.effects = new Effects(this.scene, this.quality, 800);
    this.buildEnvironment();

    // ---- UI + input (need the DOM; gameplay objects are looked up lazily by handlers)
    this.ui = new UI(this, document.getElementById('ui'));
    this.input = new Input(this.ui.touch, {
      joy: this.ui.joy,
      joyBase: this.ui.joyBase,
      joyKnob: this.ui.joyKnob,
      joyHint: this.ui.joyHint,
    });

    this.player = new Player(this);
    this.gun = new PhysicsGun(this);
    this.gun.setLightEnv(this.scene.environment);
    this.blocks = new BlockManager(this);
    this.blocks.spawnInitial();
    this.challenge = new Challenge(this);
    this.challenge.apply();

    this.bindControls();
    this.applySettings();
    this.resize();
    this.installViewportWatch();
    this.installWebViewGuards();
    // audio needs a first gesture (fullscreen is never forced: WebViews manage their own chrome)
    const first = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', first, true);
    };
    window.addEventListener('pointerdown', first, true);
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });

    // warm up so the first visible frame is complete (shaders compiled, shadow map drawn)
    status('Almost ready…');
    this.stepOnce();
    this.renderFrame(1, 0.016);
  }

  buildEnvironment() {
    // image-based lighting baked ONCE from the space skybox plus a few bright light panels, so
    // metallic / crystal blocks have something interesting to reflect (no real-time reflections).
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(createSky());
    const panel = (color, x, y, z, w, h) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    panel(0xffffff, 0, 150, 40, 160, 60);
    panel(0x20d8ff, 160, 40, 0, 120, 40);
    panel(0xff30d0, -150, 30, -60, 120, 40);
    panel(0x7a3cff, 0, 20, -170, 200, 30);
    panel(0xbfe8ff, 0, 15, 170, 160, 20);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 1.0;
    pm.dispose();
  }

  // ------------------------------------------------------------------ controls

  bindControls() {
    const inp = this.input;
    const gun = this.gun;
    inp.onLookMove = (dx, dy) => {
      if (gun.rotateMode && gun.held) {
        gun.rotateBy(dx, dy);
        return true;
      }
      return false;
    };
    this.ui.touch.addEventListener(
      'wheel',
      (e) => {
        gun.adjustDistance(-e.deltaY * 0.004);
        e.preventDefault();
      },
      { passive: false },
    );
    inp.onKey = (code, down) => {
      if (code === 'Escape' && down) return this.ui.panels.close();
      if (this.ui.panels.isOpen) return;
      switch (code) {
        case 'KeyE':
          if (down) gun.toggleGrab();
          break;
        case 'KeyF':
          if (down) gun.push();
          break;
        case 'KeyT':
          if (down) gun.throwBlock();
          break;
        case 'KeyQ':
          gun.setPull(down);
          break;
        case 'KeyR':
          if (down) {
            if (!gun.rotateMode) gun.toggleRotate();
          } else if (gun.rotateMode) gun.toggleRotate();
          break;
        case 'KeyC':
          if (down) this.ui.panels.open('collection');
          break;
        case 'KeyN':
          if (down) this.ui.panels.open('spawn');
          break;
        case 'KeyX':
          if (down) this.resetBlocks();
          break;
        case 'KeyH':
          if (down) this.ui.panels.open('help');
          break;
        default:
      }
    };
  }

  applySettings() {
    const s = this.save.data.settings;
    this.audio.setEnabled(s.sound);
    this.audio.setVolume(s.volume);
    this.world.setShadows(!!s.shadows);
    this.applyQuality();
  }

  applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.resize(true);
  }

  setQuality(id) {
    this.save.data.settings.quality = id;
    this.quality = getQuality(id);
    this.world.setQuality(this.quality);
    this.water.setQuality(this.quality);
    this.effects.setQuality(this.quality);
    this.applyQuality();
    this.save.save(true);
    this.events.emit('toast', { text: `Graphics: ${this.quality.label}`, kind: 'info' });
  }

  setShadows(on) {
    this.save.data.settings.shadows = on;
    this.world.setShadows(on);
    this.save.save(true);
    this.events.emit('toast', { text: `Shadows ${on ? 'on' : 'off'}`, kind: 'info' });
  }

  /** Watches the real container (not the device screen) and coalesces bursts into one resize per frame. */
  installViewportWatch() {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    this.appEl.appendChild(probe);
    this._safeProbe = probe;
    const schedule = () => {
      if (this._rz) return;
      this._rz = requestAnimationFrame(() => {
        this._rz = 0;
        this.resize();
      });
    };
    new ResizeObserver(schedule).observe(this.appEl);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
  }

  /** Keep the page itself still while playing inside an in-app WebView. */
  installWebViewGuards() {
    const stop = (e) => e.cancelable && e.preventDefault();
    const el = this.appEl;
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('dblclick', stop);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop);
    // iOS double-tap zoom fallback
    let lastEnd = 0;
    document.addEventListener(
      'touchend',
      (e) => {
        const now = performance.now();
        if (now - lastEnd < 320 && !(e.target instanceof HTMLInputElement)) stop(e);
        lastEnd = now;
      },
      { passive: false },
    );
    window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
    document.addEventListener('contextmenu', stop);

    // app goes to the background / returns: drop touches, don't replay the lost time into physics
    const hidden = () => {
      this.input.reset();
      this.gun.setPull(false);
      this.save.flush();
      this.audio.suspend?.();
    };
    const shown = () => {
      this.last = performance.now();
      this.acc = 0;
      this.audio.resume?.();
      this.resize();
    };
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? hidden() : shown()));
    window.addEventListener('pagehide', hidden);
    window.addEventListener('pageshow', shown);
    window.addEventListener('blur', () => this.input.reset());
  }

  resize() {
    const w = Math.max(1, this.appEl.clientWidth);
    const h = Math.max(1, this.appEl.clientHeight);
    const pr = this.renderer.getPixelRatio();
    if (this._safeProbe) {
      const cs = getComputedStyle(this._safeProbe);
      this.appEl.style.setProperty('--safe-t-px', cs.paddingTop);
    }
    if (this._w === w && this._h === h && this._pr === pr) return;
    this._w = w;
    this._h = h;
    this._pr = pr;
    this.renderer.setSize(w, h, false); // canvas CSS size is 100%; only the drawing buffer changes
    this.renderer.getDrawingBufferSize(SCREEN.value); // screen-locked block patterns use pixel coordinates
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.setViewportHeight(h * pr);
    this.events.emit('resize', { w, h });
  }

  tryFullscreen() {
    try {
      const el = document.documentElement;
      if (document.fullscreenElement || !el.requestFullscreen) return;
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      p?.catch(() => {});
    } catch {
      /* fullscreen is optional */
    }
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      else this.events.emit('toast', { text: 'Fullscreen is not supported here', kind: 'info' });
    } catch {
      this.events.emit('toast', { text: 'Fullscreen is not supported here', kind: 'info' });
    }
  }

  // ------------------------------------------------------------------ game actions

  spawnValue(v) {
    return this.blocks.trySpawnInFront(v);
  }

  resetBlocks() {
    this.blocks.reset();
    this.audio.click();
    this.events.emit('toast', { text: 'Blocks reset. Your Collection is safe.', kind: 'good' });
  }

  resetProgress() {
    this.save.resetAll();
    this.collection.invalidate();
    this.collection.discover(1n, { countFind: false });
    this.daily.generate(todayKey());
    this.applySettings();
    this.challenge.apply();
    this.ui.updateBest();
    this.setQuality('low');
    this.blocks.reset();
    this.events.emit('toast', { text: 'Progress reset', kind: 'info' });
  }

  // ------------------------------------------------------------------ loop

  start() {
    this.running = true;
    this.last = performance.now();
    this.ui.showTutorial(7500);
    this.hintTimer = setTimeout(() => {
      if (this.save.data.stats.merges === 0) {
        this.events.emit('toast', { text: 'Tip: grab one block, aim at the other, then Throw!', kind: 'hint' });
      }
    }, 45000);
    const loop = (now) => {
      this.frameId = requestAnimationFrame(loop);
      if (this.lostContext) return;
      try {
        this.frame(now);
      } catch (e) {
        console.error('[frame]', e);
        this.errors = (this.errors || 0) + 1;
        if (this.errors > 20) {
          cancelAnimationFrame(this.frameId);
          document.getElementById('fatal-msg').textContent = 'The game hit an unexpected error. Your saved progress is safe. Please reload.';
          document.getElementById('fatal').hidden = false;
        }
      }
    };
    this.frameId = requestAnimationFrame(loop);
  }

  stepOnce() {
    this.fixedStep(STEP);
  }

  frame(now) {
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.fixedStep(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0; // never spiral when the device cannot keep up
    this.renderFrame(this.acc / STEP, dt);
  }

  fixedStep(dt) {
    this.player.fixedPre(dt, this.input);
    this.gun.fixedPre(dt);
    this.blocks.fixedPre(dt);
    this.physics.step((a, b) => this.blocks.onCollision(a, b));
    this.blocks.fixedPost(dt);
    this.player.fixedPost();
  }

  renderFrame(alpha, dt) {
    const sens = this.save.data.settings.sensitivity;
    const look = this.input.consumeLook({});
    look.sens = sens;
    this.player.updateCamera(dt, alpha, this.camera, look);
    this.camera.updateMatrixWorld(true);

    this.world.update(dt, this.time, this.player.position, this.camera);
    this.blocks.render(alpha, dt, this.time, this.camera);
    this.gun.update(dt, this.time, this.camera, this.player);
    this.challenge.update(dt);
    this.effects.update(dt, this.camera);
    this.ui.update();

    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.gun.scene, this.camera);
  }
}
