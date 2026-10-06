package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.stream.Collectors.toUnmodifiableSet;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Chunk;
import org.bukkit.entity.Player;

/**
 * Keeps graves and their blocks in step with storage: loads them at start (or stops qol if it
 * cannot), puts back a missing grave block when its chunk loads, breaks open expired graves and
 * tells their owners, and removes emptied graves. Main thread only.
 */
final class GraveUpkeep {

  private record Loaded(
      List<GraveContents> graves, List<GraveStore.Claim> claims, List<GraveStore.Drop> drops) {}

  private final QolRuntime runtime;
  private final GraveStore store;
  private final GraveRegistry registry;
  private final GravePolicy policy;
  private final GraveFace face;
  private final Protection protection;
  private final BlockChanges changes;
  private final Set<UUID> expired = new HashSet<>();

  GraveUpkeep(QolRuntime runtime, GraveParts parts) {
    this.runtime = runtime;
    this.store = parts.store();
    this.registry = parts.registry();
    this.policy = parts.policy();
    this.face = parts.hooks().face();
    this.protection = parts.protection();
    this.changes = parts.changes();
  }

  /**
   * Reads every grave from storage; until this finishes no grave can be opened or made. If storage
   * cannot be read, {@code failed} runs: graves must not run on a partial picture.
   */
  void load(Runnable failed, Runnable loaded) {
    runtime.onMain(
        store
            .loadAll()
            .thenCombine(
                store.pendingClaims(), (graves, claims) -> new Loaded(graves, claims, List.of()))
            .thenCombine(
                store.pendingDrops(),
                (prior, drops) -> new Loaded(prior.graves(), prior.claims(), drops)),
        "loading graves",
        loadedState -> {
          restore(loadedState);
          runtime.logger().info("qol loaded {} graves", loadedState.graves().size());
          loaded.run();
        },
        failure -> failed.run());
  }

  private void restore(Loaded loadedState) {
    registry.load(loadedState.graves());
    expired.clear();
    loadedState.drops().stream()
        .filter(drop -> !drop.ownerOnly())
        .map(GraveStore.Drop::grave)
        .forEach(expired::add);
    for (var claim : loadedState.claims()) {
      if (registry.get(claim.grave()).isEmpty() || !registry.tryLock(claim.grave())) {
        throw new IllegalStateException("invalid pending grave claim " + claim.token());
      }
    }
    var dropGraves =
        loadedState.drops().stream().map(GraveStore.Drop::grave).collect(toUnmodifiableSet());
    for (var contents : loadedState.graves()) {
      restoreGrave(contents, dropGraves);
    }
    reconcileLoaded(loadedState.drops());
  }

  private void restoreGrave(GraveContents contents, Set<UUID> dropGraves) {
    var grave = contents.grave();
    if (!Blocks.isLoaded(runtime.server(), grave.pos())) {
      return;
    }
    if (contents.isEmpty()) {
      if (dropGraves.contains(grave.id())) {
        clear(grave);
        if (!expired.contains(grave.id()) && policy.isExpired(grave, runtime.time().instant())) {
          expire(grave);
        }
      } else if (registry.tryLock(grave.id())) {
        remove(grave.id());
      }
    } else if (policy.isExpired(grave, runtime.time().instant())) {
      expire(grave);
    } else {
      mark(contents);
    }
  }

  /** A chunk loaded: its graves get their blocks back if they lost them. */
  void chunkLoaded(Chunk chunk) {
    var world = chunk.getWorld().getName();
    for (var contents : registry.all()) {
      var pos = contents.grave().pos();
      if (pos.world().equals(world)
          && pos.x() >> 4 == chunk.getX()
          && pos.z() >> 4 == chunk.getZ()) {
        if (contents.isEmpty()) {
          clear(contents.grave());
          maybeRemove(contents.grave().id());
        } else if (policy.isExpired(contents.grave(), runtime.time().instant())) {
          expire(contents.grave());
        } else {
          mark(contents);
        }
      }
    }
    reconcile(chunk);
  }

