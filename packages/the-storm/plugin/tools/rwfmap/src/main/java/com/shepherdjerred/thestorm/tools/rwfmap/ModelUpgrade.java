package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavModelUpgrade;
import java.io.IOException;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Explicit offline migration of a private, fully verified model-3 map folder. */
final class ModelUpgrade {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private ModelUpgrade() {}

  private record Hashes(
      String sourceArtifact, String targetArtifact, String terrain, String classification) {}

  private record Receipt(
      String map, Hashes hashes, int climbableNodes, NavModelUpgrade.Preservation preserved) {}

  static int model3(Path folder, PrintStream out) {
    var map = MapFolder.load(folder);
    var classification = map.classify();
    try {
      var legacy = Files.readAllBytes(map.navFile());
      var legacySummary = Files.readString(map.summaryFile());
      var classificationSha = JSON.readTree(legacySummary).required("classificationSha256");
      if (!classificationSha.isString())
        throw new IllegalArgumentException("legacy summary has no classification hash");
      var source =
          new NavModelUpgrade.Source(
              map.id(),
              map.schematic().sha256(),
              classification,
              Sites.of(map.definition()),
              classificationSha.asString());
      var upgraded =
          switch (NavModelUpgrade.model3(legacy, source)) {
            case Result.Ok<NavModelUpgrade.Upgraded, NavCodec.CodecError>(var value) -> value;
            case Result.Err<NavModelUpgrade.Upgraded, NavCodec.CodecError>(var error) ->
                throw new IllegalArgumentException(error.message());
          };
      // Reconstruct the exact former summary without running weighted analysis again. Its
      // classification hash, sites, counts, route costs and original byte length must all match.
      var expectedLegacy =
          Summary.of(upgraded.artifact(), classification, List.of(), legacy)
              .replace("\"generatorVersion\": 4,", "\"generatorVersion\": 3,")
              .replace("\"movementModelVersion\": 4,", "\"movementModelVersion\": 3,");
      if (!legacySummary.equals(expectedLegacy))
        throw new IllegalArgumentException(
            "legacy summary differs from exact model-3 terrain/analysis");
      var bytes = upgraded.bytes();
      var summary = Summary.of(upgraded.artifact(), classification, List.of(), bytes);
      Files.write(map.navFile(), bytes);
      Files.writeString(map.summaryFile(), summary);
      out.println(
          JSON.writeValueAsString(
              new Receipt(
                  map.id(),
                  new Hashes(
                      sha256(legacy),
                      sha256(bytes),
                      map.schematic().sha256(),
                      MapBaker.sha256(classification)),
                  upgraded.artifact().graph().climbableNodes().cardinality(),
                  upgraded.preservation())));
      return RwfMap.OK;
    } catch (IOException e) {
      throw new UncheckedIOException("could not upgrade private map folder " + folder, e);
    } catch (JacksonException e) {
      throw new IllegalArgumentException("legacy summary is not valid JSON", e);
    }
  }

  private static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is mandatory", e);
    }
  }
}
