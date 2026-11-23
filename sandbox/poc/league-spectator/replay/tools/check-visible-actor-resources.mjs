import * as THREE from "three";
import { clone } from "/assets/utils/SkeletonUtils.js";
import { createLatestVisibleActorOwnership } from "../latest-visible-actor-ownership.mjs";

// Isolated browser resource control, not a replay rendering/fidelity claim.
// Uses the exact skinned-clone library and ownership boundary used by the viewer.
export function checkVisibleActorResources() {
  const geometry = new THREE.BufferGeometry(),
    material = new THREE.MeshBasicMaterial(),
    prototype = new THREE.Group(),
    bone = new THREE.Bone(),
    mesh = new THREE.SkinnedMesh(geometry, material);
  bone.name = "original-joint";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  prototype.add(mesh);
  let disposedGeometry = 0,
    disposedMaterial = 0,
    created = 0,
    released = 0,
    peak = 0;
  geometry.addEventListener("dispose", () => disposedGeometry++);
  material.addEventListener("dispose", () => disposedMaterial++);
  const entries = Array.from({ length: 2379 }, (_, index) => ({ index })),
    live = new Set();
  const owner = createLatestVisibleActorOwnership({
    entries,
    visible: (entry, time) => entry.index <= time && entry.index > time - 2,
    create(entry) {
      const group = clone(prototype),
        actor = group.children[0];
      if (
        actor.geometry !== geometry ||
        actor.material !== material ||
        actor.skeleton === mesh.skeleton ||
        actor.skeleton.bones[0] === bone
      )
        throw Error(
          "Skinned actor clone did not separate pose from shared assets",
        );
      actor.skeleton.computeBoneTexture();
      const texture = actor.skeleton.boneTexture;
      actor.skeleton.bones[0].position.x = entry.index + 10;
      if (bone.position.x !== 0)
        throw Error("Instance pose mutated shared prototype");
      const instance = { group, actor, texture, textureDisposed: false };
      texture.addEventListener("dispose", () => {
        instance.textureDisposed = true;
      });
      created++;
      live.add(instance);
      peak = Math.max(peak, live.size);
      return instance;
    },
    release(instance) {
      instance.actor.skeleton.dispose();
      if (
        !instance.textureDisposed ||
        instance.actor.skeleton.boneTexture !== null
      )
        throw Error("Retired actor retained its bone texture");
      if (!live.delete(instance)) throw Error("Actor instance released twice");
      released++;
    },
  });
  for (const time of [0, 100, 2378, 1000, 0]) {
    owner.reconcile(time);
    if (owner.size !== (time === 0 ? 1 : 2))
      throw Error("Wrong oracle-visible actor count");
    if (disposedGeometry || disposedMaterial)
      throw Error("Instance retirement disposed shared asset");
  }
  owner.dispose();
  if (live.size || created !== released)
    throw Error("Actor disposal leaked an instance");
  geometry.dispose();
  material.dispose();
  mesh.skeleton.dispose();
  return {
    records: entries.length,
    created,
    released,
    peakInstances: peak,
    sharedGeometryDisposals: disposedGeometry,
    sharedMaterialDisposals: disposedMaterial,
    backwardsPoseRestored: bone.position.x === 0,
  };
}
