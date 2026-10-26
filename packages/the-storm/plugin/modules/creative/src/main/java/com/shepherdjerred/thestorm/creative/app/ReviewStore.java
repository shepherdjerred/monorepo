package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Rating;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Ratings and comments. A missing claim row is written in the same call so the foreign key holds.
 */
public interface ReviewStore {

  /** Every rating and comment. */
  record Snapshot(List<Rating> ratings, List<Comment> comments) {}

  CompletableFuture<Snapshot> load();

  /**
   * Stores {@code score} for {@code player} on {@code plot}. {@code ensure} is written first when
   * the plot has no claim row yet.
   */
  CompletableFuture<Void> rate(Optional<StoredClaim> ensure, PlotId plot, UUID player, int score);

  /** Adds one comment, writing {@code ensure} first when the plot has no claim row yet. */
  CompletableFuture<Void> comment(Optional<StoredClaim> ensure, Comment comment);

  /** Removes one comment. The claim row stays. */
  CompletableFuture<Void> delete(PlotId plot, UUID player, int posted);
}
