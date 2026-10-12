package com.shepherdjerred.thestorm.core.snapshot;

import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.zip.ZipException;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/**
 * Player data on a pretend disk: saving writes the player's inventory, level and string persistent
 * data as one file, the way Paper's atomic file replace does, and {@link #load} puts a player back
 * to what the file holds, as a login after a crash would.
 *
 * <ul>
 *   <li>{@link #dropWrites}: a save silently does not reach disk (Paper logs and carries on).
 *   <li>{@link #lagReads}: reads wait until {@link #release}.
 *   <li>{@link #corrupt}: the next reads find a truncated file.
 * </ul>
 */
final class MemorySavedData implements SavedPlayerData {

  /** One saved file. */
  record File(ItemData items, int level, Map<NamespacedKey, String> values) {}

  final Map<UUID, File> files = new HashMap<>();
  private final List<Runnable> lagged = new ArrayList<>();
  boolean dropWrites;
  boolean lagReads;
  int corrupt;
  int saves;
  int reads;

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
      var value = container.get(key, PersistentDataType.STRING);
      if (value != null) {
        values.put(key, value);
      }
    }
    var items =
        ItemData.of(
            ItemStack.serializeItemsAsBytes(
                Arrays.stream(player.getInventory().getContents())
                    .map(item -> item == null ? ItemStack.empty() : item)
                    .toList()));
    files.put(player.getUniqueId(), new File(items, player.getLevel(), Map.copyOf(values)));
  }

  @Override
  public CompletableFuture<Optional<String>> marker(UUID player, NamespacedKey key) {
    reads++;
    var answer = new CompletableFuture<Optional<String>>();
    Runnable read =
        () -> {
          if (corrupt > 0) {
            corrupt--;
            answer.completeExceptionally(
                new UncheckedIOException(new ZipException("Unexpected end of ZLIB input stream")));
            return;
          }
          var file = files.get(player);
          if (file == null) {
            answer.completeExceptionally(new IllegalStateException("no saved file"));
            return;
          }
          answer.complete(Optional.ofNullable(file.values().get(key)));
        };
    if (lagReads) {
      lagged.add(read);
    } else {
      read.run();
    }
    return answer;
  }

  /** Lets the lagging reads finish. */
  void release() {
    lagReads = false;
    var waiting = List.copyOf(lagged);
    lagged.clear();
    waiting.forEach(Runnable::run);
  }

  /** Puts {@code player} back to their saved file (an empty player if none was saved). */
  void load(Player player) {
    var file = files.get(player.getUniqueId());
    var container = player.getPersistentDataContainer();
    for (var key : List.copyOf(container.getKeys())) {
      container.remove(key);
    }
    player.getInventory().clear();
    player.setLevel(0);
    if (file == null) {
      return;
    }
    player.getInventory().setContents(ItemStack.deserializeItemsFromBytes(file.items().bytes()));
    player.setLevel(file.level());
    file.values().forEach((key, value) -> container.set(key, PersistentDataType.STRING, value));
  }
}
