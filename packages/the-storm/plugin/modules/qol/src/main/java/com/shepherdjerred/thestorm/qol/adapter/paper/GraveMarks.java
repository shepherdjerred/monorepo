package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.GraveAccess;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Persistent data on a grave chest: owner and expiry, so opening does not wait on the database. */
final class GraveMarks {

  private final NamespacedKey owner;
  private final NamespacedKey expires;

  GraveMarks(Plugin plugin) {
    this.owner = new NamespacedKey(plugin, "grave_owner");
    this.expires = new NamespacedKey(plugin, "grave_expires");
  }

  void write(TileState state, UUID ownerId, Instant expiresAt) {
    var data = state.getPersistentDataContainer();
    data.set(owner, PersistentDataType.STRING, ownerId.toString());
    data.set(expires, PersistentDataType.LONG, expiresAt.toEpochMilli());
    state.update();
  }

  boolean isGrave(Block block) {
    return block.getState() instanceof TileState state
        && read(state.getPersistentDataContainer()).isPresent();
  }

  Optional<Marked> read(TileState state) {
    return read(state.getPersistentDataContainer());
  }

  private Optional<Marked> read(PersistentDataContainer data) {
    var ownerId = data.get(owner, PersistentDataType.STRING);
    var expiresAt = data.get(expires, PersistentDataType.LONG);
    if (ownerId == null || expiresAt == null) {
      return Optional.empty();
    }
    return Optional.of(new Marked(UUID.fromString(ownerId), Instant.ofEpochMilli(expiresAt)));
  }

  /**
   * A grave read off its chest.
   *
   * @param owner who may open it
   * @param expires when {@link GraveAccess} says it has spilled
   */
  record Marked(UUID owner, Instant expires) {}
}
