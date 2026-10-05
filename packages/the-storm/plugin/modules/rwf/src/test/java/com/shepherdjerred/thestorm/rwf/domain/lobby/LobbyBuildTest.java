package com.shepherdjerred.thestorm.rwf.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The generated lobby is deterministic and every place in it stands where the layout says. */
final class LobbyBuildTest {

  private static final LobbyLayout LAYOUT = LobbyBuild.layout();

  /** The block state at world position {@code at}. */
  private static String at(LobbyBuild.Blocks blocks, BlockPos at) {
    var origin = LobbyBuild.ORIGIN;
    return blocks.at(at.x() - origin.x(), at.y() - origin.y(), at.z() - origin.z());
  }

  private static void standable(LobbyBuild.Blocks blocks, Spawn stand) {
    var feet = stand.position().toBlock();
    assertThat(at(blocks, feet.plus(0, -1, 0)))
        .as("floor under %s", stand)
        .isNotEqualTo(LobbyBuild.AIR);
    assertThat(at(blocks, feet)).as("feet at %s", stand).isEqualTo(LobbyBuild.AIR);
    assertThat(at(blocks, feet.plus(0, 1, 0))).as("head at %s", stand).isEqualTo(LobbyBuild.AIR);
  }

  @Test
  void generatingTwiceGivesTheSameBlocks() {
    assertThat(LobbyBuild.generate().indices()).isEqualTo(LobbyBuild.generate().indices());
    assertThat(LobbyBuild.layout()).isEqualTo(LAYOUT);
  }

  @Test
  void theRoomIsClosedOnEverySide() {
    var blocks = LobbyBuild.generate();
    for (var x = 0; x < LobbyBuild.WIDTH; x++) {
      for (var z = 0; z < LobbyBuild.LENGTH; z++) {
        assertThat(blocks.at(x, 0, z)).isNotEqualTo(LobbyBuild.AIR);
        assertThat(blocks.at(x, LobbyBuild.HEIGHT - 1, z)).isNotEqualTo(LobbyBuild.AIR);
      }
    }
    for (var y = 1; y < LobbyBuild.HEIGHT - 1; y++) {
      for (var i = 0; i < LobbyBuild.WIDTH; i++) {
        assertThat(blocks.at(i, y, 0)).isNotEqualTo(LobbyBuild.AIR);
        assertThat(blocks.at(i, y, LobbyBuild.LENGTH - 1)).isNotEqualTo(LobbyBuild.AIR);
        assertThat(blocks.at(0, y, i)).isNotEqualTo(LobbyBuild.AIR);
        assertThat(blocks.at(LobbyBuild.WIDTH - 1, y, i)).isNotEqualTo(LobbyBuild.AIR);
      }
    }
  }

  @Test
  void everyPlaceSomeoneStandsHasAFloorAndHeadroom() {
    var blocks = LobbyBuild.generate();
    standable(blocks, LAYOUT.spawn());
    standable(blocks, LAYOUT.balcony());
    LAYOUT.sides().forEach(side -> standable(blocks, side.at()));
    LAYOUT.alcoves().forEach(alcove -> standable(blocks, alcove.stand()));
  }

  @Test
  void theSpawnIsOnTheGoldPadAndTheSidesOnTheirTeamsColours() {
    var blocks = LobbyBuild.generate();

    assertThat(at(blocks, LAYOUT.spawn().position().toBlock().plus(0, -1, 0)))
        .isEqualTo(LobbyBuild.PAD);
    assertThat(
            at(
                blocks,
                LAYOUT.side(TeamColor.RED).orElseThrow().at().position().toBlock().plus(0, -1, 0)))
        .isEqualTo(LobbyBuild.RED);
    assertThat(
            at(
                blocks,
                LAYOUT.side(TeamColor.BLUE).orElseThrow().at().position().toBlock().plus(0, -1, 0)))
        .isEqualTo(LobbyBuild.BLUE);
  }

  @Test
  void eachKitHasALitAlcoveWithItsItemOverThePedestal() {
    var blocks = LobbyBuild.generate();

    assertThat(LAYOUT.kits()).isEqualTo(KitBook.MILESTONE_ONE.stream().map(KitSpec::id).toList());
    for (var alcove : LAYOUT.alcoves()) {
      var item = alcove.display().toBlock();
      assertThat(at(blocks, item)).isEqualTo(LobbyBuild.AIR);
      assertThat(at(blocks, item.plus(0, -1, 0))).isEqualTo(LobbyBuild.PEDESTAL);
      assertThat(
              at(
                  blocks,
                  new BlockPos(
                      LobbyBuild.ORIGIN.x() + LobbyBuild.WIDTH - 1, item.y() + 1, item.z())))
          .isEqualTo(LobbyBuild.LAMP);
    }
  }

  @Test
  void theBalconyLooksOutOfTheWindow() {
    var blocks = LobbyBuild.generate();
    var eye = LAYOUT.balcony().position().toBlock().plus(0, 1, 0);

    assertThat(at(blocks, new BlockPos(LobbyBuild.ORIGIN.x(), eye.y(), eye.z())))
        .isEqualTo(LobbyBuild.GLASS);
    assertThat(LAYOUT.balcony().yaw()).isEqualTo(90);
  }

  @Test
  void aLayoutRefusesPlacesOutsideTheRoomAndDuplicateAlcoves() {
    var outside = new Spawn(new Vec3(0.5, 65, 0.5), 0, 0);
    assertThatThrownBy(
            () ->
                new LobbyLayout(
                    LAYOUT.name(),
                    LAYOUT.region(),
                    outside,
                    LAYOUT.sides(),
                    LAYOUT.alcoves(),
                    LAYOUT.rules(),
                    LAYOUT.board(),
                    LAYOUT.balcony()))
        .hasMessageContaining("spawn");
    var twice = List.of(LAYOUT.alcoves().getFirst(), LAYOUT.alcoves().getFirst());
    assertThatThrownBy(
            () ->
                new LobbyLayout(
                    LAYOUT.name(),
                    LAYOUT.region(),
                    LAYOUT.spawn(),
                    LAYOUT.sides(),
                    twice,
                    LAYOUT.rules(),
                    LAYOUT.board(),
                    LAYOUT.balcony()))
        .hasMessageContaining("two alcoves");
  }
}
