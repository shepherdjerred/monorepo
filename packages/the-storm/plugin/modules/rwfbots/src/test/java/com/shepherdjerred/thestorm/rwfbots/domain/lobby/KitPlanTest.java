package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import java.time.Duration;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** A bot tries kits before the match but always ends on the one the director drafted. */
final class KitPlanTest {

  private static final List<String> KITS = List.of("trooper", "longbow", "shortbow", "rewind");

  @Test
  void everyPlanEndsOnTheDraftedKitWithAtMostThreeSwitchesFiveSecondsApart() {
    for (var archetype : Archetype.values()) {
      var temperament = LobbyTemperamentTest.of(archetype);
      for (var seed = 0; seed < 200; seed++) {
        var drafted = KITS.get(seed % KITS.size());
        var window = Duration.ofSeconds(seed % 90);
        var plan =
            KitPlan.plan(
                new KitPlan.Choice(drafted, KITS), temperament, window, new SplittableRandom(seed));

        assertThat(plan.last()).as("seed %d", seed).isEqualTo(drafted);
        assertThat(plan.switches()).hasSizeLessThanOrEqualTo(KitPlan.MAX_SWITCHES);
        var previous = Duration.ZERO;
        var kit = plan.first();
        for (var change : plan.switches()) {
          assertThat(change.after().minus(previous)).isGreaterThanOrEqualTo(KitPlan.MIN_GAP);
          assertThat(change.kit()).as("a switch changes the kit").isNotEqualTo(kit);
          previous = change.after();
          kit = change.kit();
        }
        assertThat(previous).isLessThanOrEqualTo(window);
      }
    }
  }

  @Test
  void withNoTimeToSwitchABotJustPicksItsDraftedKit() {
    var plan =
        KitPlan.plan(
            new KitPlan.Choice("longbow", KITS),
            LobbyTemperamentTest.of(Archetype.TROLL),
            Duration.ofSeconds(4),
            new SplittableRandom(1));

    assertThat(plan.first()).isEqualTo("longbow");
    assertThat(plan.switches()).isEmpty();
  }

  @Test
  void eagerTemperamentsSwitchMore() {
    var troll = 0;
    var rusher = 0;
    for (var seed = 0; seed < 300; seed++) {
      troll +=
          KitPlan.plan(
                  new KitPlan.Choice("trooper", KITS),
                  LobbyTemperamentTest.of(Archetype.TROLL),
                  Duration.ofSeconds(60),
                  new SplittableRandom(seed))
              .switches()
              .size();
      rusher +=
          KitPlan.plan(
                  new KitPlan.Choice("trooper", KITS),
                  LobbyTemperamentTest.of(Archetype.RUSHER),
                  Duration.ofSeconds(60),
                  new SplittableRandom(seed))
              .switches()
              .size();
    }

    assertThat(troll).isGreaterThan(rusher);
  }

  @Test
  void theSameSeedPlansTheSame() {
    var temperament = LobbyTemperamentTest.of(Archetype.TACTICIAN);
    var choice = new KitPlan.Choice("rewind", KITS);

    assertThat(KitPlan.plan(choice, temperament, Duration.ofSeconds(50), new SplittableRandom(9)))
        .isEqualTo(
            KitPlan.plan(choice, temperament, Duration.ofSeconds(50), new SplittableRandom(9)));
  }
}
