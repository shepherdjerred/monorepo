package com.shepherdjerred.thestorm.companions.adapter.db;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.companions.app.CompanionState;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class CompanionStoreTest {
  @TempDir Path directory;

  @Test
  void persistsInventoryAndRequiresResolvingAnOutstandingEffect() {
    var state =
        new CompanionState(
            UUID.randomUUID(),
            new CompanionState.Position("world", 0, 64, 0, 0, 0),
            new CompanionState.Vitals(19, 18, 3, 2, 0.5f),
            "AA==",
            Optional.empty());
    var file = directory.resolve("companions.db");
    try (var database = StormDatabase.open(file)) {
      database.migrate("companions", getClass().getClassLoader());
      var store = new JooqCompanionStore(database);
      store.save("rowan", state).join();
      var other =
          new CompanionState(
              UUID.randomUUID(),
              state.position(),
              state.vitals(),
              state.inventory(),
              state.building());
      assertThatThrownBy(() -> store.save("rowan", other).join())
          .hasRootCauseInstanceOf(IllegalStateException.class);
      assertThatThrownBy(() -> store.begin("rowan", other, "replace identity").join())
          .hasRootCauseInstanceOf(IllegalStateException.class);
      store.begin("rowan", state, "mine oak").join();
      assertThatThrownBy(() -> store.save("rowan", state).join())
          .hasRootCauseInstanceOf(IllegalStateException.class);
      assertThatThrownBy(() -> store.begin("rowan", state, "craft").join())
          .hasRootCauseInstanceOf(IllegalStateException.class);
    }
    try (var database = StormDatabase.open(file)) {
      var store = new JooqCompanionStore(database);
      var restored = requireNonNull(store.load().join().get("rowan"));
      assertThat(restored.state()).isEqualTo(state);
      assertThat(restored.pending()).contains("mine oak");
      store.finish("rowan", state).join();
      assertThat(requireNonNull(store.load().join().get("rowan")).pending()).isEmpty();
      assertThatThrownBy(() -> store.finish("rowan", state).join())
          .hasRootCauseInstanceOf(IllegalStateException.class);
    }
  }
}
