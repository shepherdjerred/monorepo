package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Shared routes and defenses, personal finite gathering budgets. All reset each run. */
public final class Settlement {
  private record Harvest(UUID player, BlockPos block) {}

  private final SurvivalContent content;
  private final Set<String> open = new HashSet<>();
  private final Map<Harvest, Integer> harvested = new HashMap<>();
  private final Map<String, Integer> defenses = new HashMap<>();

  public Settlement(SurvivalContent content) {
    this.content = content;
    reset();
  }

  public Set<String> open() {
    return Set.copyOf(open);
  }

  public boolean accessible(String zone) {
    return open.contains(zone);
  }

  public boolean unlockable(SurvivalContent.Zone zone) {
    return !accessible(zone.id()) && open.containsAll(zone.requires());
  }

  public void unlock(SurvivalContent.Zone zone) {
    if (!unlockable(zone)) {
      throw new IllegalStateException("Route is not available");
    }
    open.add(zone.id());
  }

  public boolean harvest(UUID player, SurvivalContent.Resource resource) {
    var key = new Harvest(player, resource.block());
    var used = harvested.getOrDefault(key, 0);
    if (used >= resource.perRound()) {
      return false;
    }
    harvested.put(key, used + 1);
    return true;
  }

  public int strength(String defense) {
    return defenses.getOrDefault(defense, 0);
  }

  public boolean breach(String defense) {
    var next = Math.max(0, strength(defense) - 1);
    defenses.put(defense, next);
    return next == 0;
  }

  public void repair(String defense) {
    defenses.put(defense, 5);
  }

  public void arm(String defense) {
    defenses.put(defense, 1);
  }

  public void nextRound() {
    harvested.clear();
  }

  public void reset() {
    open.clear();
    content.zones().stream()
        .filter(z -> z.emeralds() == 0)
        .map(SurvivalContent.Zone::id)
        .forEach(open::add);
    harvested.clear();
    defenses.clear();
    content.zones().stream()
        .flatMap(z -> z.defenses().stream())
        .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
        .forEach(d -> repair(d.id()));
  }
}
