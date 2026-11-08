package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Plans historical towns without changing existing names or memberships. */
public final class HeritageTownImport {
  private HeritageTownImport() {}

  public record Plan(List<Town> towns, List<String> conflicts) {
    public Plan {
      towns = List.copyOf(towns);
      conflicts = List.copyOf(conflicts);
    }
  }

  /** Completed identities are never recreated, including after a player disbands a town. */
  public static Plan plan(
      List<HeritageSite> sites, List<Town> existing, Set<UUID> completed, Instant now) {
    var ids = new HashSet<UUID>();
    var members = new HashSet<UUID>();
    var names = new HashSet<String>();
    for (var town : existing) {
      ids.add(town.id());
      members.addAll(town.members().keySet());
      names.add(town.name().toLowerCase(Locale.ROOT));
    }
    var result = new ArrayList<Town>();
    var conflicts = new ArrayList<String>();
    for (var site : sites) {
      if (site.activeTownName().isBlank()) continue;
      var id = site.activeTownId().orElseThrow();
      if (completed.contains(id) || ids.contains(id)) continue;
      var town = create(site, now);
      var name = site.activeTownName().toLowerCase(Locale.ROOT);
      if (town.members().keySet().stream().anyMatch(members::contains) || names.contains(name)) {
        conflicts.add(site.id());
        continue;
      }
      result.add(town);
      ids.add(id);
      members.addAll(town.members().keySet());
      names.add(name);
    }
    return new Plan(result, conflicts);
  }

  private static Town create(HeritageSite site, Instant now) {
    var id = site.activeTownId().orElseThrow();
    return site.kind() == HeritageSite.Kind.PLAYER
        ? Town.found(id, site.activeTownName(), now, site.editors().getFirst().player())
        : Town.historical(id, site.activeTownName(), now);
  }
}
