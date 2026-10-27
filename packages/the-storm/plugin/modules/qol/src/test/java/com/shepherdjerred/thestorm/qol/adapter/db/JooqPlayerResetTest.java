package com.shepherdjerred.thestorm.qol.adapter.db;

import static com.shepherdjerred.thestorm.qol.adapter.db.generated.Tables.QOL_PLAYER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqPlayerResetTest {

  @Test
  void resetRecreatesAFirstJoinProfileWithoutTouchingAnotherPlayer(@TempDir Path directory)
      throws Exception {
    try (var database = StormDatabase.open(directory.resolve("qol.db"))) {
      database.migrate("qol", getClass().getClassLoader());
      var profiles = new JooqQolStore(database);
      var target = UUID.randomUUID();
      var other = UUID.randomUUID();
      await(profiles.ensure(target, Instant.EPOCH));
      await(profiles.ensure(other, Instant.EPOCH));

      await(new JooqPlayerReset(database).reset(target));

      int targetRows =
          await(
              database.read(
                  dsl -> dsl.fetchCount(QOL_PLAYER, QOL_PLAYER.PLAYER.eq(target.toString()))));
      int otherRows =
          await(
              database.read(
                  dsl -> dsl.fetchCount(QOL_PLAYER, QOL_PLAYER.PLAYER.eq(other.toString()))));
      assertThat(targetRows).isZero();
      assertThat(otherRows).isEqualTo(1);
      assertThat(await(profiles.ensure(target, Instant.EPOCH)).created()).isTrue();
      assertThat(await(profiles.ensure(target, Instant.EPOCH)).profile().starterRtpCharges())
          .isEqualTo(8);
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
