package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.OnnxActor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

final class PromotionBundleTest {
  @Test
  void completeSyntheticCodecBundleCanBeReadWithoutChangingItsExport(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    assertThat(ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .isEqualTo(fixture.actor);
    assertThatIllegalArgumentException()
        .isThrownBy(
            () -> ActorManifest.load(directory, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC));
    assertThat(Files.readString(directory.resolve("source-manifest.json")))
        .isEqualTo("%s\n", PromotionContract.JSON.writeValueAsString(fixture.source));
  }

  @Test
  void labelAndHumanTrainingMetadataCannotLoadWithoutPromotion(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    Files.delete(directory.resolve("promotion.json"));
    // JNI must never receive this deliberately invalid graph when the evidence is missing.
    Files.write(directory.resolve("actor.onnx"), new byte[] {1, 2, 3});
    assertThatIllegalArgumentException()
        .isThrownBy(() -> OnnxActor.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("missing bundle file promotion.json");
    fixture.source.put("acceptance", "accepted");
    assertThatIllegalArgumentException()
        .isThrownBy(
            () -> ActorManifest.validate(fixture.source, ActorManifest.Acceptance.ACCEPTED));
  }

  @Test
  void artifactManifestAndEveryEvidenceFileRemainBound(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    var original = Files.readString(directory.resolve("manifest.json"));
    var changed = (ObjectNode) PromotionContract.JSON.readTree(original);
    changed.put("weights_sha256", "a".repeat(64));
    Files.writeString(
        directory.resolve("manifest.json"), PromotionContract.JSON.writeValueAsString(changed));
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("differs from evaluated export");
    Files.writeString(directory.resolve("manifest.json"), original);
    var evidence = directory.resolve(fixture.proof.path("files").get(0).path("file").asString());
    var bytes = Files.readAllBytes(evidence);
    Files.write(evidence, new byte[] {1, 2, 3});
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("evidence checksum");
    Files.write(evidence, bytes);
    Files.write(directory.resolve("actor.onnx"), new byte[] {1, 2, 3});
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("ONNX artifact hash mismatch");
  }

  @Test
  void pathsAndSymlinksCannotEscapeTheBundle(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    var entry = (ObjectNode) fixture.proof.path("files").get(0);
    var name = entry.path("file").asString();
    entry.put("file", "../outside.blob");
    fixture.seal();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("canonical evidence path");
    entry.put("file", name);
    fixture.seal();
    var evidence = directory.resolve(name);
    var target = directory.resolve("outside.blob");
    Files.move(evidence, target);
    Files.createSymbolicLink(evidence, target);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("evidence symlink");
  }

  @Test
  void summaryWinsCannotDisagreeWithArchivedStrengthOutcomes(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    var seed = (ObjectNode) fixture.proof.path("pilot").path("seeds").get(0);
    seed.put("authored_wins", 121);
    fixture.seal();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("recomputed strength wins");
  }

  @Test
  void archivedStrengthRejectsOldReportsAndChangedMapOrGameBindings(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    var seed = (ObjectNode) fixture.proof.path("pilot").path("seeds").get(0);
    var digest = seed.path("strength_sha256").asString();
    var original =
        (ObjectNode)
            PromotionContract.JSON.readTree(
                Files.readAllBytes(directory.resolve("evidence/" + digest + ".blob")));
    var mutations =
        List.<Consumer<ObjectNode>>of(
            value -> value.put("version", 1),
            value -> value.put("extra", true),
            value -> ((ArrayNode) value.path("maps")).remove(0),
            value -> ((ObjectNode) value.path("games").get(0)).put("blocksSha256", "f".repeat(64)),
            value ->
                ((ObjectNode) value.path("games").get(0)).put("scenarioSha256", "f".repeat(64)),
            value -> ((ObjectNode) value.path("games").get(0)).put("map", "other-map"),
            value -> ((ObjectNode) value.path("games").get(0)).put("extra", true),
            value -> ((ObjectNode) value.path("games").get(0)).put("seed", 500000001),
            value -> ((ObjectNode) value.path("games").get(0)).put("side", "blue"),
            value ->
                ((ObjectNode) value.path("games").get(1))
                    .set("match", value.path("games").get(0).path("match")));
    for (var mutation : mutations) {
      var changed = original.deepCopy();
      mutation.accept(changed);
      seed.put("strength_sha256", fixture.blob(changed));
      fixture.seal();
      assertThatIllegalArgumentException()
          .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED));
    }
    seed.put("strength_sha256", digest);
    fixture.seal();
    assertThat(ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .isEqualTo(fixture.actor);
  }

  @Test
  void summaryVotesCannotDisagreeWithTheSealedHumanBallot(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    var preference = (ObjectNode) fixture.proof.path("preference");
    preference.put("learned_votes", 16).put("ties", 4);
    fixture.seal();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.load(directory, ActorManifest.Acceptance.ACCEPTED))
        .withMessageContaining("recomputed blind votes");
  }

  @Test
  void proofParserRejectsUnknownMissingNullAndCoercedFields(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    var original = fixture.proof.deepCopy();
    var mutations =
        List.<Consumer<ObjectNode>>of(
            node -> node.put("passed", true),
            node -> node.remove("load"),
            node -> node.putNull("load"),
            node -> node.put("schema", "1"),
            node -> node.put("schema", 1.5));
    for (var mutate : mutations) {
      var changed = original.deepCopy();
      mutate.accept(changed);
      assertThatThrownBy(
              () ->
                  PromotionContract.JSON.readValue(
                      PromotionContract.JSON.writeValueAsString(changed), PromotionProof.class))
          .isInstanceOf(tools.jackson.core.JacksonException.class);
    }
  }
}
