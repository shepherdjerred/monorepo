package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqTownsStore;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.bukkit.configuration.file.YamlConfiguration;

/** Imports a synthetic owner through the same historical town path on disposable Paper. */
final class HistoricalTownFixtures {
  private HistoricalTownFixtures() {}

  static void seed(Path content) {
    var owner =
        UUID.nameUUIDFromBytes("OfflinePlayer:HistoryTownA".getBytes(StandardCharsets.UTF_8));
    var site =
        new HeritageSite(
            "fixture-old-town",
            "OldTown",
            HeritageSite.Kind.PLAYER,
            "OldTown",
            "world",
            RegionProfile.SAFE,
            Set.of(new HeritageSite.Chunk(100, 100)),
            List.of(),
            Set.of(),
            List.of(new HeritageSite.Editor(owner, "HistoryTownA")),
            "Disposable fixture");
    attachSite(content, owner);
    try (var database = StormDatabase.open(content.resolve("the-storm.db"))) {
      database.migrate("towns", JooqTownsStore.class.getClassLoader());
      new JooqTownsStore(database)
          .importHeritage(List.of(site), Instant.EPOCH)
          .get(30, TimeUnit.SECONDS);
    } catch (Exception failure) {
      throw new IllegalStateException("Could not seed historical town", failure);
    }
  }

  private static void attachSite(Path content, UUID owner) {
    var file = content.resolve("heritage.yml").toFile();
    var config = new YamlConfiguration();
    try {
      config.load(file);
      var sites = new java.util.ArrayList<>(config.getMapList("sites"));
      sites.add(
          new java.util.LinkedHashMap<>(
              java.util.Map.ofEntries(
                  java.util.Map.entry("id", "fixture-old-town"),
                  java.util.Map.entry("name", "OldTown"),
                  java.util.Map.entry("kind", "PLAYER"),
                  java.util.Map.entry("activeTownName", "OldTown"),
                  java.util.Map.entry("world", "world"),
                  java.util.Map.entry("profile", "SAFE"),
                  java.util.Map.entry(
                      "protectedChunks",
                      new java.util.ArrayList<>(
                          List.of(
                              new java.util.LinkedHashMap<>(
                                  java.util.Map.of("x", 100, "z", 100))))),
                  java.util.Map.entry("protectedAreas", new java.util.ArrayList<>()),
                  java.util.Map.entry("editingChunks", new java.util.ArrayList<>()),
                  java.util.Map.entry(
                      "editors",
                      new java.util.ArrayList<>(
                          List.of(
                              new java.util.LinkedHashMap<>(
                                  java.util.Map.of(
                                      "player", owner.toString(), "name", "HistoryTownA"))))),
                  java.util.Map.entry("provenance", "Disposable fixture"))));
      config.set("sites", sites);
      config.save(file);
    } catch (java.io.IOException | org.bukkit.configuration.InvalidConfigurationException failure) {
      throw new IllegalStateException("Could not prepare historical town site", failure);
    }
  }
}
