package com.shepherdjerred.thestorm.creative.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.PlotViews;
import com.shepherdjerred.thestorm.creative.domain.RecoveredPlot;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqClaimStoreTest {

  private static final UUID OWNER = UUID.fromString("cb488c76-08ba-4755-b425-6613fde02f70");
  private static final UUID FRIEND = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID STRANGER = UUID.fromString("00000000-0000-0000-0000-000000000003");

  @TempDir Path directory;

  @Test
  void claimsTrustAndAReleaseRoundTripWithoutWritingACatalog() throws Exception {
    var plot = new PlotId(2, 1);
    var claimed =
        new StoredClaim(
            plot,
            Optional.of(OWNER),
            false,
            true,
            "Harbor",
            "A dock",
            Map.of(FRIEND, PlotRole.TRUSTED),
            Set.of(),
            PlotSurface.DEFAULT);
    var released =
        new StoredClaim(
            plot,
            Optional.empty(),
            true,
            false,
            "Harbor",
            "A dock",
            Map.of(),
            Set.of(),
            PlotSurface.DEFAULT);
    try (var database = StormDatabase.open(directory.resolve("creative.db"))) {
      database.migrate("creative", JooqClaimStoreTest.class.getClassLoader());
      var store = new JooqClaimStore(database);

      store.save(claimed).join();
      assertThat(store.loadAll().join()).containsExactly(claimed);

      store
          .save(
              claimed
                  .withAccess(Map.of(STRANGER, PlotRole.DENIED, FRIEND, PlotRole.MEMBER))
                  .withText("Harbor", "Still a dock"))
          .join();
      var replaced = store.loadAll().join().getFirst();
      assertThat(replaced.access())
          .containsEntry(STRANGER, PlotRole.DENIED)
          .containsEntry(FRIEND, PlotRole.MEMBER);
      assertThat(replaced.description()).isEqualTo("Still a dock");

      store.save(released).join();
      assertThat(store.loadAll().join()).containsExactly(released);
      var hidden =
          PlotViews.resolve(
              plot,
              Optional.of(new RecoveredPlot("2;1", OWNER.toString(), List.of())),
              Optional.of(released));
      assertThat(hidden.owner()).isEmpty();
      assertThat(hidden.staffHeld()).isFalse();

      store.delete(plot).join();
      assertThat(store.loadAll().join()).isEmpty();
    }
  }

  @Test
  void aMetadataRowKeepsANullOwner() throws Exception {
    var overlay =
        new StoredClaim(
            new PlotId(0, 0),
            Optional.empty(),
            false,
            false,
            "Ruins",
            "Staff build",
            Map.of(FRIEND, PlotRole.MEMBER),
            Set.of(),
            PlotSurface.DEFAULT);
    try (var database = StormDatabase.open(directory.resolve("overlay.db"))) {
      database.migrate("creative", JooqClaimStoreTest.class.getClassLoader());
      var store = new JooqClaimStore(database);
      store.save(overlay).join();

      assertThat(store.loadAll().join()).containsExactly(overlay);
    }
  }

  @Test
  void aTrustRowWithoutARoleLoadsAsTrusted() throws Exception {
    var plot = new PlotId(4, 4);
    var claimed =
        new StoredClaim(
            plot,
            Optional.of(OWNER),
            false,
            true,
            "Plot",
            "Open",
            Map.of(),
            Set.of(),
            PlotSurface.DEFAULT);
    try (var database = StormDatabase.open(directory.resolve("legacy-role.db"))) {
      database.migrate("creative", JooqClaimStoreTest.class.getClassLoader());
      var store = new JooqClaimStore(database);
      store.save(claimed).join();
      database
          .write(
              dsl ->
                  dsl.query(
                          "INSERT INTO creative_trust (plot_x, plot_z, member) VALUES (?, ?, ?)",
                          plot.x(),
                          plot.z(),
                          FRIEND.toString())
                      .execute())
          .join();

      assertThat(store.loadAll().join().getFirst().access())
          .containsEntry(FRIEND, PlotRole.TRUSTED);
    }
  }

  @Test
  void flagsRoundTripAndAnUnknownFlagFails() throws Exception {
    var plot = new PlotId(5, 5);
    var claimed =
        new StoredClaim(
            plot,
            Optional.of(OWNER),
            false,
            true,
            "Plot",
            "Open",
            Map.of(),
            Set.of(PlotFlag.USE, PlotFlag.PVP),
            PlotSurface.DEFAULT);
    try (var database = StormDatabase.open(directory.resolve("flags.db"))) {
      database.migrate("creative", JooqClaimStoreTest.class.getClassLoader());
      var store = new JooqClaimStore(database);
      store.save(claimed).join();
      assertThat(store.loadAll().join()).containsExactly(claimed);

      store.save(claimed.withFlags(Set.of())).join();
      assertThat(store.loadAll().join().getFirst().flags()).isEmpty();

      database
          .write(
              dsl ->
                  dsl.query(
                          "INSERT INTO creative_flags (plot_x, plot_z, flag) VALUES (?, ?, ?)",
                          plot.x(),
                          plot.z(),
                          "fly")
                      .execute())
          .join();
      assertThatThrownBy(() -> store.loadAll().join())
          .cause()
          .hasMessageContaining("unknown creative flag: fly");
    }
  }

  @Test
  void surfaceRoundTripAndAnUnknownFloorFails() throws Exception {
    var plot = new PlotId(6, 6);
    var claimed =
        new StoredClaim(
            plot,
            Optional.of(OWNER),
            false,
            true,
            "Plot",
            "Open",
            Map.of(),
            Set.of(),
            new PlotSurface(
                Optional.of("minecraft:sand"),
                Optional.of("minecraft:quartz_block"),
                Optional.of("minecraft:desert")));
    try (var database = StormDatabase.open(directory.resolve("surface.db"))) {
      database.migrate("creative", JooqClaimStoreTest.class.getClassLoader());
      var store = new JooqClaimStore(database);
      store.save(claimed).join();
      assertThat(store.loadAll().join()).containsExactly(claimed);

      store.save(claimed.withSurface(PlotSurface.DEFAULT)).join();
      assertThat(store.loadAll().join().getFirst().surface()).isEqualTo(PlotSurface.DEFAULT);

      database
          .write(
              dsl ->
                  dsl.query(
                          "UPDATE creative_claims SET floor = ? WHERE plot_x = ? AND plot_z = ?",
                          "minecraft:tnt",
                          plot.x(),
                          plot.z())
                      .execute())
          .join();
      assertThatThrownBy(() -> store.loadAll().join())
          .cause()
          .hasMessageContaining("unknown creative floor");
    }
  }
}
