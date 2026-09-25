package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shards.domain.DropRule;
import com.shepherdjerred.thestorm.shards.domain.DropsConfig;
import com.shepherdjerred.thestorm.shards.domain.ShardDrops;
import java.util.List;
import java.util.Map;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Item;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.block.BlockMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class DropListenerTest {

  private final Harness harness = new Harness();
  private final PlacedBlocks placed =
      new PlacedBlocks(new NamespacedKey(harness.plugin, "placed_sources"));
  private final DropListener listener =
      new DropListener(
          new ShardDrops(
              new DropsConfig(
                  List.of(harness.world.getKey().asString()),
                  List.of("SPAWNER"),
                  Map.of("ZOMBIE", new DropRule(1, 1, 1)),
                  Map.of("DIAMOND_ORE", new DropRule(1, 2, 2)))),
          placed,
          harness.kit(0.0));
  private final PlayerMock miner = harness.server.addPlayer();

  DropListenerTest() {
    miner.setGameMode(GameMode.SURVIVAL);
    miner.getInventory().setItemInMainHand(ItemStack.of(Material.DIAMOND_PICKAXE));
  }

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private BlockMock ore(int x) {
    var block = harness.world.getBlockAt(x, 12, 0);
    block.setType(Material.DIAMOND_ORE);
    block.setDrops(List.of(ItemStack.of(Material.DIAMOND)));
    return block;
  }

  private int shardsOnTheGround() {
    return harness.world.getEntities().stream()
        .filter(Item.class::isInstance)
        .map(entity -> ((Item) entity).getItemStack())
        .filter(harness.shards::isShard)
        .mapToInt(ItemStack::getAmount)
        .sum();
  }

  private void mine(Block block) {
    listener.onBreak(new BlockBreakEvent(block, miner));
  }

  private void place(Block block) {
    listener.onPlace(
        new BlockPlaceEvent(
            block,
            block.getState(),
            block.getRelative(BlockFace.DOWN),
            ItemStack.of(block.getType()),
            miner,
            true,
            EquipmentSlot.HAND));
  }

  @Test
  void naturalOreDropsShards() {
    mine(ore(0));

    assertThat(shardsOnTheGround()).isEqualTo(2);
  }

  @Test
  void placedOreDropsNothing() {
    var block = ore(0);
    place(block);

    mine(block);

    assertThat(shardsOnTheGround()).isZero();
  }

  @Test
  void breakingPlacedOreClearsTheMark() {
    var block = ore(0);
    place(block);
    mine(block);

    assertThat(placed.isPlaced(block)).isFalse();
  }

  @Test
  void placingOtherBlocksMarksNothing() {
    var stone = harness.world.getBlockAt(0, 12, 0);
    stone.setType(Material.STONE);

    place(stone);

    assertThat(placed.isPlaced(stone)).isFalse();
  }

  @Test
  void orePushedByAPistonCountsAsPlaced() {
    var block = ore(0);
    var destination = block.getRelative(BlockFace.EAST);

    listener.onPistonExtend(
        new BlockPistonExtendEvent(
            block.getRelative(BlockFace.WEST), List.of(block), BlockFace.EAST));

    assertThat(placed.isPlaced(destination)).isTrue();
    ore(1);
    mine(destination);
    assertThat(shardsOnTheGround()).isZero();
  }

  @Test
  void orePulledByAPistonCountsAsPlaced() {
    var block = ore(5);

    listener.onPistonRetract(
        new BlockPistonRetractEvent(
            block.getRelative(BlockFace.WEST, 2), List.of(block), BlockFace.WEST));

    assertThat(placed.isPlaced(block.getRelative(BlockFace.WEST))).isTrue();
  }

  @Test
  void pistonsMovingOtherBlocksMarkNothing() {
    var stone = harness.world.getBlockAt(0, 12, 0);
    stone.setType(Material.STONE);

    listener.onPistonExtend(
        new BlockPistonExtendEvent(
            stone.getRelative(BlockFace.WEST), List.of(stone), BlockFace.EAST));

    assertThat(placed.isPlaced(stone.getRelative(BlockFace.EAST))).isFalse();
  }

  @Test
  void creativeBreaksDropNothing() {
    miner.setGameMode(GameMode.CREATIVE);

    mine(ore(0));

    assertThat(shardsOnTheGround()).isZero();
  }

  @Test
  void silkTouchDropsNothing() {
    var pickaxe = ItemStack.of(Material.DIAMOND_PICKAXE);
    pickaxe.addUnsafeEnchantment(Enchantment.SILK_TOUCH, 1);
    miner.getInventory().setItemInMainHand(pickaxe);

    mine(ore(0));

    assertThat(shardsOnTheGround()).isZero();
  }

  @Test
  void theWrongToolDropsNothing() {
    var block = ore(0);
    // A wooden pickaxe breaks diamond ore without drops.
    block.setDrops(List.of());
    miner.getInventory().setItemInMainHand(ItemStack.of(Material.WOODEN_PICKAXE));

    mine(block);

    assertThat(shardsOnTheGround()).isZero();
  }

  @Test
  void aBreakWithDropsTurnedOffDropsNothing() {
    var event = new BlockBreakEvent(ore(0), miner);
    event.setDropItems(false);

    listener.onBreak(event);

    assertThat(shardsOnTheGround()).isZero();
  }
}
