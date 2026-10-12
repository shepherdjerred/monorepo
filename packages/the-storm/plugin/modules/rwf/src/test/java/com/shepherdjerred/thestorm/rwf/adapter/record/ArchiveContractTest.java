package com.shepherdjerred.thestorm.rwf.adapter.record;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * The recording archive contract ({@code rwf-archive.json}) is the language-neutral source the
 * Temporal archiver reads; the writer and the retention guard must agree with it.
 */
final class ArchiveContractTest {

  private static final Path OWNED = Path.of("../../../server/owned/plugins/TheStorm");

  @Test
  void theWriterAndRetentionAgreeWithTheArchiveContract() throws IOException {
    var contract =
        JsonMapper.builder().build().readTree(Files.readString(OWNED.resolve("rwf-archive.json")));

    assertThat(contract.get("version").asInt()).isEqualTo(1);
    assertThat(contract.get("recordingSuffix").asString()).isEqualTo(GzipRecorder.SUFFIX);
    assertThat(contract.get("partSuffix").asString()).isEqualTo(GzipRecorder.PART_SUFFIX);
    assertThat(contract.get("markerSuffix").asString()).isEqualTo(Retention.MARKER_SUFFIX);
    assertThat(contract.get("marker").asString()).isEqualTo(Retention.Marker.VERSION);
    var config = Files.readString(OWNED.resolve("rwf.yml"));
    assertThat(config)
        .containsPattern("(?m)^  directory: " + contract.get("directory").asString() + "$");
  }
}
