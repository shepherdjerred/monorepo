package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import java.time.Duration;
import org.junit.jupiter.api.Test;

final class ExplanationsTest {

  private final Explanations explanations =
      new Explanations(
          ConfigFiles.load(TracksConfigTest.SHIPPED, TracksConfig.class), Progressions::crystals);

  private String explain(PurchaseProblem problem) {
    return explanations.explain(problem, NOW);
  }

  @Test
  void namesAndOffersUseTheConfiguredNames() {
    assertThat(explanations.name(MECHANIC)).isEqualTo("Mechanic");
    assertThat(explanations.ranked(MECHANIC, 3)).isEqualTo("Mechanic III");
    assertThat(explanations.offer(new Quote(ENGINEER, 2, 3_750)))
        .isEqualTo("Engineer II for 3,750 crystals");
  }

  @Test
  void everyPurchaseProblemReads() {
    var quote = new Quote(MECHANIC, 2, 2_500);
    assertThat(explain(new PurchaseProblem.AlreadyMaxed(MECHANIC)))
        .isEqualTo("Mechanic is already at its highest level.");
    assertThat(explain(new PurchaseProblem.NotNextLevel(MECHANIC, 0, 3)))
        .isEqualTo("Start Mechanic at I.");
    assertThat(explain(new PurchaseProblem.NotNextLevel(MECHANIC, 1, 3)))
        .isEqualTo("Train Mechanic II first.");
    assertThat(explain(new PurchaseProblem.NotNextLevel(MECHANIC, 3, 2)))
        .isEqualTo("You already have Mechanic III.");
    assertThat(explain(new PurchaseProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1)))
        .isEqualTo("Your primary track is Mechanic I; it must reach II before Engineer can.");
    assertThat(explain(new PurchaseProblem.CoolingDown(NOW.plus(Duration.ofMinutes(90)))))
        .isEqualTo("You can train again in 1h 30m.");
    assertThat(explain(new PurchaseProblem.CannotAfford(2_500, 12)))
        .isEqualTo("You need 2,500 crystals and have 12 crystals.");
    assertThat(explain(new PurchaseProblem.QuoteChanged(quote, new Quote(MECHANIC, 2, 3_750))))
        .isEqualTo(
            "The offer changed from Mechanic II for 2,500 crystals to Mechanic II for 3,750"
                + " crystals; check again.");
    assertThat(explain(new PurchaseProblem.StillLoading()))
        .isEqualTo("Your tracks are still loading; try again in a moment.");
    assertThat(explain(new PurchaseProblem.LoadFailed()))
        .isEqualTo("Your tracks could not be loaded; try again shortly.");
    assertThat(explain(new PurchaseProblem.ShuttingDown()))
        .isEqualTo("The server is stopping; train again once it is back.");
    assertThat(explain(new PurchaseProblem.AlreadyBuying()))
        .isEqualTo("You are already buying a level; wait for it to finish.");
    assertThat(explain(new PurchaseProblem.NotRecorded(quote)))
        .isEqualTo(
            "Buying Mechanic II could not be saved, so your crystals were refunded. Try again.");
  }

  @Test
  void everyAdminProblemReads() {
    assertThat(explanations.explain(new AdminProblem.AbovePrimary(ENGINEER, 4, MECHANIC, 3)))
        .isEqualTo("Engineer IV would pass the primary track, Mechanic III.");
    assertThat(explanations.explain(new AdminProblem.BelowSecondary(MECHANIC, 1, ENGINEER, 2)))
        .isEqualTo("The primary track, Mechanic, cannot go below Engineer II (asked for I).");
    assertThat(explanations.explain(new AdminProblem.WouldChangePrimary(MECHANIC)))
        .isEqualTo("Mechanic is the primary track; use /perks admin reset to change it.");
  }
}
