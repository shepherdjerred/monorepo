package com.shepherdjerred.thestorm.core.world;

import com.shepherdjerred.thestorm.core.reset.AccountEpochs;
import java.util.Collection;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;

/** Hidden ownership/grants carry the account generation at which they were authored. */
public final class WorldAccountEpochs {
  private final AccountEpochs epochs;
  private final NamespacedKey key;

  public WorldAccountEpochs(AccountEpochs epochs, String module) {
    this.epochs = epochs;
    key = new NamespacedKey("thestorm", module + "_account_epochs");
  }

  public boolean permits(PersistentDataContainer data, UUID player) {
    var saved = data.get(key, PersistentDataType.TAG_CONTAINER);
    if (saved == null && data.has(key))
      throw new IllegalStateException("Invalid account generation metadata");
    var generation =
        saved == null ? 0L : saved.getOrDefault(playerKey(player), PersistentDataType.LONG, 0L);
    return generation == epochs.current(player);
  }

  public boolean permitsAll(PersistentDataContainer data) {
    var saved = data.get(key, PersistentDataType.TAG_CONTAINER);
    if (saved == null) {
      if (data.has(key)) throw new IllegalStateException("Invalid account generation metadata");
      return true;
    }
    return saved.getKeys().stream()
        .allMatch(player -> permits(data, UUID.fromString(player.getKey())));
  }

  public void stamp(PersistentDataContainer data, Collection<UUID> players) {
    var saved = data.getAdapterContext().newPersistentDataContainer();
    for (var player : players)
      saved.set(playerKey(player), PersistentDataType.LONG, epochs.current(player));
    data.set(key, PersistentDataType.TAG_CONTAINER, saved);
  }

  /** Reauthorizes only explicit new grants, preserving every other identity's generation. */
  public void renew(PersistentDataContainer data, Collection<UUID> players) {
    var saved = data.get(key, PersistentDataType.TAG_CONTAINER);
    if (saved == null) {
      if (data.has(key)) throw new IllegalStateException("Invalid account generation metadata");
      saved = data.getAdapterContext().newPersistentDataContainer();
    }
    for (var player : players)
      saved.set(playerKey(player), PersistentDataType.LONG, epochs.current(player));
    data.set(key, PersistentDataType.TAG_CONTAINER, saved);
  }

  private static NamespacedKey playerKey(UUID player) {
    return new NamespacedKey("thestorm", player.toString());
  }
}
