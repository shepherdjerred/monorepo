package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Locking, unlocking, trusting and the owner's options. Anyone may lock a container they placed;
 * one nobody is recorded as placing may be locked by whoever may build there in the wilderness, and
 * on a claim only by the town's owner or assistants (it is the town's). Only the owner changes who
 * a lock trusts and what it allows; staff with bypass may lock anything.
 */
public final class LockRules {

  private LockRules() {}

  /** The new lock, or every reason it cannot be made. */
  public static Result<Lock, List<LockProblem>> lock(
      LockAttempt attempt, LockIndex index, LockPolicy policy) {
    var problems = new ArrayList<LockProblem>();
    var player = attempt.player();
    attempt.blocks().stream()
        .flatMap(block -> index.lockAt(block).stream())
        .findFirst()
        .ifPresent(
            lock -> problems.add(new LockProblem.AlreadyLocked(lock.owner().equals(player))));
    standingProblem(player, attempt.standing()).ifPresent(problems::add);
    if (index.countOf(player) >= policy.maxPerPlayer()) {
      problems.add(new LockProblem.LimitReached(policy.maxPerPlayer()));
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(Lock.of(attempt.newId(), player, Set.copyOf(attempt.blocks())));
  }

  private static Optional<LockProblem> standingProblem(UUID player, LockAttempt.Standing standing) {
    if (standing.bypass()) {
      return Optional.empty();
    }
    var placedBy = standing.placedBy();
    if (placedBy != null && !placedBy.equals(player)) {
      return Optional.of(new LockProblem.PlacedBySomeoneElse());
    }
    if (placedBy == null && standing.land() == LockAttempt.Ground.OTHER_CLAIM) {
      return Optional.of(new LockProblem.TownsToLock());
    }
    return standing.mayBuild() ? Optional.empty() : Optional.of(new LockProblem.NotYourLand());
  }

  /** The lock to remove; {@code mayUnlock} says whether {@code LockAccess#unlocking} allows it. */
  public static Result<Lock, List<LockProblem>> unlock(Optional<Lock> lock, boolean mayUnlock) {
    if (lock.isEmpty()) {
      return err(new LockProblem.NotLocked());
    }
    return mayUnlock ? Result.ok(lock.get()) : err(new LockProblem.NotYourLock());
  }

  /**
   * The lock trusting {@code target} with {@code grant}, or no longer trusting them when {@code
   * grant} is empty. Owner only.
   */
  public static Result<Lock, List<LockProblem>> trust(
      UUID player, Optional<Lock> lock, PlayerRef target, Optional<LockGrant> grant) {
    return owned(player, lock)
        .flatMap(
            found -> {
              if (target.id().equals(player)) {
                return err(new LockProblem.NotYourself());
              }
              var current = Optional.ofNullable(found.trusted().get(target.id()));
              if (grant.isEmpty()) {
                return current.isPresent()
                    ? Result.ok(found.withoutTrust(target.id()))
                    : err(new LockProblem.NotTrusted(target.name()));
              }
              return current.equals(grant)
                  ? err(new LockProblem.AlreadyTrusted(target.name()))
                  : Result.ok(found.withTrust(target.id(), grant.get()));
            });
  }

  /** The lock shared with the owner's town (opening only), or no longer shared. Owner only. */
  public static Result<Lock, List<LockProblem>> shareWithTown(
      UUID player, Optional<Lock> lock, boolean on) {
    return owned(player, lock)
        .flatMap(
            found ->
                found.options().sharedWithTown() == on
                    ? err(new LockProblem.Unchanged("town sharing", on))
                    : Result.ok(
                        found.withOptions(new Lock.Options(on, found.options().redstone()))));
  }

  /** The lock letting redstone dispense or craft from it, or not. Owner only. */
  public static Result<Lock, List<LockProblem>> redstone(
      UUID player, Optional<Lock> lock, boolean on) {
    return owned(player, lock)
        .flatMap(
            found ->
                found.options().redstone() == on
                    ? err(new LockProblem.Unchanged("redstone", on))
                    : Result.ok(
                        found.withOptions(new Lock.Options(found.options().sharedWithTown(), on))));
  }

  private static Result<Lock, List<LockProblem>> owned(UUID player, Optional<Lock> lock) {
    if (lock.isEmpty()) {
      return err(new LockProblem.NotLocked());
    }
    return lock.get().owner().equals(player)
        ? Result.ok(lock.get())
        : err(new LockProblem.NotYourLock());
  }

  private static Result<Lock, List<LockProblem>> err(LockProblem problem) {
    return Result.err(List.of(problem));
  }
}
