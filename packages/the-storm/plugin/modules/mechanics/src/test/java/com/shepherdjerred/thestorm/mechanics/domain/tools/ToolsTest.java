package com.shepherdjerred.thestorm.mechanics.domain.tools;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.CookingPotConfig;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class ToolsTest {

  @Nested
  final class Cycles {

    private final List<String> choices = List.of("a", "b", "c");

    @Test
    void stepsForwardAndBackAndWraps() {
      assertThat(Cycle.step(choices, "a", true)).contains("b");
      assertThat(Cycle.step(choices, "c", true)).contains("a");
      assertThat(Cycle.step(choices, "a", false)).contains("c");
      assertThat(Cycle.step(choices, "b", false)).contains("a");
    }

    @Test
    void anUnknownCurrentStartsAtAnEnd() {
      assertThat(Cycle.step(choices, "z", true)).contains("a");
      assertThat(Cycle.step(choices, "z", false)).contains("c");
    }

    @Test
    void noOtherChoiceMeansNoStep() {
      assertThat(Cycle.step(List.of("a"), "a", true)).isEmpty();
      assertThat(Cycle.step(List.<String>of(), "a", true)).isEmpty();
      assertThat(Cycle.step(List.of("a"), "z", true)).contains("a");
    }
  }

  @Nested
  final class CookingPots {

    private final CookingPotConfig config =
        new CookingPotConfig(
            new Access(true, 1, 1),
            List.of("minecraft:fire", "minecraft:campfire"),
            Map.of("minecraft:coal", 8),
            64);

    @Test
    void findsHeatOneOrTwoBlocksBelow() {
      var sign = new Pos(0, 64, 0);

      assertThat(
              CookingPot.heatSource(
                  new TestGrid().solid(new Pos(0, 63, 0), "minecraft:fire"), sign, config))
          .contains(new Pos(0, 63, 0));
      assertThat(
              CookingPot.heatSource(
                  new TestGrid().solid(new Pos(0, 62, 0), "minecraft:campfire"), sign, config))
          .contains(new Pos(0, 62, 0));
      assertThat(
              CookingPot.heatSource(
                  new TestGrid().solid(new Pos(0, 61, 0), "minecraft:fire"), sign, config))
          .isEqualTo(Optional.empty());
      assertThat(
              CookingPot.heatSource(
                  new TestGrid().solid(new Pos(0, 63, 0), TestGrid.STONE), sign, config))
          .isEmpty();
    }

    @Test
    void refuelTakesWholeItemsThatFit() {
      assertThat(CookingPot.refuel(0, new CookingPot.Offer(3, 8), 64))
          .isEqualTo(new CookingPot.Refuel(3, 24));
      assertThat(CookingPot.refuel(50, new CookingPot.Offer(3, 8), 64))
          .isEqualTo(new CookingPot.Refuel(1, 58));
      assertThat(CookingPot.refuel(60, new CookingPot.Offer(3, 8), 64))
          .isEqualTo(new CookingPot.Refuel(0, 60));
      assertThat(CookingPot.refuel(64, new CookingPot.Offer(64, 1), 64))
          .isEqualTo(new CookingPot.Refuel(0, 64));
    }

    @Test
    void cookingSpendsOneFuelPerItem() {
      assertThat(CookingPot.cook(10, 4)).isEqualTo(new CookingPot.Cook(4, 6));
      assertThat(CookingPot.cook(3, 16)).isEqualTo(new CookingPot.Cook(3, 0));
      assertThat(CookingPot.cook(0, 16)).isEqualTo(new CookingPot.Cook(0, 0));
    }
  }

  @Nested
  final class LightSwitches {

    private final Pos sign = new Pos(0, 64, 0);

    @Test
    void anyLightOnTurnsThemAllOff() {
      var lights =
          List.of(
              new LightSwitch.Light(new Pos(1, 64, 0), true),
              new LightSwitch.Light(new Pos(2, 64, 0), false));

      var flip = LightSwitch.flip(sign, lights, 10);

      assertThat(flip.on()).isFalse();
      assertThat(flip.changes()).containsExactly(new Pos(1, 64, 0));
    }

    @Test
    void allOffTurnsThemAllOn() {
      var lights =
          List.of(
              new LightSwitch.Light(new Pos(1, 64, 0), false),
              new LightSwitch.Light(new Pos(0, 66, 0), false));

      var flip = LightSwitch.flip(sign, lights, 10);

      assertThat(flip.on()).isTrue();
      assertThat(flip.changes()).containsExactly(new Pos(1, 64, 0), new Pos(0, 66, 0));
    }

    @Test
    void onlyTheNearestLightsCount() {
      var lights =
          List.of(
              new LightSwitch.Light(new Pos(5, 64, 0), true),
              new LightSwitch.Light(new Pos(1, 64, 0), false),
              new LightSwitch.Light(new Pos(0, 64, 2), false));

      var flip = LightSwitch.flip(sign, lights, 2);

      assertThat(flip.on()).isTrue();
      assertThat(flip.changes()).containsExactly(new Pos(1, 64, 0), new Pos(0, 64, 2));
    }
  }
}
