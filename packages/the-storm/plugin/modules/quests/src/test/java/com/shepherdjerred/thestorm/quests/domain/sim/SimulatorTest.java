package com.shepherdjerred.thestorm.quests.domain.sim;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.CALENDAR;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.NOW;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.always;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.when;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class SimulatorTest {

  private static List<Simulator.Run> simulate(Quest quest, Quest... others) {
    var all = new java.util.ArrayList<>(List.of(others));
    all.add(quest);
    return Simulator.simulate(Catalog.of(all), quest, CALENDAR, NOW);
  }

  @Test
  void everyKindOfObjectiveIsPlayedThrough() {
    var iron = ItemMatch.of("IRON_INGOT");
    var quest =
        quest("all")
            .stage(
                stage("s")
                    .objective(new Objective.Deliver("giver", iron, 5, Optional.empty()))
                    .objective(new Objective.Hold(iron, 2, Optional.empty()))
                    .objective(new Objective.Collect(iron, 3, Optional.empty()))
                    .objective(new Objective.Craft(iron, 3, Optional.empty()))
                    .objective(new Objective.Fish(Optional.empty(), 2, Optional.empty()))
                    .objective(new Objective.Mine("STONE", 2, Optional.empty()))
                    .objective(new Objective.Place("TORCH", 2, Optional.empty()))
                    .objective(new Objective.Kill("ZOMBIE", 3, Optional.empty()))
                    .objective(new Objective.Reach("mines", Optional.empty()))
                    .objective(new Objective.Level("mechanic", 2, Optional.empty()))
                    .objective(new Objective.Custom("wave", 4, Optional.empty()))
                    .objective(talk("giver")))
            .reward(new Action.Crystals(10))
            .build();
    var runs = simulate(quest);
    assertThat(runs)
        .singleElement()
        .satisfies(
            run -> {
              assertThat(run.completed()).as(String.join("\n", run.transcript())).isTrue();
              assertThat(run.crystals()).isEqualTo(10);
              assertThat(run.transcript()).last().isEqualTo("completed");
            });
  }

  @Test
  void everyOptionOfEveryChoiceIsARun() {
    var quest =
        quest("pick")
            .stage(
                stage("a")
                    .objective(talk("giver"))
                    .choice(new Stage.Option("Left", "left"), new Stage.Option("Right", "right")))
            .stage(
                stage("left")
                    .onComplete(new Action.Crystals(5))
                    .choice(
                        new Stage.Option("Up", "complete"), new Stage.Option("Down", "complete")))
            .stage(stage("right").onComplete(new Action.Crystals(7)))
            .start("a")
            .build();
    var runs = simulate(quest);
    assertThat(runs)
        .extracting(Simulator.Run::choices)
        .containsExactlyInAnyOrder(List.of(0, 0), List.of(0, 1), List.of(1));
    assertThat(runs).allSatisfy(run -> assertThat(run.completed()).isTrue());
    assertThat(runs).extracting(Simulator.Run::crystals).containsExactlyInAnyOrder(5L, 5L, 7L);
  }

  @Test
  void requirementsAndWaitingBranchesAreSatisfied() {
    var prior = quest("prior").stage(stage("s").objective(talk("giver"))).build();
    var quest =
        quest("gated")
            .requires(new Condition.Completed("prior"))
            .requires(new Condition.ReputationAtLeast("town", 5))
            .requires(new Condition.Compare("x", Condition.Comparison.GREATER, 2))
            .requires(new Condition.HasItem(ItemMatch.of("COD"), 1))
            .requires(new Condition.TimeBetween(20 * 60, 4 * 60))
            .requires(new Condition.PointsAtLeast(3))
            .requires(new Condition.HasPermission("a.b"))
            .requires(new Condition.InRegion("mines"))
            .requires(new Condition.TrackAtLeast("mechanic", 1))
            .requires(new Condition.Active("prior"))
            .stage(
                stage("s")
                    .objective(talk("giver"))
                    .branches(when("complete", new Condition.WeatherIs(Condition.Weather.THUNDER))))
            .build();
    var runs = simulate(quest, prior);
    assertThat(runs)
        .singleElement()
        .satisfies(
            run -> {
              assertThat(run.completed()).as(String.join("\n", run.transcript())).isTrue();
              assertThat(run.transcript()).contains("wait for complete");
            });
  }

  @Test
  void refusalsFailuresAndStuckQuestsAreReported() {
    var locked =
        quest("locked")
            .requires(new Condition.Not(new Condition.PointsAtLeast(0)))
            .stage(stage("s").objective(talk("giver")))
            .build();
    assertThat(simulate(locked))
        .singleElement()
        .satisfies(
            run -> {
              assertThat(run.completed()).isFalse();
              assertThat(run.transcript()).anyMatch(line -> line.startsWith("refused"));
            });
    var failing = quest("fails").stage(stage("s").objective(talk("giver")).then("fail")).build();
    assertThat(simulate(failing))
        .singleElement()
        .satisfies(
            run -> {
              assertThat(run.completed()).isFalse();
              assertThat(run.transcript()).last().isEqualTo("ended without completing");
            });
    var stuck =
        quest("stuck")
            .stage(
                stage("s")
                    .objective(talk("giver"))
                    .branches(
                        when("complete", new Condition.Not(new Condition.PointsAtLeast(0))),
                        always("fail")))
            .build();
    // The first branch can never hold, so after the objective the second (fail) is taken.
    assertThat(simulate(stuck))
        .singleElement()
        .satisfies(run -> assertThat(run.completed()).isFalse());
    var waiting =
        quest("waiting")
            .stage(
                stage("s")
                    .objective(talk("giver"))
                    .branches(when("complete", new Condition.Not(new Condition.PointsAtLeast(0)))))
            .build();
    assertThat(simulate(waiting))
        .singleElement()
        .satisfies(
            run -> {
              assertThat(run.completed()).isFalse();
              assertThat(run.transcript()).anyMatch(line -> line.startsWith("stuck in stage"));
            });
  }
}
