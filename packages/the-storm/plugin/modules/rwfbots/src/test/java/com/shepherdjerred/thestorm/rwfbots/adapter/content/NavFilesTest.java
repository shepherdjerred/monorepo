package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The synthetic map baked with {@code MapBaker}, encoded with {@code NavCodec} and written to
 * {@code rwf/maps/<id>/nav.rwfnav} loads back; anything else is reported by map id, and the catalog
 * releases an artifact only once the match's map hashes to what it was baked from.
 */
final class NavFilesTest {

  private static final NavArtifact SYNTHETIC = SyntheticMap.bake();

  @TempDir Path directory;

  private Path mapFolder(String mapId) throws IOException {
    var folder = directory.resolve(NavFiles.MAPS_DIRECTORY).resolve(mapId);
    Files.createDirectories(folder);
    return folder;
  }

  @Test
  void aBakedArtifactNextToItsMapLoadsByMapId() throws IOException {
    Files.write(mapFolder("synthetic").resolve(NavFiles.FILE_NAME), NavCodec.encode(SYNTHETIC));
    mapFolder("harbour");

    var loaded = NavFiles.load(directory);

    assertThat(loaded.artifacts()).containsOnlyKeys("synthetic");
    assertThat(loaded.artifacts().get("synthetic")).isEqualTo(SYNTHETIC);
    assertThat(loaded.problems())
        .containsOnlyKeys("harbour")
        .containsValue("no nav.rwfnav; bake one with the rwfmap tool");
  }

  @Test
  void aCorruptOrMisnamedArtifactIsReportedNotUsed() throws IOException {
    Files.write(mapFolder("broken").resolve(NavFiles.FILE_NAME), new byte[] {1, 2, 3, 4});
    Files.write(mapFolder("renamed").resolve(NavFiles.FILE_NAME), NavCodec.encode(SYNTHETIC));

    var loaded = NavFiles.load(directory);

    assertThat(loaded.artifacts()).isEmpty();
    assertThat(loaded.problems().get("broken")).startsWith("nav.rwfnav does not decode");
    assertThat(loaded.problems().get("renamed"))
        .isEqualTo("nav.rwfnav was baked for map synthetic, not renamed");
  }

  @Test
  void anObsoleteGeneratorCannotReleaseUnsafeNavigation() throws IOException {
    var old =
        new NavArtifact(
            SYNTHETIC.formatVersion(),
            1,
            SYNTHETIC.mapId(),
            SYNTHETIC.blocksSha256(),
            SYNTHETIC.sites(),
            SYNTHETIC.grid(),
            SYNTHETIC.graph(),
            SYNTHETIC.regions(),
            SYNTHETIC.cover(),
            SYNTHETIC.chokepoints(),
            SYNTHETIC.routes(),
            SYNTHETIC.distanceFields());
    Files.write(mapFolder("synthetic").resolve(NavFiles.FILE_NAME), NavCodec.encode(old));
    var loaded = NavFiles.load(directory);
    assertThat(loaded.artifacts()).isEmpty();
    assertThat(loaded.problems())
        .containsEntry("synthetic", "nav.rwfnav uses an obsolete generator; rebake the map");
  }

  @Test
  void aMissingMapsFolderIsADeploymentError() {
    assertThatThrownBy(() -> NavFiles.load(directory))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("rwf/maps");
  }

  @Test
  void theCatalogReleasesAnArtifactOnlyForTheTerrainItWasBakedFrom() {
    var catalog = new NavCatalog();
    catalog.add(SYNTHETIC);
    catalog.reject("harbour", "no nav.rwfnav");

    assertThat(catalog.forMap("synthetic")).as("before the map is chosen").isEmpty();
    assertThat(catalog.confirm("synthetic", "f".repeat(64)))
        .hasValueSatisfying(reason -> assertThat(reason).contains("rebake"));
    assertThat(catalog.forMap("synthetic")).isEmpty();
    assertThat(catalog.confirm("synthetic", SYNTHETIC.blocksSha256())).isEmpty();
    assertThat(catalog.forMap("synthetic")).contains(SYNTHETIC);
    assertThat(catalog.confirm("harbour", "0".repeat(64))).contains("no nav.rwfnav");
    assertThat(catalog.confirm("unknown", "0".repeat(64)))
        .hasValueSatisfying(reason -> assertThat(reason).contains("no nav artifact"));
    assertThat(catalog.problems()).containsOnlyKeys("harbour", "unknown");
  }

  @Test
  void releasingInactiveNavigationDropsBothDecodedAndConfirmedReferences() {
    var catalog = new NavCatalog();
    catalog.add(SYNTHETIC);
    assertThat(catalog.confirm("synthetic", SYNTHETIC.blocksSha256())).isEmpty();
    catalog.evict("synthetic");
    assertThat(catalog.decoded()).isEmpty();
    assertThat(catalog.forMap("synthetic")).isEmpty();
    assertThat(catalog.problems()).isEmpty();
  }
}
