package com.shepherdjerred.thestorm.quests.domain.engine;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.CALENDAR;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.empty;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Comparison;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemFacts;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest.Repeat;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest;
import com.shepherdjerred.thestorm.quests.domain.state.Completion;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Conditions, the calendar, credit, game time, craft counts and placed blocks. */
final class RulesTest {

  private static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");

  // ---- conditions --------------------------------------------------------------------------

  @Test
  void worldConditionsAskTheFacts() {
    var facts =
        new ScriptedFacts()
            .give(IRON, 3)
            .track("mechanic", 2)
            .weather(Weather.THUNDER)
            .at("spawn")
            .permit("a.b")
            .time(20 * 60);
    var state = empty();
    assertThat(Conditions.holds(new Condition.HasItem(IRON, 3), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.HasItem(IRON, 4), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.TrackAtLeast("mechanic", 2), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.TrackAtLeast("mechanic", 3), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.WeatherIs(Weather.THUNDER), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.WeatherIs(Weather.RAIN), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.InRegion("spawn"), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.InRegion("mines"), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.HasPermission("a.b"), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.HasPermission("a.c"), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.TimeBetween(18 * 60, 6 * 60), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.TimeBetween(6 * 60, 18 * 60), state, facts))
        .isFalse();
  }

  @Test
  void timeRangesWrapPastMidnight() {
    assertThat(Conditions.between(23 * 60, 22 * 60, 2 * 60)).isTrue();
    assertThat(Conditions.between(60, 22 * 60, 2 * 60)).isTrue();
    assertThat(Conditions.between(2 * 60, 22 * 60, 2 * 60)).isFalse();
    assertThat(Conditions.between(12 * 60, 22 * 60, 2 * 60)).isFalse();
    assertThat(Conditions.between(6 * 60, 6 * 60, 18 * 60)).isTrue();
    assertThat(Conditions.between(18 * 60, 6 * 60, 18 * 60)).isFalse();
    assertThatThrownBy(() -> new Condition.TimeBetween(60, 60))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void stateConditionsAskTheQuestState() {
    var facts = new ScriptedFacts();
    var state =
        empty()
            .withCompletion("a", new Completion(1, Instant.EPOCH))
            .withActive(ActiveQuest.entering("b", "s", 0, Instant.EPOCH))
            .withReputation("town", 5)
            .withPoints(4)
            .withVariable("x", 3);
    assertThat(Conditions.holds(new Condition.Completed("a"), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.Completed("b"), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.Active("b"), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.Active("a"), state, facts)).isFalse();
    assertThat(Conditions.holds(new Condition.ReputationAtLeast("town", 5), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.ReputationAtLeast("town", 6), state, facts))
        .isFalse();
    assertThat(Conditions.holds(new Condition.ReputationAtLeast("other", 0), state, facts))
        .isTrue();
    assertThat(Conditions.holds(new Condition.PointsAtLeast(4), state, facts)).isTrue();
    assertThat(Conditions.holds(new Condition.Not(new Condition.PointsAtLeast(4)), state, facts))
        .isFalse();
    assertThat(Conditions.all(List.of(), state, facts)).isTrue();
    for (var comparison : Comparison.values()) {
      var expected =
          switch (comparison) {
            case EQUAL, LESS_OR_EQUAL, GREATER_OR_EQUAL -> true;
            case NOT_EQUAL, LESS, GREATER -> false;
          };
      assertThat(Conditions.holds(new Condition.Compare("x", comparison, 3), state, facts))
          .as(comparison.name())
          .isEqualTo(expected);
    }
    assertThat(Conditions.holds(new Condition.Compare("unset", Comparison.EQUAL, 0), state, facts))
        .isTrue();
    assertThat(Comparison.LESS.test(2, 3)).isTrue();
    assertThat(Comparison.GREATER.test(4, 3)).isTrue();
  }

  // ---- the calendar ------------------------------------------------------------------------

  private static Optional<Completion> doneAt(String instant) {
    return Optional.of(new Completion(1, Instant.parse(instant)));
  }

  @Test
  void neverCompletedIsAlwaysAvailable() {
    for (var repeat : Repeat.values()) {
      assertThat(CALENDAR.available(repeat, Optional.empty(), Instant.EPOCH)).isTrue();
    }
  }

  @Test
  void onceIsNeverAvailableAgain() {
    assertThat(
            CALENDAR.available(
                Repeat.ONCE, doneAt("2020-01-01T00:00:00Z"), Instant.parse("2030-01-01T00:00:00Z")))
        .isFalse();
  }

  @Test
  void dailyTurnsAtLocalMidnightNotUtc() {
    // 23:30 Los Angeles on the 23rd is 06:30 UTC on the 24th.
    var done = doneAt("2026-09-24T06:30:00Z");
    assertThat(CALENDAR.available(Repeat.DAILY, done, Instant.parse("2026-09-24T06:59:59Z")))
        .isFalse();
    assertThat(CALENDAR.available(Repeat.DAILY, done, Instant.parse("2026-09-24T07:00:00Z")))
        .isTrue();
  }

  @Test
  void weeklyTurnsAtTheStartOfTheWeek() {
    // Sunday 2026-09-27 12:00 Los Angeles; the week starts Monday.
    var done = doneAt("2026-09-27T19:00:00Z");
    assertThat(CALENDAR.week(Instant.parse("2026-09-27T19:00:00Z")).toString())
        .isEqualTo("2026-09-21");
    assertThat(CALENDAR.available(Repeat.WEEKLY, done, Instant.parse("2026-09-28T06:59:00Z")))
        .isFalse();
    assertThat(CALENDAR.available(Repeat.WEEKLY, done, Instant.parse("2026-09-28T07:00:00Z")))
        .isTrue();
    // Done on a Monday morning: not again until the next Monday.
    var monday = doneAt("2026-09-28T16:00:00Z");
    assertThat(CALENDAR.available(Repeat.WEEKLY, monday, Instant.parse("2026-10-04T20:00:00Z")))
        .isFalse();
    assertThat(CALENDAR.available(Repeat.WEEKLY, monday, Instant.parse("2026-10-05T07:00:00Z")))
        .isTrue();
  }

  // ---- credit ------------------------------------------------------------------------------

  @Test
  void eachObjectiveCountsOnlyItsOwnEvents() {
    var cod = ItemFacts.of("COD");
    assertThat(
            Credit.of(
                new Objective.Kill("ZOMBIE", 1, Optional.empty()), new QuestEvent.Killed("ZOMBIE")))
        .isEqualTo(1);
    assertThat(
            Credit.of(
                new Objective.Kill("ZOMBIE", 1, Optional.empty()), new QuestEvent.Mined("ZOMBIE")))
        .isZero();
    assertThat(
            Credit.of(
                new Objective.Collect(IRON, 9, Optional.empty()),
                new QuestEvent.Collected(ItemFacts.of("IRON_INGOT"), 4)))
        .isEqualTo(4);
    assertThat(
            Credit.of(
                new Objective.Craft(IRON, 9, Optional.empty()),
                new QuestEvent.Crafted(ItemFacts.of("GOLD_INGOT"), 4)))
        .isZero();
    assertThat(
            Credit.of(
                new Objective.Craft(IRON, 9, Optional.empty()),
                new QuestEvent.Crafted(ItemFacts.of("IRON_INGOT"), 2)))
        .isEqualTo(2);
    assertThat(
            Credit.of(
                new Objective.Fish(Optional.empty(), 2, Optional.empty()),
                new QuestEvent.Fished(cod)))
        .isEqualTo(1);
    assertThat(
            Credit.of(
                new Objective.Fish(Optional.of(ItemMatch.of("SALMON")), 2, Optional.empty()),
                new QuestEvent.Fished(cod)))
        .isZero();
    assertThat(
            Credit.of(
                new Objective.Mine("STONE", 2, Optional.empty()), new QuestEvent.Mined("STONE")))
        .isEqualTo(1);
    assertThat(
            Credit.of(
                new Objective.Place("TORCH", 2, Optional.empty()), new QuestEvent.Placed("TORCH")))
        .isEqualTo(1);
    assertThat(
            Credit.of(
                new Objective.Reach("mines", Optional.empty()),
                new QuestEvent.Reached(Set.of("mines", "spawn"))))
        .isEqualTo(1);
    assertThat(
            Credit.of(
                new Objective.Custom("wave", 5, Optional.empty()), new QuestEvent.Hook("wave", 3)))
        .isEqualTo(3);
    assertThat(
            Credit.of(
                new Objective.Custom("wave", 5, Optional.empty()), new QuestEvent.Hook("other", 3)))
        .isZero();
    for (var event :
        List.of(
            new QuestEvent.Killed("ZOMBIE"),
            new QuestEvent.Collected(ItemFacts.of("IRON_INGOT"), 1))) {
      assertThat(Credit.of(new Objective.Talk("nat", Optional.empty()), event)).isZero();
      assertThat(Credit.of(new Objective.Hold(IRON, 1, Optional.empty()), event)).isZero();
      assertThat(Credit.of(new Objective.Deliver("nat", IRON, 1, Optional.empty()), event))
          .isZero();
      assertThat(Credit.of(new Objective.Level("mechanic", 1, Optional.empty()), event)).isZero();
      assertThat(event.shared()).isTrue();
    }
    assertThat(new QuestEvent.Mined("STONE").shared()).isFalse();
  }

  @Test
  void itemMatchesNeedEveryComponentAsked() {
    var sword =
        new ItemMatch("DIAMOND_SWORD", Optional.empty(), Map.of("sharpness", 5), Optional.empty());
    var plain = ItemFacts.of("DIAMOND_SWORD");
    var sharp5 =
        new ItemFacts("DIAMOND_SWORD", Optional.empty(), Map.of("sharpness", 5), Optional.empty());
    var sharp4 =
        new ItemFacts("DIAMOND_SWORD", Optional.empty(), Map.of("sharpness", 4), Optional.empty());
    assertThat(sword.matches(sharp5)).isTrue();
    assertThat(sword.matches(sharp4)).isFalse();
    assertThat(sword.matches(plain)).isFalse();
    assertThat(ItemMatch.of("DIAMOND_SWORD").matches(sharp4)).isTrue();
    var named = new ItemMatch("PAPER", Optional.of("Crime Report"), Map.of(), Optional.empty());
    assertThat(named.matches(ItemFacts.of("PAPER"))).isFalse();
    assertThat(
            named.matches(
                new ItemFacts("PAPER", Optional.of("Crime Report"), Map.of(), Optional.empty())))
        .isTrue();
    var potion = new ItemMatch("POTION", Optional.empty(), Map.of(), Optional.of("healing"));
    assertThat(
            potion.matches(
                new ItemFacts("POTION", Optional.empty(), Map.of(), Optional.of("healing"))))
        .isTrue();
    assertThat(
            potion.matches(
                new ItemFacts("POTION", Optional.empty(), Map.of(), Optional.of("poison"))))
        .isFalse();
    assertThat(potion.hasComponents()).isTrue();
    assertThatThrownBy(() -> ItemMatch.of("iron")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ItemMatch("X", Optional.empty(), Map.of("a", 0), Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  // ---- small helpers -----------------------------------------------------------------------

  @Test
  void gameTimeStartsAtSunrise() {
    assertThat(GameTime.minuteOfDay(0)).isEqualTo(6 * 60);
    assertThat(GameTime.minuteOfDay(6000)).isEqualTo(12 * 60);
    assertThat(GameTime.minuteOfDay(18000)).isZero();
    assertThat(GameTime.minuteOfDay(23999)).isEqualTo(6 * 60 - 1);
    assertThat(GameTime.minuteOfDay(24000 * 3 + 12000)).isEqualTo(18 * 60);
    assertThat(GameTime.minuteOfDay(-6000)).isZero();
  }

  @Test
  void craftCounts() {
    assertThat(CraftCount.of(false, 4, List.of(5, 3), 64)).isEqualTo(4);
    assertThat(CraftCount.of(true, 4, List.of(5, 3), 64)).isEqualTo(12);
    assertThat(CraftCount.of(true, 4, List.of(64), 10)).isEqualTo(8);
    assertThat(CraftCount.of(true, 1, List.of(), 64)).isZero();
    assertThat(CraftCount.of(true, 4, List.of(3), 0)).isZero();
  }

  @Test
  void placedBlocksDoNotCountWhenBroken() {
    var memory = Duration.ofDays(2);
    var placed = new PlacedBlocks(memory);
    var now = Instant.parse("2026-10-06T00:00:00Z");
    var owner = UUID.fromString("69aef4f7-91d0-4f09-aef1-c721307aa45c");
    var other = UUID.fromString("c5d09d96-02f7-448a-a18e-47cdf894a401");
    var a = new PlacedBlocks.Position("w", 0, 64, 0);
    var b = new PlacedBlocks.Position("w", 1, 64, 0);
    var c = new PlacedBlocks.Position("w", 2, 64, 0);
    assertThat(placed.broken(a, owner, now)).isEqualTo(PlacedBlocks.Break.NATURAL);
    placed.placed(a, Optional.of(owner), now);
    assertThat(placed.broken(a, owner, now)).isEqualTo(PlacedBlocks.Break.OWN);
    assertThat(placed.broken(a, owner, now)).isEqualTo(PlacedBlocks.Break.NATURAL);
    placed.placed(a, Optional.of(owner), now);
    placed.placed(b, Optional.of(other), now);
    placed.placed(c, Optional.empty(), now);
    // Time, rather than later placements, determines when a placement expires.
    assertThat(placed.remembers(a, now)).isTrue();
    assertThat(placed.broken(b, owner, now)).isEqualTo(PlacedBlocks.Break.PLACED);
    assertThat(placed.broken(c, owner, now)).isEqualTo(PlacedBlocks.Break.PLACED);
    assertThat(placed.broken(a, owner, now.plus(memory))).isEqualTo(PlacedBlocks.Break.OWN);
    placed.placed(a, Optional.of(owner), now);
    assertThat(placed.broken(a, owner, now.plus(memory).plusNanos(1)))
        .isEqualTo(PlacedBlocks.Break.NATURAL);
    assertThatThrownBy(() -> new PlacedBlocks(Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PlacedBlocks(Duration.ofDays(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
