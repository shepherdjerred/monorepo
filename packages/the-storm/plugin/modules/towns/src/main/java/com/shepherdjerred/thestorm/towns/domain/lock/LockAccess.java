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
  }

  /** Why a player may use a lock; staff hear when they only got in by bypass. */
  public enum Right {
    OWNER,
    TRUSTED,
    TOWN,
    LAND_MANAGER,
    BYPASS,
  }

  public LockAccess(Towns towns) {
    this.towns = towns;
  }

  /**
   * Why {@code player} may open the container {@code lock} protects, standing on the claim of
   * {@code landTown} (empty off claims), or empty when they may not.
   */
  public Optional<Right> open(Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    if (lock.owner().equals(player)) {
      return Optional.of(Right.OWNER);
    }
    if (lock.trusted().containsKey(player)) {
      return Optional.of(Right.TRUSTED);
    }
    if (lock.options().sharedWithTown() && sameTown(lock.owner(), player)) {
      return Optional.of(Right.TOWN);
    }
    return managerOrStaff(lock, player, bypass, landTown);
  }

  /** Why {@code player} may break the locked container, or empty when they may not. */
  public Optional<Right> breaking(Lock lock, UUID player, boolean bypass, Optional<UUID> landTown) {
    if (lock.owner().equals(player)) {
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
    if (lock.owner().equals(player)) {
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
