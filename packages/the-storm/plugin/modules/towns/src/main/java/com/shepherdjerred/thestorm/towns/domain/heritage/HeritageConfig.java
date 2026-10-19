package com.shepherdjerred.thestorm.towns.domain.heritage;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Required repository-owned catalog, loaded before player admission. Each archive binds one
 * restored world to its approved source; sites in other worlds preserve modern builds.
 */
public record HeritageConfig(
    int schemaVersion, List<HeritageArchive> archives, List<HeritageSite> sites) {
  public HeritageConfig {
    archives = List.copyOf(archives);
    sites = List.copyOf(sites);
    if (schemaVersion != 2 || archives.isEmpty() || sites.isEmpty()) {
      throw new IllegalArgumentException("invalid or empty heritage catalog");
    }
    var ids = new HashSet<String>();
    var names = new HashSet<String>();
    for (var site : sites) {
      if (!ids.add(site.id()) || !names.add(site.name().toLowerCase(Locale.ROOT))) {
        throw new IllegalArgumentException("duplicate heritage site: " + site.id());
      }
    }
    var archiveIds = new HashSet<String>();
    var hashes = new HashSet<String>();
    var worlds = new HashSet<String>();
    for (var archive : archives) {
      if (!archiveIds.add(archive.id())
          || !hashes.add(archive.sha256())
          || !worlds.add(archive.world())) {
        throw new IllegalArgumentException("duplicate heritage archive: " + archive.id());
      }
      if (sites.stream()
          .noneMatch(
              site ->
                  site.id().equals(archive.spawnSite())
                      && site.kind() == HeritageSite.Kind.SERVER
                      && site.world().equals(archive.world()))) {
        throw new IllegalArgumentException(
            "heritage archive is missing its server spawn site: " + archive.id());
      }
    }
  }

  public Optional<HeritageArchive> archive(String id) {
    return archives.stream().filter(archive -> archive.id().equals(id)).findFirst();
  }

  public Optional<HeritageArchive> archiveForWorld(String world) {
    return archives.stream().filter(archive -> archive.world().equals(world)).findFirst();
  }
}
