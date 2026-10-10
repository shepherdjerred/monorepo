package com.shepherdjerred.thestorm.rwfbots.sim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionContract;
import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SimulationCaptureTest {
  @TempDir Path directory;

  @Test
  void originalFixedPairsAreCompleteAndCannotBeOverwritten() throws IOException {
    var file = directory.resolve("original.jsonl");
    SimulationCapture.capture(file);
    var original = Files.readAllBytes(file);
    var lines = Files.readAllLines(file);
    var header = PromotionContract.JSON.readValue(lines.getFirst(), SimulationCapture.Header.class);
    assertThat(header)
        .isEqualTo(
            new SimulationCapture.Header(
                "header",
                1,
                "rwf-authored-simulation-floors-v1",
                "authored-simulation",
                false,
                false));
    var complete =
        PromotionContract.JSON.readValue(lines.getLast(), SimulationCapture.Complete.class);
    assertThat(complete).isEqualTo(new SimulationCapture.Complete("complete", 16));
    var runs =
        lines.stream()
            .filter(line -> line.contains("\"type\":\"run\""))
            .map(line -> PromotionContract.JSON.readValue(line, SimulationCapture.Run.class))
            .toList();
    assertThat(runs.stream().map(SimulationCapture.Run::seed).toList())
        .containsExactlyElementsOf(
            IntStream.range(10, 26).mapToObj(value -> (long) value).toList());
    assertThat(runs.stream().map(SimulationCapture.Run::run).toList())
        .containsExactlyElementsOf(IntStream.rangeClosed(1, 16).boxed().toList());
    var endings =
        lines.stream()
            .filter(line -> line.contains("\"type\":\"end\""))
            .map(line -> PromotionContract.JSON.readValue(line, SimulationCapture.End.class))
            .toList();
    assertThat(endings)
        .hasSize(16)
        .allSatisfy(
            end -> {
              assertThat(end.contact()).isNotNull().isPositive();
              assertThat(end.tick()).isEqualTo(Math.max(Advance.BY, end.contact()));
              assertThat(end.measurements()).hasSize(2);
            });
    assertThatThrownBy(() -> SimulationCapture.capture(file))
        .isInstanceOf(FileAlreadyExistsException.class);
    assertThat(Files.readAllBytes(file)).isEqualTo(original);
  }

  @Test
  void changedSeedsAndMalformedNeutralContractsFailLoudly() {
    var json = PromotionContract.JSON.writeValueAsString(SimulationContract.SPEC);
    var changed =
        PromotionContract.JSON.readValue(
            json.replace("\"firstSeed\":10", "\"firstSeed\":11"), SimulationContract.Spec.class);
    assertThatThrownBy(() -> SimulationContract.validate(changed))
        .hasMessageContaining("fixed advancement test");
    assertThatThrownBy(
            () ->
                PromotionContract.JSON.readValue(
                    json.replace("\"firstSeed\":10,", ""), SimulationContract.Spec.class))
        .hasMessageContaining("firstSeed");
    assertThatThrownBy(
            () ->
                PromotionContract.JSON.readValue(
                    json.replace("{", "{\"unexpected\":true,"), SimulationContract.Spec.class))
        .hasMessageContaining("unexpected");
  }
}
