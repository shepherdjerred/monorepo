import * as THREE from "three";

// This renderer implements a documented subset of the static League VFX schema.
// Every instance is evaluated from absolute replay time, including random samples.
function sample(field, time, defaults) {
  if (!field) return defaults;
  let result = field.constantValue ?? defaults;
  const curve = field.dynamics;
  if (curve?.times?.length && curve.values?.length) {
    let i = 0;
    while (i + 1 < curve.times.length && curve.times[i + 1] <= time) i++;
    const j = Math.min(i + 1, curve.times.length - 1);
    const span = curve.times[j] - curve.times[i];
    const t = span
      ? THREE.MathUtils.clamp((time - curve.times[i]) / span, 0, 1)
      : 0;
    const a = curve.values[i],
      b = curve.values[j];
    const v = Array.isArray(a)
      ? a.map((x, k) => THREE.MathUtils.lerp(x, b[k], t))
      : THREE.MathUtils.lerp(a, b, t);
    result = Array.isArray(result)
      ? result.map((x, k) => x * v[k])
      : result * v;
  }
  return result;
}
function random(seed) {
  let x = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
function birthValue(field, defaults, seed) {
  const base = field?.constantValue ?? defaults;
  const tables = field?.dynamics?.probabilityTables;
  if (!tables) return base;
  const values = Array.isArray(base) ? [...base] : [base];
  const sampled = values.map((v, k) => {
    const table = tables[k];
    if (!table?.keyTimes?.length) return v;
    const r = random(seed + k * 137);
    let i = 0;
    while (i + 1 < table.keyTimes.length && table.keyTimes[i + 1] <= r) i++;
    const j = Math.min(i + 1, table.keyTimes.length - 1),
      span = table.keyTimes[j] - table.keyTimes[i];
    return (
      v *
      THREE.MathUtils.lerp(
        table.keyValues[i],
        table.keyValues[j],
        span ? (r - table.keyTimes[i]) / span : 0,
      )
    );
  });
  return Array.isArray(base) ? sampled : sampled[0];
}
export function missilePosition(m, time) {
  const duration = Math.hypot(...m.end.map((v, i) => v - m.start[i])) / m.speed;
  const phase =
    duration > 0 ? THREE.MathUtils.clamp((time - m.time) / duration, 0, 1) : 1;
  // Source height is a temporary approximation until height solver/bone bindings are reconstructed.
  return m.start.map(
    (v, i) =>
      v + (m.end[i] - v) * phase + (i === 1 ? m.source[1] - m.start[1] : 0),
  );
}
export class SpellEffects {
  constructor(world) {
    this.world = world;
    this.root = new THREE.Group();
    world.add(this.root);
    this.pools = new Map();
    this.textures = [];
    this.geometries = [];
    this.emitters = new Map();
  }
  async load() {
    const response = await fetch("/assets/effects/package.json");
    if (!response.ok) throw Error("Missing build-specific effect package");
    this.definition = await response.json();
    if (
      this.definition.schema !== 2 ||
      this.definition.build !== "16.14.794.5912"
    )
      throw Error("Effect package build mismatch");
    const textures = new Map(),
      meshes = new Map();
    for (const [id, definition] of Object.entries(this.definition.effects)) {
      const list = [];
      for (const e of definition.emitters) {
        if (!textures.has(e.textureFile)) {
          const texture = await new THREE.TextureLoader().loadAsync(
            `/assets/effects/${e.textureFile}`,
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          textures.set(e.textureFile, texture);
          this.textures.push(texture);
        }
        let geometry;
        if (e.meshFile) {
          if (!meshes.has(e.meshFile)) {
            const r = await fetch(`/assets/effects/${e.meshFile}`);
            if (!r.ok) throw Error("Missing effect mesh");
            const data = await r.json();
            const g = new THREE.BufferGeometry();
            g.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(data.positions, 3),
            );
            g.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
            meshes.set(e.meshFile, g);
            this.geometries.push(g);
          }
          geometry = meshes.get(e.meshFile);
        }
        const frames = [],
          [cols, rows] = e.texDiv ?? [1, 1];
        for (let f = 0; f < (e.numFrames ?? 1); f++) {
          const map = textures.get(e.textureFile).clone();
          map.repeat.set(1 / cols, 1 / rows);
          map.offset.set(
            (f % cols) / cols,
            1 - (Math.floor(f / cols) + 1) / rows,
          );
          frames.push(map);
          this.textures.push(map);
        }
        const primitive = e.primitive?.__type ?? "VfxPrimitiveCameraQuad";
        const emitter = {
          ...e,
          frames,
          geometry,
          trail: primitive.includes("Trail"),
        };
        list.push(emitter);
        this.pools.set(e.id, []);
      }
      this.emitters.set(id, list);
    }
  }
  effectFor(m) {
    const key = `${m.sourceName.toLowerCase()}:${m.missileHash}`;
    const id = this.definition.missiles[key];
    return id && this.emitters.get(id)?.length ? id : null;
  }
  particle(e, index) {
    const pool = this.pools.get(e.id);
    if (index < pool.length) return pool[index];
    if (index >= 2048)
      throw Error(`Particle capacity exceeded: ${e.emitterName}`);
    const settings = {
      map: e.frames[0],
      transparent: true,
      depthWrite: false,
      blending:
        e.blendMode === 4
          ? THREE.AdditiveBlending
          : e.blendMode === 3
            ? THREE.MultiplyBlending
            : THREE.NormalBlending,
    };
    let object;
    if (e.trail) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, size] of [
        ["position", 3],
        ["color", 4],
        ["uv", 2],
      ])
        geometry.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(34 * size), size),
        );
      const indices = [];
      for (let i = 0; i < 16; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geometry.setIndex(indices);
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          ...settings,
          side: THREE.DoubleSide,
          vertexColors: true,
        }),
      );
      this.geometries.push(geometry);
    } else if (e.geometry)
      object = new THREE.Mesh(
        e.geometry,
        new THREE.MeshBasicMaterial({ ...settings, side: THREE.DoubleSide }),
      );
    else object = new THREE.Sprite(new THREE.SpriteMaterial(settings));
    object.frustumCulled = false;
    this.root.add(object);
    pool.push(object);
    return object;
  }
  update(time, missiles) {
    for (const pool of this.pools.values())
      for (const p of pool) p.visible = false;
    const used = new Map();
    let particles = 0,
      instances = 0;
    for (const m of missiles) {
      if (time < m.time || time > m.endTime + 5) continue;
      const id = this.effectFor(m);
      if (!id) continue;
      let visible = false;
      for (const e of this.emitters.get(id)) {
        const life = e.particleLifetime.constantValue,
          delay = e.timeBeforeFirstEmission ?? 0;
        const start = m.time + delay,
          stop = m.endTime;
        if (time < start || time > stop + life) continue;
        const birthColor = e.birthColor?.constantValue ?? [1, 1, 1, 1];
        const scale = e.birthScale0?.constantValue ?? [1, 1, 1];
        if (e.trail) {
          const from = Math.max(start, time - life),
            to = Math.min(time, stop);
          if (from >= to) continue;
          const index = used.get(e.id) ?? 0,
            p = this.particle(e, index);
          used.set(e.id, index + 1);
          p.visible = true;
          particles++;
          visible = true;
          const dx = m.end[0] - m.start[0],
            dz = m.end[2] - m.start[2],
            length = Math.hypot(dx, dz);
          if (!length) {
            p.visible = false;
            continue;
          }
          for (let i = 0; i <= 16; i++) {
            const t = from + ((to - from) * i) / 16,
              age = (time - t) / life,
              point = missilePosition(m, t);
            const size = sample(e.scale0, age, [1, 1, 1]),
              color = sample(e.Color, age, [1, 1, 1, 1]);
            const half = (scale[0] * size[0]) / 2;
            for (let side = 0; side < 2; side++) {
              const n = i * 2 + side,
                sign = side ? 1 : -1;
              p.geometry.attributes.position.array.set(
                [
                  point[0] + (dz / length) * half * sign,
                  point[1],
                  point[2] - (dx / length) * half * sign,
                ],
                n * 3,
              );
              p.geometry.attributes.color.array.set(
                color.map((v, c) => v * birthColor[c]),
                n * 4,
              );
              p.geometry.attributes.uv.array.set([i / 16, side], n * 2);
            }
          }
          for (const attribute of Object.values(p.geometry.attributes))
            attribute.needsUpdate = true;
          continue;
        }
        const rate = e.rate?.constantValue ?? 1;
        const first = e.isSingleParticle
          ? 0
          : Math.max(0, Math.ceil((time - start - life) * rate));
        const last = e.isSingleParticle
          ? 0
          : Math.floor((Math.min(time, stop) - start) * rate);
        for (let n = first; n <= last; n++) {
          const birth = start + n / rate,
            age = (time - birth) / life;
          if (birth > stop || age < 0 || age >= 1) continue;
          const index = used.get(e.id) ?? 0,
            p = this.particle(e, index);
          used.set(e.id, index + 1);
          p.visible = true;
          particles++;
          visible = true;
          const seed = (m.entityId + n * 7919) >>> 0;
          const point = missilePosition(
            m,
            e.bindWeight?.constantValue === 1 ? Math.min(time, stop) : birth,
          );
          const yaw = Math.atan2(m.end[0] - m.start[0], m.end[2] - m.start[2]);
          const shapeOffset = e.SpawnShape?.emitOffset;
          const offset = Array.isArray(shapeOffset)
              ? shapeOffset
              : birthValue(shapeOffset, [0, 0, 0], seed + 71),
            velocity = birthValue(e.birthVelocity, [0, 0, 0], seed);
          const elapsed = time - birth;
          const local = offset.map((v, k) => v + velocity[k] * elapsed);
          p.position.set(
            point[0] + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw),
            point[1] + local[1],
            point[2] - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw),
          );
          const size = sample(e.scale0, age, [1, 1, 1]),
            color = sample(e.Color, age, [1, 1, 1, 1]);
          const birthScale = birthValue(e.birthScale0, [1, 1, 1], seed + 17);
          p.scale.set(...birthScale.map((v, k) => v * size[k]));
          const rotation = birthValue(e.birthRotation0, [0, 0, 0], seed + 29),
            rotationSpeed = birthValue(
              e.birthRotationalVelocity0,
              [0, 0, 0],
              seed + 53,
            );
          if (p.isMesh)
            p.rotation.set(
              ...rotation.map(
                (v, k) => ((v + rotationSpeed[k] * elapsed) * Math.PI) / 180,
              ),
            );
          if (p.isMesh && e.particleIsLocalOrientation) p.rotation.y += yaw;
          if (p.isSprite)
            p.material.rotation =
              ((rotation[2] + rotationSpeed[2] * elapsed) * Math.PI) / 180;
          p.material.color.setRGB(
            ...color.slice(0, 3).map((v, k) => v * birthColor[k]),
          );
          p.material.opacity = color[3] * birthColor[3];
          const frame =
            (e.isRandomStartFrame
              ? Math.floor(random(seed) * e.frames.length)
              : 0) + Math.floor(elapsed * (e.frameRate ?? 0));
          p.material.map = e.frames[frame % e.frames.length];
        }
      }
      if (visible) instances++;
    }
    this.visibleParticles = particles;
    this.visibleEffects = instances;
  }
  dispose() {
    this.world.remove(this.root);
    for (const pool of this.pools.values())
      for (const p of pool) p.material.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
  }
}
