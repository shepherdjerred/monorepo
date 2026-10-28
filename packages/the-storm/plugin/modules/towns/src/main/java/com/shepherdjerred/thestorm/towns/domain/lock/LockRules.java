package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;

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
        .ifPresent(lock -> problems.add(new LockProblem.AlreadyLocked(lock.ownedByPlayer(player))));
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
   * grant} is empty. The owner, or an admin on the list, may change it.
   */
  public static Result<Lock, List<LockProblem>> trust(
      UUID player, Optional<Lock> lock, PlayerRef target, Optional<LockGrant> grant) {
    return editable(player, lock)
        .flatMap(
            found -> {
              if (found.ownedByPlayer(target.id())) {
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
                    : Result.ok(found.withOptions(found.options().withShared(on))));
  }

  /** The lock letting redstone dispense or craft from it, or not. Owner only. */
  public static Result<Lock, List<LockProblem>> redstone(
      UUID player, Optional<Lock> lock, boolean on) {
    return owned(player, lock)
        .flatMap(
            found ->
                found.options().redstone() == on
                    ? err(new LockProblem.Unchanged("redstone", on))
                    : Result.ok(found.withOptions(found.options().withRedstone(on))));
  }

  /** The lock switched to {@code type}. A password lock keeps {@code password}. Owner only. */
  public static Result<Lock, List<LockProblem>> type(
      UUID player, Optional<Lock> lock, LockType type, String password) {
    return owned(player, lock)
        .flatMap(
            found -> {
              if (type == LockType.PASSWORD && password.isBlank()) {
                return err(new LockProblem.PasswordMissing());
              }
              var word = type == LockType.PASSWORD ? password : "";
              if (found.options().type() == type && found.options().password().equals(word)) {
                return err(
                    new LockProblem.Unchanged(
                        type.name().toLowerCase(java.util.Locale.ROOT), true));
              }
              return Result.ok(found.withType(type, word));
            });
  }

  /** The lock with {@code flag} set to {@code on}. Owner only. */
  public static Result<Lock, List<LockProblem>> flag(
      UUID player, Optional<Lock> lock, LockFlag flag, boolean on) {
    return owned(player, lock)
        .flatMap(
            found ->
                flag.isOn(found.options().flags()) == on
                    ? err(
                        new LockProblem.Unchanged(
                            flag.name().toLowerCase(java.util.Locale.ROOT), on))
                    : Result.ok(found.withFlag(flag, on)));
  }

  /**
   * The lock with permission group {@code name} added or removed. {@code name} is stored in lower
   * case. The owner, or an admin on the list, may change it.
   */
  public static Result<Lock, List<LockProblem>> group(
      UUID player, Optional<Lock> lock, String name, boolean on) {
    var normalized = name.toLowerCase(Locale.ROOT);
    if (!normalized.matches("[a-z0-9._-]{1,32}")) {
      return err(new LockProblem.BadEntry(name));
    }
    return editable(player, lock)
        .flatMap(
            found -> {
              var has = found.options().groups().contains(normalized);
              if (has == on) {
                return err(new LockProblem.Unchanged("group " + normalized, on));
              }
              var next = new HashSet<>(found.options().groups());
              if (on) {
                next.add(normalized);
              } else {
                next.remove(normalized);
              }
              return Result.ok(found.withOptions(found.options().withGroups(next)));
            });
  }

  /**
   * The lock whose extra town list includes {@code town}, or no longer does. The owner, or an admin
   * on the list, may change it.
   */
  public static Result<Lock, List<LockProblem>> town(
      UUID player, Optional<Lock> lock, UUID town, boolean on) {
    return editable(player, lock)
        .flatMap(
            found -> {
              var has = found.options().towns().contains(town);
              if (has == on) {
                return err(new LockProblem.Unchanged("town", on));
              }
              var next = new HashSet<>(found.options().towns());
              if (on) {
                next.add(town);
              } else {
                next.remove(town);
              }
              return Result.ok(found.withOptions(found.options().withTowns(next)));
            });
  }

  /**
   * Locks that an admin expiry removes: not exempt, and not opened after {@code now} minus {@code
   * days}.
   */
  public static List<Lock> expired(Collection<Lock> locks, Instant now, int days) {
    var cutoff = now.minus(Duration.ofDays(days));
    return locks.stream()
        .filter(lock -> !lock.options().flags().exempt())
        .filter(lock -> !lock.options().lastUsed().isAfter(cutoff))
        .toList();
  }

  /** Locks whose owner matches {@code owner}, except exempt locks. */
  public static List<Lock> purge(Collection<Lock> locks, Predicate<UUID> owner) {
    return locks.stream()
        .filter(lock -> !lock.options().flags().exempt())
        .filter(lock -> owner.test(lock.owner()))
        .toList();
  }

  private static Result<Lock, List<LockProblem>> editable(UUID player, Optional<Lock> lock) {
    if (lock.isEmpty()) {
      return err(new LockProblem.NotLocked());
    }
    var found = lock.get();
    if (found.ownedByPlayer(player) || found.trusted().get(player) == LockGrant.ADMIN) {
      return Result.ok(found);
    }
    return err(new LockProblem.NotYourLock());
  }

  private static Result<Lock, List<LockProblem>> owned(UUID player, Optional<Lock> lock) {
    if (lock.isEmpty()) {
      return err(new LockProblem.NotLocked());
    }
    return lock.get().ownedByPlayer(player)
        ? Result.ok(lock.get())
        : err(new LockProblem.NotYourLock());
  }

  private static Result<Lock, List<LockProblem>> err(LockProblem problem) {
    return Result.err(List.of(problem));
  }
}
