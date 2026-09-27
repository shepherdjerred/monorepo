package com.shepherdjerred.thestorm.spells.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Chunk;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataType;

/** Recovery markers serialized in the same chunk data as their temporary blocks. */
final class ChunkMarkers {

  private static final String NAMESPACE = "thestorm";
  private static final String PREFIX = "temporary_block_";

  private ChunkMarkers() {}

  static void put(Chunk chunk, TemporaryBlock block) {
    chunk
        .getPersistentDataContainer()
        .set(key(block.key()), PersistentDataType.STRING, block.original() + "\n" + block.placed());
  }

  static void remove(Chunk chunk, BlockKey block) {
    chunk.getPersistentDataContainer().remove(key(block));
  }

  static List<TemporaryBlock> entries(Chunk chunk) {
    var found = new ArrayList<TemporaryBlock>();
    var data = chunk.getPersistentDataContainer();
    for (var key : data.getKeys()) {
      if (!key.getNamespace().equals(NAMESPACE) || !key.getKey().startsWith(PREFIX)) {
        continue;
      }
      var parts = key.getKey().substring(PREFIX.length()).split("_", -1);
      if (parts.length != 3) {
        throw new IllegalStateException("invalid temporary-block marker key " + key);
      }
      var localX = Integer.parseInt(parts[0]);
      var y = Integer.parseInt(parts[1]);
      var localZ = Integer.parseInt(parts[2]);
      if (localX < 0 || localX > 15 || localZ < 0 || localZ > 15) {
        throw new IllegalStateException("invalid temporary-block marker position " + key);
      }
      var value = data.get(key, PersistentDataType.STRING);
      if (value == null
          || value.indexOf('\n') < 1
          || value.indexOf('\n') != value.lastIndexOf('\n')) {
        throw new IllegalStateException("invalid temporary-block marker value at " + key);
      }
      var separator = value.indexOf('\n');
      found.add(
          new TemporaryBlock(
              new BlockKey(
                  chunk.getWorld().getKey().asString(),
                  chunk.getX() * 16 + localX,
                  y,
                  chunk.getZ() * 16 + localZ),
              value.substring(0, separator),
              value.substring(separator + 1),
              Instant.EPOCH));
    }
    return List.copyOf(found);
  }

  private static NamespacedKey key(BlockKey block) {
    return requireNonNull(
        NamespacedKey.fromString(
            NAMESPACE
                + ":"
                + PREFIX
                + (block.x() & 15)
                + "_"
                + block.y()
                + "_"
                + (block.z() & 15)));
  }
}
