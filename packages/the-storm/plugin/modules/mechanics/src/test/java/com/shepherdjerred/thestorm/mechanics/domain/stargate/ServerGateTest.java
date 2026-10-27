package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class ServerGateTest {
  @Test
  void serverCircleMatchesTheSevenRowOutlineAndItsOpening() {
    var frame = new StargateFrame(new Pos(6, 73, 110), Direction.WEST, StargateFrame.Shape.CIRCLE);
    var rows = new StringBuilder();
    for (var y = 6; y >= 0; y--) {
      for (var x = -3; x <= 3; x++) {
        var pos = new Pos(6 + x, 73 + y, 110);
        rows.append(
            frame.frameBlocks().contains(pos) ? 'X' : frame.interior().contains(pos) ? '.' : ' ');
      }
      rows.append('\n');
    }
    assertThat(rows.toString())
        .isEqualTo("  XXX  \n X...X \nX.....X\nX.....X\nX.....X\n X...X \n  XXX  \n");
    assertThat(frame.controls())
        .containsExactlyInAnyOrder(new Pos(3, 75, 110), new Pos(9, 75, 110));
  }

  @Test
  void rejectsInvalidSignGeometryAndDuplicateDestinationLabels() {
    var first =
        new ServerGate.Destination(
            "Skylands", "skylands", ServerGate.Kind.WORLD, new Pos(1, 70, 1));
    var duplicate =
        new ServerGate.Destination("skylands", "world", ServerGate.Kind.WORLD, new Pos(1, 70, 1));
    assertThatThrownBy(
            () ->
                new ServerGate(
                    "spawn",
                    "world",
                    new Pos(6, 73, 110),
                    Direction.WEST,
                    new Pos(9, 75, 111),
                    false,
                    List.of(first, duplicate)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new ServerGate(
                    "spawn",
                    "world",
                    new Pos(6, 73, 110),
                    Direction.WEST,
                    new Pos(6, 75, 111),
                    false,
                    List.of(first)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void everyDestinationRequiresAnExplicitLanding() {
    assertThatThrownBy(
            () -> new ServerGate.Destination("2015", "world", ServerGate.Kind.WORLD, null))
        .isInstanceOf(NullPointerException.class);
  }

  @Test
  void shippedWelcomeGateHasApprovedCircleAndAllFourDestinations() throws Exception {
    var yaml = Files.readString(Path.of("../../../server/owned/plugins/TheStorm/stargates.yml"));
    var result = StrictYaml.parse("stargates.yml", yaml, StargateConfig.class);
    assertThat(result).isInstanceOf(Result.Ok.class);
    var config = ((Result.Ok<StargateConfig, ?>) result).value();
    assertThat(config.serverGates()).hasSize(1);
    var gate = config.serverGates().getFirst();
    assertThat(gate.origin()).isEqualTo(new Pos(6, 73, 110));
    assertThat(gate.sign()).isEqualTo(new Pos(9, 75, 111));
    assertThat(gate.allowPreservedPortal()).isTrue();
    assertThat(gate.destinations())
        .extracting(ServerGate.Destination::label)
        .containsExactly("2026", "2015", "Skylands", "Creative");
  }

  @Test
  void strictYamlLoadsWorldAndCreativeDestinations() {
    var yaml =
        """
        openFor: PT10S
        serverGates:
          - id: hub
            world: world
            origin: { x: 6, y: 73, z: 110 }
            across: WEST
            sign: { x: 9, y: 75, z: 111 }
            allowPreservedPortal: false
            destinations:
              - { label: '2015', world: world, kind: WORLD, landing: { x: 68, y: 69, z: 66 } }
              - { label: Creative, world: creative, kind: CREATIVE, landing: { x: 1, y: 70, z: 1 } }
        """;
    var result = StrictYaml.parse("stargates.yml", yaml, StargateConfig.class);
    assertThat(result).isInstanceOf(Result.Ok.class);
    assertThat(
            StrictYaml.parse(
                "stargates.yml",
                yaml.replace("    allowPreservedPortal: false\n", ""),
                StargateConfig.class))
        .isInstanceOf(Result.Err.class);
    assertThat(
            StrictYaml.parse(
                "stargates.yml",
                yaml.replace(", landing: { x: 1, y: 70, z: 1 }", ""),
                StargateConfig.class))
        .isInstanceOf(Result.Err.class);
  }
}
