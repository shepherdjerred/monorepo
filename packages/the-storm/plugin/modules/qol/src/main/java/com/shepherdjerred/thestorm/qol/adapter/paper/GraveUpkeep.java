package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.util.List;
import java.util.UUID;
import org.bukkit.Chunk;

/**
 * Keeps graves and their blocks in step with storage: loads them at start, puts back a missing
 * grave block when its chunk loads, breaks open expired graves (only in loaded chunks, so the items
 * land where players can reach them) and removes emptied graves. Main thread only.
 */
final class GraveUpkeep {

  private final QolRuntime runtime;
  private final GraveStore store;
  private final GraveRegistry registry;
  private final GravePolicy policy;
  private final GraveFace face;

  GraveUpkeep(QolRuntime runtime, GraveParts parts) {
    this.runtime = runtime;
    this.store = parts.store();
    this.registry = parts.registry();
    this.policy = parts.policy();
    this.face = parts.face();
  }

  /** Reads every grave from storage; until this finishes, no grave can be opened. */
  void load() {
    runtime.onMain(
        store.loadAll(),
        "loading graves",
        graves -> {
          registry.load(graves);
          for (var contents : graves) {
            if (contents.isEmpty()) {
              // Emptied just before a crash: nothing left to guard.
              if (registry.tryLock(contents.grave().id())) {
                remove(contents.grave().id());
              }
            } else if (Blocks.isLoaded(runtime.server(), contents.grave().pos())) {
              mark(contents);
            }
          }
          runtime.logger().info("qol loaded {} graves", graves.size());
        },
        failure -> {});
  }

  /** A chunk loaded: its graves get their blocks back if needed, and expired ones break open. */
  void chunkLoaded(Chunk chunk) {
    var world = chunk.getWorld().getName();
    for (var contents : registry.all()) {
      var pos = contents.grave().pos();
      if (pos.world().equals(world)
          && pos.x() >> 4 == chunk.getX()
          && pos.z() >> 4 == chunk.getZ()) {
        mark(contents);
        if (policy.isExpired(contents.grave(), runtime.time().instant())) {
          expire(contents);
        }
      }
    }
  }

  /** Breaks open every expired grave whose chunk is loaded. */
  void sweep() {
    var now = runtime.time().instant();
    for (var contents : registry.all()) {
      if (policy.isExpired(contents.grave(), now)
          && Blocks.isLoaded(runtime.server(), contents.grave().pos())) {
        expire(contents);
      }
    }
  }

  /** Puts {@code contents}' block back if it is missing and its spot is open. */
  void mark(GraveContents contents) {
    var grave = contents.grave();
    var found = Blocks.block(runtime.server(), grave.pos());
    if (found.isEmpty()) {
      return;
    }
    var block = found.orElseThrow();
    if (GraveBlocks.idAt(block).filter(grave.id()::equals).isPresent()) {
      return;
    }
    if (Blocks.cell(block) == GravePlacement.Cell.OPEN) {
      GraveBlocks.place(block, grave, face);
      runtime
          .logger()
          .info("Put back the block of {}'s grave at {}", grave.ownerName(), grave.pos());
    } else {
      runtime
          .logger()
          .warn(
              "{}'s grave at {} has lost its block to {}; its items are safe in storage",
              grave.ownerName(),
              grave.pos(),
              block.getType());
    }
  }

  /** Breaks open an expired grave: its items drop where it stood. */
  private void expire(GraveContents contents) {
    var grave = contents.grave();
    if (!registry.tryLock(grave.id())) {
      return;
    }
    runtime.onMain(
        store.delete(grave.id()),
        "breaking open " + grave.ownerName() + "'s grave",
        items -> {
          gone(grave.id(), grave.pos(), items);
          var owner = runtime.server().getPlayer(grave.owner());
          if (owner != null) {
            Say.info(
                owner,
                Say.GRAVES,
                "Your grave at " + grave.pos().describe() + " broke open and dropped its items.");
          }
        },
        failure -> registry.unlock(grave.id()));
  }

  /**
   * Removes an emptied grave. The caller holds the grave's lock; anything still in storage
   * (nothing, normally) drops where the grave stood.
   */
  void remove(UUID id) {
    var found = registry.get(id);
    if (found.isEmpty()) {
      registry.unlock(id);
      return;
    }
    var pos = found.orElseThrow().grave().pos();
    runtime.onMain(
        store.delete(id),
        "removing an emptied grave",
        items -> gone(id, pos, items),
        failure -> registry.unlock(id));
  }

  private void gone(UUID id, GravePos pos, List<GraveItem> items) {
    registry.remove(id);
    Blocks.block(runtime.server(), pos).ifPresent(block -> GraveBlocks.clear(block, id));
    var center = Blocks.center(runtime.server(), pos);
    if (center.isEmpty()) {
      if (!items.isEmpty()) {
        runtime
            .logger()
            .error("A grave at {} held {} stacks but its world is gone", pos, items.size());
      }
      return;
    }
    var at = center.orElseThrow();
    for (var item : items) {
      at.getWorld().dropItemNaturally(at, ItemCodec.decode(item.item()));
    }
  }
}