  /** A loaded chunk may cross its deadline without another chunk-load event. */
  void expireNear(Player player) {
    var at = Blocks.at(player);
    for (var contents : registry.all()) {
      var pos = contents.grave().pos();
      if (pos.world().equals(at.getWorld().getName())
          && Math.abs(pos.x() - at.getBlockX()) <= 8
          && Math.abs(pos.y() - at.getBlockY()) <= 8
          && Math.abs(pos.z() - at.getBlockZ()) <= 8) {
        expireIfDue(contents.grave().id());
      }
    }
  }

  /** Prevents an expired head from being opened before its pending drops are recorded. */
  boolean expireIfDue(UUID id) {
    var found = registry.get(id);
    if (found.isEmpty()) {
      return false;
    }
    var contents = found.orElseThrow();
    if (!policy.isExpired(contents.grave(), runtime.time().instant())) {
      return false;
    }
    if (expired.contains(id)) {
      if (clear(contents.grave())) maybeRemove(id);
      return true;
    }
    if (contents.isEmpty()) {
      maybeRemove(id);
    } else {
      expire(contents.grave());
    }
    return true;
  }

  /** Event-driven catch-up for a chunk's durable item projections. */
  private void reconcile(Chunk chunk) {
    runtime.onMain(
        store.pendingDrops(),
        "loading grave drop projections",
        drops -> {
          if (chunk.isLoaded()) {
            GraveDropEntity.reconcile(chunk, drops);
          }
        },
        failure -> {});
  }

  private void maybeRemove(UUID grave) {
    runtime.onMain(
        store.pendingDrops(),
        "checking empty grave projections",
        drops -> {
          if (drops.stream().anyMatch(drop -> drop.grave().equals(grave))) {
            registry
                .get(grave)
                .ifPresent(
                    contents -> {
                      if (!expired.contains(grave)
                          && policy.isExpired(contents.grave(), runtime.time().instant())) {
                        expire(contents.grave());
                      }
                    });
          } else if (registry.tryLock(grave)) {
            remove(grave);
          }
        },
        failure -> {});
  }

  private void reconcileLoaded(List<GraveStore.Drop> drops) {
    var seen = new HashSet<String>();
    for (var drop : drops) {
      var pos = drop.pos();
      var world = runtime.server().getWorld(pos.world());
      var chunkX = pos.x() >> 4;
      var chunkZ = pos.z() >> 4;
      if (world != null && world.isChunkLoaded(chunkX, chunkZ)) {
        var key = pos.world() + ":" + chunkX + ":" + chunkZ;
        if (seen.add(key)) {
          GraveDropEntity.reconcile(world.getChunkAt(chunkX, chunkZ), drops);
        }
      }
    }
  }

  /** Puts {@code contents}' block back if it is missing and its spot is open air. */
  void mark(GraveContents contents) {
    var grave = contents.grave();
    if (contents.isEmpty() || policy.isExpired(grave, runtime.time().instant())) {
      return;
    }
    var found = Blocks.block(runtime.server(), grave.pos());
    if (found.isEmpty()) {
      return;
    }
    var block = found.orElseThrow();
    if (!protection
        .check(grave.owner(), ProtectedAction.AUTOMATIC_BUILD, block.getLocation())
        .isAllowed()) {
      return;
    }
    if (GraveBlocks.idAt(block).filter(grave.id()::equals).isPresent()) {
      return;
    }
    if (Blocks.cell(block) == GravePlacement.Cell.OPEN) {
      GraveBlocks.preparePlace(block, grave, face, changes).apply();
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
        store.listNotices(id),
        "reading " + player.getName() + "'s grave notices",
        notices -> {
          var online = runtime.server().getPlayer(id);
          if (online != null && online.isOnline()) {
            notices.forEach(notice -> Say.info(online, Say.GRAVES, notice.message()));
            var ids = notices.stream().map(GraveStore.PendingNotice::id).toList();
            runtime.onMain(
                store.acknowledgeNotices(id, ids),
                "acknowledging grave notices",
                done -> {},
                failure -> {});
          }
        },
        failure -> {});
  }

