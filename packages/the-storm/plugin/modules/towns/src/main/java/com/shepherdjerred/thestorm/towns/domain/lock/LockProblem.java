package com.shepherdjerred.thestorm.towns.domain.lock;

/** Why a lock change was refused. */
public sealed interface LockProblem {

  /** Nothing here is locked. */
  record NotLocked() implements LockProblem {}

  /** It is already locked, by the player themselves when {@code yours}. */
  record AlreadyLocked(boolean yours) implements LockProblem {}

  /** Someone else placed this container; only they may lock it. */
  record PlacedBySomeoneElse() implements LockProblem {}

  /** The player may not build where the container stands, so it is not theirs to lock. */
  record NotYourLand() implements LockProblem {}

  /** Nobody placed it and it stands on a town's claim: only that town's managers may lock it. */
  record TownsToLock() implements LockProblem {}

  /** The owner asked for {@code setting} to be {@code on}, and it already is. */
  record Unchanged(String setting, boolean on) implements LockProblem {}

  /** The player holds as many locks as they may. */
  record LimitReached(int limit) implements LockProblem {}

  /** Only the lock's owner may unlock it or change who it trusts. */
  record NotYourLock() implements LockProblem {}

  /** The owner always has access; they cannot trust or untrust themselves. */
  record NotYourself() implements LockProblem {}

  /** The named player is already trusted. */
  record AlreadyTrusted(String player) implements LockProblem {}

  /** The named player is not trusted. */
  record NotTrusted(String player) implements LockProblem {}

  /** A change to this lock is still being saved. */
  record Busy() implements LockProblem {}
}
