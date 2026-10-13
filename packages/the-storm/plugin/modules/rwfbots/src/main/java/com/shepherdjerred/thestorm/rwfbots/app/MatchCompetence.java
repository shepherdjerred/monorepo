package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import java.util.EnumMap;
import java.util.SplittableRandom;

/** Seeded between-match variation with a mechanical competence floor for every personality. */
public final class MatchCompetence {
  private MatchCompetence() {}

  public static Levers levers(Personality personality, ExperienceSettings settings, long seed) {
    var random = new SplittableRandom(seed ^ personality.id().hashCode());
    var spread = settings.variety().spread();
    var skill =
        Math.clamp(
            settings.difficulty().skill()
                + (personality.skill() - 0.5) * spread
                + random.nextDouble(-spread, spread),
            settings.difficulty().competenceFloor(),
            1);
    var raw = LeverCurves.at(skill, Director.offsets(personality));
    var floor = LeverCurves.at(settings.difficulty().competenceFloor());
    var values = new EnumMap<Lever, Double>(Lever.class);
    for (var lever : Lever.values()) {
      // Aggression is a style preference, not a measure of competence.
      values.put(
          lever,
          lever == Lever.AGGRESSION
              ? raw.get(lever)
              : lever.lowerIsBetter()
                  ? Math.min(raw.get(lever), floor.get(lever))
                  : Math.max(raw.get(lever), floor.get(lever)));
    }
    var temperatureScale =
        com.shepherdjerred.thestorm.rwfbots.domain.tactics.ArchetypeBias.of(personality.archetype())
            .temperature();
    values.compute(
        Lever.DECISION_TEMPERATURE,
        (lever, value) ->
            Math.min(
                raw.decisionTemperature(),
                floor.decisionTemperature() / Math.max(1, temperatureScale)));
    return Levers.of(values);
  }

  public static Style style(Personality personality, ExperienceSettings settings) {
    var original = personality.style();
    return switch (settings.style()) {
      case VARIED -> original;
      case PUSH -> new Style(Math.max(0.75, original.aggression()), 0.3, 0.7, 0.7);
      case CAUTIOUS -> new Style(0.45, Math.max(0.75, original.patience()), 0.75, 0.25);
      case TEAMPLAY -> new Style(0.65, 0.55, Math.max(0.85, original.teamplay()), 0.45);
    };
  }
}
