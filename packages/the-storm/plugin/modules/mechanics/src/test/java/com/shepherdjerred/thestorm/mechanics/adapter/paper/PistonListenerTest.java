package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.AuditedBlockChanges;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mechanics.app.Gatekeeper;
import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.PistonMoveReaction;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.Piston;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Piston mechanisms across Paper's moving-piston animation lifecycle. */
final class PistonListenerTest {

  @TempDir Path directory;

  private final Map<String, Block> blockSpies = new HashMap<>();

  private ServerMock server;
  private WorldMock rawWorld;
  private World world;
  private PlayerMock owner;
  private PistonListener listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    MechanicsTestPlugin.directory = directory;
    var plugin =
        MockBukkit.loadWith(
            MechanicsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", MechanicsTestPlugin.class.getName()));
    rawWorld = server.addSimpleWorld("world");
    rawWorld.loadChunk(0, 0);
    rawWorld.loadChunk(-1, 0);
    world = wrapWorldWithPistonMetadata();
    owner = server.addPlayer("Alice");

    var config = TestConfigs.mechanics();
    var protection =
        new Protection() {
          @Override
          public Decision check(UUID player, ProtectedAction action, Location location) {
            return location.getBlockX() < 0
                ? new Decision.Denied(MechanicsTestPlugin.DENIED)
                : Decision.allowed();
          }

          @Override
          public Decision checkHarm(
              UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
            return Decision.allowed();
          }

          @Override
          public boolean isPreserved(Location location) {
            return false;
          }

          @Override
          public boolean sameLand(Location a, Location b) {
            return (a.getBlockX() < 0) == (b.getBlockX() < 0);
          }
        };
    var kit =
        new Kit(
            config,
            new Gatekeeper(config),
            new Signs(plugin),
            new Guard(protection),
            new PaperScheduler(plugin),
            new SealedWorlds(),
            new AuditedBlockChanges(change -> {}));
    listener = new PistonListener(kit);
  }

  @AfterEach
  void stop() {
    blockSpies.clear();
    MockBukkit.unmock();
  }

  /**
   * MockBukkit leaves {@code BlockMock.isPassable()} and {@code getPistonMoveReaction()}
   * unimplemented; supply real vanilla values on one shared spy per coordinate.
   */
  private World wrapWorldWithPistonMetadata() {
    var worldSpy = spy(rawWorld);
    doAnswer(
            call -> {
              int x = call.getArgument(0);
              int y = call.getArgument(1);
              int z = call.getArgument(2);
              return blockAt(x, y, z);
            })
        .when(worldSpy)
        .getBlockAt(anyInt(), anyInt(), anyInt());
    return worldSpy;
  }

  private Block blockAt(int x, int y, int z) {
    var key = x + ":" + y + ":" + z;
    var existing = blockSpies.get(key);
    if (existing != null) {
      return existing;
    }
    var blockSpy = spy(rawWorld.getBlockAt(x, y, z));
    doReturn(world).when(blockSpy).getWorld();
    doAnswer(
            call -> {
              BlockFace face = call.getArgument(0);
              return blockAt(x + face.getModX(), y + face.getModY(), z + face.getModZ());
            })
        .when(blockSpy)
        .getRelative(any(BlockFace.class));
    doAnswer(call -> blockSpy.getType().isAir() || Signs.isSign(blockSpy.getType()))
        .when(blockSpy)
        .isPassable();
    doAnswer(call ->
            blockSpy.getType() == Material.OBSIDIAN || blockSpy.getType() == Material.BEDROCK
                ? PistonMoveReaction.BLOCK
                : PistonMoveReaction.MOVE)
        .when(blockSpy)
        .getPistonMoveReaction();
    blockSpies.put(key, blockSpy);
    return blockSpy;
  }

  private void attachPistonSign(Block piston, String tag) {
    var signBlock = piston.getRelative(BlockFace.NORTH);
    signBlock.setType(Material.OAK_WALL_SIGN);
    var wallSign = (WallSign) signBlock.getBlockData();
    wallSign.setFacing(BlockFace.NORTH);
    signBlock.setBlockData(wallSign);
    var sign = (Sign) signBlock.getState();
    sign.getSide(Side.FRONT).line(1, Component.text(tag));
    var plugin = requireNonNull(server.getPluginManager().getPlugin("TheStorm"));
    sign.getPersistentDataContainer()
        .set(
            new NamespacedKey(plugin, "mechanic_owner"),
            PersistentDataType.STRING,
            owner.getUniqueId().toString());
    sign.update();
  }

  private static void settlePiston(
      Block piston, Material material, BlockFace facing, boolean extended) {
    var data = (Piston) material.createBlockData();
    data.setFacing(facing);
    data.setExtended(extended);
    piston.setBlockData(data);
  }

