package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.AcceptedModels;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;

final class PromotionSealingTest {
  private static Path source(Path directory, PromotionFixture fixture) throws Exception {
    var source = Files.createDirectory(directory.resolve("original"));
    Files.write(source.resolve("actor.onnx"), fixture.actor);
    Files.writeString(
        source.resolve("manifest.json"),
        PromotionContract.JSON.writeValueAsString(fixture.source) + "\n");
    return source;
  }

  @Test
  void sealerReplaysRealJniAndWritesOnlyOneSyntheticCodecManifest(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    Files.delete(directory.resolve("manifest.json"));
    var original = source(directory, fixture);
    var sourceBytes = Files.readAllBytes(original.resolve("manifest.json"));
    var result = PromotionBundle.seal(directory, original);
    assertThat(result.acceptance()).isEqualTo("accepted");
    assertThat(result.learned_control_enabled()).isFalse();
    assertThat(result.java_parity().batches()).containsExactly(1, 3, 20, 100);
    assertThat(result.java_parity().steps()).isEqualTo(16);
    assertThat(ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .isEqualTo(fixture.actor);
    assertThat(Files.readAllBytes(original.resolve("manifest.json"))).isEqualTo(sourceBytes);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> PromotionBundle.seal(directory, original))
        .withMessageContaining("already exists");
  }

  @Test
  void failedGatesNeverWriteAnAcceptedManifest(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    ((ObjectNode) fixture.proof.path("preference")).put("learned_votes", 14);
    fixture.seal();
    Files.delete(directory.resolve("manifest.json"));
    var original = source(directory, fixture);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> PromotionBundle.seal(directory, original));
    assertThat(directory.resolve("manifest.json")).doesNotExist();
    assertThat(directory.resolve("promotion-result.json")).doesNotExist();
  }

  @Test
  void substitutedOriginalCannotBeSealed(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    Files.delete(directory.resolve("manifest.json"));
    var original = source(directory, fixture);
    Files.write(original.resolve("actor.onnx"), new byte[] {1, 2, 3});
    assertThatIllegalArgumentException()
        .isThrownBy(() -> PromotionBundle.seal(directory, original))
        .withMessageContaining("original actor changed");
    assertThat(directory.resolve("manifest.json")).doesNotExist();
  }

  @Test
  void acceptedOwnerWarmsAndCachesOneSyntheticCodecActor(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    assertThat(fixture.actor).isNotEmpty();
    try (var pool = new DirectComputePool();
        var models =
            new AcceptedModels(
                new AcceptedModels.Parts(directory, pool, new SplittableRandom(1), () -> 0))) {
      var model = models.load().join();
      assertThat(models.load().join()).isSameAs(model);
      assertThat(model.metrics().submitted()).isZero();
    }
  }

  @Test
  void acceptedOwnerDoesNotTreatAnUnacceptedDiagnosticAsARequiredAsset(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    Files.writeString(
        directory.resolve("manifest.json"),
        PromotionContract.JSON.writeValueAsString(fixture.source));
    try (var pool = new DirectComputePool();
        var models =
            new AcceptedModels(
                new AcceptedModels.Parts(directory, pool, new SplittableRandom(1), () -> 0))) {
      org.assertj.core.api.Assertions.assertThatThrownBy(() -> models.load().join())
          .hasCauseInstanceOf(IllegalArgumentException.class);
    }
  }
}
