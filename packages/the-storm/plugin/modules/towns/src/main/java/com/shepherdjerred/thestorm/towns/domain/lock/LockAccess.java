package com.shepherdjerred.thestorm.towns.domain.lock;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

/**
 * Who may open, break and unlock a locked container, and whether items may move in or out of one.
 *
 * <ul>
 *   <li>open: its owner, the players they trust, their town mates when the owner shares it with the
 *       town, the managers of the claim it stands on when the owner is not a member of that town,
 *       and staff with bypass;
 *   <li>break: its owner, players trusted to manage it, those claim managers, and staff; sharing
 *       with the town never lets anyone break it;
 *   <li>unlock: its owner, those claim managers, and staff;
 *   <li>items move by hopper, dropper, crafter, cart or golem only when every end of the move is
 *       locked by the same owner: a hopper under a locked chest must be locked by its owner too.
 * </ul>
 */
public final class LockAccess {

  private final Towns towns;

  /** Towns as locks need them. */
  public interface Towns {

    Optional<UUID> townIdOf(UUID player);

    /** True when {@code player} is the owner or an assistant of {@code townId}. */
    boolean manages(UUID player, UUID townId);

    /**
     * True when one of {@code blocks} is a personal chunk whose resident is not {@code player}, so
     * sharing the lock with the town does not open it for them.
     */
    default boolean blocksTownShare(
        UUID player,
        java.util.Collection<com.shepherdjerred.thestorm.towns.domain.land.BlockPos> blocks) {
      return false;
    }
  }

  /** Why a player may use a lock; staff hear when they only got in by bypass. */
  public enum Right {
    OWNER,
    TRUSTED,
    TOWN,
    LAND_MANAGER,
    BYPASS,
    /** The lock's type lets people who are not on the list use it. */
    PUBLIC,
    /** The player entered this password lock's word during this session. */
    PASSWORD,
  }

  /**
   * What a player who can open the inventory may do with its items. Full access is the owner, a
   * trusted player, a town share, a land manager, staff, or a known password.
   */
  public enum Movement {
    FULL,
    PUT,
    TAKE,
    LOOK,
    NONE
  }

  /**
   * Extra facts about an open that are not the player or the lock: the claim they stand on, whether
   * they already typed the password, and whether they hold one of the lock's groups.
   */
  public record Approach(Optional<UUID> landTown, boolean passwordKnown, boolean groupMember) {

    public Approach(Optional<UUID> landTown) {
      this(landTown, false, false);
    }
  }

  public LockAccess(Towns towns) {
    this.towns = towns;
  }

  /**
   * Why {@code player} may open the container {@code lock} protects, standing on the claim of
   * {@code landTown} (empty off claims), or empty when they may not.
   */
  public Optional<Right> open(Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    return open(lock, player, bypass, new Approach(landTown));
  }

  /**
   * Why {@code player} may open {@code lock}. {@code approach} carries the claim, a known password,
   * and group membership.
   */
  public Optional<Right> open(Lock lock, UUID player, boolean bypass, Approach approach) {
    var landTown = approach.landTown();
    var passwordKnown = approach.passwordKnown();
    var groupMember = approach.groupMember();
    if (lock.ownedByPlayer(player)) {
      return Optional.of(Right.OWNER);
    }
    if (lock.trusted().containsKey(player)) {
      return Optional.of(Right.TRUSTED);
    }
    if (lock.options().sharedWithTown()
        && sameTown(lock.owner(), player)
        && !towns.blocksTownShare(player, lock.blocks())) {
      return Optional.of(Right.TOWN);
    }
    var town = towns.townIdOf(player);
    if (town.isPresent() && lock.options().towns().contains(town.get())) {
      return Optional.of(Right.TOWN);
    }
    if (groupMember) {
      return Optional.of(Right.TRUSTED);
    }
    var staff = managerOrStaff(lock, player, bypass, landTown);
    if (staff.isPresent()) {
      return staff;
    }
    return switch (lock.options().type()) {
      case PRIVATE -> Optional.empty();
      case PASSWORD -> passwordKnown ? Optional.of(Right.PASSWORD) : Optional.empty();
      case PUBLIC, DONATION, SUPPLY, DISPLAY -> Optional.of(Right.PUBLIC);
    };
  }

  /** How {@code player} may move items once the inventory is open. */
  public Movement movement(Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    return movement(lock, player, bypass, new Approach(landTown));
  }

  /** How {@code player} may move items once the inventory is open. */
  public Movement movement(Lock lock, UUID player, boolean bypass, Approach approach) {
    var right = open(lock, player, bypass, approach);
    if (right.isEmpty()) {
      return Movement.NONE;
    }
    if (right.get() != Right.PUBLIC) {
      return Movement.FULL;
    }
    return switch (lock.options().type()) {
      case PUBLIC, PRIVATE, PASSWORD -> Movement.FULL;
      case DONATION -> Movement.PUT;
      case SUPPLY -> Movement.TAKE;
      case DISPLAY -> Movement.LOOK;
    };
  }

  /** Why {@code player} may break the locked container, or empty when they may not. */
  public Optional<Right> breaking(Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    if (lock.ownedByPlayer(player)) {
      return Optional.of(Right.OWNER);
    }
    if (lock.trusted().get(player) == LockGrant.MANAGE) {
      return Optional.of(Right.TRUSTED);
    }
    return managerOrStaff(lock, player, bypass, landTown);
  }

  /** Why {@code player} may remove the lock, or empty when they may not. */
  public Optional<Right> unlocking(
      Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    if (lock.ownedByPlayer(player)) {
      return Optional.of(Right.OWNER);
    }
    return managerOrStaff(lock, player, bypass, landTown);
  }

  private Optional<Right> managerOrStaff(
      Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    if (landTown.isPresent()
        && towns.manages(player, landTown.get())
        && !landTown.equals(towns.townIdOf(lock.owner()))) {
      return Optional.of(Right.LAND_MANAGER);
    }
    return bypass ? Optional.of(Right.BYPASS) : Optional.empty();
  }

  private boolean sameTown(UUID owner, UUID player) {
    var ownerTown = towns.townIdOf(owner);
    return ownerTown.isPresent() && ownerTown.equals(towns.townIdOf(player));
  }

  /**
   * True when items may move between containers whose lock owners are {@code ends} (empty for an
   * end nobody locked, such as a hopper minecart): when nobody locked any end, or one owner locked
   * every end.
   */
  public static boolean mayTransfer(Collection<Optional<UUID>> ends) {
    var owners = ends.stream().flatMap(Optional::stream).distinct().count();
    if (owners == 0) {
      return true;
    }
    return owners == 1 && ends.stream().allMatch(Optional::isPresent);
  }
}
