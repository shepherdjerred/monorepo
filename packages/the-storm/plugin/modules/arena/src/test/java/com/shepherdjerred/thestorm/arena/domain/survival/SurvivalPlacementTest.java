package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class SurvivalPlacementTest {
  @Test
  void everyBlockAndFixtureKeepsItsLayoutInSeparateWorldsAcrossNegativeChunkBoundaries()
      throws java.security.NoSuchAlgorithmException {
    var directory = Path.of("../../../server/owned/plugins/TheStorm/arena");
    var settlement = ConfigFiles.load(directory.resolve("survival.yml"), SurvivalContent.class);
    var rustworks =
        ConfigFiles.load(directory.resolve("rustworks.yml"), SurvivalMapContent.class)
            .withRules(settlement);
    assertThat(settlement.arena().world()).isEqualTo("settlement");
    assertThat(rustworks.arena().world()).isEqualTo("rustworks");
    for (var content : java.util.List.of(settlement, rustworks)) {
      var placement = SurvivalPlacement.authored(content);
      var authored = placement.content(content);
      var original = fingerprint(authored, new SurvivalPlacement(0, 0));
      assertThat(fingerprint(content, placement)).isEqualTo(original);
      assertThat(content.arena().region().min().chunk().x()).isNegative();
      assertThat(content.arena().region().max().chunk().x()).isPositive();
    }
  }

  private static String fingerprint(SurvivalContent content, SurvivalPlacement placement)
      throws java.security.NoSuchAlgorithmException {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    var blocks = SurvivalBlueprint.blocks(content);
    assertThat(blocks.get(content.lobbyGuide())).isEqualTo("LECTERN");
    blocks.forEach(
        (at, material) ->
            digest.update(
                (placement.block(at).describe() + "=" + material + "\n")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    return java.util.HexFormat.of().formatHex(digest.digest());
  }
}
