package com.shepherdjerred.thestorm.arena.domain.wave;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The checked wave table: every wave from 1 to the final wave is covered by exactly one entry, and
 * every mob, rider, boss and summon it names exists.
 */
public final class WaveTable {

  /** The longest chain of riders on riders. */
  static final int MAX_RIDER_DEPTH = 3;

  private final WaveFile file;
  private final List<WaveEntry> byWave;

  private WaveTable(WaveFile file, List<WaveEntry> byWave) {
    this.file = file;
    this.byWave = List.copyOf(byWave);
  }

  /** Checks {@code file}, returning the table or every problem found. */
  public static Result<WaveTable, List<String>> of(WaveFile file) {
    var problems = new ArrayList<String>();
    checkArchetypes(file, problems);
    checkBosses(file, problems);
    var byWave = cover(file, problems);
    for (var entry : file.waves()) {
      checkEntry(file, entry, problems);
    }
    return problems.isEmpty()
        ? Result.ok(new WaveTable(file, byWave))
        : Result.err(List.copyOf(problems));
  }

  public int finalWave() {
    return file.finalWave();
  }

  /** The entry covering {@code wave}. */
  public WaveEntry entry(int wave) {
    if (wave < 1 || wave > finalWave()) {
      throw new IllegalArgumentException("no wave " + wave + "; waves run 1 to " + finalWave());
    }
    return byWave.get(wave - 1);
  }

  public WaveKind kind(int wave) {
    return entry(wave).kind();
  }

  public MobArchetype mob(String id) {
    var mob = file.mobs().get(id);
    if (mob == null) {
      throw new IllegalArgumentException("unknown mob " + id);
    }
    return mob;
  }

  public Map<String, MobArchetype> mobs() {
    return file.mobs();
  }

  public Map<String, BossDefinition> bosses() {
    return file.bosses();
  }

  /** How many entities a mob of archetype {@code id} is, its riders included. */
  public int entities(String id) {
    var count = 0;
    Optional<String> current = Optional.of(id);
    while (current.isPresent()) {
      count++;
      current = mob(current.orElseThrow()).rider();
    }
    return count;
  }

  /** Wave {@code wave}, scaled for {@code difficulty}. */
  public ResolvedWave resolve(int wave, Difficulty difficulty) {
    var entry = entry(wave);
    var units = new ArrayList<SpawnUnit>();
    for (var group : entry.spawns()) {
      var mob = mob(group.mob());
      var count = WaveScaling.count(group, wave - entry.from(), difficulty);
      var unit =
          new SpawnUnit(
              group.mob(),
              WaveScaling.mobHealth(mob, wave, entry.kind(), difficulty),
              WaveScaling.damage(mob, wave, difficulty),
              entities(group.mob()));
      for (var i = 0; i < count; i++) {
        units.add(unit);
      }
    }
    var boss =
        entry
            .boss()
            .map(
                id -> {
                  var definition = file.bosses().get(id);
                  if (definition == null) {
                    throw new IllegalStateException("unknown boss " + id);
                  }
                  return new BossOrder(
                      id,
                      definition,
                      WaveScaling.bossHealth(definition, difficulty),
                      WaveScaling.damage(mob(definition.mob()), wave, difficulty),
                      entities(definition.mob()));
                });
    return new ResolvedWave(wave, entry.kind(), units, boss);
  }

  private static List<WaveEntry> cover(WaveFile file, List<String> problems) {
    var byWave = new ArrayList<WaveEntry>();
    for (var wave = 1; wave <= file.finalWave(); wave++) {
      var number = wave;
      var covering = file.waves().stream().filter(entry -> entry.covers(number)).toList();
      if (covering.isEmpty()) {
        problems.add("wave " + wave + " is not covered by any entry");
      } else if (covering.size() > 1) {
        problems.add("wave " + wave + " is covered by " + covering.size() + " entries");
      } else {
        byWave.add(covering.getFirst());
      }
    }
    for (var entry : file.waves()) {
      if (entry.to() > file.finalWave()) {
        problems.add(
            "entry "
                + entry.from()
                + "-"
                + entry.to()
                + " runs past finalWave "
                + file.finalWave());
      }
    }
    return byWave;
  }

  private static void checkArchetypes(WaveFile file, List<String> problems) {
    for (var entry : file.mobs().entrySet()) {
      var seen = new HashSet<String>();
      seen.add(entry.getKey());
      var rider = entry.getValue().rider();
      var depth = 0;
      while (rider.isPresent()) {
        var id = rider.orElseThrow();
        depth++;
        if (!file.mobs().containsKey(id)) {
          problems.add("mob " + entry.getKey() + " has unknown rider " + id);
          break;
        }
        if (!seen.add(id) || depth > MAX_RIDER_DEPTH) {
          problems.add(
              "mob " + entry.getKey() + " has riders nested too deep or in a loop (at " + id + ")");
          break;
        }
        rider = file.mobs().get(id).rider();
      }
    }
  }

  private static void checkBosses(WaveFile file, List<String> problems) {
    for (var entry : file.bosses().entrySet()) {
      var boss = entry.getValue();
      if (!file.mobs().containsKey(boss.mob())) {
        problems.add("boss " + entry.getKey() + " uses unknown mob " + boss.mob());
      }
      for (var ability : boss.abilities()) {
        ability
            .summon()
            .filter(summon -> !file.mobs().containsKey(summon))
            .ifPresent(
                summon ->
                    problems.add("boss " + entry.getKey() + " summons unknown mob " + summon));
      }
    }
  }

  private static void checkEntry(WaveFile file, WaveEntry entry, List<String> problems) {
    var range = "entry " + entry.from() + "-" + entry.to();
    for (var group : entry.spawns()) {
      if (!file.mobs().containsKey(group.mob())) {
        problems.add(range + " spawns unknown mob " + group.mob());
      }
    }
    entry
        .boss()
        .filter(boss -> !file.bosses().containsKey(boss))
        .ifPresent(boss -> problems.add(range + " names unknown boss " + boss));
    if (entry.kind() == WaveKind.CAVALRY) {
      var mounted =
          entry.spawns().stream()
              .map(group -> file.mobs().get(group.mob()))
              .anyMatch(mob -> mob != null && mob.rider().isPresent());
      if (!mounted) {
        problems.add(range + " is a cavalry wave but none of its mobs has a rider");
      }
    }
  }
}
