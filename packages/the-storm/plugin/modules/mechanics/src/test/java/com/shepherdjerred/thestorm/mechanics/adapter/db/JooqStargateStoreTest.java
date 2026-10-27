package com.shepherdjerred.thestorm.mechanics.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqStargateStoreTest {
  private static final UUID OWNER = new UUID(0, 1);
  private static final UUID GUEST = new UUID(0, 2);
  private static final UUID NETWORK = new UUID(0, 3);
  private static final UUID GATE = new UUID(0, 4);
  private static final UUID WORLD = new UUID(0, 5);
  @TempDir Path directory;
  private StormDatabase database;
  private JooqStargateStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("test.db"));
    database.migrate("mechanics", getClass().getClassLoader());
    store = new JooqStargateStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void networksInvitesAndGatesSurviveReload() throws Exception {
    var network =
        new StargateNetwork(NETWORK, "Friends", new NetworkAccess.Private(OWNER, Set.of(GUEST)));
    var gate =
        new Stargate(
            GATE,
            NETWORK,
            "Home",
            OWNER,
            WORLD,
            new Pos(1, 65, 2),
            new StargateFrame(new Pos(2, 63, 3), Direction.EAST));
    store.createNetwork(network).get();
    store.createGate(gate).get();
    database.close();
    database = StormDatabase.open(directory.resolve("test.db"));
    database.migrate("mechanics", getClass().getClassLoader());
    store = new JooqStargateStore(database);
    assertThat(store.load().get().networks()).containsExactly(network);
    assertThat(store.load().get().gates()).containsExactly(gate);
    store.replaceInvitations(NETWORK, Set.of()).get();
    assertThat(store.load().get().networks())
        .containsExactly(
            new StargateNetwork(NETWORK, "Friends", new NetworkAccess.Private(OWNER, Set.of())));
    assertThat(store.deleteGate(GATE).get()).isTrue();
    assertThat(store.deleteGate(GATE).get()).isFalse();
    assertThat(store.load().get().gates()).isEmpty();
  }

  @Test
  void duplicateNamesAndInvitationsOnPublicNetworksAreRejected() throws Exception {
    store.createNetwork(new StargateNetwork(NETWORK, "Road", new NetworkAccess.Public())).get();
    assertThatThrownBy(
            () ->
                store
                    .createNetwork(
                        new StargateNetwork(new UUID(1, 1), "ROAD", new NetworkAccess.Public()))
                    .get())
        .isInstanceOf(ExecutionException.class);
    assertThatThrownBy(() -> store.replaceInvitations(NETWORK, Set.of(GUEST)).get())
        .isInstanceOf(ExecutionException.class);
    assertThat(store.load().get().networks())
        .containsExactly(new StargateNetwork(NETWORK, "Road", new NetworkAccess.Public()));
  }
}
