package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.StoredGrave;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.Material;
import org.bukkit.block.Chest;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Spills graves whose lifetime has ended. */
final class GraveExpiry {

  private final QolStore store;
  private final ModuleContext context;
  private final AtomicBoolean running = new AtomicBoolean();

  GraveExpiry(QolStore store, ModuleContext context) {
    this.store = store;
    this.context = context;
  }

  void start() {
    context
        .scheduler()
        .repeatOnMainThread(Duration.ofSeconds(30), Duration.ofSeconds(30), this::scan);
  }

  private void scan() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    var _ =
        store
            .due(context.time().instant())
            .whenCompleteAsync(
                (graves, failure) -> {
                  if (failure != null) {
                    running.set(false);
                    context.logger().error("Could not list expired graves", failure);
                    return;
                  }
                  graves.forEach(this::spill);
                  running.set(false);
                },
                context.scheduler().mainThread());
  }

  private void spill(StoredGrave grave) {
    var world = context.plugin().getServer().getWorld(grave.world());
    if (world == null) {
      throw new IllegalStateException(
          "grave " + grave.id() + " is in missing world " + grave.world());
    }
    var _ =
        world
            .getChunkAtAsync(grave.x() >> 4, grave.z() >> 4)
            .thenRunAsync(() -> drop(grave), context.scheduler().mainThread());
  }

  private void drop(StoredGrave grave) {
    var world = context.plugin().getServer().getWorld(grave.world());
    if (world == null) {
      throw new IllegalStateException(
          "grave " + grave.id() + " is in missing world " + grave.world());
    }
    var block = world.getBlockAt(grave.x(), grave.y(), grave.z());
    if (block.getState() instanceof Chest chest) {
      var contents = chest.getBlockInventory().getContents();
      if (contents == null) {
        throw new IllegalStateException("grave " + grave.id() + " chest has no inventory");
      }
      for (var item : contents) {
        dropOne(world, grave, item);
      }
      chest.getBlockInventory().clear();
      block.setType(Material.AIR);
    }
    var _ =
        store
            .deleteGrave(grave.id())
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not delete grave {}", grave.id(), failure);
                  }
                },
                context.scheduler().mainThread());
  }

  private static void dropOne(org.bukkit.World world, StoredGrave grave, @Nullable ItemStack item) {
    if (item != null) {
      world.dropItemNaturally(
          world.getBlockAt(grave.x(), grave.y(), grave.z()).getLocation(), item);
    }
  }
}
