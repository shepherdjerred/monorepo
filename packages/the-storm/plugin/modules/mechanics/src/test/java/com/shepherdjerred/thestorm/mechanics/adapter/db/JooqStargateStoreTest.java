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
            new Pos(-1, 65, 2),
            new StargateFrame(new Pos(2, 63, 3), Direction.EAST, StargateFrame.Shape.CIRCLE),
            "Destination",
            true);
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

  @Test
  void automaticallyCreatedNetworkAndGateCommitTogether() throws Exception {
    var network = new StargateNetwork(NETWORK, "Road", new NetworkAccess.Public());
    var gate =
        new Stargate(
            GATE,
            NETWORK,
            "Home",
            OWNER,
            WORLD,
            new Pos(1, 65, 2),
            new StargateFrame(new Pos(2, 63, 3), Direction.EAST),
            null,
            false);
    store.createNetworkAndGate(network, gate).get();
    assertThat(store.load().get().networks()).containsExactly(network);
    assertThat(store.load().get().gates()).containsExactly(gate);

    var otherId = new UUID(2, 3);
    var other = new StargateNetwork(otherId, "Other", new NetworkAccess.Public());
    var duplicate =
        new Stargate(
            GATE,
            otherId,
            "OtherGate",
            OWNER,
            WORLD,
            new Pos(1, 65, 2),
            new StargateFrame(new Pos(2, 63, 3), Direction.EAST),
            null,
            false);
    assertThatThrownBy(() -> store.createNetworkAndGate(other, duplicate).get())
        .isInstanceOf(ExecutionException.class);
    assertThat(store.load().get().networks()).containsExactly(network);
    assertThat(store.load().get().gates()).containsExactly(gate);
  }

  @Test
  void resetRemovesOwnedPrivateNetworksOwnedGatesAndInvitationsOnly() throws Exception {
    var publicId = new UUID(1, 1);
    var otherPrivateId = new UUID(1, 2);
    var other = new UUID(1, 3);
    var privateNetwork =
        new StargateNetwork(NETWORK, "Mine", new NetworkAccess.Private(OWNER, Set.of(GUEST)));
    var publicNetwork = new StargateNetwork(publicId, "Road", new NetworkAccess.Public());
    var otherNetwork =
        new StargateNetwork(
            otherPrivateId, "Theirs", new NetworkAccess.Private(other, Set.of(OWNER, GUEST)));
    store.createNetwork(privateNetwork).get();
    store.createNetwork(publicNetwork).get();
    store.createNetwork(otherNetwork).get();
    var myGate =
        new Stargate(
            GATE,
            publicId,
            "Mine",
            OWNER,
            WORLD,
            new Pos(1, 65, 2),
            new StargateFrame(new Pos(2, 63, 3), Direction.EAST),
            null,
            false);
    var guestGate =
        new Stargate(
            new UUID(2, 1),
            NETWORK,
            "Guest",
            GUEST,
            WORLD,
            new Pos(11, 65, 2),
            new StargateFrame(new Pos(12, 63, 3), Direction.EAST),
            null,
            false);
    var keptGate =
        new Stargate(
            new UUID(2, 2),
            publicId,
            "Kept",
            other,
            WORLD,
            new Pos(21, 65, 2),
            new StargateFrame(new Pos(22, 63, 3), Direction.EAST),
            null,
            false);
    store.createGate(myGate).get();
    store.createGate(guestGate).get();
    store.createGate(keptGate).get();

    store.resetPlayer(OWNER).get();
    store.resetPlayer(OWNER).get();
    var result = store.load().get();
    assertThat(result.networks())
        .containsExactlyInAnyOrder(
            publicNetwork,
            new StargateNetwork(
                otherPrivateId, "Theirs", new NetworkAccess.Private(other, Set.of(GUEST))));
    assertThat(result.gates()).containsExactly(keptGate);
  }
}
