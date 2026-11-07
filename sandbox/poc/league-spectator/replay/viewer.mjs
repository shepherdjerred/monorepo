import * as THREE from "three";
import { GLTFLoader } from "/assets/vendor/GLTFLoader.js";
import { OrbitControls } from "/assets/vendor/OrbitControls.js";
import { indexMovement, sampleMovement, PLAYER_START } from "./playback.mjs";
import { CombatPlayback } from "./combat-playback.mjs";
import { ReplayAudio } from "./replay-audio.mjs";
import { GameplayScene } from "./gameplay-scene.mjs";

const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#111b22");
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(42, 1, 5, 60000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 400;
controls.maxDistance = 30000;
const world = new THREE.Group();
world.scale.z = -1;
scene.add(world);
scene.add(new THREE.HemisphereLight(0xffffff, 0x637b68, 2));
const sun = new THREE.DirectionalLight(0xffefd7, 2);
sun.position.set(-1000, 6000, 2000);
scene.add(sun);
let replay = null,
  tracks = null,
  animationTracks = null,
  time = 0,
  playing = false,
  speed = 1,
  follow = null,
  clipStart = 180,
  clipEnd = 210,
  clipMode = false;
let worker = null;
let replayAudio = null;
let combat = null,
  gameplayScene = null;
const champions = [],
  groundMeshes = [];
const textureLoader = new THREE.TextureLoader();
const fmt = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function overview() {
  follow = null;
  controls.target.set(7400, 0, -7400);
  camera.position.set(7400, 16000, 7000);
  controls.update();
  $("camera-status").textContent = "Free camera · full map";
}
overview();
function resize() {
  const bounds = $("viewport").getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($("viewport"));
resize();
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${response.status} ${url}`);
  return response.json();
}
async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${response.status} ${url}`);
  return response.arrayBuffer();
}
function fail(error) {
  console.error(error);
  $("loading").textContent = error.message;
  $("loading").style.display = "block";
  $("status").textContent = error.message;
  $("load").disabled = false;
  $("file").disabled = false;
}

async function loadMap() {
  const [description, buffer, bindingData] = await Promise.all([
    json("/assets/map-srx/map.json"),
    bytes("/assets/map-srx/map.bin"),
    json("/assets/map-srx/bindings.json"),
  ]);
  const textureCache = new Map(),
    materials = new Map();
  for (const [name, binding] of Object.entries(bindingData.bindings)) {
    if (!textureCache.has(binding.texture)) {
      const texture = await textureLoader.loadAsync(
        `/assets/map-srx/${binding.texture}`,
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      textureCache.set(binding.texture, texture);
    }
    materials.set(
      name,
      new THREE.MeshBasicMaterial({
        map: textureCache.get(binding.texture),
        side: THREE.DoubleSide,
        alphaTest: binding.alphaTest,
      }),
    );
  }
  for (const item of description.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(buffer, item.positionOffset, item.vertexCount * 3),
        3,
      ),
    );
    if (item.hasUv)
      geometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(buffer, item.uvOffset, item.vertexCount * 2),
          2,
        ),
      );
    geometry.setIndex(
      new THREE.BufferAttribute(
        new Uint32Array(buffer, item.indexOffset, item.indexCount),
        1,
      ),
    );
    const submeshes = item.submeshes.filter(
      (s) => !bindingData.unsupported[s.material],
    );
    if (!submeshes.length) {
      geometry.dispose();
      continue;
    }
    const meshMaterials = submeshes.map((s) => {
      const m = materials.get(s.material);
      if (!m) throw Error(`Missing map material ${s.material}`);
      return m;
    });
    submeshes.forEach((s, i) => geometry.addGroup(s.start, s.count, i));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, meshMaterials);
    world.add(mesh);
    groundMeshes.push(mesh);
  }
  $("render-status").textContent =
    `${description.meshes.length.toLocaleString()} SRX map meshes · WebGL2`;
  $("loading").style.display = "none";
  return {
    meshes: description.meshes.length,
    materials: materials.size,
    textures: textureCache.size,
  };
}

