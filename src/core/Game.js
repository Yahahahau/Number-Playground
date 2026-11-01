// Orchestrates every system and runs the main loop (fixed-step physics + interpolated rendering).
import * as THREE from 'three';
import { PhysicsWorld, STEP } from '../physics/PhysicsWorld.js';
import { Events } from './Events.js';
import { SaveSystem } from '../save/Save.js';
import { getQuality } from '../settings/Quality.js';
import { Collection } from '../collection/Collection.js';
import { Daily, todayKey } from '../collection/Daily.js';
import { World } from '../world/World.js';
import { createSky, HORIZON } from '../world/Sky.js';
import { Water } from '../water/Water.js';
import { Effects } from '../effects/Effects.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Player } from '../player/Player.js';
import { Input } from '../player/Input.js';
import { BlockManager } from '../blocks/BlockManager.js';
import { PhysicsGun } from '../weapons/PhysicsGun.js';
import { UI } from '../ui/UI.js';
import { POND, WATER_Y, inPond } from '../world/terrain.js';

const UNDERWATER = new THREE.Color('#0a4f78');

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
    this.water = new Water(this.scene, this.quality, this.world.sunDir);
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

    this.bindControls();
    this.applySettings();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.appEl);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      if (document.visibilityState === 'hidden') this.save.flush();
    });
    // browsers need a gesture before audio / fullscreen
    const first = (e) => {
      this.audio.unlock();
      if (e.pointerType === 'touch') this.tryFullscreen();
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
    // image-based lighting generated from the same procedural sky the water reflects
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(createSky(this.world.sunDir));
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.75;
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

  resize() {
    const w = Math.max(1, this.appEl.clientWidth);
    const h = Math.max(1, this.appEl.clientHeight);
    if (this._w === w && this._h === h && this._pr === this.renderer.getPixelRatio()) return;
    this._w = w;
    this._h = h;
    this._pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.setViewportHeight(h * this._pr);
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
    this.water.update(dt, this.camera, this.renderer, this.scene);
    this.blocks.render(alpha, dt, this.time, this.camera);
    this.gun.update(dt, this.time, this.camera, this.player);
    this.effects.update(dt, this.camera);
    this.ui.update();
    this.audio.setPondProximity(Math.hypot(this.camera.position.x - POND.x, this.camera.position.z - POND.z));
    this.updateUnderwater(dt);

    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.gun.scene, this.camera);
  }

  updateUnderwater(dt) {
    const c = this.camera.position;
    const under = c.y < WATER_Y && inPond(c.x, c.z, 0);
    if (under === this.under) return;
    this.under = under;
    const fog = this.scene.fog;
    if (under) {
      fog.color.copy(UNDERWATER);
      this.scene.background = UNDERWATER;
      fog.near = 0.3;
      fog.far = 14;
    } else {
      fog.color.copy(HORIZON);
      this.scene.background = HORIZON.clone();
      fog.near = this.quality.fog[0];
      fog.far = this.quality.fog[1];
    }
  }
}
