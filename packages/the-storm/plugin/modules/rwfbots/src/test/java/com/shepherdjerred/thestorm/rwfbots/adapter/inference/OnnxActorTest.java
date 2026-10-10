package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import com.shepherdjerred.thestorm.rwfbots.app.learning.ActorMatrix;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

final class OnnxActorTest {
  private static Path fixture() {
    return Path.of(
        java.util.Objects.requireNonNull(System.getProperty("thestorm.rwfbots.actorParity")));
  }

  @Test
  void matchesPythonAcrossIndependentRecurrentBatchSizes() {
    var result = ActorParity.verify(fixture().resolve("onnx"), fixture().resolve("samples.json"));
    assertThat(result.batches()).containsExactly(1, 3, 20, 100);
    assertThat(result.steps()).isEqualTo(16);
    assertThat(result.maximumAbsoluteError()).isLessThan(1e-5);
  }

  @Test
  void unacceptedModelsCannotLoadThroughTheAcceptedGate() {
    assertThatIllegalArgumentException()
        .isThrownBy(
            () -> OnnxActor.load(fixture().resolve("onnx"), ActorManifest.Acceptance.ACCEPTED));
  }

  @Test
  void changingOnlyTheAcceptanceLabelCannotPromoteDiagnosticTraining() throws Exception {
    var json = JsonMapper.builder().build();
    var manifest = json.readTree(Files.readString(fixture().resolve("onnx/manifest.json")));
    var changed = ((tools.jackson.databind.node.ObjectNode) manifest).put("acceptance", "accepted");
    assertThatIllegalArgumentException()
        .isThrownBy(() -> ActorManifest.validate(changed, ActorManifest.Acceptance.ACCEPTED));
  }

  @Test
  void corruptedArtifactAndUnknownMetadataFailLoudly(@TempDir Path out) throws Exception {
    Files.copy(fixture().resolve("onnx/manifest.json"), out.resolve("manifest.json"));
    Files.write(out.resolve("actor.onnx"), new byte[] {1, 2, 3});
    assertThatIllegalArgumentException()
        .isThrownBy(() -> OnnxActor.load(out, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC));
    var json = JsonMapper.builder().build();
    var manifest = json.readTree(Files.readString(out.resolve("manifest.json")));
    var changed = ((tools.jackson.databind.node.ObjectNode) manifest).put("unexpected", true);
    assertThatIllegalArgumentException()
        .isThrownBy(
            () -> ActorManifest.validate(changed, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC));
  }

  @Test
  void closedNativeSessionsCannotBeUsedAndMatricesDoNotLeakMutableArrays() {
    var actor =
        OnnxActor.load(fixture().resolve("onnx"), ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC);
    actor.close();
    actor.close();
    var values = new float[34];
    var observation = new ActorMatrix(1, 34, values);
    values[0] = 1;
    observation.values()[0] = 1;
    assertThat(observation.values()).containsOnly(0f);
    var input =
        new RecurrentActor.Input(
            observation,
            new ActorMatrix(1, 128, new float[128]),
            new ActorMatrix(1, 128, new float[128]));
    assertThatIllegalStateException().isThrownBy(() -> actor.forward(input));
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new ActorMatrix(1, 1, new float[] {Float.NaN}));
  }
}
