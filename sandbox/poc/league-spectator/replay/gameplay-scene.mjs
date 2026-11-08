import * as THREE from "three";
import { GLTFLoader } from "/assets/vendor/GLTFLoader.js";
import { clone } from "/assets/utils/SkeletonUtils.js";
import { latest } from "./combat-playback.mjs";
import { SpellEffects } from "./spell-effects.mjs";

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status}: ${url}`);
  return r.json();
}
export class GameplayScene {
  constructor(world, combat, height) {
    this.world = world;
    this.combat = combat;
    this.height = height;
    this.units = [];
    this.assets = new Map();
    this.active = new Map();
    this.pool = new Map();
    this.unsupported = {};
    this.unrenderedObjectSpawns = {};
    this.missiles = [];
    this.guides = new THREE.Group();
    world.add(this.guides);
  }
  async load() {
    const [registry, structures] = await Promise.all([
      json("/assets/units/registry.json"),
      json("/assets/structures.json"),
    ]);
    const structuresByHash = new Map(structures.map((s) => [s.nameHash, s]));
    const types = { 4: "melee", 5: "ranged", 6: "siege", 7: "super" };
    for (const event of this.combat.events) {
      let skin,
        spawn = { ...event };
      if (event.kind === "minion") {
        if (!types[event.minionType])
          throw Error(`Unknown minion type ${event.minionType}`);
        const first = this.combat.tracks.get(event.entityId)?.[0];
        if (!first) {
          this.unsupported.minionWithoutMovement =
            (this.unsupported.minionWithoutMovement ?? 0) + 1;
          continue;
        }
        // Team is inferred from recorded spawn-side coordinates until barracks identity is decoded.
        const team =
          first.waypoints[0][0] + first.waypoints[0][1] < 14850
            ? "order"
            : "chaos";
        skin = `characters/sru_${team}minion${types[event.minionType]}/skins/skin0`;
        spawn.position = [
          first.waypoints[0][0],
          this.height(...first.waypoints[0]),
          first.waypoints[0][1],
        ];
        spawn.visibleFrom = first.time;
      } else if (event.kind === "neutral")
        skin = `characters/${event.name.toLowerCase()}/skins/skin0`;
      else if (event.kind === "turret") {
        if (!event.name) continue; // Fountain lasers have a separate asset and presentation contract.
        const match = event.instanceName.match(/_(\d+)_\d+$/);
        if (!match)
          throw Error(`Unrecognized turret identity ${event.instanceName}`);
        const key = `{${Number(match[1]).toString(16).padStart(8, "0")}}`,
          binding = structuresByHash.get(key);
        if (!binding) throw Error(`Unbound turret placement ${key}`);
        skin = binding.skin.toLowerCase();
        spawn.position = binding.transform[3].slice(0, 3);
        spawn.transform = binding.transform;
      } else if (event.kind === "spawn") {
        skin = `characters/${event.name.toLowerCase()}/skins/skin0`;
        if (!registry[skin]) {
          this.unrenderedObjectSpawns[event.name] =
            (this.unrenderedObjectSpawns[event.name] ?? 0) + 1;
          continue;
        }
        spawn.position = [
          event.position[0],
          this.height(...event.position),
          event.position[1],
        ];
      } else continue;
      if (!registry[skin]) {
        this.unsupported[skin] = (this.unsupported[skin] ?? 0) + 1;
        continue;
      }
      this.units.push({ ...spawn, skin });
    }
    for (const skin of new Set(this.units.map((u) => u.skin))) {
      const definition = registry[skin];
      const gltf = await new GLTFLoader().loadAsync(
        `/assets/units/${definition.key}/model.glb`,
      );
      gltf.scene.traverse((object) => {
        if (object.isMesh) {
          const old = object.material;
          object.material = new THREE.MeshBasicMaterial({
            map: old.map,
            side: THREE.DoubleSide,
            alphaTest: 0.4,
          });
          old.dispose();
        }
      });
      this.assets.set(skin, {
        ...definition,
        gltf,
        clips: new Map(gltf.animations.map((c) => [c.name.toLowerCase(), c])),
      });
    }
    for (const e of this.combat.events.filter((e) => e.kind === "missile")) {
      if (e.speed <= 0) continue;
      const duration =
        Math.hypot(
          e.end[0] - e.start[0],
          e.end[1] - e.start[1],
          e.end[2] - e.start[2],
        ) / e.speed;
      const removal = this.combat.removals
        .get(e.entityId)
        ?.find((r) => r.time >= e.time);
      this.missiles.push({
        ...e,
        endTime: Math.min(e.time + duration, removal?.time ?? Infinity),
      });
    }
    this.missileGeometry = new THREE.BufferGeometry();
    this.missileGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(600 * 6), 3),
    );
    this.missileLines = new THREE.LineSegments(
      this.missileGeometry,
      new THREE.LineBasicMaterial({
        color: "#ffe29b",
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.missileLines.frustumCulled = false;
    this.guides.add(this.missileLines);
    this.spellEffects = new SpellEffects(this.world);
    await this.spellEffects.load();
    this.combat.spells = this.spellEffects.definition.spells;
    this.effectCoverage = {
      rendered: 0,
      total: this.missiles.length,
      unsupported: {},
    };
    for (const m of this.missiles) {
      if (this.spellEffects.effectFor(m)) this.effectCoverage.rendered++;
      else {
        const key = `${m.sourceName}:${m.missileHash}`;
        this.effectCoverage.unsupported[key] =
          (this.effectCoverage.unsupported[key] ?? 0) + 1;
      }
    }
  }
  acquire(unit) {
    const asset = this.assets.get(unit.skin),
      pool = this.pool.get(unit.skin) ?? [];
    if (pool.length) return pool.pop();
    const mesh = clone(asset.gltf.scene),
      group = new THREE.Group();
    mesh.scale.setScalar(asset.scale);
    group.add(mesh);
    this.world.add(group);
    return {
      skin: unit.skin,
      asset,
      mesh,
      group,
      mixer: new THREE.AnimationMixer(mesh),
      clip: null,
    };
  }
  update(time) {
    const desired = new Set();
    let corpses = 0;
    for (const unit of this.units) {
      if (time < (unit.visibleFrom ?? unit.time)) continue;
      const removal = latest(this.combat.removals.get(unit.entityId), time);
      if (removal && removal.time >= unit.time) continue;
      const state = this.combat.state(unit.entityId, time, unit);
      // Non-champion corpse persistence is a declared presentation approximation.
      if (!state.point || (state.dead && time - state.death.time > 4)) continue;
      desired.add(unit.entityId);
      if (!this.active.has(unit.entityId))
        this.active.set(unit.entityId, this.acquire(unit));
      const p = this.active.get(unit.entityId);
      p.group.visible = true;
      const [x, z] = state.point;
      if (state.dead) corpses++;
      p.group.position.set(x, unit.position?.[1] ?? 0, z);
      const action = this.combat.action(
        unit.entityId,
        time,
        p.asset.clips,
        p.asset.semantic,
        state,
      );
      const target = this.combat.facing(unit.entityId, time, action);
      if (target) p.mesh.rotation.y = Math.atan2(target[0] - x, target[1] - z);
      else if (state.movement)
        p.mesh.rotation.y = Math.atan2(...state.movement.direction);
      else if (unit.transform)
        p.mesh.rotation.y = Math.atan2(
          unit.transform[2][0],
          unit.transform[2][2],
        );
      else if (unit.facingPosition)
        p.mesh.rotation.y = Math.atan2(
          unit.facingPosition[0] - x,
          unit.facingPosition[2] - z,
        );
      const name = p.asset.semantic[state.moving ? "run" : "idle"][0];
      const clip =
        action?.clip ?? (name ? p.asset.clips.get(name.toLowerCase()) : null);
      if (clip) {
        if (p.clip !== clip) {
          p.mixer.stopAllAction();
          p.clip = clip;
          p.action = p.mixer.clipAction(clip);
          p.action.setLoop(THREE.LoopOnce, 1);
          p.action.clampWhenFinished = true;
          p.action.play();
        }
        p.action.paused = true;
        p.action.time = action?.phase ?? time % clip.duration;
        p.mixer.update(0);
      }
    }
    for (const [id, p] of this.active)
      if (!desired.has(id)) {
        p.group.visible = false;
        p.mixer.stopAllAction();
        p.clip = null;
        const skin = p.skin;
        if (!this.pool.has(skin)) this.pool.set(skin, []);
        this.pool.get(skin).push(p);
        this.active.delete(id);
      }
    const positions = this.missileGeometry.attributes.position.array;
    let count = 0;
    for (const m of this.missiles) {
      if (m.time > time || m.endTime < time || this.spellEffects.effectFor(m))
        continue;
      if (count >= 600) throw Error("Missile guide capacity exceeded");
      const duration =
        Math.hypot(...m.end.map((v, i) => v - m.start[i])) / m.speed;
      const phase = Math.min(1, (time - m.time) / duration),
        tail = Math.max(0, phase - 0.09);
      for (let i = 0; i < 3; i++) {
        positions[count * 6 + i] =
          m.start[i] + (m.end[i] - m.start[i]) * tail + (i === 1 ? 80 : 0);
        positions[count * 6 + 3 + i] =
          m.start[i] + (m.end[i] - m.start[i]) * phase + (i === 1 ? 80 : 0);
      }
      count++;
    }
    this.missileGeometry.setDrawRange(0, count * 2);
    this.missileGeometry.attributes.position.needsUpdate = true;
    this.spellEffects.update(time, this.missiles);
    this.counts = {
      units: desired.size,
      corpses,
      missiles: count,
      particles: this.spellEffects.visibleParticles,
      effects: this.spellEffects.visibleEffects,
    };
  }
  dispose() {
    const instances = [
      ...this.active.values(),
      ...[...this.pool.values()].flat(),
    ];
    for (const p of instances) {
      p.mixer.stopAllAction();
      p.mesh.traverse((object) => {
        if (object.isSkinnedMesh) object.skeleton.dispose();
      });
      this.world.remove(p.group);
    }
    for (const asset of this.assets.values())
      asset.gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    this.world.remove(this.guides);
    this.missileGeometry?.dispose();
    this.missileLines?.material.dispose();
    this.spellEffects?.dispose();
  }
}
