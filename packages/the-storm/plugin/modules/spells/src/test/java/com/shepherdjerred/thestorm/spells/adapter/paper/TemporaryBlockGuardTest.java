package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.ExplosionResult;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Zombie;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Temporary blocks cannot be broken, burnt, melted, taken, pushed or blown up. */
final class TemporaryBlockGuardTest {

  private final Harness harness = new Harness();
  private final TemporaryBlocks blocks =
      new TemporaryBlocks(
          new TemporaryBlocksWorldTest.MemoryStore(), harness.server, harness.clock, harness.async);
  private final TemporaryBlockGuard guard = new TemporaryBlockGuard(blocks);

  private Block wall;
  private Block plain;

  @BeforeEach
  void setUp() {
    wall = harness.world.getBlockAt(0, 100, 0);
    wall.setType(Material.AIR);
    blocks.place(List.of(wall), Material.PACKED_ICE.createBlockData(), Duration.ofSeconds(30));
    plain = harness.world.getBlockAt(3, 100, 0);
    plain.setType(Material.STONE);
  }

  @AfterEach
  void tearDown() {
    harness.close();
  }

  @Test
  void theTemporaryBlockIsInPlace() {
    assertThat(wall.getType()).isEqualTo(Material.PACKED_ICE);
    assertThat(blocks.holds(wall)).isTrue();
    assertThat(blocks.holds(plain)).isFalse();
  }

  @Test
  void itCannotBeBroken() {
    var player = harness.server.addPlayer();
    var onWall = new BlockBreakEvent(wall, player);
    var onPlain = new BlockBreakEvent(plain, player);

    guard.onBreak(onWall);
    guard.onBreak(onPlain);

    assertThat(onWall.isCancelled()).isTrue();
    assertThat(onPlain.isCancelled()).isFalse();
  }

  @Test
  void itCannotBurnOrMelt() {
    var burn = new BlockBurnEvent(wall, plain);
    var fade = new BlockFadeEvent(wall, wall.getState());

    guard.onBurn(burn);
    guard.onFade(fade);

    assertThat(burn.isCancelled()).isTrue();
    assertThat(fade.isCancelled()).isTrue();
  }

  @Test
  void creaturesCannotTakeOrChangeIt() {
    var zombie = harness.world.spawn(new Location(harness.world, 5, 100, 5), Zombie.class);
    var change = new EntityChangeBlockEvent(zombie, wall, Material.AIR.createBlockData());

    guard.onEntityChange(change);

    assertThat(change.isCancelled()).isTrue();
  }

  @Test
  void pistonsCannotMoveIt() {
    var piston = harness.world.getBlockAt(-1, 100, 0);
    var push = new BlockPistonExtendEvent(piston, List.of(wall), BlockFace.EAST);
    var pull = new BlockPistonRetractEvent(piston, List.of(wall), BlockFace.WEST);
    var other = new BlockPistonExtendEvent(piston, List.of(plain), BlockFace.EAST);

    guard.onPistonPush(push);
    guard.onPistonPull(pull);
    guard.onPistonPush(other);

    assertThat(push.isCancelled()).isTrue();
    assertThat(pull.isCancelled()).isTrue();
    assertThat(other.isCancelled()).isFalse();
  }

  @Test
  void explosionsSpareItButNotItsNeighbours() {
    var fromBlock =
        new BlockExplodeEvent(
            plain,
            plain.getState(),
            new ArrayList<>(List.of(wall, plain)),
            1f,
            ExplosionResult.DESTROY);
    var zombie = harness.world.spawn(new Location(harness.world, 5, 100, 5), Zombie.class);
    var fromEntity =
        new EntityExplodeEvent(
            zombie,
            zombie.getLocation(),
            new ArrayList<>(List.of(wall, plain)),
            1f,
            ExplosionResult.DESTROY);

    guard.onBlockExplode(fromBlock);
    guard.onEntityExplode(fromEntity);

    assertThat(fromBlock.blockList()).containsExactly(plain);
    assertThat(fromEntity.blockList()).containsExactly(plain);
  }
}
