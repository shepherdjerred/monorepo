package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Stable pairs/trios and personality-selected independent players, separate from tactical slots.
 */
public final class Squads {
  private Squads() {}

  static Map<CombatantId, Integer> deal(
      Map<CombatantId, Integer> previous,
      List<CombatantView> bots,
      Map<CombatantId, SlotFit.Member> members) {
    if (bots.stream().allMatch(bot -> previous.containsKey(bot.id())))
      return regroup(previous, bots);
    var ordered = new ArrayList<>(bots);
    ordered.sort(
        Comparator.comparingDouble(
                (CombatantView bot) ->
                    affinity(java.util.Objects.requireNonNull(members.get(bot.id()))))
            .thenComparing(CombatantView::id));
    var solos = bots.size() == 1 ? 1 : bots.size() / 4;
    var result = new HashMap<CombatantId, Integer>();
    for (var index = 0; index < solos; index++) result.put(ordered.get(index).id(), -1);
    var grouped = ordered.subList(solos, ordered.size());
    var index = 0;
    var group = 0;
    while (index < grouped.size()) {
      var size = grouped.size() - index == 3 ? 3 : 2;
      for (var member = 0; member < size; member++) result.put(grouped.get(index++).id(), group);
      group++;
    }
    return Map.copyOf(result);
  }

  private static double affinity(SlotFit.Member member) {
    var archetype = member.archetype();
    var independent =
        archetype == Archetype.LURKER
            || archetype == Archetype.FLANKER
            || archetype == Archetype.DUELIST
            || archetype == Archetype.TROLL;
    return (independent ? 0 : 1) + member.roleWeights().getOrDefault(Role.ESCORT, 0.0);
  }

  private static Map<CombatantId, Integer> regroup(
      Map<CombatantId, Integer> previous, List<CombatantView> bots) {
    var living = new HashMap<Integer, List<CombatantId>>();
    for (var bot : bots) {
      var group = java.util.Objects.requireNonNull(previous.get(bot.id()));
      if (group >= 0) living.computeIfAbsent(group, ignored -> new ArrayList<>()).add(bot.id());
    }
    var orphans =
        living.values().stream()
            .filter(group -> group.size() == 1)
            .flatMap(List::stream)
            .sorted()
            .toList();
    if (orphans.size() < 2) return previous;
    var result = new HashMap<>(previous);
    for (var index = 0; index + 1 < orphans.size(); index += 2) {
      result.put(orphans.get(index + 1), previous.get(orphans.get(index)));
    }
    return Map.copyOf(result);
  }
}
