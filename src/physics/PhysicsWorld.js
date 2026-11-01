// Thin wrapper around Rapier3D (rapier3d-compat). All simulation is stepped with a FIXED timestep
// by the game loop; rendering interpolates between steps.
import RAPIER from '@dimforge/rapier3d-compat';

export const STEP = 1 / 60;
export const GRAVITY = -13;

export class PhysicsWorld {
  static async create() {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = STEP;
    this.events = new RAPIER.EventQueue(true);
    this._shapeCache = new Map();
  }

  /** Advance one fixed step; collision-start pairs are reported through the callback. */
  step(onCollisionStart) {
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (started) onCollisionStart(h1, h2);
    });
  }

  addStaticCollider(desc) {
    return this.world.createCollider(desc);
  }

  addStaticTrimesh(vertices, indices) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8).setRestitution(0.1);
    return this.world.createCollider(desc);
  }

  /** Ray cast returning { collider, toi } or null. */
  raycast(origin, dir, maxToi, excludeBody = null) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, excludeBody || undefined);
    if (!hit) return null;
    return { collider: hit.collider, toi: hit.timeOfImpact ?? hit.toi ?? 0 };
  }

  /** True when an axis-aligned box of half-extent h centred at p overlaps anything. */
  boxOverlaps(p, h, excludeBody = null) {
    const key = h.toFixed(3);
    let shape = this._shapeCache.get(key);
    if (!shape) {
      shape = new RAPIER.Cuboid(h, h, h);
      this._shapeCache.set(key, shape);
    }
    const hit = this.world.intersectionWithShape(
      p,
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      undefined,
      undefined,
      undefined,
      excludeBody || undefined,
    );
    return !!hit;
  }

  removeBody(body) {
    try {
      this.world.removeRigidBody(body);
    } catch (e) {
      console.warn('[physics] removeRigidBody failed', e);
    }
  }
}
