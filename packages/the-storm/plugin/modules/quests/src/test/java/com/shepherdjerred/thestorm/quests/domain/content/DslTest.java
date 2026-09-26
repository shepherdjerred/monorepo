package com.shepherdjerred.thestorm.quests.domain.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Comparison;
import com.shepherdjerred.thestorm.quests.domain.model.Condition.Weather;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class DslTest {

  private static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");

  private static <T> T ok(Result<T, String> result) {
    return result.fold(
        value -> value,
        error -> {
          throw new AssertionError(error);
        });
  }

  private static <T> String err(Result<T, String> result) {
    return result.fold(
        value -> {
          throw new AssertionError("expected an error, got " + value);
        },
        error -> error);
  }

  @Test
  void everyObjectiveParses() {
    assertThat(ok(Dsl.objective("talk thomas")))
        .isEqualTo(new Objective.Talk("thomas", Optional.empty()));
    assertThat(ok(Dsl.objective("deliver thomas 32 IRON_INGOT")))
        .isEqualTo(new Objective.Deliver("thomas", IRON, 32, Optional.empty()));
    assertThat(ok(Dsl.objective("hold 5 IRON_INGOT")))
        .isEqualTo(new Objective.Hold(IRON, 5, Optional.empty()));
    assertThat(ok(Dsl.objective("collect 5 IRON_INGOT")))
        .isEqualTo(new Objective.Collect(IRON, 5, Optional.empty()));
    assertThat(ok(Dsl.objective("craft 2 IRON_INGOT")))
        .isEqualTo(new Objective.Craft(IRON, 2, Optional.empty()));
    assertThat(ok(Dsl.objective("fish 3 any")))
        .isEqualTo(new Objective.Fish(Optional.empty(), 3, Optional.empty()));
    assertThat(ok(Dsl.objective("fish 1 TROPICAL_FISH")))
        .isEqualTo(
            new Objective.Fish(Optional.of(ItemMatch.of("TROPICAL_FISH")), 1, Optional.empty()));
    assertThat(ok(Dsl.objective("mine 10 stone")))
        .isEqualTo(new Objective.Mine("STONE", 10, Optional.empty()));
    assertThat(ok(Dsl.objective("place 4 TORCH")))
        .isEqualTo(new Objective.Place("TORCH", 4, Optional.empty()));
    assertThat(ok(Dsl.objective("kill 12 zombified_piglin")))
        .isEqualTo(new Objective.Kill("ZOMBIFIED_PIGLIN", 12, Optional.empty()));
    assertThat(ok(Dsl.objective("reach south-mines")))
        .isEqualTo(new Objective.Reach("south-mines", Optional.empty()));
    assertThat(ok(Dsl.objective("level mechanic 2")))
        .isEqualTo(new Objective.Level("mechanic", 2, Optional.empty()));
    assertThat(ok(Dsl.objective("custom arena-wave 3")))
        .isEqualTo(new Objective.Custom("arena-wave", 3, Optional.empty()));
  }

  @Test
  void aLabelReplacesTheDescription() {
    assertThat(ok(Dsl.objective("deliver stanley 1 TROPICAL_FISH | Something funny")))
        .isEqualTo(
            new Objective.Deliver(
                "stanley", ItemMatch.of("TROPICAL_FISH"), 1, Optional.of("Something funny")));
    assertThat(err(Dsl.objective("talk nat | "))).contains("must not be empty");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "dance",
        "talk",
        "talk a b",
        "deliver thomas many IRON_INGOT",
        "deliver thomas 0 IRON_INGOT",
        "kill -1 ZOMBIE",
        "kill 5",
        "hold 5",
        "level mechanic",
        "deliver thomas 5 iron_ingot",
      })
  void malformedObjectivesAreErrors(String line) {
    assertThat(Dsl.objective(line).isOk()).isFalse();
  }

  @Test
  void itemsCarryComponents() {
    var sword =
        ok(Dsl.item("DIAMOND_SWORD[enchant=sharpness:5,enchant=unbreaking:3,name=Old Faithful]"));
    assertThat(sword.material()).isEqualTo("DIAMOND_SWORD");
    assertThat(sword.enchantments()).isEqualTo(Map.of("sharpness", 5, "unbreaking", 3));
    assertThat(sword.name()).contains("Old Faithful");
    var potion = ok(Dsl.item("POTION[potion=strong_healing]"));
    assertThat(potion.potion()).contains("strong_healing");
    assertThat(err(Dsl.item("POTION[potion]"))).contains("key=value");
    assertThat(err(Dsl.item("POTION[colour=red]"))).contains("unknown item component");
    assertThat(err(Dsl.item("POTION[potion=a"))).contains("end with ]");
    assertThat(err(Dsl.item("SWORD[enchant=sharpness]"))).contains("key:level");
    assertThat(err(Dsl.item("SWORD[enchant=sharpness:1,enchant=sharpness:2]"))).contains("twice");
    assertThat(err(Dsl.item("SWORD[name= ]"))).contains("blank");
  }

  @Test
  void everyConditionParses() {
    assertThat(ok(Dsl.condition("has 3 IRON_INGOT"))).isEqualTo(new Condition.HasItem(IRON, 3));
    assertThat(ok(Dsl.condition("track mechanic 2")))
        .isEqualTo(new Condition.TrackAtLeast("mechanic", 2));
    assertThat(ok(Dsl.condition("completed a"))).isEqualTo(new Condition.Completed("a"));
    assertThat(ok(Dsl.condition("active a"))).isEqualTo(new Condition.Active("a"));
    assertThat(ok(Dsl.condition("reputation townsfolk 5")))
        .isEqualTo(new Condition.ReputationAtLeast("townsfolk", 5));
    assertThat(ok(Dsl.condition("points 3"))).isEqualTo(new Condition.PointsAtLeast(3));
    assertThat(ok(Dsl.condition("time 18:00-06:00")))
        .isEqualTo(new Condition.TimeBetween(18 * 60, 6 * 60));
    assertThat(ok(Dsl.condition("weather storm")))
        .isEqualTo(new Condition.WeatherIs(Weather.THUNDER));
    assertThat(ok(Dsl.condition("weather rain"))).isEqualTo(new Condition.WeatherIs(Weather.RAIN));
    assertThat(ok(Dsl.condition("weather clear")))
        .isEqualTo(new Condition.WeatherIs(Weather.CLEAR));
    assertThat(ok(Dsl.condition("region spawn"))).isEqualTo(new Condition.InRegion("spawn"));
    assertThat(ok(Dsl.condition("permission a.b"))).isEqualTo(new Condition.HasPermission("a.b"));
    assertThat(ok(Dsl.condition("var claims >= 3")))
        .isEqualTo(new Condition.Compare("claims", Comparison.GREATER_OR_EQUAL, 3));
    assertThat(ok(Dsl.condition("not completed a")))
        .isEqualTo(new Condition.Not(new Condition.Completed("a")));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "sunny",
        "weather snow",
        "time 25:00-01:00",
        "time 06:00",
        "time 06:00-06:00",
        "var x ~ 3",
        "points many",
        "completed",
      })
  void malformedConditionsAreErrors(String line) {
    assertThat(Dsl.condition(line).isOk()).isFalse();
  }

  @Test
  void everyActionParses() {
    assertThat(ok(Dsl.action("give 2 IRON_INGOT"))).isEqualTo(new Action.Give(IRON, 2));
    assertThat(ok(Dsl.action("give 1 IRON_INGOT[name=Lucky Bar]")))
        .isEqualTo(
            new Action.Give(
                new ItemMatch("IRON_INGOT", Optional.of("Lucky Bar"), Map.of(), Optional.empty()),
                1));
    assertThat(ok(Dsl.action("take 2 IRON_INGOT"))).isEqualTo(new Action.Take(IRON, 2));
    assertThat(ok(Dsl.action("crystals 750"))).isEqualTo(new Action.Crystals(750));
    assertThat(ok(Dsl.action("permission a.b"))).isEqualTo(new Action.Grant("a.b"));
    assertThat(ok(Dsl.action("title scientist"))).isEqualTo(new Action.Title("scientist"));
    assertThat(ok(Dsl.action("spell blink"))).isEqualTo(new Action.Spell("blink"));
    assertThat(ok(Dsl.action("set x 4"))).isEqualTo(new Action.SetVariable("x", 4));
    assertThat(ok(Dsl.action("add x -1"))).isEqualTo(new Action.AddVariable("x", -1));
    assertThat(ok(Dsl.action("flag met"))).isEqualTo(new Action.SetVariable("met", 1));
    assertThat(ok(Dsl.action("reputation townsfolk -2")))
        .isEqualTo(new Action.Reputation("townsfolk", -2));
    assertThat(ok(Dsl.action("points 3"))).isEqualTo(new Action.Points(3));
    assertThat(ok(Dsl.action("start next"))).isEqualTo(new Action.StartQuest("next"));
    assertThat(ok(Dsl.action("message Hello there, traveller!")))
        .isEqualTo(new Action.Message("Hello there, traveller!"));
    assertThat(ok(Dsl.action("teleport spawn"))).isEqualTo(new Action.Teleport("spawn"));
    assertThat(ok(Dsl.action("spawn 1 elder_guardian shrine Aqua's Minion")))
        .isEqualTo(new Action.Spawn("ELDER_GUARDIAN", 1, "shrine", Optional.of("Aqua's Minion")));
    assertThat(ok(Dsl.action("spawn 3 ZOMBIE mines")))
        .isEqualTo(new Action.Spawn("ZOMBIE", 3, "mines", Optional.empty()));
    assertThat(ok(Dsl.action("marker nat turn-in")))
        .isEqualTo(new Action.Marker("nat", Action.NpcMark.TURN_IN));
    assertThat(ok(Dsl.action("marker nat available")))
        .isEqualTo(new Action.Marker("nat", Action.NpcMark.AVAILABLE));
    assertThat(ok(Dsl.action("marker nat none")))
        .isEqualTo(new Action.Marker("nat", Action.NpcMark.NONE));
    assertThat(ok(Dsl.action("custom cutscene windmill intro")))
        .isEqualTo(new Action.Custom("cutscene", "windmill intro"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "explode",
        "crystals",
        "crystals 0",
        "crystals ten",
        "points 0",
        "message",
        "marker nat maybe",
        "spawn 0 ZOMBIE mines",
        "give 0 IRON_INGOT",
        "custom hook",
      })
  void malformedActionsAreErrors(String line) {
    assertThat(Dsl.action(line).isOk()).isFalse();
  }

  @Test
  void timeLimits() {
    assertThat(ok(Dsl.timeLimit("none"))).isEmpty();
    assertThat(ok(Dsl.timeLimit("30m fail")))
        .contains(new Stage.TimeLimit(Duration.ofMinutes(30), "fail"));
    assertThat(ok(Dsl.timeLimit("2h ambush")))
        .contains(new Stage.TimeLimit(Duration.ofHours(2), "ambush"));
    assertThat(ok(Dsl.timeLimit("45s fail")))
        .contains(new Stage.TimeLimit(Duration.ofSeconds(45), "fail"));
    assertThat(ok(Dsl.timeLimit("1d fail")))
        .contains(new Stage.TimeLimit(Duration.ofDays(1), "fail"));
    assertThat(Dsl.timeLimit("30m").isOk()).isFalse();
    assertThat(Dsl.timeLimit("0m fail").isOk()).isFalse();
    assertThat(Dsl.timeLimit("soon fail").isOk()).isFalse();
  }
}