  @Test
  void superStickyCompactsSeparatedBlocksWhenRetractEventFiresWithMovingPiston() {
    var piston = world.getBlockAt(3, 64, 6);
    // Paper replaces the retracting sticky piston base with MOVING_PISTON before firing
    // BlockPistonRetractEvent, then restores STICKY_PISTON[extended=false] once settled.
    piston.setType(Material.MOVING_PISTON);
    attachPistonSign(piston, "[SuperSticky]");
    world.getBlockAt(4, 64, 6).setType(Material.COBBLESTONE);
    world.getBlockAt(7, 64, 6).setType(Material.OAK_PLANKS);
    world.getBlockAt(8, 64, 6).setType(Material.OAK_PLANKS);

    listener.onRetract(new BlockPistonRetractEvent(piston, List.of(), BlockFace.EAST));
    settlePiston(piston, Material.STICKY_PISTON, BlockFace.EAST, false);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(4, 64, 6).getType()).isEqualTo(Material.COBBLESTONE);
    assertThat(world.getBlockAt(5, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(world.getBlockAt(6, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(world.getBlockAt(7, 64, 6).getType()).isEqualTo(Material.AIR);
    assertThat(world.getBlockAt(8, 64, 6).getType()).isEqualTo(Material.AIR);
  }

  @Test
  void superStickyStopsAtRefusedBlocksAndRefusesProtectedMoves() {
    var piston = world.getBlockAt(3, 64, 6);
    piston.setType(Material.MOVING_PISTON);
    attachPistonSign(piston, "[SuperSticky]");
    world.getBlockAt(5, 64, 6).setType(Material.OAK_PLANKS);
    world.getBlockAt(6, 64, 6).setType(Material.OBSIDIAN);
    world.getBlockAt(8, 64, 6).setType(Material.OAK_PLANKS);

    listener.onRetract(new BlockPistonRetractEvent(piston, List.of(), BlockFace.EAST));
    settlePiston(piston, Material.STICKY_PISTON, BlockFace.EAST, false);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(4, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(world.getBlockAt(5, 64, 6).getType()).isEqualTo(Material.AIR);
    assertThat(world.getBlockAt(6, 64, 6).getType()).isEqualTo(Material.OBSIDIAN);
    assertThat(world.getBlockAt(8, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);

    var protectedPiston = world.getBlockAt(0, 64, 6);
    protectedPiston.setType(Material.MOVING_PISTON);
    attachPistonSign(protectedPiston, "[SuperSticky]");
    world.getBlockAt(-3, 64, 6).setType(Material.OAK_PLANKS);

    listener.onRetract(new BlockPistonRetractEvent(protectedPiston, List.of(), BlockFace.WEST));
    settlePiston(protectedPiston, Material.STICKY_PISTON, BlockFace.WEST, false);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(-3, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(world.getBlockAt(-1, 64, 6).getType()).isEqualTo(Material.AIR);
  }

  @Test
  void superStickyDoesNotPullWhenPistonSettlesAsNonStickyOrRotated() {
    var piston = world.getBlockAt(3, 64, 6);
    piston.setType(Material.MOVING_PISTON);
    attachPistonSign(piston, "[SuperSticky]");
    world.getBlockAt(6, 64, 6).setType(Material.OAK_PLANKS);

    listener.onRetract(new BlockPistonRetractEvent(piston, List.of(), BlockFace.EAST));
    settlePiston(piston, Material.PISTON, BlockFace.EAST, false);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(6, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(world.getBlockAt(4, 64, 6).getType()).isEqualTo(Material.AIR);

    piston.setType(Material.MOVING_PISTON);
    listener.onRetract(new BlockPistonRetractEvent(piston, List.of(), BlockFace.EAST));
    settlePiston(piston, Material.STICKY_PISTON, BlockFace.SOUTH, false);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(6, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
  }

  @Test
  void superPushSlidesExtendedLineForwardAfterSettling() {
    var piston = world.getBlockAt(3, 64, 6);
    settlePiston(piston, Material.PISTON, BlockFace.EAST, false);
    attachPistonSign(piston, "[SuperPush]");
    world.getBlockAt(5, 64, 6).setType(Material.OAK_PLANKS);

    listener.onExtendConfirmed(new BlockPistonExtendEvent(piston, List.of(), BlockFace.EAST));
    settlePiston(piston, Material.PISTON, BlockFace.EAST, true);
    server.getScheduler().performTicks(4);

    assertThat(world.getBlockAt(5, 64, 6).getType()).isEqualTo(Material.AIR);
    assertThat(world.getBlockAt(9, 64, 6).getType()).isEqualTo(Material.OAK_PLANKS);
  }
}
