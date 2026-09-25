package com.shepherdjerred.thestorm.arena.domain.arena;

import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;

/** Checks that arena definitions agree with the classes and tiers they refer to. */
public final class ArenaContent {

  private ArenaContent() {}

  /**
   * Every problem with {@code arenas} given the classes and the number of tiers: unknown classes on
   * class signs, tiers out of range, and two arenas sharing an id or overlapping.
   */
  public static List<String> check(
      Collection<ArenaDefinition> arenas, ClassBook classes, int tiers) {
    var problems = new ArrayList<String>();
    var byId = new HashMap<String, ArenaDefinition>();
    for (var arena : arenas) {
      if (byId.put(arena.id(), arena) != null) {
        problems.add("two arenas have the id " + arena.id());
      }
      for (var sign : arena.classSigns().keySet()) {
        if (classes.find(sign).isEmpty()) {
          problems.add("arena " + arena.id() + " has a sign for unknown class " + sign);
        }
      }
      if (arena.tier() > tiers) {
        problems.add(
            "arena " + arena.id() + " uses tier " + arena.tier() + " but only " + tiers + " exist");
      }
    }
    problems.addAll(overlaps(List.copyOf(arenas)));
    return List.copyOf(problems);
  }

  private static List<String> overlaps(List<ArenaDefinition> arenas) {
    var problems = new ArrayList<String>();
    for (var i = 0; i < arenas.size(); i++) {
      for (var j = i + 1; j < arenas.size(); j++) {
        if (overlap(arenas.get(i), arenas.get(j))) {
          problems.add("arenas " + arenas.get(i).id() + " and " + arenas.get(j).id() + " overlap");
        }
      }
    }
    return problems;
  }

  private static boolean overlap(ArenaDefinition a, ArenaDefinition b) {
    if (!a.world().equals(b.world())) {
      return false;
    }
    var p = a.region();
    var q = b.region();
    return p.min().x() <= q.max().x()
        && q.min().x() <= p.max().x()
        && p.min().y() <= q.max().y()
        && q.min().y() <= p.max().y()
        && p.min().z() <= q.max().z()
        && q.min().z() <= p.max().z();
  }
}
