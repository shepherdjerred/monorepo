package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The added kits' weights, laid over the personality files as they load. */
final class KitWeightsFileTest {

  private static Path dataDirectory() {
    var personalities = System.getProperty("thestorm.rwfbots.personalities");
    assertThat(personalities).as("the build passes the shipped personalities").isNotNull();
    return Path.of(personalities).resolve("../..").normalize();
  }

  private static Path personalities() {
    return dataDirectory().resolve(PersonalityFiles.DIRECTORY);
  }

  @Test
  void everyKitCanBeDraftedOnceTheWeightsAreLaidOver() {
    var catalog = PersonalityFiles.load(dataDirectory());

    for (var kit : Kit.values()) {
      assertThat(catalog.all().stream().filter(p -> p.kits().getOrDefault(kit, 0.0) > 0))
          .as("personalities that may pick %s", kit)
          .isNotEmpty();
    }
  }

  @Test
  void theFilesKeepTheirOwnWeightsAndGainOnlyTheAddedKits() {
    var files = PersonalityFiles.loadDirectory(personalities());
    var loaded = PersonalityFiles.load(dataDirectory());

    for (var personality : files.all()) {
      var merged = loaded.byId(personality.id()).orElseThrow();
      personality
          .kits()
          .forEach((kit, weight) -> assertThat(merged.kits()).containsEntry(kit, weight));
    }
  }

  @Test
  void aMissingEntryAnEntryWithoutAPersonalityOrAReweighedKitStopsTheModule() {
    var files = PersonalityFiles.loadDirectory(personalities());
    var shipped = KitWeightsFile.load(dataDirectory()).personalities();
    var first = files.all().getFirst();

    var missing = new HashMap<>(shipped);
    missing.remove(first.id());
    assertThatThrownBy(() -> new KitWeightsFile(missing).applyTo(files))
        .hasMessageContaining("%s has no entry", first.id());

    var stray = new HashMap<>(shipped);
    stray.put("nobody-here", Map.of());
    assertThatThrownBy(() -> new KitWeightsFile(stray).applyTo(files))
        .hasMessageContaining("nobody-here is not a personality");

    var owned = first.kits().keySet().iterator().next();
    var reweighed = new HashMap<>(shipped);
    reweighed.put(first.id(), Map.of(owned.id(), 0.5));
    assertThatThrownBy(() -> new KitWeightsFile(reweighed).applyTo(files))
        .hasMessageContaining("already weighs %s", owned.id());
  }
}
