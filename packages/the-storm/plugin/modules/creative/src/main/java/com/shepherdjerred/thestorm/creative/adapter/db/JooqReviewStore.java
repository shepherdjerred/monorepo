package com.shepherdjerred.thestorm.creative.adapter.db;

import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_COMMENTS;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_RATINGS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Rating;
import com.shepherdjerred.thestorm.creative.app.ReviewStore;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotReviews;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** {@link ReviewStore} over ratings and comments. */
public final class JooqReviewStore implements ReviewStore {

  private final StormDatabase database;

  public JooqReviewStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Snapshot> load() {
    return database.read(JooqReviewStore::readAll);
  }

  @Override
  public CompletableFuture<Void> rate(
      Optional<StoredClaim> ensure, PlotId plot, UUID player, int score) {
    PlotReviews.rate(java.util.Map.of(), player, score);
    return done(
        database.write(
            dsl -> {
              ensure(dsl, ensure);
              dsl.insertInto(CREATIVE_RATINGS)
                  .set(CREATIVE_RATINGS.PLOT_X, plot.x())
                  .set(CREATIVE_RATINGS.PLOT_Z, plot.z())
                  .set(CREATIVE_RATINGS.PLAYER, player.toString())
                  .set(CREATIVE_RATINGS.SCORE, score)
                  .onConflict(
                      CREATIVE_RATINGS.PLOT_X, CREATIVE_RATINGS.PLOT_Z, CREATIVE_RATINGS.PLAYER)
                  .doUpdate()
                  .set(CREATIVE_RATINGS.SCORE, score)
                  .execute();
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> comment(Optional<StoredClaim> ensure, Comment comment) {
    return done(
        database.write(
            dsl -> {
              ensure(dsl, ensure);
              dsl.insertInto(CREATIVE_COMMENTS)
                  .set(CREATIVE_COMMENTS.PLOT_X, comment.plot().x())
                  .set(CREATIVE_COMMENTS.PLOT_Z, comment.plot().z())
                  .set(CREATIVE_COMMENTS.PLAYER, comment.player().toString())
                  .set(CREATIVE_COMMENTS.AUTHOR, comment.author())
                  .set(CREATIVE_COMMENTS.BODY, comment.body())
                  .set(CREATIVE_COMMENTS.POSTED, comment.posted())
                  .execute();
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> delete(PlotId plot, UUID player, int posted) {
    return done(
        database.write(
            dsl ->
                dsl.deleteFrom(CREATIVE_COMMENTS)
                    .where(CREATIVE_COMMENTS.PLOT_X.eq(plot.x()))
                    .and(CREATIVE_COMMENTS.PLOT_Z.eq(plot.z()))
                    .and(CREATIVE_COMMENTS.PLAYER.eq(player.toString()))
                    .and(CREATIVE_COMMENTS.POSTED.eq(posted))
                    .execute()));
  }

  private static Snapshot readAll(DSLContext dsl) {
    var ratings = new ArrayList<Rating>();
    for (var row : dsl.selectFrom(CREATIVE_RATINGS).fetch()) {
      int score = column(row.getScore(), "score");
      if (score < 1 || score > 5) {
        throw new IllegalStateException("creative rating is outside 1 through 5");
      }
      ratings.add(
          new Rating(
              plotId(row.getPlotX(), row.getPlotZ()),
              UUID.fromString(column(row.getPlayer(), "player")),
              score));
    }
    var comments = new ArrayList<Comment>();
    for (var row : dsl.selectFrom(CREATIVE_COMMENTS).fetch()) {
      var author = column(row.getAuthor(), "author");
      var body = column(row.getBody(), "body");
      if (author.isBlank() || body.isBlank()) {
        throw new IllegalStateException("creative comment is blank");
      }
      comments.add(
          new Comment(
              plotId(row.getPlotX(), row.getPlotZ()),
              UUID.fromString(column(row.getPlayer(), "player")),
              author,
              body,
              column(row.getPosted(), "posted")));
    }
    return new Snapshot(List.copyOf(ratings), List.copyOf(comments));
  }

  private static void ensure(DSLContext dsl, Optional<StoredClaim> claim) {
    if (claim.isPresent()) {
      JooqClaimStore.replace(dsl, claim.orElseThrow());
    }
  }

  private static PlotId plotId(Integer x, Integer z) {
    return new PlotId(column(x, "plot_x"), column(z, "plot_z"));
  }

  private static <T> T column(T value, String name) {
    if (value == null) {
      throw new IllegalStateException("creative review column " + name + " is null");
    }
    return value;
  }

  private static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }
}
