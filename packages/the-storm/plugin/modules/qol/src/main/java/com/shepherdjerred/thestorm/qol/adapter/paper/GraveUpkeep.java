package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Chunk;
import org.bukkit.entity.Player;

/**
 * Keeps graves and their blocks in step with storage: loads them at start (or stops qol if it
 * cannot), puts back a missing grave block when its chunk loads, breaks open expired graves and
 * tells their owners, and removes emptied graves. Main thread only.
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
    this.face = parts.hooks().face();
  }

  /**
   * Reads every grave from storage; until this finishes no grave can be opened or made. If storage
   * cannot be read, {@code failed} runs: graves must not run on a partial picture.
   */
  void load(Runnable failed) {
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
        failure -> failed.run());
  }

  /** A chunk loaded: its graves get their blocks back if they lost them. */
  void chunkLoaded(Chunk chunk) {
    var world = chunk.getWorld().getName();
    for (var contents : registry.all()) {
      var pos = contents.grave().pos();
      if (pos.world().equals(world)
          && pos.x() >> 4 == chunk.getX()
          && pos.z() >> 4 == chunk.getZ()) {
        mark(contents);
      }
    }
  }

  /**
   * Breaks open every expired grave. The sweep loads the grave's chunk itself, so the items land
   * where the grave stood (and wait there, unloaded, for their owner) rather than going to whoever
   * happens to load the chunk later.
   */
  void sweep() {
    var now = runtime.time().instant();
    for (var contents : registry.all()) {
      var grave = contents.grave();
      if (!policy.isExpired(grave, now)) {
        continue;
      }
      var world = runtime.server().getWorld(grave.pos().world());
      if (world == null) {
        continue;
      }
      world.loadChunk(grave.pos().x() >> 4, grave.pos().z() >> 4);
      expire(grave);
    }
  }

  /** Puts {@code contents}' block back if it is missing and its spot is open air. */
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

  /** Sends {@code player} what happened to their graves while they were away. */
  void deliverNotices(Player player) {
    var id = player.getUniqueId();
    runtime.onMain(
        store.takeNotices(id),
        "reading " + player.getName() + "'s grave notices",
        messages -> {
          var online = runtime.server().getPlayer(id);
          if (online != null) {
            messages.forEach(message -> Say.info(online, Say.GRAVES, message));
          }
        },
        failure -> {});
  }

  /** Breaks open an expired grave: its items drop where it stood, and its owner is told. */
  private void expire(Grave grave) {
    if (!registry.tryLock(grave.id())) {
      return;
    }
    var message =
        "Your grave at "
            + grave.pos().describe()
            + " broke open after "
            + DurationText.of(policy.expireAfter())
            + "; what was left in it lies on the ground there.";
    var owner = runtime.server().getPlayer(grave.owner());
    var notice =
        owner == null
            ? Optional.of(new GraveStore.Notice(grave.owner(), message, runtime.time().instant()))
            : Optional.<GraveStore.Notice>empty();
    runtime.onMain(
        store.expire(grave.id(), notice),
        "breaking open " + grave.ownerName() + "'s grave",
        items -> {
          gone(grave, items);
          runtime
              .logger()
              .info(
                  "{}'s grave at {} expired and dropped {} stacks",
                  grave.ownerName(),
                  grave.pos(),
                  items.size());
          var online = runtime.server().getPlayer(grave.owner());
          if (online != null && notice.isEmpty()) {
            Say.info(online, Say.GRAVES, message);
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
    var grave = found.orElseThrow().grave();
    runtime.onMain(
        store.delete(id),
        "removing an emptied grave",
        items -> gone(grave, items),
        failure -> registry.unlock(id));
  }

  /** Forgets {@code grave}, puts back the block it replaced and drops {@code items} there. */
  private void gone(Grave grave, List<GraveItem> items) {
    registry.remove(grave.id());
    var replaced = runtime.server().createBlockData(grave.replaced());
    Blocks.block(runtime.server(), grave.pos())
        .ifPresent(block -> GraveBlocks.clear(block, grave.id(), replaced));
    var center = Blocks.center(runtime.server(), grave.pos());
    if (center.isEmpty()) {
      if (!items.isEmpty()) {
        runtime
            .logger()
            .error("A grave at {} held {} stacks but its world is gone", grave.pos(), items.size());
      }
      return;
    }
    var at = center.orElseThrow();
    for (var item : items) {
      at.getWorld().dropItemNaturally(at, ItemCodec.decode(item.item()));
    }
  }
}
