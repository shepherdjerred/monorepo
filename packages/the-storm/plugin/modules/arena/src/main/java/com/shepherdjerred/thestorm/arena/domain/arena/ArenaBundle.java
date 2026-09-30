package com.shepherdjerred.thestorm.arena.domain.arena;

import com.shepherdjerred.thestorm.arena.domain.config.ArenaSettings;
import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.util.ArrayList;
import java.util.List;

/**
 * All of the arena's content, checked to agree across files: the settings, the classes, the wave
 * table and every arena.
 *
 * @param settings {@code arena.yml}
 * @param classes {@code arena/classes.yml}
 * @param waves {@code arena/waves.yml}, checked
 * @param arenas every {@code arena/arenas/<id>.yml}
 */
public record ArenaBundle(
    ArenaSettings settings, ClassBook classes, WaveTable waves, List<ArenaDefinition> arenas) {

  public ArenaBundle {
    arenas = List.copyOf(arenas);
    var problems = new ArrayList<>(ArenaContent.check(arenas, classes, settings.tiers().size()));
    for (var milestone : settings.rewards().vault().milestones()) {
      if (milestone.wave() > waves.finalWave()) {
        problems.add("vault milestone " + milestone.wave() + " is past the final wave");
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalArgumentException(String.join("; ", problems));
    }
  }
}
