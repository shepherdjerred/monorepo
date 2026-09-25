package com.shepherdjerred.thestorm.mechanics.domain.creation;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.BlockDropsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.CookingPotConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.ElevatorConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.HiddenSwitchConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.LightSwitchConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.MapChangerConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.PaintingSwitcherConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.PistonConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SignCopierConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.Unlock;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class CreationRulesTest {

  private static final Pos SIGN = new Pos(0, 64, 0);

  private static final MechanicsConfig CONFIG =
      new MechanicsConfig(
          new HiddenSwitchConfig(TestConfigs.access(1)),
          new LightSwitchConfig(TestConfigs.access(1), 8, 16, List.of("minecraft:candle")),
          new CookingPotConfig(
              TestConfigs.access(1), List.of("minecraft:fire"), Map.of("minecraft:coal", 8), 64),
          new BlockDropsConfig(new Unlock(true, 1), List.of("minecraft:glass")),
          new ElevatorConfig(TestConfigs.access(2), 64),
          TestConfigs.span(8, 1),
          TestConfigs.gate(3, 8, 8),
          TestConfigs.span(8, 1),
          new SignCopierConfig(new Unlock(true, 3), "minecraft:feather"),
          new MapChangerConfig(new Access(true, 3, 3), 16),
          new PaintingSwitcherConfig(new Unlock(true, 3)),
          new PistonConfig(
              new Unlock(true, 4),
              new Unlock(true, 4),
              new Unlock(true, 5),
              new Unlock(true, 5),
              1.5,
              8,
              4,
              12,
              List.of("minecraft:obsidian")));

  private static final CreationRules RULES = CreationRules.standard(CONFIG);

  private static SignView view(Mechanism mechanism, Mount mount, Optional<Direction> facing) {
    return new SignView(List.of("", mechanism.tag(), "", ""), mount, facing);
  }

  private static Optional<Refusal> check(TestGrid grid, Mechanism mechanism, SignView view) {
    return RULES.check(new CreationRequest(mechanism, SIGN, view, grid));
  }

  private static Optional<Refusal> check(TestGrid grid, Mechanism mechanism) {
    return check(grid, mechanism, view(mechanism, Mount.WALL, Optional.of(Direction.NORTH)));
  }

  @ParameterizedTest
  @EnumSource(
      value = Mechanism.class,
      names = {"LIGHT_SWITCH", "LIFT_UP", "LIFT_DOWN", "LIFT"})
  void signsWithNothingToCheckAreAccepted(Mechanism mechanism) {
    assertThat(check(new TestGrid(), mechanism)).isEmpty();
  }

  @Test
  void aHiddenSwitchMustHangOnAWall() {
    var standing = view(Mechanism.HIDDEN_SWITCH, Mount.STANDING, Optional.of(Direction.NORTH));

    assertThat(check(new TestGrid(), Mechanism.HIDDEN_SWITCH)).isEmpty();
    assertThat(check(new TestGrid(), Mechanism.HIDDEN_SWITCH, standing))
        .contains(new Refusal("Put this sign on the side of a block."));
  }

  @Test
  void aBridgeNeedsASquareFacingAndABase() {
    var withBase = new TestGrid().solid(SIGN.offset(Direction.DOWN), PLANKS);
    var diagonal = view(Mechanism.BRIDGE, Mount.STANDING, Optional.empty());

    assertThat(check(withBase, Mechanism.BRIDGE)).isEmpty();
    assertThat(check(withBase, Mechanism.BRIDGE, diagonal))
        .contains(new Refusal("Turn the sign to face north, south, east or west."));
    assertThat(check(new TestGrid().solid(SIGN.offset(Direction.DOWN), STONE), Mechanism.BRIDGE))
        .isPresent();
  }

  @Test
  void theFarEndOfABridgeCanComeLater() {
    var grid = new TestGrid().solid(SIGN.offset(Direction.UP), PLANKS);

    assertThat(check(grid, Mechanism.BRIDGE)).isEmpty();
  }

  @Test
  void doorsNeedTheirBaseOnTheirSide() {
    var above = new TestGrid().solid(SIGN.offset(Direction.UP), PLANKS);
    var below = new TestGrid().solid(SIGN.offset(Direction.DOWN), PLANKS);

    assertThat(check(above, Mechanism.DOOR_UP)).isEmpty();
    assertThat(check(below, Mechanism.DOOR_UP)).isPresent();
    assertThat(check(below, Mechanism.DOOR_DOWN)).isEmpty();
    assertThat(check(above, Mechanism.DOOR_DOWN)).isPresent();
  }

  @Test
  void aGateSignNeedsAGateNearby() {
    var grid = new TestGrid().fill(new Pos(1, 64, 1), new Pos(1, 66, 1), TestGrid.FENCE);

    assertThat(check(grid, Mechanism.GATE)).isEmpty();
    assertThat(check(new TestGrid(), Mechanism.GATE))
        .contains(new Refusal("No gate within 3 blocks of this sign."));
  }

  @Test
  void aCookingPotNeedsHeatBelow() {
    var grid = new TestGrid().solid(new Pos(0, 62, 0), "minecraft:fire");

    assertThat(check(grid, Mechanism.COOKING_POT)).isEmpty();
    assertThat(check(new TestGrid(), Mechanism.COOKING_POT)).isPresent();
  }

  @Test
  void aMapChangerNeedsARange() {
    var good =
        new SignView(List.of("", "[Map]", "3-9", ""), Mount.WALL, Optional.of(Direction.NORTH));
    var tooMany =
        new SignView(List.of("", "[Map]", "0-99", ""), Mount.WALL, Optional.of(Direction.NORTH));

    assertThat(check(new TestGrid(), Mechanism.MAP_CHANGER, good)).isEmpty();
    assertThat(check(new TestGrid(), Mechanism.MAP_CHANGER, tooMany))
        .contains(new Refusal("A map changer cycles at most 16 maps."));
    assertThat(check(new TestGrid(), Mechanism.MAP_CHANGER)).isPresent();
  }

  @ParameterizedTest
  @EnumSource(
      value = Mechanism.class,
      names = {"CRUSH", "BOUNCE", "SUPER_PUSH"})
  void pistonSignsTouchAPiston(Mechanism mechanism) {
    var piston = new TestGrid().solid(SIGN.offset(Direction.WEST), "minecraft:piston");
    var sticky = new TestGrid().solid(SIGN.offset(Direction.UP), "minecraft:sticky_piston");

    assertThat(check(piston, mechanism)).isEmpty();
    assertThat(check(sticky, mechanism)).isEmpty();
    assertThat(check(new TestGrid(), mechanism))
        .contains(new Refusal("Put this sign against a piston."));
  }

  @Test
  void superStickyNeedsAStickyPiston() {
    var piston = new TestGrid().solid(SIGN.offset(Direction.WEST), "minecraft:piston");
    var sticky = new TestGrid().solid(SIGN.offset(Direction.DOWN), "minecraft:sticky_piston");

    assertThat(check(sticky, Mechanism.SUPER_STICKY)).isEmpty();
    assertThat(check(piston, Mechanism.SUPER_STICKY))
        .contains(new Refusal("Put this sign against a sticky piston."));
  }
}
