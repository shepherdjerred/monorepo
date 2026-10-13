package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import com.shepherdjerred.thestorm.rwf.app.MatchExperiences;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.ArchetypeBias;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class MatchCompetenceTest {
  @Test
  void all512PersonalitiesMeetEveryMechanicalFloorAtEachDifficulty() {
    var catalog =
        PersonalityFiles.loadDirectory(
            Path.of(System.getProperty("thestorm.rwfbots.personalities")));
    assertThat(catalog.all()).hasSize(512);
    for (var difficulty : ExperienceSettings.Difficulty.values()) {
      var settings = ExperienceSettings.DEFAULT.withDifficulty(difficulty);
      var floor = LeverCurves.at(difficulty.competenceFloor());
      for (var personality : catalog.all()) {
        var levers = MatchCompetence.levers(personality, settings, 31);
        for (var lever : Lever.values()) {
          if (lever == Lever.AGGRESSION) continue;
          var effective = effective(lever, levers, personality);
          assertThat(meetsFloor(lever, effective, floor.get(lever)))
              .as("%s %s %s", difficulty, personality.id(), lever)
              .isTrue();
        }
      }
    }
  }

  private static double effective(
      Lever lever,
      com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers levers,
      com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality personality) {
    return lever == Lever.DECISION_TEMPERATURE
        ? levers.get(lever) * ArchetypeBias.of(personality.archetype()).temperature()
        : levers.get(lever);
  }

  private static boolean meetsFloor(Lever lever, double value, double floor) {
    return lever.lowerIsBetter() ? value <= floor + 1e-12 : value >= floor - 1e-12;
  }

  @Test
  void varietyIsSeededAndHardPlayNeverAdaptsDownToAWeakHuman() {
    var personality = Fixtures.personality("ash", "Ash", 0.2);
    var settings = ExperienceSettings.DEFAULT;
    assertThat(MatchCompetence.levers(personality, settings, 31))
        .isEqualTo(MatchCompetence.levers(personality, settings, 31))
        .isNotEqualTo(MatchCompetence.levers(personality, settings, 32));
    var catalog =
        new com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog(
            List.of(personality));
    var frozen =
        new MatchExperiences.Frozen(
            UUID.fromString("00000000-0000-0000-0000-000000000001"), 31, settings);
    var weak =
        new Director.Request(
            catalog, Map.of(), List.of(new Rating(12, 2)), 1, Set.of(), Set.of(Kit.TROOPER), 2);
    var strong =
        new Director.Request(
            catalog, Map.of(), List.of(new Rating(38, 2)), 1, Set.of(), Set.of(Kit.TROOPER), 2);
    var a = Director.pick(weak, frozen, new SplittableRandom(7));
    var b = Director.pick(strong, frozen, new SplittableRandom(7));
    assertThat(a.bots().getFirst().levers()).isEqualTo(b.bots().getFirst().levers());
    assertThat(a.shift()).isZero();
    assertThat(b.shift()).isZero();
  }
}
