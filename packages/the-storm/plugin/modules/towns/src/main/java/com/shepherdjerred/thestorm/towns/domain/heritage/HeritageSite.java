package com.shepherdjerred.thestorm.towns.domain.heritage;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Immutable archive protection. Town membership and claim flags cannot change these rights. */
public record HeritageSite(
    String id,
    String name,
    Kind kind,
    String activeTownName,
    String world,
    RegionProfile profile,
    Set<Chunk> protectedChunks,
    List<Cuboid> protectedAreas,
    Set<Chunk> editingChunks,
    List<Editor> editors,
    String provenance) {

  public enum Kind {
    PLAYER,
    SERVER,
    HERITAGE
  }

  public record Chunk(int x, int z) {}

  public record Editor(UUID player, String name) {
    public Editor {
      if (name.isBlank()) throw new IllegalArgumentException("heritage editor needs a name");
    }
  }

  public HeritageSite {
    protectedChunks = Set.copyOf(protectedChunks);
    protectedAreas = List.copyOf(protectedAreas);
    editingChunks = Set.copyOf(editingChunks);
    editors = List.copyOf(editors);
    if (!id.matches("[a-z0-9_-]{1,32}")
        || name.isBlank()
        || world.isBlank()
        || provenance.isBlank()) {
      throw new IllegalArgumentException("heritage site needs an id, name, world and provenance");
    }
    if (protectedChunks.isEmpty() && protectedAreas.isEmpty()) {
      throw new IllegalArgumentException("heritage site has no protected footprint: " + id);
    }
    if (!protectedChunks.containsAll(editingChunks)
        || (editors.isEmpty() && !editingChunks.isEmpty())) {
      throw new IllegalArgumentException("heritage editing footprint is not proven: " + id);
    }
    if (kind == Kind.PLAYER && (activeTownName.isBlank() || editors.size() != 1)) {
      throw new IllegalArgumentException("active heritage town needs one proven mayor: " + id);
    }
    for (var area : protectedAreas) {
      if (!area.world().equals(world) || area.from().y() != -64 || area.to().y() != 319) {
        throw new IllegalArgumentException(
            "heritage areas must cover the full world height: " + id);
      }
    }
    var identities = new HashSet<UUID>();
    for (var editor : editors) {
      if (!identities.add(editor.player())) {
        throw new IllegalArgumentException("duplicate heritage editor: " + id);
      }
    }
  }

  public boolean contains(int x, int y, int z) {
    return y >= -64
        && y <= 319
        && (protectedChunks.contains(new Chunk(x >> 4, z >> 4))
            || protectedAreas.stream().anyMatch(area -> area.contains(world, x, y, z)));
  }

  /** Stable imported town identity; display-name edits never detach the public directory. */
  public Optional<UUID> activeTownId() {
    return activeTownName.isBlank()
        ? Optional.empty()
        : Optional.of(
            UUID.nameUUIDFromBytes(
                ("the-storm:heritage-town:v1:" + id)
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  public Set<UUID> editorsAt(int x, int z) {
    if (!editingChunks.contains(new Chunk(x >> 4, z >> 4))) return Set.of();
    var result = new HashSet<UUID>();
    editors.forEach(editor -> result.add(editor.player()));
    return Set.copyOf(result);
  }

  public Set<ChunkPos> footprint() {
    var result = new HashSet<ChunkPos>();
    protectedChunks.forEach(chunk -> result.add(new ChunkPos(world, chunk.x(), chunk.z())));
    protectedAreas.forEach(area -> result.addAll(area.footprint()));
    return Set.copyOf(result);
  }

  public com.shepherdjerred.thestorm.towns.domain.region.AdminRegion asRegion() {
    var areas = new java.util.ArrayList<>(protectedAreas);
    for (var chunk : protectedChunks) {
      areas.add(
          new Cuboid(
              world,
              new com.shepherdjerred.thestorm.towns.domain.region.BlockCorner(
                  chunk.x() * 16, -64, chunk.z() * 16),
              new com.shepherdjerred.thestorm.towns.domain.region.BlockCorner(
                  chunk.x() * 16 + 15, 319, chunk.z() * 16 + 15)));
    }
    return new com.shepherdjerred.thestorm.towns.domain.region.AdminRegion(
        id,
        name,
        new com.shepherdjerred.thestorm.towns.domain.region.RegionAreas(List.of(), areas),
        List.of(),
        com.shepherdjerred.thestorm.towns.domain.region.RegionSpawns.unlimited(),
        profile);
  }
}
