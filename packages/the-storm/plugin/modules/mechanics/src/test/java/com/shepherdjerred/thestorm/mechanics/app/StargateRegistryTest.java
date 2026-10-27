package com.shepherdjerred.thestorm.mechanics.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class StargateRegistryTest {
  private static final UUID NETWORK = new UUID(0, 1);
  private static final UUID WORLD = new UUID(0, 2);
  private static final UUID OWNER = new UUID(0, 3);

  private static Stargate gate(long id, String name, int x) {
    return new Stargate(
        new UUID(1, id),
        NETWORK,
        name,
        OWNER,
        WORLD,
        new Pos(x - 1, 65, -1),
        new StargateFrame(new Pos(x, 63, 0), Direction.EAST));
  }

  @Test
  void indexesSignsAndInteriorsAndOrdersOtherDestinations() {
    var network = new StargateNetwork(NETWORK, "Roads", new NetworkAccess.Public());
    var home = gate(1, "Home", 0);
    var zoo = gate(2, "Zoo", 10);
    var arena = gate(3, "Arena", 20);
    var registry =
        new StargateRegistry(
            new StargateStore.Snapshot(List.of(network), List.of(home, zoo, arena)));
    assertThat(registry.network("ROADS")).contains(network);
    assertThat(registry.sign(WORLD, home.sign())).contains(home);
    assertThat(registry.interior(WORLD, home.frame().interior().getFirst())).contains(home);
    assertThat(registry.destinations(home)).containsExactly(arena, zoo);
  }

  @Test
  void rejectsMissingNetworksAndOverlappingGates() {
    var network = new StargateNetwork(NETWORK, "Roads", new NetworkAccess.Public());
    var first = gate(1, "One", 0);
    assertThatThrownBy(
            () -> new StargateRegistry(new StargateStore.Snapshot(List.of(), List.of(first))))
        .isInstanceOf(IllegalStateException.class);
    var overlap = gate(2, "Two", 1);
    assertThatThrownBy(
            () ->
                new StargateRegistry(
                    new StargateStore.Snapshot(List.of(network), List.of(first, overlap))))
        .isInstanceOf(IllegalStateException.class);
  }
}