function healthSprite(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.scale.set(280, 35, 1);
  sprite.position.y = 250;
  sprite.renderOrder = 21;
  sprite.userData = { canvas, texture, color, key: null };
  return sprite;
}
function updateHealth(sprite, stats, dead) {
  sprite.visible = Boolean(stats && stats.maxHealth > 0 && !dead);
  if (!sprite.visible) return;
  const shield =
    (stats.allShield ?? 0) +
    (stats.physicalShield ?? 0) +
    (stats.magicalShield ?? 0);
  const key = `${Math.round(stats.currentHealth)}:${Math.round(stats.maxHealth)}:${Math.round(shield)}`;
  if (sprite.userData.key === key) return;
  sprite.userData.key = key;
  const ctx = sprite.userData.canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 32);
  ctx.fillStyle = "#090c10";
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = "#353d43";
  ctx.fillRect(3, 3, 250, 26);
  const max = Math.max(stats.maxHealth, stats.currentHealth + shield),
    hp = (Math.max(0, stats.currentHealth) / max) * 250;
  ctx.fillStyle = sprite.userData.color;
  ctx.fillRect(3, 3, hp, 26);
  ctx.fillStyle = "#e1edff";
  ctx.fillRect(3 + hp, 3, Math.min(250 - hp, (shield / max) * 250), 26);
  ctx.fillStyle = "#10232a99";
  for (let value = 100; value < max; value += 100)
    ctx.fillRect(3 + (250 * value) / max, 3, 1, 26);
  sprite.userData.texture.needsUpdate = true;
}
function labelSprite(name, color) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a121bcc";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 27px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 42);
  const texture = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.scale.set(340, 85, 1);
  sprite.position.y = 300;
  sprite.renderOrder = 20;
  return sprite;
}

async function loadChampions(roster) {
  for (const champ of champions) {
    world.remove(champ.group, champ.trail);
    champ.mixer.stopAllAction();
    champ.mixer.uncacheRoot(champ.mesh);
    champ.group.traverse((object) => {
      object.geometry?.dispose();
      if (object.isSkinnedMesh) object.skeleton.dispose();
      if (object.material) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    champ.trail.geometry.dispose();
    champ.trail.material.dispose();
  }
  champions.length = 0;
  $("roster").replaceChildren();
  await Promise.all(
    roster.map(async (p, index) => {
      const key = p.champion.toLowerCase();
      const gltf = await new GLTFLoader().loadAsync(
        `/assets/champions/${key}/model.glb`,
      );
      const mesh = gltf.scene;
      mesh.traverse((object) => {
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
      const mixer = new THREE.AnimationMixer(mesh);
      const clips = new Map(
        gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]),
      );
      const locomotion = await json(`/assets/champions/${key}/locomotion.json`);
      const combatConfig = await json(`/assets/champions/${key}/combat.json`);
      mesh.scale.setScalar(combatConfig.scale);
      for (const name of Object.values(locomotion))
        if (!clips.has(name.toLowerCase()))
          throw Error(`Missing locomotion clip ${key}/${name}`);
      const group = new THREE.Group();
      group.add(mesh);
      const color = p.team === 100 ? "#70baff" : "#ff8199";
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(85, 100, 48),
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 5;
      ring.renderOrder = 10;
      group.add(ring);
      const label = labelSprite(p.champion, color);
      group.add(label);
      const health = healthSprite(color);
      group.add(health);
      world.add(group);
      const trail = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.8,
          depthTest: false,
        }),
      );
      world.add(trail);
      trail.visible = false;
      trail.renderOrder = 15;
      champions.push({
        index,
        group,
        mesh,
        mixer,
        clips,
        locomotion,
        combatConfig,
        health,
        ring,
        activeClip: null,
        trail,
        label,
        lastEvent: null,
        champion: p.champion,
        team: p.team,
      });
    }),
  );
  champions.sort((a, b) => a.index - b.index);
  for (const p of champions) {
    const button = document.createElement("button");
    button.textContent = p.champion;
    button.className = p.team === 100 ? "" : "red";
    button.onclick = () => focusChampion(p.index);
    $("roster").append(button);
  }
}

