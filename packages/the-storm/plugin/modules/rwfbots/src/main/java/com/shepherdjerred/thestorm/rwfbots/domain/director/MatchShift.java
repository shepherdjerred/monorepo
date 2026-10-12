package com.shepherdjerred.thestorm.rwfbots.domain.director;

import java.util.ArrayList;
import java.util.List;

/**
 * Chooses the one skill shift applied to every bot in a match so that a bot of median skill sits a
 * little under the median human, at a gap where the human wins {@link #TARGET_HUMAN_WIN} of the
 * time under the rating model. It is a pure function of the ratings in the lobby: there is no
 * rubber-banding within or between matches, so a human who improves meets harder bots only as their
 * own rating rises.
 */
public final class MatchShift {

  /** How often the median human should beat the median bot. */
  public static final double TARGET_HUMAN_WIN = 0.55;

  /** The most the shift may move skill either way. */
  public static final double MAX_SHIFT = 0.5;

  private MatchShift() {}

  /**
   * The shift for a lobby of {@code humans} against bots of {@code botSkills}, targeting {@code
   * targetHumanWin} for the median human against the median bot.
   */
  public static double choose(List<Rating> humans, List<Double> botSkills, double targetHumanWin) {
    if (humans.isEmpty() || botSkills.isEmpty()) {
      throw new IllegalArgumentException("need at least one human and one bot");
    }
    if (!(targetHumanWin > 0 && targetHumanWin < 1)) {
      throw new IllegalArgumentException("target win rate must be in (0, 1)");
    }
    var humanMedian = median(humans.stream().map(Rating::mu).toList());
    // P(human wins) = Phi((mu_h - mu_b) / (sqrt(2) beta)) for two equally sure players.
    var gap = Normal.quantile(targetHumanWin) * Math.sqrt(2) * OpenSkill.BETA;
    var desiredSkill = SkillScale.toSkill(humanMedian - gap);
    var botMedian = median(botSkills);
    return Math.clamp(desiredSkill - botMedian, -MAX_SHIFT, MAX_SHIFT);
  }

  /** The median of {@code values}, the mean of the middle two for even counts. */
  public static double median(List<Double> values) {
    if (values.isEmpty()) {
      throw new IllegalArgumentException("median of nothing");
    }
    var sorted = new ArrayList<>(values);
    sorted.sort(Double::compare);
    var n = sorted.size();
    return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
  }
}
