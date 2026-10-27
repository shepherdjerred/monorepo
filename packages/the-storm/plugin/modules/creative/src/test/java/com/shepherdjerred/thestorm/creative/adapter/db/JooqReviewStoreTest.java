package com.shepherdjerred.thestorm.creative.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqReviewStoreTest {

  private static final UUID OWNER = UUID.fromString("cb488c76-08ba-4755-b425-6613fde02f70");
  private static final UUID VISITOR = UUID.fromString("00000000-0000-0000-0000-000000000002");

  @TempDir Path directory;

  @Test
  void onePlayerKeepsOneRatingAndAClaimSaveLeavesIt() throws Exception {
    var plot = new PlotId(1, 1);
    var claim = claim(plot);
    try (var database = StormDatabase.open(directory.resolve("reviews.db"))) {
      database.migrate("creative", JooqReviewStoreTest.class.getClassLoader());
      var claims = new JooqClaimStore(database);
      var reviews = new JooqReviewStore(database);

      reviews.rate(Optional.of(claim), plot, OWNER, 4).join();
      reviews.rate(Optional.empty(), plot, OWNER, 5).join();
      reviews.rate(Optional.empty(), plot, VISITOR, 3).join();
      var loaded = reviews.load().join();
      assertThat(loaded.ratings()).hasSize(2);
      assertThat(loaded.ratings())
          .filteredOn(rating -> rating.player().equals(OWNER))
          .singleElement()
          .extracting(rating -> rating.score())
          .isEqualTo(5);

      claims.save(claim.withText("Harbor", "A dock")).join();
      assertThat(reviews.load().join().ratings()).hasSize(2);

      var note = new Comment(plot, VISITOR, "Visitor", "Quiet", 1);
      reviews.comment(Optional.empty(), note).join();
      reviews.delete(plot, VISITOR, 1).join();
      assertThat(reviews.load().join().comments()).isEmpty();
      assertThat(reviews.load().join().ratings()).hasSize(2);
    }
  }

  private static StoredClaim claim(PlotId plot) {
    return new StoredClaim(
        plot,
        Optional.of(OWNER),
        false,
        true,
        "",
        "",
        Map.of(),
        Set.of(),
        PlotSurface.DEFAULT,
        Optional.empty(),
        false);
  }
}
