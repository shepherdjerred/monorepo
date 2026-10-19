package com.shepherdjerred.thestorm.towns.domain.heritage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class HeritageConfigTest {
  private static final String FIRST = "a".repeat(64);
  private static final String SECOND = "b".repeat(64);

  private static HeritageSite site(String id, HeritageSite.Kind kind, String world) {
    return new HeritageSite(
        id,
        id + " name",
        kind,
        "",
        world,
        RegionProfile.SAFE,
        Set.of(new HeritageSite.Chunk(0, 0)),
        List.of(),
        Set.of(),
        List.of(),
        "Fixture provenance.");
  }

  private static final List<HeritageSite> SITES =
      List.of(
          site("spawn", HeritageSite.Kind.SERVER, "world"),
          site("map2-spawn", HeritageSite.Kind.SERVER, "map2"),
          site("map2-town", HeritageSite.Kind.HERITAGE, "map2"),
          site("settlement", HeritageSite.Kind.SERVER, "settlement"));

  private static HeritageArchive map1() {
    return new HeritageArchive("main-map1-2015-07-09", FIRST, "world", "spawn");
  }

  private static HeritageArchive map2() {
    return new HeritageArchive("main-map2-2016-01-10", SECOND, "map2", "map2-spawn");
  }

  @Test
  void twoArchivesResolveByIdAndWorldWhileModernWorldsRemainUnarchived() {
    var config = new HeritageConfig(2, List.of(map1(), map2()), SITES);
    assertThat(config.archive("main-map2-2016-01-10")).contains(map2());
    assertThat(config.archiveForWorld("world")).contains(map1());
    assertThat(config.archiveForWorld("map2")).contains(map2());
    assertThat(config.archiveForWorld("settlement")).isEmpty();
    assertThat(config.archive("unknown")).isEmpty();
  }

  @Test
  void rejectsOtherSchemaVersionsAndMissingArchives() {
    assertThatThrownBy(() -> new HeritageConfig(1, List.of(map1()), SITES))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeritageConfig(2, List.of(), SITES))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsDuplicateArchiveIdsHashesAndWorlds() {
    var sameId = new HeritageArchive("main-map1-2015-07-09", SECOND, "map2", "map2-spawn");
    var sameHash = new HeritageArchive("main-map2-2016-01-10", FIRST, "map2", "map2-spawn");
    var sameWorld = new HeritageArchive("main-map2-2016-01-10", SECOND, "world", "spawn");
    for (var duplicate : List.of(sameId, sameHash, sameWorld)) {
      assertThatThrownBy(() -> new HeritageConfig(2, List.of(map1(), duplicate), SITES))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("duplicate heritage archive");
    }
  }

  @Test
  void requiresEachArchiveSpawnToBeAServerSiteInItsOwnWorld() {
    for (var spawn : List.of("missing", "map2-town", "spawn")) {
      var archive = new HeritageArchive("main-map2-2016-01-10", SECOND, "map2", spawn);
      assertThatThrownBy(() -> new HeritageConfig(2, List.of(map1(), archive), SITES))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("server spawn site");
    }
  }

  @Test
  void rejectsMalformedArchiveIdentity() {
    assertThatThrownBy(() -> new HeritageArchive("Main Map", FIRST, "world", "spawn"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeritageArchive("main", "ABC", "world", "spawn"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeritageArchive("main", FIRST, " ", "spawn"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeritageArchive("main", FIRST, "world", ""))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void siteNamesStayUniqueAcrossArchives() {
    var clash =
        new HeritageSite(
            "map2-clash",
            "SPAWN NAME",
            HeritageSite.Kind.HERITAGE,
            "",
            "map2",
            RegionProfile.SAFE,
            Set.of(new HeritageSite.Chunk(1, 1)),
            List.of(),
            Set.of(),
            List.of(),
            "Fixture provenance.");
    var sites = new ArrayList<>(SITES);
    sites.add(clash);
    assertThatThrownBy(() -> new HeritageConfig(2, List.of(map1(), map2()), sites))
        .hasMessageContaining("duplicate heritage site");
  }
}
