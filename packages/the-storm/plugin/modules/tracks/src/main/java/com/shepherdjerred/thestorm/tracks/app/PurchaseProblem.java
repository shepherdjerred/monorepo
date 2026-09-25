package com.shepherdjerred.thestorm.tracks.app;

import java.time.Instant;

/** Why a player cannot buy a track level. Several may apply at once. */
public sealed interface PurchaseProblem {

  /** The track is already at {@link Track#MAX_LEVEL}. */
  record AlreadyMaxed(Track track) implements PurchaseProblem {}

  /** Levels are bought one at a time, in order; {@code requested} is not the next one. */
  record NotNextLevel(Track track, int current, int requested) implements PurchaseProblem {}

  /** A secondary track may not pass the primary track's level. */
  record AbovePrimary(Track track, int requested, Track primary, int primaryLevel)
      implements PurchaseProblem {}

  /** The player bought a level recently and may buy again at {@code availableAt}. */
  record CoolingDown(Instant availableAt) implements PurchaseProblem {}

  /** The player holds fewer crystals than the level costs. */
  record CannotAfford(long cost, long balance) implements PurchaseProblem {}

  /** The price or level differs from the quote the player confirmed. */
  record QuoteChanged(Quote offered, Quote current) implements PurchaseProblem {}

  /** The player's levels have not loaded since they joined. */
  record StillLoading() implements PurchaseProblem {}

  /** Loading the player's levels failed; it is being retried. */
  record LoadFailed() implements PurchaseProblem {}

  /** The server is stopping and takes no new purchases. */
  record ShuttingDown() implements PurchaseProblem {}

  /** Another purchase for this player has not finished. */
  record AlreadyBuying() implements PurchaseProblem {}

  /** The level could not be saved after payment, so the payment was refunded. */
  record NotRecorded(Quote quote) implements PurchaseProblem {}
}
