package com.shepherdjerred.thestorm.rwf.testing;

import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;

/**
 * Saved player data for MockBukkit, which persists no NBT: saving copies the player's string
 * persistent data aside as the file on disk would hold it. {@link #dropWrites} makes saves vanish,
 * as when Paper's save fails.
 */
public final class FakeSavedPlayerData implements SavedPlayerData {

  private final Map<UUID, Map<NamespacedKey, String>> files = new HashMap<>();
  public boolean dropWrites;
  public int saves;

  @Override
  public boolean available() {
    return true;
  }

  @Override
  public void save(Player player) {
    saves++;
    if (dropWrites) {
      return;
    }
    var container = player.getPersistentDataContainer();
    var values = new HashMap<NamespacedKey, String>();
    for (var key : container.getKeys()) {
      if (container.has(key, PersistentDataType.STRING)) {
        values.put(key, container.get(key, PersistentDataType.STRING));
      }
    }
    files.put(player.getUniqueId(), values);
  }

  @Override
  public CompletableFuture<Optional<String>> marker(UUID player, NamespacedKey key) {
    var file = files.get(player);
    if (file == null) {
      return CompletableFuture.failedFuture(new IllegalStateException("no saved file"));
    }
    return CompletableFuture.completedFuture(Optional.ofNullable(file.get(key)));
  }
}
