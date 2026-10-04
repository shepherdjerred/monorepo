package com.shepherdjerred.thestorm.skills.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.skills.app.BlockMove;
import com.shepherdjerred.thestorm.skills.app.BlockPosition;
import com.shepherdjerred.thestorm.skills.app.RankedSkillPlayer;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.ExperienceOrb;
import org.bukkit.event.player.PlayerItemMendEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** The event progression on MockBukkit: no skill XP is earned inside a sealed world. */
final class SkillListenerTest {

  @TempDir Path directory;

  private final SealedWorlds sealed = new SealedWorlds();
  private final RecordingLevels levels = new RecordingLevels();
  private ServerMock server;
  private StormDatabase database;
  private SkillListener listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    var plugin = MockBukkit.createMockPlugin("TheStorm");
    database = StormDatabase.open(directory.resolve("t.db"));
    var context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            new PaperScheduler(plugin),
            new DirectComputePool(),
            database,
            new Services(),
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            plugin.getComponentLogger());
    listener = new SkillListener(context, levels, new SkillsConfig(10, 60), sealed);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
    database.close();
  }

  @Test
  void mendingEarnsRepairExperienceInAnOrdinaryWorld() {
    var world = server.getWorld("world");
    var alice = playerIn(world, "Alice");

    listener.onMend(mend(alice, world, 7));

    assertThat(levels.awards).containsExactly("Alice:REPAIR:7");
  }

  @Test
  void aSealedWorldEarnsNoExperience() {
    sealed.seal("arena");
    var arena = server.addSimpleWorld("arena");
    var bob = playerIn(arena, "Bob");

    listener.onMend(mend(bob, arena, 7));

    assertThat(levels.awards).isEmpty();
  }

  private PlayerMock playerIn(World world, String name) {
    var player = server.addPlayer(name);
    player.setGameMode(GameMode.SURVIVAL);
    player.teleport(new Location(world, 0.5, 5, 0.5));
    return player;
  }

  private static PlayerItemMendEvent mend(PlayerMock player, World world, int amount) {
    var orb = world.spawn(player.getLocation(), ExperienceOrb.class);
    return new PlayerItemMendEvent(
        player, new ItemStack(Material.IRON_PICKAXE), EquipmentSlot.HAND, orb, amount, amount);
  }

  /** Records awards; every other call answers at once with nothing. */
  private static final class RecordingLevels implements SkillLevels {

    final List<String> awards = new ArrayList<>();

    @Override
    public CompletableFuture<SkillProgress> progress(UUID playerId) {
      return CompletableFuture.completedFuture(new SkillProgress(Map.of()));
    }

    @Override
    public CompletableFuture<List<RankedSkillPlayer>> top(int limit) {
      return CompletableFuture.completedFuture(List.of());
    }

    @Override
    public CompletableFuture<SkillProgress> award(
        UUID playerId, String name, Skill skill, int experience) {
      awards.add(name + ":" + skill + ":" + experience);
      return CompletableFuture.completedFuture(new SkillProgress(Map.of(skill, (long) experience)));
    }

    @Override
    public CompletableFuture<Boolean> markPlaced(BlockPosition position) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> wasPlacedAndForget(BlockPosition position) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> movePlaced(List<BlockMove> moves) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> growPlacedTree(
        List<BlockPosition> starters, List<BlockPosition> generated) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> launchFalling(BlockPosition source, UUID entityId) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> landFalling(UUID entityId, BlockPosition destination) {
      return CompletableFuture.completedFuture(false);
    }

    @Override
    public CompletableFuture<Boolean> forgetFalling(UUID entityId) {
      return CompletableFuture.completedFuture(false);
    }
  }
}
