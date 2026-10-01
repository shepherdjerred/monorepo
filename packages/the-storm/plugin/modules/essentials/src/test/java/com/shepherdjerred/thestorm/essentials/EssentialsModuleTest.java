package com.shepherdjerred.thestorm.essentials;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import com.shepherdjerred.thestorm.essentials.testing.PaperHarness;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class EssentialsModuleTest {

  @Test
  void publishesModerationForTheAgentModule(@TempDir Path directory) {
    try (var harness = PaperHarness.start(directory, new FakeWallets())) {
      var moderation = harness.services.require(ModerationService.class);
      harness.until(() -> moderation.loaded().isDone());
      assertThat(moderation.loaded()).isCompleted();
    }
  }
}
