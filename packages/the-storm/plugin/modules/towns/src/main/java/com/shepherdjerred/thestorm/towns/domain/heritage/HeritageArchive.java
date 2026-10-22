package com.shepherdjerred.thestorm.towns.domain.heritage;

/** One approved source archive restored into one world, with that world's SERVER spawn site. */
public record HeritageArchive(String id, String sha256, String world, String spawnSite) {
  public HeritageArchive {
    if (!id.matches("[a-z0-9-]{1,64}")
        || !sha256.matches("[a-f0-9]{64}")
        || world.isBlank()
        || spawnSite.isBlank()) {
      throw new IllegalArgumentException(
          "heritage archive needs an id, sha256, world and spawn site");
    }
  }
}
