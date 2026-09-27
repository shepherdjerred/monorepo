package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.ItemDisplay.ItemDisplayTransform;
import org.bukkit.persistence.PersistentDataType;

/** Item displays are replaceable projections of grave rows; the database keeps the only claim. */
final class GraveDropEntity {

  private static final NamespacedKey GRAVE = new NamespacedKey("thestorm", "grave_drop_id");
  private static final NamespacedKey INDEX = new NamespacedKey("thestorm", "grave_drop_index");

  record Key(UUID grave, int index) {}

  private GraveDropEntity() {}

  static Optional<Key> key(Entity entity) {
    var data = entity.getPersistentDataContainer();
    var grave = data.get(GRAVE, PersistentDataType.STRING);
    var index = data.get(INDEX, PersistentDataType.INTEGER);
    if (grave == null && index == null) {
      return Optional.empty();
    }
    if (grave == null || index == null) {
      throw new IllegalStateException("incomplete grave drop entity tag: " + entity.getUniqueId());
    }
    return Optional.of(new Key(UUID.fromString(grave), index));
  }

  /** Restores missing item projections and removes stale ones in an already loaded chunk. */
  static void reconcile(Chunk chunk, List<GraveStore.Drop> all) {
    var expected = new HashMap<Key, GraveStore.Drop>();
    for (var drop : all) {
      var pos = drop.pos();
      if (pos.world().equals(chunk.getWorld().getName())
          && pos.x() >> 4 == chunk.getX()
          && pos.z() >> 4 == chunk.getZ()) {
        expected.put(new Key(drop.grave(), drop.item().index()), drop);
      }
    }
    var present = new HashMap<Key, ItemDisplay>();
    for (var entity : chunk.getEntities()) {
      if (!(entity instanceof ItemDisplay display)) {
        continue;
      }
      key(display)
          .ifPresent(
              id -> {
                if (!expected.containsKey(id) || present.putIfAbsent(id, display) != null) {
                  display.remove();
                }
              });
    }
    for (Map.Entry<Key, GraveStore.Drop> entry : expected.entrySet()) {
      if (!present.containsKey(entry.getKey())) {
        spawn(chunk, entry.getValue());
      }
    }
  }

  private static void spawn(Chunk chunk, GraveStore.Drop drop) {
    var pos = drop.pos();
    var world = chunk.getWorld();
    var at = new Location(world, pos.x() + 0.5, pos.y() + 0.5, pos.z() + 0.5);
    world.spawn(
        at,
        ItemDisplay.class,
        display -> {
          display.setItemStack(ItemCodec.decode(drop.item().item()));
          display.setItemDisplayTransform(ItemDisplayTransform.GROUND);
          display
              .getPersistentDataContainer()
              .set(GRAVE, PersistentDataType.STRING, drop.grave().toString());
          display
              .getPersistentDataContainer()
              .set(INDEX, PersistentDataType.INTEGER, drop.item().index());
          display.setGravity(false);
          display.setInvulnerable(true);
        });
  }
}
