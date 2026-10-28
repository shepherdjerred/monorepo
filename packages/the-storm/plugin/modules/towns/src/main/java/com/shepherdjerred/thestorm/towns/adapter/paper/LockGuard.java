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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemFrame;
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

  /** Password locks a player has opened since they logged in. */
  private final Map<UUID, Set<UUID>> passwords = new ConcurrentHashMap<>();

  /**
   * The password lock a player was just asked to answer in chat. Read from the async chat thread so
   * the password is not broadcast, and removed on the main thread.
   */
  private final Map<UUID, UUID> awaitingPassword = new ConcurrentHashMap<>();

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

  /** The id of the town named {@code name}, ignoring case. */
  Optional<UUID> townNamed(String name) {
    return towns.named(name).map(town -> town.id());
  }

  /** The lock on an item frame or armor stand, stored at the block that entity occupies. */
  @Nullable Lock kept(Entity entity) {
    if (!(entity instanceof ItemFrame) && !(entity instanceof ArmorStand)) {
      return null;
    }
    return keptAt(entity.getLocation().getBlock());
  }

  /** A lock stored at {@code block} even when that block is not itself a container. */
  @Nullable Lock keptAt(Block block) {
    if (isSealed(block.getWorld())) {
      return null;
    }
    return book.at(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  /**
   * True when {@code player} may use {@code entity}'s lock. An entity with no lock is free. A
   * refusal is told to the player.
   */
  boolean mayUse(Player player, Entity entity, boolean breaking) {
    var lock = kept(entity);
    if (lock == null) {
      return true;
    }
    var block = entity.getLocation().getBlock();
    var actor = Guard.actor(player);
    var allowed =
        breaking
            ? access.breaking(lock, actor.player(), actor.bypass(), landTown(block))
            : access.open(
                lock,
                actor.player(),
                actor.bypass(),
                new LockAccess.Approach(
                    landTown(block),
                    knowsPassword(player.getUniqueId(), lock),
                    inGroup(player, lock)));
    if (allowed.isPresent()) {
      return true;
    }
    notices.denied(player, new Denial.Locked());
    return false;
  }

  /** A locked machine may use its own inventory from redstone only by explicit owner choice. */
  boolean mayAutomate(Block block) {
    var lock = lockOf(block);
    return lock == null || lock.options().redstone();
  }

  /**
   * The blocks of the container at {@code block}: it, its double-chest partner, or its other half.
   */
  static List<Block> container(Block block) {
    var blocks = new ArrayList<Block>(2);
    blocks.add(block);
    Chests.partner(block).ifPresent(partner -> add(blocks, partner));
    Doors.otherHalf(block).ifPresent(half -> add(blocks, half));
    return List.copyOf(blocks);
  }

  /** {@link #container(Block)}, plus both halves of a paired door. */
  static List<Block> covered(Block block) {
    var blocks = new ArrayList<>(container(block));
    for (var extra : Doors.pair(block)) {
      add(blocks, extra);
    }
    return List.copyOf(blocks);
  }

  private static void add(List<Block> blocks, Block block) {
    if (!blocks.contains(block)) {
      blocks.add(block);
    }
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

  private record Who(UUID player, boolean bypass, Predicate<Lock> groupMember) {}

  private boolean permits(Player actor, List<Block> blocks, Operation operation) {
    var who = Guard.actor(actor);
    return permits(
        blocks, operation, new Who(who.player(), who.bypass(), lock -> inGroup(actor, lock)));
  }

  private boolean permits(UUID player, boolean bypass, List<Block> blocks, Operation operation) {
    return permits(blocks, operation, new Who(player, bypass, lock -> false));
  }

  private boolean permits(List<Block> blocks, Operation operation, Who who) {
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
            case OPEN ->
                access.open(
                    lock,
                    who.player(),
                    who.bypass(),
                    new LockAccess.Approach(
                        landTown(block),
                        knowsPassword(who.player(), lock),
                        who.groupMember().test(lock)));
            case BREAK, WIRE -> access.breaking(lock, who.player(), who.bypass(), landTown(block));
          };
      if (allowed.isEmpty()) {
        return false;
      }
    }
    return true;
  }

  private static boolean inGroup(Player player, Lock lock) {
    for (var group : lock.options().groups()) {
      var node = "thestorm.towns.lock.group." + group;
      if (player.isPermissionSet(node) && player.hasPermission(node)) {
        return true;
      }
    }
    return false;
  }

  private boolean report(Player player, List<Block> blocks, Operation operation) {
    if (permits(player, blocks, operation)) {
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
    if (LockAccess.mayTransfer(owners(source, destination))) {
      return true;
    }
    return allowsOut(source) && allowsIn(destination);
  }

  /** How {@code player} may move items in the lock on {@code block}. */
  LockAccess.Movement movement(Player player, Block block) {
    var lock = lockOf(block);
    if (lock == null) {
      return LockAccess.Movement.FULL;
    }
    var actor = Guard.actor(player);
    return access.movement(
        lock,
        actor.player(),
        actor.bypass(),
        new LockAccess.Approach(
            landTown(block), knowsPassword(actor.player(), lock), inGroup(player, lock)));
  }

  boolean knowsPassword(UUID player, Lock lock) {
    return passwords.getOrDefault(player, Set.of()).contains(lock.id());
  }

  /** The next chat message from {@code player} is an attempt at {@code lock}'s password. */
  void expectPassword(UUID player, Lock lock) {
    awaitingPassword.put(player, lock.id());
  }

  /** True when {@code player} has been asked for a password and has not answered. */
  boolean isAwaitingPassword(UUID player) {
    return awaitingPassword.containsKey(player);
  }

  /** The lock id {@code player} was asked to unlock, if they have not answered yet. */
  @Nullable UUID takePasswordPrompt(UUID player) {
    return awaitingPassword.remove(player);
  }

  void grantPassword(UUID player, UUID lockId) {
    passwords.computeIfAbsent(player, id -> new HashSet<>()).add(lockId);
  }

  /** Drops password access when {@code player} logs out. */
  void forgetPasswords(UUID player) {
    passwords.remove(player);
    awaitingPassword.remove(player);
  }

  private boolean allowsOut(Inventory inventory) {
    for (var lock : locksOf(inventory)) {
      var flags = lock.options().flags();
      if (!flags.hopper() && !flags.hopperOut()) {
        return false;
      }
    }
    return true;
  }

  private boolean allowsIn(Inventory inventory) {
    for (var lock : locksOf(inventory)) {
      var flags = lock.options().flags();
      if (!flags.hopper() && !flags.hopperIn()) {
        return false;
      }
    }
    return true;
  }

  private List<Lock> locksOf(Inventory inventory) {
    if (inventory.getHolder(false) instanceof Entity) {
      return List.of();
    }
    var found = new ArrayList<Lock>();
    for (var location : Chests.locations(inventory)) {
      var lock = lockOf(Guard.world(location).getBlockAt(location));
      if (lock != null) {
        found.add(lock);
      }
    }
    return found;
  }
}
