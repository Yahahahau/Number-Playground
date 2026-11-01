// First-person controller: Rapier kinematic character controller (gravity, slopes, auto-step,
// pushes dynamic blocks) + smoothed look and an interpolated camera so physics never makes it shake.
import * as THREE from 'three';
import { START, terrainHeight, inPond, WATER_Y } from '../world/terrain.js';

const HALF = 0.55; // capsule cylinder half-height
const RADIUS = 0.36;
const CENTER = HALF + RADIUS; // centre above feet
const EYE = 1.62; // eye above feet
const WALK = 4.6;
const SWIM = 2.4;

export class Player {
  constructor(game) {
    this.game = game;
    const R = game.physics.RAPIER;
    const w = game.physics.world;
    const y = terrainHeight(START.x, START.z) + CENTER + 0.05;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(START.x, y, START.z));
    this.collider = w.createCollider(R.ColliderDesc.capsule(HALF, RADIUS).setFriction(0).setCollisionGroups(0x0002ffff), this.body);
    this.cc = w.createCharacterController(0.02);
    this.cc.enableAutostep(0.35, 0.12, false);
    this.cc.enableSnapToGround(0.3);
    this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass?.(60);

    this.prev = new THREE.Vector3(START.x, y, START.z);
    this.curr = this.prev.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = false;
    this.inWater = false;
    this.speed = 0;

    this.yawT = -0.28;
    this.pitchT = -0.36;
    this.yaw = this.yawT;
    this.pitch = this.pitchT;
    this.camY = y - CENTER + EYE;
    this.position = new THREE.Vector3(START.x, y - CENTER, START.z); // feet, interpolated
    this.eye = new THREE.Vector3();
    this._mv = { x: 0, y: 0 };
    this.ignore = null; // collider that must not block the player (held block)
    this.filter = (c) => c !== this.ignore;
  }

  forward(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  look(dx, dy, sens) {
    this.yawT -= dx * 0.0047 * sens;
    this.pitchT = Math.max(-1.42, Math.min(1.42, this.pitchT - dy * 0.0047 * sens));
  }

  fixedPre(dt, input) {
    const m = input.movement(this._mv);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wx = -sy * m.y + cy * m.x;
    const wz = -cy * m.y - sy * m.x;
    const sp = this.inWater ? SWIM : WALK;
    const tx = wx * sp;
    const tz = wz * sp;
    const k = 1 - Math.exp(-dt * (this.grounded ? 16 : 5));
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    this.vy = this.grounded ? -2 : Math.max(-30, this.vy - 22 * dt);
    this.cc.computeColliderMovement(
      this.collider,
      { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt },
      undefined,
      undefined,
      this.filter,
    );
    const mv = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
  }

  fixedPost() {
    this.prev.copy(this.curr);
    const t = this.body.translation();
    this.curr.set(t.x, t.y, t.z);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const feet = t.y - CENTER;
    this.inWater = inPond(t.x, t.z, 0) && feet < WATER_Y - 0.1;
  }

  /** Per rendered frame: smooth look, interpolate position, place the camera. */
  updateCamera(dt, alpha, camera, look) {
    if (look) this.look(look.x, look.y, look.sens);
    const f = 1 - Math.exp(-dt * 30);
    this.yaw += (this.yawT - this.yaw) * f;
    this.pitch += (this.pitchT - this.pitch) * f;

    const x = this.prev.x + (this.curr.x - this.prev.x) * alpha;
    const y = this.prev.y + (this.curr.y - this.prev.y) * alpha;
    const z = this.prev.z + (this.curr.z - this.prev.z) * alpha;
    this.position.set(x, y - CENTER, z);

    // smooth vertical eye motion (stairs / slopes), never below the ground
    const targetY = y - CENTER + EYE;
    const dy = targetY - this.camY;
    this.camY = Math.abs(dy) > 0.9 ? targetY : this.camY + dy * (1 - Math.exp(-dt * 22));
    const ground = terrainHeight(x, z);
    this.camY = Math.max(this.camY, ground + 0.35);

    this.eye.set(x, this.camY, z);
    camera.position.copy(this.eye);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  teleportTo(x, z) {
    const y = terrainHeight(x, z) + CENTER + 0.05;
    this.body.setTranslation({ x, y, z }, true);
    this.prev.set(x, y, z);
    this.curr.copy(this.prev);
    this.vel.set(0, 0, 0);
  }
}
