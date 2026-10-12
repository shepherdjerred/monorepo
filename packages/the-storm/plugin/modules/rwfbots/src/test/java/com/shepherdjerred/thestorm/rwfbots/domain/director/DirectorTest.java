package com.shepherdjerred.thestorm.rwfbots.domain.director;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.personality;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class DirectorTest {

  @Test
  void winnersRiseLosersFallAndEveryoneGetsSurer() {
    var teams =
        List.of(List.of(Rating.DEFAULT, Rating.DEFAULT), List.of(Rating.DEFAULT, Rating.DEFAULT));
    var rated = OpenSkill.rate(teams, List.of(0, 1));
    for (var winner : rated.get(0)) {
      assertThat(winner.mu()).isGreaterThan(Rating.DEFAULT.mu());
      assertThat(winner.sigma()).isLessThan(Rating.DEFAULT.sigma());
    }
    for (var loser : rated.get(1)) {
      assertThat(loser.mu()).isLessThan(Rating.DEFAULT.mu());
    }
    assertThat(rated.get(0).getFirst().mu() - Rating.DEFAULT.mu())
        .isCloseTo(Rating.DEFAULT.mu() - rated.get(1).getFirst().mu(), within(1e-9));
    var tie = OpenSkill.rate(teams, List.of(0, 0));
    assertThat(tie.get(0).getFirst().mu()).isCloseTo(Rating.DEFAULT.mu(), within(1e-9));
  }

  @Test
  void upsetsMoveRatingsMoreThanExpectedResults() {
    var strong = new Rating(35, 3);
    var weak = new Rating(15, 3);
    var expected = OpenSkill.rate(List.of(List.of(strong), List.of(weak)), List.of(0, 1));
    var upset = OpenSkill.rate(List.of(List.of(strong), List.of(weak)), List.of(1, 0));
    assertThat(expected.get(0).getFirst().mu() - strong.mu())
        .isLessThan(upset.get(1).getFirst().mu() - weak.mu());
    assertThat(OpenSkill.winProbability(List.of(strong), List.of(weak))).isGreaterThan(0.95);
    assertThat(OpenSkill.winProbability(List.of(weak), List.of(weak))).isCloseTo(0.5, within(1e-9));
  }

  @Test
  void normalQuantileInvertsTheCdf() {
    for (var p : new double[] {0.01, 0.1, 0.45, 0.55, 0.9, 0.99}) {
      assertThat(Normal.cdf(Normal.quantile(p))).isCloseTo(p, within(1e-6));
    }
    assertThat(Normal.quantile(0.5)).isCloseTo(0, within(1e-9));
  }

  @Test
  void balancerMakesTeamsOfEqualSizeAndCloseStrength() {
    var lobby = new ArrayList<Participant>();
    double[] mus = {40, 35, 33, 30, 28, 22, 20, 12};
    for (var i = 0; i < mus.length; i++) {
      lobby.add(new Participant("p" + i, new Rating(mus[i], 5), i < 3));
    }
    var teams = TeamBalancer.balance(lobby, 2);
    assertThat(teams.get(0)).hasSize(4);
    assertThat(teams.get(1)).hasSize(4);
    assertThat(TeamBalancer.spread(teams)).isLessThanOrEqualTo(2);
    assertThat(TeamBalancer.balance(lobby, 2)).isEqualTo(teams);
    var everyone = teams.stream().flatMap(List::stream).map(Participant::id).toList();
    assertThat(everyone)
        .containsExactlyInAnyOrderElementsOf(lobby.stream().map(Participant::id).toList());
  }

  @Test
  void matchShiftPutsBotsJustUnderTheHumanMedianAndDoesNotRubberBand() {
    var humans = List.of(new Rating(25, 4), new Rating(31, 4), new Rating(19, 4));
    var botSkills = List.of(0.5, 0.5, 0.5);
    var shift = MatchShift.choose(humans, botSkills, MatchShift.TARGET_HUMAN_WIN);
    var botMu = SkillScale.toMu(0.5 + shift);
    assertThat(botMu).isLessThan(25).isGreaterThan(23);
    assertThat(
            OpenSkill.winProbability(
                List.of(new Rating(25, 0.01)), List.of(new Rating(botMu, 0.01))))
        .isCloseTo(MatchShift.TARGET_HUMAN_WIN, within(0.01));
    assertThat(MatchShift.choose(humans, botSkills, MatchShift.TARGET_HUMAN_WIN)).isEqualTo(shift);
    var stronger = List.of(new Rating(30, 4), new Rating(36, 4), new Rating(24, 4));
    assertThat(MatchShift.choose(stronger, botSkills, MatchShift.TARGET_HUMAN_WIN))
        .isGreaterThan(shift);
    assertThat(MatchShift.choose(List.of(new Rating(60, 1)), botSkills, 0.55))
        .isEqualTo(MatchShift.MAX_SHIFT);
  }

  @Test
  void draftIsSeededAndDistinct() {
    var catalog =
        new PersonalityCatalog(
            List.of(
                personality("alder", "Alder", 0.3),
                personality("birch", "Birch", 0.5),
                personality("cedar", "Cedar", 0.7),
                personality("dogwood", "Dogwood", 0.9)));
    var first = Draft.draft(catalog, 3, new SplittableRandom(5));
    var again = Draft.draft(catalog, 3, new SplittableRandom(5));
    assertThat(first).hasSize(3).doesNotHaveDuplicates().isEqualTo(again);
    assertThatThrownBy(() -> Draft.draft(catalog, 5, new SplittableRandom(5)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
