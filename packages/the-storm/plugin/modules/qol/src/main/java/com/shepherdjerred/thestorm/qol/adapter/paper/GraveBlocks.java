package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.Skull;
import org.bukkit.persistence.PersistentDataType;

/**
 * Grave blocks: a player head wearing the owner's face, carrying the grave's id in its persistent
 * data. The block is only a marker; the items live in the database. Main thread only.
 */
final class GraveBlocks {

  /** The grave id on a grave block (string). */
  static final NamespacedKey KEY = new NamespacedKey("thestorm", "grave");

  private GraveBlocks() {}

  /** Makes {@code block} the marker for {@code grave}. */
  static void place(Block block, Grave grave, GraveFace face) {
    block.setType(Material.PLAYER_HEAD, false);
    if (!(block.getState() instanceof Skull skull)) {
      throw new IllegalStateException("a player head has no skull state at " + block);
    }
    face.apply(skull, grave.owner());
    skull.getPersistentDataContainer().set(KEY, PersistentDataType.STRING, grave.id().toString());
    skull.update(true, false);
  }

  /** The grave whose marker {@code block} is, if it is one. */
  static Optional<UUID> idAt(Block block) {
    var type = block.getType();
    if (type != Material.PLAYER_HEAD && type != Material.PLAYER_WALL_HEAD) {
      return Optional.empty();
    }
    if (!(block.getState() instanceof Skull skull)) {
      return Optional.empty();
    }
    var id = skull.getPersistentDataContainer().get(KEY, PersistentDataType.STRING);
    return id == null ? Optional.empty() : Optional.of(UUID.fromString(id));
  }

  static boolean isGrave(Block block) {
    return idAt(block).isPresent();
  }

  /** Removes {@code block} if it is the marker for {@code grave}. */
  static void clear(Block block, UUID grave) {
    if (idAt(block).filter(grave::equals).isPresent()) {
      block.setType(Material.AIR, false);
    }
  }
}
