package com.shepherdjerred.thestorm.creative.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.creative.app.VisitBody;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqBodyStoreTest {

  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000008");

  @TempDir Path directory;

  @Test
  void bodiesRoundTripAndACleanLeaveDropsOnlyCreative() throws Exception {
    var survival = body(BodyRole.SURVIVAL, 4, new byte[] {1}, new byte[] {7});
    var creative = body(BodyRole.CREATIVE, 30, new byte[] {2}, new byte[] {8});
    try (var database = StormDatabase.open(directory.resolve("creative.db"))) {
      database.migrate("creative", JooqBodyStoreTest.class.getClassLoader());
      var store = new JooqBodyStore(database);
      store.save(survival).join();
      store.save(creative).join();

      assertThat(store.load(PLAYER).join()).containsExactly(survival, creative);

      store.delete(PLAYER, BodyRole.CREATIVE).join();
      assertThat(store.load(PLAYER).join()).containsExactly(survival);

      store.delete(PLAYER).join();
      assertThat(store.load(PLAYER).join()).isEmpty();
    }
  }

  private static VisitBody body(BodyRole role, int experience, byte[] inventory, byte[] ender) {
    return new VisitBody(
        role,
        new Snapshot(
            PLAYER,
            role.wire(),
            new Position(role == BodyRole.CREATIVE ? "creative" : "world", 1.5, 65, -0.5, 90, 0),
            new Vitals(
                new Vitals.Condition(18, 17, 4, 0.5f),
                role == BodyRole.CREATIVE ? "CREATIVE" : "SURVIVAL",
                new Vitals.Flight(role == BodyRole.CREATIVE, false, 0.1f),
                20),
            new Experience(experience, 0.25f, experience),
            ItemData.of(inventory),
            List.of(new EffectRecord("minecraft:speed", 1, 40, false, true, true)),
            Instant.parse("2026-10-18T00:00:00Z")),
        ItemData.of(ender));
  }
}
