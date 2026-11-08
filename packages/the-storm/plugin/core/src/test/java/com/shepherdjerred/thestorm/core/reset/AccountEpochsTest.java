package com.shepherdjerred.thestorm.core.reset;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class AccountEpochsTest {
  @Test
  void revocationSurvivesRestartEvenIfALaterResetStageFails(@TempDir Path directory)
      throws Exception {
    var player = new UUID(0, 1);
    var path = directory.resolve("reset.db");
    try (var database = StormDatabase.open(path)) {
      database.migrate("core", getClass().getClassLoader());
      var epochs = new AccountEpochs(new SqlAccountEpochs(database));
      epochs.loaded().get(5, TimeUnit.SECONDS);
      var resets = new PlayerResetRegistry(epochs);
      resets.register(
          "core",
          owner -> {
            assertThat(epochs.current(owner)).isEqualTo(1);
            return CompletableFuture.failedFuture(new IllegalStateException("later failure"));
          });
      resets.complete(Set.of());
      assertThat(resets.reset(player)).failsWithin(Duration.ofSeconds(5));
      assertThat(epochs.current(player)).isEqualTo(1);
    }
    try (var database = StormDatabase.open(path)) {
      var epochs = new AccountEpochs(new SqlAccountEpochs(database));
      epochs.loaded().get(5, TimeUnit.SECONDS);
      assertThat(epochs.current(player)).isEqualTo(1);
      assertThat(epochs.current(new UUID(0, 2))).isZero();
      epochs.retire(player).get(5, TimeUnit.SECONDS);
      assertThat(epochs.current(player)).isEqualTo(2);
    }
  }
}