  /** Offers an owner's unclaimed overflow at their feet while the grave stays locked. */
  void offerOverflow(Player player, Grave grave, Set<Integer> indexes) {
    var at = Blocks.pos(Blocks.at(player).getBlock());
    runtime.onMain(
        store.beginOverflow(grave.id(), indexes, at),
        "offering grave overflow",
        drops -> {
          registry.get(grave.id()).ifPresent(contents -> registry.put(contents.without(indexes)));
          if (registry.get(grave.id()).filter(GraveContents::isEmpty).isPresent()) {
            clear(grave);
          }
          var world = runtime.server().getWorld(at.world());
          if (world != null && world.isChunkLoaded(at.x() >> 4, at.z() >> 4)) {
            reconcile(world.getChunkAt(at.x() >> 4, at.z() >> 4));
          }
          registry.unlock(grave.id());
          if (player.isOnline()) {
            Say.info(player, Say.GRAVES, drops.size() + " stacks fell at your feet.");
          }
        },
        failure -> registry.unlock(grave.id()));
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
    var world = runtime.server().getWorld(grave.pos().world());
    if (world == null) {
      registry.unlock(grave.id());
      return;
    }
    var chunkX = grave.pos().x() >> 4;
    var chunkZ = grave.pos().z() >> 4;
    if (!world.isChunkLoaded(chunkX, chunkZ)) {
      registry.unlock(grave.id());
      return;
    }
    var chunk = world.getChunkAt(chunkX, chunkZ);
    if (protection.isPreserved(
        Blocks.block(runtime.server(), grave.pos()).orElseThrow().getLocation())) {
      registry.unlock(grave.id());
      return;
    }
    runtime.onMain(
        store.beginExpiry(
            grave.id(), new GraveStore.Notice(grave.owner(), message, runtime.time().instant())),
        "breaking open " + grave.ownerName() + "'s grave",
        drops -> {
          registry
              .get(grave.id())
              .ifPresent(
                  contents ->
                      registry.put(
                          contents.without(
                              drops.stream()
                                  .map(drop -> drop.item().index())
                                  .collect(toUnmodifiableSet()))));
          clear(grave);
          expired.add(grave.id());
          reconcile(chunk);
          runtime.logger().info("{}'s grave at {} broke open", grave.ownerName(), grave.pos());
          var online = runtime.server().getPlayer(grave.owner());
          if (online != null) {
            deliverNotices(online);
          }
          registry.unlock(grave.id());
        },
        failure -> registry.unlock(grave.id()));
  }

  private boolean clear(Grave grave) {
    if (!Blocks.isLoaded(runtime.server(), grave.pos())) {
      return false;
    }
    var block = Blocks.block(runtime.server(), grave.pos()).orElseThrow();
    if (protection.isPreserved(block.getLocation())) return false;
    GraveBlocks.clear(
        block, grave.id(), runtime.server().createBlockData(grave.replaced()), changes);
    return true;
  }

  /**
   * Removes an emptied grave. The caller holds the grave's lock; storage refuses deletion if any
   * claim or projected item still remains.
   */
  void remove(UUID id) {
    var found = registry.get(id);
    if (found.isEmpty()) {
      registry.unlock(id);
      return;
    }
    var grave = found.orElseThrow().grave();
    if (!Blocks.isLoaded(runtime.server(), grave.pos())) {
      registry.unlock(id);
      return;
    }
    // Clearing first is retryable if SQLite fails. Deleting first could strand a head in
    // an unloaded chunk with no durable grave row left to find it.
    if (!clear(grave)) {
      registry.unlock(id);
      return;
    }
    runtime.onMain(
        store.deleteEmpty(id),
        "removing an emptied grave",
        done -> {
          registry.remove(grave.id());
          expired.remove(grave.id());
        },
        failure -> registry.unlock(id));
  }
}
