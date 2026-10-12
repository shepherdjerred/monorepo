package com.shepherdjerred.thestorm.rwf.domain.lobby;

import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;

/** Metadata-only lobby recommendations; no terrain or navigation loading is required. */
public final class LobbySizing {

  /** Automatic play favors the large preset. TEAM is an explicit players-per-team override. */
  public enum Mode {
    AUTO,
    SMALL,
    MEDIUM,
    LARGE,
    TEAM,
    FIXED
  }

  /** A session preference. The number is used only by TEAM and FIXED. */
  public record Selection(Mode mode, int count) {
    public Selection {
      if ((mode == Mode.TEAM || mode == Mode.FIXED) && count < 1) {
        throw new IllegalArgumentException("the requested count must be positive");
      }
    }

    /** Resolve the preference for this map, retaining legacy fixed targets for test profiles. */
    public int target(MapDefinition map, int maximum) {
      return switch (mode) {
        case AUTO, LARGE -> recommend(map, maximum).large();
        case SMALL -> recommend(map, maximum).small();
        case MEDIUM -> recommend(map, maximum).medium();
        case TEAM -> balanced((long) count * map.teams().size(), map.teams().size(), maximum);
        case FIXED -> Math.min(count, maximum);
      };
    }
  }

  /** Total combatants, including humans, for each preset and the map's horizontal footprint. */
  public record Recommendations(long footprint, int small, int medium, int large) {}

  private LobbySizing() {}

  /**
   * Medium targets are 16, 32 or 48 for footprints up to 128 squared, 200 squared, or larger. Small
   * halves that target; large adds half. Presets balance the teams without reusing a team's saved
   * spawn positions. Explicit TEAM overrides may reuse spawns, as the match engine supports.
   */
  public static Recommendations recommend(MapDefinition map, int maximum) {
    var region = map.border();
    var footprint =
        ((long) region.max().x() - region.min().x() + 1)
            * ((long) region.max().z() - region.min().z() + 1);
    var medium = footprint <= 16_384 ? 16 : footprint <= 40_000 ? 32 : 48;
    var teams = map.teams().size();
    var spawns = map.teams().stream().mapToInt(team -> team.spawns().size()).min().orElseThrow();
    var capacity = Math.min(maximum, spawns * teams);
    return new Recommendations(
        footprint,
        balanced(medium / 2, teams, capacity),
        balanced(medium, teams, capacity),
        balanced(medium * 3 / 2, teams, capacity));
  }

  private static int balanced(long requested, int teams, int maximum) {
    if (maximum < teams) {
      throw new IllegalArgumentException("the combatant cap cannot field every map team");
    }
    return (int) (Math.min(Math.max(teams, requested), maximum) / teams * teams);
  }
}
