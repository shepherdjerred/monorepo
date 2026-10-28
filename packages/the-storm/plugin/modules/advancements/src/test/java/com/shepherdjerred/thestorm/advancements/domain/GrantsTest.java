package com.shepherdjerred.thestorm.advancements.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class GrantsTest {

  @Test
  void tenQuestsStopAtTenErrands() {
    assertThat(Grants.quests(10)).containsExactly("a_survival/quest/1", "a_survival/quest/10");
  }

  @Test
  void twentyFiveClaimsStopAtGrowingTown() {
    assertThat(Grants.town(true, 25))
        .containsExactly("a_survival/town/settled", "a_survival/town/1", "a_survival/town/25");
  }

  @Test
  void aPlayerWithoutATownEarnsNothing() {
    assertThat(Grants.town(false, 40)).isEmpty();
  }

  @Test
  void aFailedShardEarnsNothingAndATierEarnsEveryLowerTier() {
    assertThat(Grants.shard(0)).isEmpty();
    assertThat(Grants.shard(3))
        .containsExactly("a_survival/shard/1", "a_survival/shard/2", "a_survival/shard/3");
  }

  @Test
  void aTrackLevelEarnsEveryLowerLevel() {
    assertThat(Grants.track("mechanic", 3))
        .containsExactly("b_tracks/mechanic/1", "b_tracks/mechanic/2", "b_tracks/mechanic/3");
    assertThat(Grants.track("mechanic", 0)).isEmpty();
  }

  @Test
  void risingFrom240To260Awards250AndNot500() {
    assertThat(Grants.skillCrossed("mining", 240, 260)).containsExactly("c_skills/mining/250");
    assertThat(Grants.skill("mining", 260))
        .containsExactly("c_skills/mining/100", "c_skills/mining/250");
  }

  @Test
  void bestWave25Awards10And25Not40() {
    assertThat(Grants.waves(25))
        .containsExactly("e_arena/wave/1", "e_arena/wave/10", "e_arena/wave/25");
  }

  @Test
  void defeatIsNotTheLastWave() {
    assertThat(Grants.arenaNotice("DEFEAT", 72)).isEmpty();
    assertThat(Grants.arenaNotice("VICTORY", 72)).containsExactly("e_arena/clear");
    assertThat(Grants.waves(72)).doesNotContain("e_arena/clear");
  }

  @Test
  void tenWinsAwardRoundWonAndTenWinsOnly() {
    assertThat(Grants.search(new Grants.SearchTotals(10, 10, 0, 0, 0, 0)))
        .contains("f_search/wins/1", "f_search/wins/10")
        .doesNotContain("f_search/wins/25", "f_search/wins/50");
  }

  @Test
  void anAfkWinDoesNotCount() {
    assertThat(Grants.winsCountingThisMatch(10, true, true)).isEqualTo(9);
    assertThat(
            Grants.search(
                new Grants.SearchTotals(
                    10, Grants.winsCountingThisMatch(10, true, true), 0, 0, 0, 0)))
        .contains("f_search/wins/1")
        .doesNotContain("f_search/wins/10");
    assertThat(Grants.winsCountingThisMatch(10, true, false)).isEqualTo(10);
  }

  @Test
  void aKillstreakRewardEarnsTheKillstreak() {
    assertThat(Grants.search(new Grants.SearchTotals(1, 0, 2, 0, 0, 1)))
        .contains("f_search/killstreak");
    assertThat(Grants.search(new Grants.SearchTotals(1, 0, 2, 0, 0, 0)))
        .doesNotContain("f_search/killstreak");
  }

  @Test
  void aWinWithoutAMatchIsCorrupt() {
    assertThatThrownBy(() -> Grants.search(new Grants.SearchTotals(0, 1, 0, 0, 0, 0)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
