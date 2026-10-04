package com.shepherdjerred.thestorm.companions.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGeneratorFactory;
import org.junit.jupiter.api.Test;

final class SurvivalRulesTest {
  private final Availability hours =
      new Availability(ZoneId.of("America/Los_Angeles"), LocalTime.of(14, 0), LocalTime.of(22, 0));

  @Test
  void requiresHumansAndFlagWithinCoreHours() {
    var opening = Instant.parse("2026-10-03T21:00:00Z");
    assertThat(hours.active(opening.minusSeconds(1), 1, true)).isFalse();
    assertThat(hours.active(opening, 1, true)).isTrue();
    assertThat(hours.active(opening, 0, true)).isFalse();
    assertThat(hours.active(opening, 1, false)).isFalse();
    assertThat(hours.active(Instant.parse("2026-10-04T05:00:00Z"), 1, true)).isFalse();
  }

  @Test
  void followsPacificDstRatherThanFixedUtcOffset() {
    assertThat(hours.active(Instant.parse("2026-11-01T21:30:00Z"), 1, true)).isFalse();
    assertThat(hours.active(Instant.parse("2026-11-01T22:00:00Z"), 1, true)).isTrue();
    assertThat(hours.active(Instant.parse("2026-03-08T21:00:00Z"), 1, true)).isTrue();
  }

  @Test
  void generatesBoundedSheltersWithARealDoorway() {
    var random = RandomGeneratorFactory.of("L64X128MixRandom").create(42);
    for (var index = 0; index < 20; index++) {
      var plan = Blueprint.shelter(random, "OAK_PLANKS");
      assertThat(plan.blocks()).hasSizeLessThanOrEqualTo(256).doesNotHaveDuplicates();
      assertThat(plan.blocks())
          .noneMatch(
              block ->
                  block.z() == 0
                      && block.x() == plan.width() / 2
                      && (block.y() == 1 || block.y() == 2));
      assertThat(plan.blocks()).allMatch(block -> block.y() < 8);
    }
    assertThatThrownBy(() -> Blueprint.rectangular(13, 5, "OAK_PLANKS"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void plansSharedIngredientsOnceAndConsumesVirtualStock() {
    var planks =
        new RecipePlanner.Recipe(
            "planks", "PLANKS", 4, Map.of("LOG", 1), RecipePlanner.Station.HAND);
    var sticks =
        new RecipePlanner.Recipe(
            "sticks", "STICK", 4, Map.of("PLANKS", 2), RecipePlanner.Station.HAND);
    var pick =
        new RecipePlanner.Recipe(
            "pick", "PICK", 1, Map.of("PLANKS", 3, "STICK", 2), RecipePlanner.Station.WORKBENCH);
    var planner =
        new RecipePlanner(Map.of("PLANKS", planks, "STICK", sticks, "PICK", pick), Set.of("LOG"));
    var plan = planner.plan("PICK", 1, Map.of()).orElseThrow();
    assertThat(
            plan.stream()
                .filter(RecipePlanner.Step.Gather.class::isInstance)
                .map(RecipePlanner.Step.Gather.class::cast)
                .mapToInt(RecipePlanner.Step.Gather::amount)
                .sum())
        .isEqualTo(2);
    assertThat(plan.getLast()).isEqualTo(new RecipePlanner.Step.Craft(pick, 1));
    assertThat(planner.plan("PICK", 1, Map.of("PICK", 1)).orElseThrow()).isEmpty();
  }

  @Test
  void rejectsUnobtainableAndCyclicRecipes() {
    var recipe = new RecipePlanner.Recipe("a", "A", 1, Map.of("A", 1), RecipePlanner.Station.HAND);
    var planner = new RecipePlanner(Map.of("A", recipe), Set.of());
    assertThat(planner.plan("A", 1, Map.of())).isEmpty();
    assertThat(planner.plan("UNKNOWN", 1, Map.of())).isEmpty();
    assertThatThrownBy(() -> planner.plan("A", 257, Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void selfDefenseAndHungerInterruptAnInstruction() {
    assertThat(
            SurvivalBrain.choose(
                new SurvivalBrain.Situation(true, 10, 1, 8, true, 32, true, true, true)))
        .isEqualTo(SurvivalBrain.Goal.DEFEND);
    assertThat(
            SurvivalBrain.choose(
                new SurvivalBrain.Situation(false, 10, 1, 8, true, 32, true, true, true)))
        .isEqualTo(SurvivalBrain.Goal.EAT);
    assertThat(
            SurvivalBrain.choose(
                new SurvivalBrain.Situation(false, 20, 1, 8, true, 32, true, false, true)))
        .isEqualTo(SurvivalBrain.Goal.WAIT);
  }
}
