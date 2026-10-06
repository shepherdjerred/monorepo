package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAccess;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.protection.Denial;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.jspecify.annotations.Nullable;

/**
 * Resolves Paper blocks and inventories to locks and asks {@link LockAccess}. A lock only counts
 * while its block is still a lockable container, so a lock left behind where a container vanished
 * (by WorldEdit, say) protects nothing until the next block placed there clears it. Main thread
 * only.
 */
final class LockGuard {

  private final LockBook book;
  private final LockAccess access;
  private final BlockKinds kinds;
  private final Notices notices;
  private final TownsState towns;
  private final SealedWorlds sealed;

  record Parts(
      LockBook book,
      LockAccess access,
      BlockKinds kinds,
      Notices notices,
      TownsState towns,
      SealedWorlds sealed) {}

  LockGuard(Parts parts) {
    this.book = parts.book();
    this.access = parts.access();
    this.kinds = parts.kinds();
    this.notices = parts.notices();
    this.towns = parts.towns();
    this.sealed = parts.sealed();
  }

  /** True in a world a minigame sealed, where no container is ever locked. */
  boolean isSealed(World world) {
    return sealed.isSealed(world);
  }

  /** The lock on {@code block}, if it is a lockable container someone locked. */
  @Nullable Lock lockOf(Block block) {
    if (!kinds.isLockable(block.getType()) || isSealed(block.getWorld())) {
      return null;
    }
    return book.at(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  /** A locked machine may use its own inventory from redstone only by explicit owner choice. */
  boolean mayAutomate(Block block) {
    var lock = lockOf(block);
    return lock == null || lock.options().redstone();
  }

  /** The blocks of the container at {@code block}: it, and its other half if a double chest. */
  static List<Block> container(Block block) {
    var blocks = new ArrayList<Block>(2);
    blocks.add(block);
    Chests.partner(block).ifPresent(blocks::add);
    return List.copyOf(blocks);
  }

  static BlockPos position(Block block) {
    return new BlockPos(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  private enum Operation {
    OPEN,
    BREAK,
    WIRE
  }

  private Optional<UUID> landTown(Block block) {
    return switch (towns.landAt(
        block.getWorld().getName(), block.getX(), block.getY(), block.getZ())) {
      case Land.TownLand(var claim) -> Optional.of(claim.townId());
      case Land.Wilderness _,
          Land.RegionLand _,
          Land.ParcelLand _,
          Land.WorkLand _,
          Land.HeritageLand _ ->
          Optional.empty();
    };
  }

  private boolean permits(UUID player, boolean bypass, List<Block> blocks, Operation operation) {
    for (var block : blocks) {
      var lock = lockOf(block);
      if (lock == null) {
        continue;
      }
      if (operation == Operation.WIRE && lock.options().redstone()) {
        continue;
      }
      var allowed =
          switch (operation) {
            case OPEN -> access.open(lock, player, bypass, landTown(block));
            case BREAK, WIRE -> access.breaking(lock, player, bypass, landTown(block));
          };
      if (allowed.isEmpty()) {
        return false;
      }
    }
    return true;
  }

  private boolean report(Player player, List<Block> blocks, Operation operation) {
    var actor = Guard.actor(player);
    if (permits(actor.player(), actor.bypass(), blocks, operation)) {
      return true;
    }
    notices.denied(player, new Denial.Locked());
    return false;
  }

  boolean mayOpen(Player player, List<Block> blocks) {
    return report(player, blocks, Operation.OPEN);
  }

  boolean mayBreak(Player player, List<Block> blocks) {
    return report(player, blocks, Operation.BREAK);
  }

  boolean mayBreak(Player player, Lock lock, Block block) {
    var actor = Guard.actor(player);
    return access.breaking(lock, actor.player(), actor.bypass(), landTown(block)).isPresent();
  }

  boolean mayWire(Player player, List<Block> blocks) {
    return report(player, blocks, Operation.WIRE);
  }

  boolean mayUnlock(Player player, BlockPos block) {
    var lock = book.lockAt(block);
    if (lock.isEmpty()) {
      return false;
    }
    var actor = Guard.actor(player);
    var land = towns.landAt(block.world(), block.x(), block.y(), block.z());
    var town =
        land instanceof Land.TownLand claim
            ? Optional.of(claim.claim().townId())
            : Optional.<UUID>empty();
    return access.unlocking(lock.get(), actor.player(), actor.bypass(), town).isPresent();
  }

  LockAttempt.Ground ground(Player player, Block block) {
    return switch (towns.landAt(
        block.getWorld().getName(), block.getX(), block.getY(), block.getZ())) {
      case Land.TownLand(var claim) ->
          towns.manages(player.getUniqueId(), claim.townId())
              ? LockAttempt.Ground.MANAGED_CLAIM
              : LockAttempt.Ground.OTHER_CLAIM;
      case Land.Wilderness _,
          Land.RegionLand _,
          Land.ParcelLand _,
          Land.WorkLand _,
          Land.HeritageLand _ ->
          LockAttempt.Ground.OPEN;
    };
  }

  boolean mayOpen(UUID player, boolean bypass, List<Block> blocks) {
    return permits(player, bypass, blocks, Operation.OPEN);
  }

  boolean mayBreak(UUID player, boolean bypass, List<Block> blocks) {
    return permits(player, bypass, blocks, Operation.BREAK);
  }

  /**
   * The lock owners of every end of an item move out of {@code source} into {@code destination}:
   * each block of each container, empty for one nobody locked. An inventory held by an entity (a
   * hopper or chest minecart) is an end nobody can lock; one with no place in the world (a plugin's
   * menu) has no ends.
   */
  List<Optional<UUID>> owners(Inventory source, Inventory destination) {
    var ends = new ArrayList<Optional<UUID>>(4);
    addOwners(source, ends);
    addOwners(destination, ends);
    return ends;
  }

  private void addOwners(Inventory inventory, List<Optional<UUID>> ends) {
    if (inventory.getHolder(false) instanceof Entity) {
      ends.add(Optional.empty());
      return;
    }
    for (var location : Chests.locations(inventory)) {
      ends.add(ownerAt(location));
    }
  }

  private Optional<UUID> ownerAt(Location location) {
    var lock = lockOf(Guard.world(location).getBlockAt(location));
    return lock == null ? Optional.empty() : Optional.of(lock.owner());
  }

  /** True when an item move between {@code source} and {@code destination} may happen. */
  boolean mayTransfer(Inventory source, Inventory destination) {
    return LockAccess.mayTransfer(owners(source, destination));
  }
}
