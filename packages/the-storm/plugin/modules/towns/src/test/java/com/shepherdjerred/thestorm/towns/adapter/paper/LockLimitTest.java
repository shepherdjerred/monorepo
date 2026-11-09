package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * A player at the lock limit keeps building: what they place past it stays unlocked instead of
 * being refused or broken back into an item. The limit is lowered to one, and Carol already holds
 * that one lock, on a chest in the wilderness.
 */
final class LockLimitTest extends AegisServer {

  private static final UUID CAROL = UUID.fromString("00000000-0000-4000-8000-0000000000c1");
  private static final int CHEST_X = 150;

  private PlayerMock carol;

  @Override
  TownsTestPlugin load() {
    TownsTestPlugin.lockLimit = 1;
    var database = StormDatabase.open(directory.resolve("t.db"));
    try {
      database.migrate("towns", LockLimitTest.class.getClassLoader());
      new JooqLocksStore(database)
          .save(Lock.of(UUID.randomUUID(), CAROL, Set.of(new BlockPos("world", CHEST_X, Y, Z))))
          .get(10, TimeUnit.SECONDS);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    } finally {
      database.close();
    }
    return super.load();
  }

  @BeforeEach
  void placeChest() {
    carol = new PlayerMock(server, "Carol", CAROL);
    server.addPlayer(carol);
    block(CHEST_X, Y, Z).setType(Material.CHEST);
  }

  @Test
  void containersPlacedPastTheLimitStayUnlocked() throws InterruptedException {
    var barrel = block(CHEST_X - 4, Y, Z);

    assertThat(placed(carol, barrel, Material.BARREL)).isTrue();
    awaitLine(carol, "placed unlocked");
    assertThat(barrel.getType()).isEqualTo(Material.BARREL);
    assertThat(rightClick(bob, barrel)).isNotEqualTo(Event.Result.DENY);
    assertThat(rightClick(bob, block(CHEST_X, Y, Z))).isEqualTo(Event.Result.DENY);
  }

  @Test
  void aDoublePartnerOfALockedChestStillJoinsItsLock() {
    var partner = block(CHEST_X + 1, Y, Z);

    assertThat(placed(carol, partner, Material.CHEST)).isTrue();
    assertThat(partner.getType()).isEqualTo(Material.CHEST);
  }

  private boolean placed(PlayerMock player, Block block, Material type) {
    block.setType(type);
    var event =
        new BlockPlaceEvent(
            block,
            block.getState(),
            block.getRelative(BlockFace.DOWN),
            new ItemStack(type),
            player,
            true,
            EquipmentSlot.HAND);
    return !call(event).isCancelled();
  }

  private Event.Result rightClick(PlayerMock player, Block block) {
    return call(new PlayerInteractEvent(
            player, Action.RIGHT_CLICK_BLOCK, null, block, BlockFace.UP, EquipmentSlot.HAND))
        .useInteractedBlock();
  }
}
