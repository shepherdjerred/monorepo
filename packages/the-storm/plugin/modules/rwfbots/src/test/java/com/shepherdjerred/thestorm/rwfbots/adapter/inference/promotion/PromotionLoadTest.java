package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;

final class PromotionLoadTest {
  @Test
  void editedSummaryAndReportCannotConcealSlowerRawTicks(@TempDir Path directory) throws Exception {
    var fixture = new PromotionFixture(directory);
    var load = (ObjectNode) fixture.proof.path("load");
    var row = (ObjectNode) load.path("phases").get(0);
    row.put("p95", 19);
    var report =
        (ObjectNode)
            PromotionContract.JSON.readTree(
                Files.readAllBytes(
                    directory.resolve(
                        "evidence/" + load.path("result_sha256").asString() + ".blob")));
    ((ObjectNode) report.path("rows").get(0)).put("p95", 19);
    load.put("result_sha256", fixture.blob(report));
    var proof =
        PromotionContract.JSON.readValue(
            PromotionContract.JSON.writeValueAsString(fixture.proof), PromotionProof.class);
    var files = new PromotionFiles(directory, proof);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> PromotionLoad.validate(files, proof.load()))
        .withMessageContaining("recomputed load p95");
  }

  @Test
  void rehasedIncompleteCommandStreamCannotReplaceTheOriginal(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    var load = (ObjectNode) fixture.proof.path("load");
    var lines =
        Files.readAllLines(
            directory.resolve("evidence/" + load.path("log_sha256").asString() + ".blob"));
    lines.remove(1);
    load.put("log_sha256", fixture.blob(String.join("\n", lines) + "\n"));
    var proof =
        PromotionContract.JSON.readValue(
            PromotionContract.JSON.writeValueAsString(fixture.proof), PromotionProof.class);
    var files = new PromotionFiles(directory, proof);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> PromotionLoad.validate(files, proof.load()))
        .withMessageContaining("raw load baseline");
  }
}
