package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Buying track levels, for {@code /perks buy} and the trainer NPCs. Call from the main thread, show
 * the {@link #quote} to the player, and {@link #buy} it once they confirm. Futures complete on the
 * main thread.
 *
 * <p>A purchase is all or nothing from the player's view: the level is saved only after payment,
 * and a payment whose level cannot be saved is refunded.
 */
public interface TrackPurchases {

  /**
   * The next level of {@code track} for {@code player} and its price, or every reason they can't.
   */
  CompletableFuture<Result<Quote, List<PurchaseProblem>>> quote(UUID player, Track track);

  /**
   * Charges {@code player} for {@code quote} and grants the level. Fails with {@link
   * PurchaseProblem.QuoteChanged} if the level or price is no longer what was offered.
   */
  CompletableFuture<Result<Purchase, List<PurchaseProblem>>> buy(UUID player, Quote quote);
}
