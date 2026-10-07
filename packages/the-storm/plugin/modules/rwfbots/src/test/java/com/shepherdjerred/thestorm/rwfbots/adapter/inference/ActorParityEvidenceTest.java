package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;

final class ActorParityEvidenceTest {
  private static Path fixture() {
    return Path.of(
        java.util.Objects.requireNonNull(System.getProperty("thestorm.rwfbots.actorParity")));
  }

  private static ObjectNode samples() throws Exception {
    return (ObjectNode)
        ActorParityEvidence.JSON.readTree(Files.readAllBytes(fixture().resolve("samples.json")));
  }

  private static Path write(Path out, ObjectNode samples) throws Exception {
    var file = out.resolve("samples.json");
    Files.writeString(file, ActorParityEvidence.JSON.writeValueAsString(samples));
    return file;
  }

  @Test
  void receiptBindsExactArtifactsAndCannotBeReplaced(@TempDir Path out) throws Exception {
    var output = out.resolve("receipt.json");
    var receipt =
        ActorParityEvidence.write(
            fixture().resolve("onnx"), fixture().resolve("samples.json"), output);
    assertThat(receipt.schema()).isEqualTo(1);
    assertThat(receipt.acceptance()).isEqualTo("unaccepted");
    assertThat(receipt.replay().batches()).containsExactly(1, 3, 20, 100);
    assertThat(receipt.replay().steps()).isEqualTo(16);
    assertThat(receipt.artifacts().samples_sha256())
        .isEqualTo(ActorManifest.sha256(Files.readAllBytes(fixture().resolve("samples.json"))));
    assertThat(receipt.artifacts().actor_manifest_sha256())
        .isEqualTo(
            ActorManifest.sha256(Files.readAllBytes(fixture().resolve("onnx/manifest.json"))));
    var before = Files.readAllBytes(output);
    assertThatThrownBy(
            () ->
                ActorParityEvidence.write(
                    fixture().resolve("onnx"), fixture().resolve("samples.json"), output))
        .isInstanceOf(java.io.UncheckedIOException.class);
    assertThat(Files.readAllBytes(output)).isEqualTo(before);
  }

  @Test
  void substitutedArtifactBindingsCannotProduceReceipt(@TempDir Path out) throws Exception {
    for (var field :
        java.util.List.of(
            "onnx_sha256",
            "actor_manifest_sha256",
            "checkpoint_manifest_sha256",
            "weights_sha256",
            "contract_sha256")) {
      var changed = samples().put(field, "0".repeat(64));
      var file = write(out, changed);
      assertThatIllegalArgumentException()
          .isThrownBy(
              () ->
                  ActorParityEvidence.write(
                      fixture().resolve("onnx"), file, out.resolve("receipt.json")));
    }
    assertThat(out.resolve("receipt.json")).doesNotExist();
  }

  @Test
  void inaccurateOutputsAndIncompleteRecurrentCasesFail(@TempDir Path out) throws Exception {
    var changed = samples();
    ((tools.jackson.databind.node.ArrayNode)
            changed.path("cases").path(0).path("steps").path(0).path("logits").path(0))
        .set(0, ActorParityEvidence.JSON.valueToTree(50));
    var file = write(out, changed);
    assertThatIllegalArgumentException()
        .isThrownBy(
            () ->
                ActorParityEvidence.write(
                    fixture().resolve("onnx"), file, out.resolve("receipt.json")));
    var incomplete = samples();
    ((tools.jackson.databind.node.ArrayNode) incomplete.path("cases").path(0).path("steps"))
        .remove(15);
    write(out, incomplete);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorParity.verify(fixture().resolve("onnx"), file));
    assertThat(out.resolve("receipt.json")).doesNotExist();
  }

  @Test
  void unknownMissingOrNullFieldsFailAtTheBoundary(@TempDir Path out) throws Exception {
    var extra = samples().put("unexpected", true);
    var file = write(out, extra);
    assertThatThrownBy(() -> ActorParity.verify(fixture().resolve("onnx"), file))
        .isInstanceOf(RuntimeException.class);
    var missing = samples();
    missing.remove("cases");
    write(out, missing);
    assertThatThrownBy(() -> ActorParity.verify(fixture().resolve("onnx"), file))
        .isInstanceOf(RuntimeException.class);
    write(out, samples().putNull("cases"));
    assertThatThrownBy(() -> ActorParity.verify(fixture().resolve("onnx"), file))
        .isInstanceOf(RuntimeException.class);
  }
}
