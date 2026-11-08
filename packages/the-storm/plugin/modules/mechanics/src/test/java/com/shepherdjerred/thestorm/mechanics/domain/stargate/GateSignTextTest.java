package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GateSignTextTest {
  @Test
  void readsTheActualArchivedStargateLayout() {
    var lines = List.of("-Sea Grinder-", "Right click", "to use gate", "(SeaStar)");
    assertThat(GateSignText.rendered(lines)).isTrue();
    assertThat(GateSignText.name(lines)).isEqualTo("Sea Grinder");
    assertThat(GateSignText.network(lines)).isEqualTo("SeaStar");
    assertThat(
            GateSignText.network(
                List.of("-Keystone-", "Right click", "to use gate", "((private))")))
        .isEqualTo("(private)");
  }

  @Test
  void creationInputAndRenderedFixedDestinationsDescribeTheSameGate() {
    var network = new StargateNetwork(new UUID(0, 1), "Roads", new NetworkAccess.Public());
    var gate =
        new Stargate(
            new UUID(0, 2),
            network.id(),
            "Home",
            new UUID(0, 3),
            new UUID(0, 4),
            new Pos(-1, 66, -1),
            new StargateFrame(new Pos(0, 64, 0), Direction.EAST),
            "Work",
            true);
    var input =
        new SignView(
            List.of("Home", "Work", "Roads", "A"), Mount.WALL, Optional.of(Direction.NORTH));
    var rendered =
        new SignView(
            GateSignText.display(gate, network, ""), Mount.WALL, Optional.of(Direction.NORTH));
    assertThat(GateSignText.matches(input, gate, network)).isTrue();
    assertThat(rendered.lines()).containsExactly("-Home-", ">Work<", "", "(Roads)");
    assertThat(GateSignText.matches(rendered, gate, network)).isTrue();
    var changed =
        new SignView(
            List.of("-Home-", ">Other<", "", "(Roads)"), Mount.WALL, Optional.of(Direction.NORTH));
    assertThat(GateSignText.matches(changed, gate, network)).isFalse();
  }
}
