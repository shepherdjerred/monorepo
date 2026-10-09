// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/WorldManager.java, Teams.<T>.Spawns);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.map;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import java.util.List;

/**
 * A team the map fields and where its players spawn.
 *
 * @param color the team
 * @param spawns its spawn points, at least one
 */
public record MapTeam(TeamColor color, List<Spawn> spawns) {

  /** Red Warfare's map builder refused to publish a team with fewer spawns than this. */
  public static final int BUILDER_MIN_SPAWNS = 12;

  /** Red Warfare's map builder refused to publish a team with more spawns than this. */
  public static final int BUILDER_MAX_SPAWNS = 120;

  /** Saved legacy worlds can exceed the editor's publishing limit (Hemispheres has 163). */
  public static final int MAX_SAVED_SPAWNS = 1024;

  public MapTeam {
    if (spawns.isEmpty()) {
      throw new IllegalArgumentException(color + " needs at least one spawn");
    }
    if (spawns.size() > MAX_SAVED_SPAWNS) {
      throw new IllegalArgumentException(
          color + " has too many spawn points: " + spawns.size() + " > " + MAX_SAVED_SPAWNS);
    }
    spawns = List.copyOf(spawns);
  }

  /** Whether the team has as many spawns as Red Warfare's builder demanded for a published map. */
  public boolean meetsBuilderSpawnMinimum() {
    return spawns.size() >= BUILDER_MIN_SPAWNS;
  }
}
