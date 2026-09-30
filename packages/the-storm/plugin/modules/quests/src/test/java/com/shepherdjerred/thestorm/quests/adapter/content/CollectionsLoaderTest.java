package com.shepherdjerred.thestorm.quests.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;

final class CollectionsLoaderTest {

  @TempDir Path directory;

  @Test
  void shippedCatalogueHasTwentyValidDiscoveries() {
    MockBukkit.mock();
    try {
      var result = CollectionsLoader.load(ShippedContent.OWNED, ShippedContent.registry().items());
      var collections =
          result.fold(
              value -> value,
              problems -> {
                throw new AssertionError(problems);
              });
      assertThat(collections.entries()).hasSize(20);
      assertThat(collections.entries().values())
          .extracting(entry -> entry.region())
          .contains("Spawn Town", "Sewers", "Library", "Wilds");
      assertThat(collections.matching("IRON_INGOT"))
          .extracting(entry -> entry.id())
          .containsExactly("smiths-stock");
    } finally {
      MockBukkit.unmock();
    }
  }

  @Test
  void badAuthoredMaterialHasItsFileAndField() throws Exception {
    Files.writeString(
        directory.resolve("collections.yml"),
        "collections:\n  relic:\n    name: Relic\n    material: OLD_FISH\n    region: Wilds\n    note: Unknown.\n");
    var result = CollectionsLoader.load(directory, Set.of("COD"));
    java.util.List<String> descriptions =
        result.fold(
            value -> java.util.List.of(),
            problems -> problems.stream().map(Object::toString).toList());
    assertThat(descriptions)
        .anySatisfy(
            problem ->
                assertThat(problem)
                    .contains("collections.yml", "collections.relic.material", "OLD_FISH"));
  }
}
