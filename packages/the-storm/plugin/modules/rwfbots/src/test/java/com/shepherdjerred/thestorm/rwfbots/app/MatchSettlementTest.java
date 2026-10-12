package com.shepherdjerred.thestorm.rwfbots.app;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A match moves the winners' ratings up, the losers' down, and counts what each bot did. */
final class MatchSettlementTest {

  private static final Instant T0 = Instant.parse("2026-10-03T12:00:00Z");

  private static Map<String, PersonalityStats> records() {
    return Map.of(
        "ash", PersonalityStats.fresh("ash", Rating.DEFAULT, T0),
        "ember", PersonalityStats.fresh("ember", Rating.DEFAULT, T0));
  }

  private static Map<
          com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId, List<MatchSettlement.Member>>
      teams() {
    var teams =
        new LinkedHashMap<
            com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId,
            List<MatchSettlement.Member>>();
    teams.put(
        RED,
        List.of(
            new MatchSettlement.Member(
                Optional.empty(), Rating.DEFAULT, PersonalityStats.Tally.NONE),
            new MatchSettlement.Member(
                Optional.of("ash"), Rating.DEFAULT, new PersonalityStats.Tally(2, 0, 1, 0))));
    teams.put(
        BLUE,
        List.of(
            new MatchSettlement.Member(
                Optional.of("ember"), Rating.DEFAULT, new PersonalityStats.Tally(0, 1, 0, 1))));
    return teams;
  }

  @Test
  void theWinnersRiseAndTheLosersFallWithTheirTallies() {
    var later = T0.plusSeconds(600);

    var updated = MatchSettlement.settle(teams(), Optional.of(RED), records(), later);

    assertThat(updated).extracting(PersonalityStats::personalityId).containsExactly("ash", "ember");
    var ash = updated.get(0);
    var ember = updated.get(1);
    assertThat(ash.rating().mu()).isGreaterThan(Rating.DEFAULT.mu());
    assertThat(ember.rating().mu()).isLessThan(Rating.DEFAULT.mu());
    assertThat(ash.rating().sigma()).isLessThan(Rating.DEFAULT.sigma());
    assertThat(ash.matches()).isEqualTo(1);
    assertThat(ash.wins()).isEqualTo(1);
    assertThat(ash.kills()).isEqualTo(2);
    assertThat(ash.plants()).isEqualTo(1);
    assertThat(ember.wins()).isZero();
    assertThat(ember.deaths()).isEqualTo(1);
    assertThat(ember.defuses()).isEqualTo(1);
    assertThat(ember.lastSeen()).isEqualTo(later);
  }

  @Test
  void aDrawLeavesEqualTeamsRatingsWhereTheyWere() {
    var updated = MatchSettlement.settle(teams(), Optional.empty(), records(), T0);

    assertThat(updated.get(1).rating().mu())
        .as("the solo team is weaker on paper, so a draw still rewards it a little")
        .isGreaterThan(Rating.DEFAULT.mu());
    assertThat(updated).allMatch(stats -> stats.wins() == 0 && stats.matches() == 1);
  }

  @Test
  void aBotWithoutARecordIsABug() {
    assertThatThrownBy(() -> MatchSettlement.settle(teams(), Optional.of(RED), Map.of(), T0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("ash");
  }
}