const raycaster = new THREE.Raycaster();
function terrainHeight(x, z) {
  raycaster.set(new THREE.Vector3(x, 3000, -z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(groundMeshes, false);
  return hits.find((h) => h.point.y < 450)?.point.y ?? 0;
}
function focusChampion(index) {
  follow = index;
  const p = champions.find((p) => p.index === index);
  if (!p) return;
  const pos = p.group.position;
  const target = new THREE.Vector3(pos.x, pos.y, -pos.z);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(0, 2200, 2600));
  controls.update();
  $("camera-status").textContent = `Following ${p.champion}`;
  for (const [i, button] of [...$("roster").children].entries())
    button.classList.toggle("active", i === index);
}
function focusPoint(point, label) {
  follow = null;
  controls.target.set(point[0], point[1], -point[2]);
  camera.position.copy(controls.target).add(new THREE.Vector3(0, 1600, 1900));
  controls.update();
  $("camera-status").textContent = label;
  for (const button of $("roster").children) button.classList.remove("active");
}
function focusAction() {
  const states = champions
    .map((p) => ({
      p,
      state: sampleMovement(tracks?.get(PLAYER_START + p.index), time),
    }))
    .filter((p) => p.state);
  let best = states[0],
    score = -1;
  for (const item of states) {
    const nearby = states.filter(
      (other) =>
        other.p.team !== item.p.team &&
        Math.hypot(
          other.state.point[0] - item.state.point[0],
          other.state.point[1] - item.state.point[1],
        ) < 2200,
    ).length;
    if (nearby > score) {
      score = nearby;
      best = item;
    }
  }
  if (best) focusChampion(best.p.index);
}
let inspectorKey = "";
function updateInspector() {
  if (!combat || !gameplayScene) return;
  const key = `${follow}:${Math.floor(time * 4)}`;
  if (key === inspectorKey) return;
  inspectorKey = key;
  const target = $("unit-state");
  target.replaceChildren();
  if (follow === null) {
    target.textContent = "Follow a champion to inspect recorded buffs.";
    return;
  }
  const champion = champions.find((p) => p.index === follow);
  const title = document.createElement("strong");
  title.textContent =
    champion.champion + (champion.dead ? " · dead" : " · alive");
  target.append(title);
  const stats = combat.stats(PLAYER_START + follow, time);
  if (stats) {
    const line = document.createElement("p");
    line.textContent = `HP ${Math.round(stats.currentHealth)} / ${Math.round(stats.maxHealth)} · shield ${Math.round((stats.allShield ?? 0) + (stats.physicalShield ?? 0) + (stats.magicalShield ?? 0))}`;
    target.append(line);
  }
  const buffs = combat.buffs(PLAYER_START + follow, time);
  const list = document.createElement("ul");
  let unnamed = 0;
  for (const buff of buffs) {
    const item = document.createElement("li");
    const name = gameplayScene.spellEffects.definition.names[buff.nameHash];
    if (!name) {
      unnamed++;
      continue;
    }
    item.textContent = `${name}${buff.count > 1 ? ` ×${buff.count}` : ""}`;
    list.append(item);
  }
  if (!buffs.length) {
    const item = document.createElement("li");
    item.textContent = "No tracked buffs";
    list.append(item);
  }
  if (unnamed) {
    const item = document.createElement("li");
    item.textContent = `${unnamed} unnamed buffs (hashes in diagnostics)`;
    list.append(item);
  }
  target.append(list);
}
function updateScene() {
  for (const p of champions) {
    const id = PLAYER_START + p.index;
    const combatState = combat.state(id, time);
    const movement = combatState.movement;
    const state = movement && {
      ...movement,
      point: combatState.point,
      moving: combatState.moving,
    };
    p.group.visible = Boolean(state);
    if (!state) continue;
    const [x, z] = state.point;
    if (p.lastEvent !== state.event) {
      p.height = terrainHeight(...state.event.waypoints[0]);
      p.lastEvent = state.event;
      const linePoints = state.event.waypoints.map(
        (q) => new THREE.Vector3(q[0], p.height + 10, q[1]),
      );
      p.trail.geometry.dispose();
      p.trail.geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    }
    p.group.position.set(x, p.height, z);
    p.mesh.rotation.y = Math.atan2(state.direction[0], state.direction[1]);
    const combatAction = combat.action(
      id,
      time,
      p.clips,
      p.combatConfig.semantic,
      combatState,
    );
    const aim = combat.facing(id, time, combatAction);
    if (aim && Math.hypot(aim[0] - x, aim[1] - z) > 1)
      p.mesh.rotation.y = Math.atan2(aim[0] - x, aim[1] - z);
    p.label.visible = p.ring.visible = !combatState.dead;
    p.dead = Boolean(combatState.dead);
    updateHealth(p.health, combat.stats(id, time), p.dead);
    p.trail.visible = follow === p.index;
    const animationTrack = animationTracks.get(PLAYER_START + p.index) || [];
    let lo = 0,
      hi = animationTrack.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (animationTrack[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    const event = animationTrack[lo - 1];
    const packetClip = event && p.clips.get(event.animationName.toLowerCase());
    // Exact name only. Compound graph logic and packet rate semantics are unverified.
    const packetActive = packetClip && time - event.time < packetClip.duration;
    const clip =
      combatAction?.clip ??
      (packetActive
        ? packetClip
        : p.clips.get(
            p.locomotion[state.moving ? "run" : "idle"].toLowerCase(),
          ));
    const phase =
      combatAction?.phase ??
      (packetActive ? time - event.time : time % clip.duration);
    if (p.activeClip !== clip) {
      p.mixer.stopAllAction();
      p.activeClip = clip;
      p.action = p.mixer.clipAction(clip);
      p.action.setLoop(THREE.LoopOnce, 1);
      p.action.clampWhenFinished = true;
      p.action.play();
    }
    p.action.paused = true;
    p.action.time = phase;
    p.mixer.update(0);
    p.animationStatus = combatAction
      ? `decoded ${combatAction.kind}: ${clip.name}`
      : packetActive
        ? `packet: ${event.animationName}`
        : `movement-derived: ${clip.name}`;
  }
  gameplayScene?.update(time);
  if (gameplayScene)
    $("world-count").textContent =
      `${gameplayScene.counts.units} NPCs · ${gameplayScene.counts.corpses + champions.filter((p) => p.dead).length} corpses · ${gameplayScene.counts.missiles} missile guides · ${gameplayScene.counts.particles} particles · ${gameplayScene.counts.effects} effects`;
  updateInspector();
  if (follow !== null) {
    const p = champions.find((p) => p.index === follow);
    if (p?.group.visible) {
      const target = new THREE.Vector3(
        p.group.position.x,
        p.group.position.y,
        -p.group.position.z,
      );
      const delta = target.clone().sub(controls.target);
      camera.position.add(delta);
      controls.target.copy(target);
    }
  }
  $("time").textContent = fmt(time);
  $("seek").value = time;
}

async function openReplay(buffer) {
  $("load").disabled = true;
  $("file").disabled = true;
  delete window.replaySpike;
  replay = null;
  replayAudio?.dispose();
  replayAudio = null;
  $("audio").disabled = true;
  $("audio").textContent = "Enable sound";
  gameplayScene?.dispose();
  gameplayScene = null;
  combat = null;
  follow = null;
  playing = false;
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play replay");
  $("play").disabled = true;
  $("seek").disabled = true;
  $("status").textContent = "Decoding original ROFL in a browser worker…";
  $("loading").style.display = "block";
  $("loading").textContent = "Decoding replay packets…";
  worker?.terminate();
  worker = new Worker("/worker.mjs", { type: "module" });
  worker.onerror = (event) =>
    fail(Error(event.message || "Replay worker failed"));
  worker.onmessage = async ({ data }) => {
    if (data.type === "error") {
      fail(Error(data.message));
      return;
    }
    if (data.type === "progress") {
      $("status").textContent =
        data.progress.message ??
        `Reading gameplay: ${data.progress.blocks.toLocaleString()} blocks`;
      $("loading").textContent = $("status").textContent;
      return;
    }
    if (data.type !== "ready") return;
    try {
      replay = data.result;
      tracks = indexMovement(replay.events);
      animationTracks = indexMovement(replay.animations);
      combat = new CombatPlayback(replay.gameplay, tracks);
      $("blocks").textContent = replay.blocks.toLocaleString();
      $("packets").textContent = replay.movementPackets.toLocaleString();
      $("records").textContent = replay.events.length.toLocaleString();
      $("decode").textContent = `${(replay.decodeMs / 1000).toFixed(2)} s`;
      $("seek").max = replay.duration;
      $("duration").textContent = fmt(replay.duration);
      $("subtitle").textContent =
        `KR_8305643709 · Summoner’s Rift · ${fmt(replay.duration)} · ten champions`;
      $("loading").textContent = "Loading champion meshes…";
      await loadChampions(replay.roster);
      $("loading").textContent =
        "Loading minions, structures, and neutral monsters…";
      gameplayScene = new GameplayScene(world, combat, terrainHeight);
      await gameplayScene.load();
      replayAudio = new ReplayAudio(replay, combat);
      await replayAudio.load();
      $("audio").disabled = false;
      const unmatched = {};
      let mapped = 0;
      for (const event of replay.animations) {
        const champion = champions[event.entityId - PLAYER_START];
        if (champion.clips.has(event.animationName.toLowerCase())) mapped++;
        else {
          const key = `${champion.champion}/${event.animationName}`;
          unmatched[key] = (unmatched[key] || 0) + 1;
        }
      }
      replay.animationCoverage = {
        mapped,
        total: replay.animations.length,
        unmatched,
      };
      $("clip-coverage").textContent =
        `${mapped.toLocaleString()} of ${replay.animations.length.toLocaleString()} animation events map to atomic clips. Unmapped names require more animation-graph reconstruction and are listed in diagnostics.`;
      const bins = new Map();
      for (const t of replay.castTimes) {
        if (t < 120 || t > replay.duration - 30) continue;
        const b = Math.floor(t / 30) * 30;
        bins.set(b, (bins.get(b) || 0) + 1);
      }
      clipStart =
        [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 180;
      clipEnd = clipStart + 30;
      replayAudio?.reset();
      time = clipStart;
      updateScene();
      focusAction();
      $("loading").style.display = "none";
      $("play").disabled = false;
      $("seek").disabled = false;
      $("load").disabled = false;
      $("file").disabled = false;
      const parity =
        replay.movementDigest ===
        "632d95de2cba6aced80eece2240646880e3b3c05ed2003cdb4a7b3eec8346e69";
      if (!parity) throw Error("Movement output does not match native oracle");
      $("status").textContent =
        `${replay.gameplay.filter((e) => e.kind === "attack").length.toLocaleString()} attacks · ${replay.gameplay.filter((e) => e.kind === "cast").length.toLocaleString()} casts · 34 deaths and respawns decoded in this browser. Animation selection and effects remain approximate.`;
      $("animation-count").textContent =
        replay.animations.length.toLocaleString();
      window.replaySpike = {
        summary: () => ({
          time,
          playing,
          follow,
          clipStart,
          clipEnd,
          build: replay.build,
          packets: replay.movementPackets,
          digest: replay.movementDigest,
          gameplayEvents: replay.gameplay.length,
          world: gameplayScene.counts,
          unsupported: gameplayScene.unsupported,
          unrenderedObjectSpawns: gameplayScene.unrenderedObjectSpawns,
          effects: gameplayScene.effectCoverage,
          audio: {
            enabled: replayAudio.enabled,
            events: replayAudio.events.length,
            scheduled: replayAudio.scheduled,
          },
        }),
        seek: (t) => {
          if (!Number.isFinite(t) || t < 0 || t > replay.duration)
            throw Error("Invalid seek");
          replayAudio?.reset();
          time = t;
          updateScene();
        },
        positions: () =>
          champions.map((p) => ({
            champion: p.champion,
            x: p.group.position.x,
            y: p.group.position.y,
            z: p.group.position.z,
            facing: p.mesh.rotation.y,
            animation: p.animationStatus,
            clipTime: p.action?.time,
            dead: p.dead,
          })),
        poses: () =>
          champions.map((p) => {
            let bones;
            p.mesh.traverse((object) => {
              if (object.isSkinnedMesh && !bones) bones = object.skeleton.bones;
            });
            return bones.map((bone) => [
              ...bone.position.toArray(),
              ...bone.quaternion.toArray(),
              ...bone.scale.toArray(),
            ]);
          }),
        health: () =>
          champions.map((p) => ({
            champion: p.champion,
            ...combat.stats(PLAYER_START + p.index, time),
          })),
        buffs: () =>
          champions.map((p) => ({
            champion: p.champion,
            buffs: combat.buffs(PLAYER_START + p.index, time),
          })),
        effectExamples: () =>
          gameplayScene.missiles
            .filter((m) => gameplayScene.spellEffects.effectFor(m))
            .map((m) => ({
              time: m.time,
              source: m.sourceName,
              hash: m.missileHash,
            })),
        overview,
        focusChampion,
        worldSnapshot: () =>
          [...gameplayScene.active]
            .sort(([a], [b]) => a - b)
            .map(([id, p]) => ({
              id,
              position: p.group.position.toArray(),
              facing: p.mesh.rotation.y,
              clip: p.clip?.name,
              phase: p.action?.time,
            })),
      };
    } catch (error) {
      fail(error);
    }
  };
  worker.postMessage({ buffer }, [buffer]);
}
$("load").onclick = async () => {
  try {
    await openReplay(await bytes("/fixture.rofl"));
  } catch (error) {
    fail(error);
  }
};
$("file").onchange = async () => {
  try {
    const file = $("file").files[0];
    if (file?.size > 512 * 1024 * 1024)
      throw Error("Replay exceeds 512 MiB limit");
    if (file) await openReplay(await file.arrayBuffer());
  } catch (error) {
    fail(error);
  }
};
$("audio").onclick = async () => {
  if (!replayAudio) return;
  $("audio").disabled = true;
  try {
    if (replayAudio.enabled) replayAudio.mute();
    else await replayAudio.enable();
    $("audio").textContent = replayAudio.enabled
      ? "Mute sound"
      : "Enable sound";
  } catch (error) {
    fail(error);
  } finally {
    $("audio").disabled = false;
  }
};
$("play").onclick = () => {
  playing = !playing;
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause replay" : "Play replay",
  );
};
$("seek").oninput = () => {
  replayAudio?.reset();
  clipMode = false;
  time = Number($("seek").value);
  updateScene();
};
$("speed").onchange = () => {
  speed = Number($("speed").value);
};
$("reset").onclick = overview;
$("focus").onclick = focusAction;
$("clip").onclick = () => {
  if (!replay) return;
  replayAudio?.reset();
  time = clipStart;
  clipMode = true;
  updateScene();
  focusAction();
};
function jump(timeValue, index) {
  if (!replay) return;
  playing = false;
  clipMode = false;
  replayAudio?.reset();
  time = timeValue;
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play replay");
  updateScene();
  focusChampion(index);
}
$("demo-lane").onclick = () => jump(481.2, 2);
$("demo-death").onclick = () => jump(53.5, 0);
$("demo-jungle").onclick = () => {
  if (!replay) return;
  const spawn = replay.gameplay.find(
    (e) => e.kind === "neutral" && e.name === "SRU_Red",
  );
  if (!spawn) throw Error("Supported jungle demonstration missing");
  jump(spawn.time + 1, 0);
  focusPoint(spawn.position, "Red Brambleback · recorded spawn");
};
$("demo-spell").onclick = () => {
  if (!replay) return;
  const missile = replay.gameplay.find(
    (e) =>
      e.kind === "missile" &&
      e.missileHash === 95130789 &&
      e.sourceName === "Ryze" &&
      e.time > 120,
  );
  if (!missile) throw Error("Supported Ryze Q demonstration missing");
  jump(missile.time + 0.15, 7);
};
$("demo-effects").onclick = () => {
  if (!replay) return;
  const choices = gameplayScene.missiles.filter(
    (m) =>
      m.time > 120 &&
      ["Talon", "Katarina", "KSante", "DrMundo", "Shen", "Belveth"].includes(
        m.sourceName,
      ) &&
      gameplayScene.spellEffects.effectFor(m),
  );
  const sources = [...new Set(choices.map((m) => m.sourceName))];
  const name = sources[effectExampleIndex++ % sources.length];
  const missile = choices.find(
    (m) => m.sourceName === name && m.endTime - m.time > 0.15,
  );
  if (!missile) throw Error(`No effect example for ${name}`);
  const champ = champions.find(
    (p) => p.champion.toLowerCase() === name.toLowerCase(),
  );
  jump(
    missile.time + Math.min(0.2, (missile.endTime - missile.time) / 2),
    champ.index,
  );
  $("demo-effects").textContent = `Next effect · ${name}`;
};
let effectExampleIndex = 0;
$("demo-ward").onclick = () => {
  if (!replay) return;
  const unit = gameplayScene.units.find(
    (u) => u.name === "SightWard" && u.time > 120,
  );
  if (!unit) throw Error("Ward example missing");
  jump(unit.time + 0.2, 0);
  focusPoint(unit.position, "Ward · recorded placement");
};
$("diagnostics").onclick = () => {
  if (!replay) return;
  const { events, ...summary } = replay;
  const blob = new Blob(
    [
      JSON.stringify(
        {
          ...summary,
          rendering: {
            unsupportedUnits: gameplayScene.unsupported,
            audio: {
              limitations: replayAudio.definition.limitations,
              omittedEvents: replayAudio.definition.omittedEvents,
            },
            unrenderedObjectSpawns: gameplayScene.unrenderedObjectSpawns,
            particleSubset: {
              coverage: gameplayScene.effectCoverage,
              effects: Object.fromEntries(
                Object.entries(
                  gameplayScene.spellEffects.definition.effects,
                ).map(([k, v]) => [k, { omittedEmitters: v.omittedEmitters }]),
              ),
              limitations: gameplayScene.spellEffects.definition.limitations,
            },
          },
          gaps: [
            "Base skins; movement-derived locomotion; exact-name animation clips at unit rate",
            "Diffuse-only materials",
            "Combat animations use approximate graph selection and timing",
            "Asset-bound missile effects use a partial emitter interpreter; unsupported missiles retain trajectory guides",
            "Non-champion corpses persist four seconds; minion team inferred from spawn side",
            "No NPC health, team visibility or equipped skin-state reconstruction",
            "Relative waypoint semantics require reference validation",
          ],
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "replay-spike-diagnostics.json";
  a.click();
  URL.revokeObjectURL(url);
};
controls.addEventListener("start", () => {
  follow = null;
  $("camera-status").textContent = "Free camera";
});
let previous = performance.now();
function frame(now) {
  const dt = Math.min((now - previous) / 1000, 0.25);
  previous = now;
  if (playing && replay) {
    time = Math.min(time + dt * speed, clipMode ? clipEnd : replay.duration);
    if (time >= (clipMode ? clipEnd : replay.duration)) {
      playing = false;
      $("play").textContent = "▶";
      $("play").setAttribute("aria-label", "Play replay");
    }
  }
  if (replay && window.replaySpike) updateScene();
  controls.update();
  replayAudio?.update(time, playing, speed, [
    controls.target.x,
    -controls.target.z,
  ]);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
loadMap().catch(fail);
