package com.shepherdjerred.thestorm.towns.domain.heritage;

import java.util.HashSet;
import java.util.List;

/** Required repository-owned catalog, loaded before player admission. */
public record HeritageConfig(int schemaVersion, String archiveSha256, List<HeritageSite> sites) {
  public HeritageConfig {
    sites = List.copyOf(sites);
    if (schemaVersion != 1 || !archiveSha256.matches("[a-f0-9]{64}") || sites.isEmpty()) {
      throw new IllegalArgumentException("invalid or empty heritage catalog");
    }
    var ids = new HashSet<String>();
    var names = new HashSet<String>();
    for (var site : sites) {
      if (!ids.add(site.id()) || !names.add(site.name().toLowerCase(java.util.Locale.ROOT))) {
        throw new IllegalArgumentException("duplicate heritage site: " + site.id());
      }
    }
    if (sites.stream()
        .noneMatch(site -> site.id().equals("spawn") && site.kind() == HeritageSite.Kind.SERVER)) {
      throw new IllegalArgumentException("heritage catalog is missing Spawn");
    }
  }
}
