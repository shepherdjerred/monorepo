package com.shepherdjerred.thestorm.quests.domain.storylet;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.NOW;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.context;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.empty;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Comparison;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import com.shepherdjerred.thestorm.quests.domain.storylet.Storylets.Candidate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

final class StoryletsTest {

  private static Quest offer(String id, Quest.Category category) {
    return quest(id)
        .giver("thomas")
        .category(category)
        .stage(stage("s").objective(talk("thomas")))
        .build();
  }

  @Test
  void requirementsRepeatCooldownAndNpcAreCheckedBeforeSelection() {
    var story = offer("story", Quest.Category.STORY);
    var daily =
        quest("daily")
            .giver("thomas")
            .repeat(Quest.Repeat.DAILY)
            .stage(stage("s").objective(talk("thomas")))
            .build();
    var locked =
        quest("locked")
            .giver("thomas")
            .requires(new Condition.Compare("permission", Comparison.EQUAL, 1))
            .stage(stage("s").objective(talk("thomas")))
            .build();
    var elsewhere =
        quest("elsewhere").giver("nat").stage(stage("s").objective(talk("nat"))).build();
    var hidden = offer("hidden", Quest.Category.HIDDEN);
    var state = empty().withCompletion("daily", new Completion(1, NOW));
    var context = context(new ScriptedFacts(), story, daily, locked, elsewhere, hidden);

    assertThat(Storylets.offers(state, "thomas", context, 5)).containsExactly(story);
    assertThat(
            Storylets.offers(
                state,
                "thomas",
                context(
                    new ScriptedFacts(),
                    NOW.plus(1, ChronoUnit.DAYS),
                    story,
                    daily,
                    locked,
                    hidden),
                5))
        .containsExactly(story, daily);
  }

  @Test
  void salienceKeepsMainStoryAheadOfDailyOffers() {
    var story = offer("story", Quest.Category.STORY);
    var side = offer("side", Quest.Category.SIDE);
    var daily = offer("daily", Quest.Category.DAILY);
    var context = context(new ScriptedFacts(), daily, side, story);

    assertThat(Storylets.offers(empty(), "thomas", context, 2)).containsExactly(story, side);
    assertThat(Storylets.offers(empty(), "thomas", context, 0)).isEmpty();
  }

  @Test
  void weightedDrawIsStableAndFavorsHigherWeights() {
    var light = new Candidate(offer("light", Quest.Category.SIDE), 2, 1);
    var heavy = new Candidate(offer("heavy", Quest.Category.SIDE), 2, 9);
    var candidates = List.of(light, heavy);
    int heavyWins = 0;
    for (long seed = 0; seed < 1_000; seed++) {
      var winner = Storylets.select(candidates, 1, seed);
      assertThat(winner).isEqualTo(Storylets.select(List.of(heavy, light), 1, seed));
      if (winner.getFirst().id().equals("heavy")) {
        heavyWins++;
      }
    }
    assertThat(heavyWins).isGreaterThan(800);
  }

  @Test
  void questIdsWithEqualJavaHashesStillRotate() {
    var first = new Candidate(offer("an", Quest.Category.SIDE), 2, 1);
    var second = new Candidate(offer("c0", Quest.Category.SIDE), 2, 1);
    assertThat(first.quest().id().hashCode()).isEqualTo(second.quest().id().hashCode());
    var winners =
        java.util.stream.LongStream.range(0, 100)
            .mapToObj(seed -> Storylets.select(List.of(first, second), 1, seed).getFirst().id())
            .distinct()
            .toList();
    assertThat(winners).containsExactlyInAnyOrder("an", "c0");
  }

  @Test
  void invalidSelectionRulesFail() {
    var candidate = new Candidate(offer("q", Quest.Category.SIDE), 0, 1);
    assertThatThrownBy(() -> new Candidate(candidate.quest(), 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Storylets.select(List.of(candidate), -1, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
