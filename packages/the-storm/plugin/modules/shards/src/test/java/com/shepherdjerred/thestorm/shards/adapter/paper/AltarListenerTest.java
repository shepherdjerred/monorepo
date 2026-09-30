package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shards.domain.AltarLocation;
import com.shepherdjerred.thestorm.shards.domain.AltarSky;
import com.shepherdjerred.thestorm.shards.domain.Altars;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import java.time.Duration;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class AltarListenerTest {

  private static final AltarSky RAIN = new AltarSky(true, true, 0.8, 0.4);
  private static final AltarSky CLEAR = new AltarSky(true, false, 0.8, 0.4);

  private final Harness harness = new Harness();
  private final Block altar = harness.world.getBlockAt(10, 64, 10);
  private final PlayerMock player = harness.server.addPlayer();

  AltarListenerTest() {
    altar.setType(Material.EMERALD_BLOCK);
    player.getInventory().setItemInMainHand(ItemStack.of(Material.DIAMOND_SWORD));
    player.getInventory().setItem(8, harness.shards.create(10));
  }

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private AltarListener listener(AltarSky sky, double roll) {
    var location =
        new AltarLocation(harness.world.getKey().asString(), 10, 64, 10, "EMERALD_BLOCK");
    var altars = new Altars(List.of(location), Duration.ofSeconds(1));
    var setup =
        new AltarSetup(
            altars, new Upgrades(harness.config.upgrades()), harness.scheduler, block -> sky);
    return new AltarListener(setup, harness.kit(roll));
  }

  private PlayerInteractEvent click(Action action, Block block, EquipmentSlot hand) {
    return new PlayerInteractEvent(
        player, action, player.getInventory().getItem(hand), block, BlockFace.UP, hand);
  }

  private PlayerInteractEvent clickAltar() {
    return click(Action.RIGHT_CLICK_BLOCK, altar, EquipmentSlot.HAND);
  }

  private int shards() {
    return harness.shards.count(player.getInventory());
  }

  private int tier() {
    return harness
        .gear
        .tierOf(player.getInventory().getItemInMainHand())
        .map(StormTier::level)
        .orElse(0);
  }

  @Test
  void aClickInTheRainUpgradesAndSpendsTheTierCost() {
    var listener = listener(RAIN, 0.99);

    var event = clickAltar();
    listener.onInteract(event);

    assertThat(tier()).isEqualTo(1);
    assertThat(shards()).isEqualTo(9);
    assertThat(event.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(event.useItemInHand()).isEqualTo(Event.Result.DENY);
    // Storm I: one bolt.
    assertThat(harness.scheduler.delays).containsExactly(Duration.ZERO);
  }

  @Test
  void twoInteractsInTheSameTickSpendShardsOnce() {
    var listener = listener(RAIN, 0.99);

    listener.onInteract(clickAltar());
    var second = clickAltar();
    listener.onInteract(second);

    assertThat(tier()).isEqualTo(1);
    assertThat(shards()).isEqualTo(9);
    assertThat(second.useInteractedBlock()).isEqualTo(Event.Result.DENY);
  }

  @Test
  void aHeldRightClickCannotChainTiersWithinTheWindow() {
    var listener = listener(RAIN, 0.99);

    listener.onInteract(clickAltar());
    for (var repeat = 0; repeat < 4; repeat++) {
      harness.clock.advance(Duration.ofMillis(200));
      listener.onInteract(clickAltar());
    }

    assertThat(tier()).isEqualTo(1);
    assertThat(shards()).isEqualTo(9);
  }

  @Test
  void afterTheWindowTheNextClickUpgradesAgain() {
    var listener = listener(RAIN, 0.99);

    listener.onInteract(clickAltar());
    harness.clock.advance(Duration.ofSeconds(1));
    listener.onInteract(clickAltar());

    assertThat(tier()).isEqualTo(2);
    assertThat(shards()).isEqualTo(7);
  }

  @Test
  void clearSkiesSpendNothing() {
    var listener = listener(CLEAR, 0.99);

    var event = clickAltar();
    listener.onInteract(event);

    assertThat(tier()).isZero();
    assertThat(shards()).isEqualTo(10);
    assertThat(event.useInteractedBlock()).isEqualTo(Event.Result.DENY);
  }

  @Test
  void aFailSpendsShardsAndKeepsTheItem() {
    var listener = listener(RAIN, 0.99);
    listener.onInteract(clickAltar());
    harness.clock.advance(Duration.ofSeconds(1));

    // Storm II fails below 0.1.
    listener(RAIN, 0.05).onInteract(clickAltar());

    assertThat(tier()).isEqualTo(1);
    assertThat(shards()).isEqualTo(7);
  }

  @Test
  void anOffHandClickIsCancelledButAttemptsNothing() {
    var listener = listener(RAIN, 0.99);

    var offHand = click(Action.RIGHT_CLICK_BLOCK, altar, EquipmentSlot.OFF_HAND);
    listener.onInteract(offHand);

    assertThat(offHand.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(offHand.useItemInHand()).isEqualTo(Event.Result.DENY);
    assertThat(shards()).isEqualTo(10);
    // The off-hand click did not use up the main hand's attempt.
    listener.onInteract(clickAltar());
    assertThat(tier()).isEqualTo(1);
  }

  @Test
  void airClicksAreIgnored() {
    var listener = listener(RAIN, 0.99);

    var air = click(Action.RIGHT_CLICK_AIR, altar, EquipmentSlot.HAND);
    listener.onInteract(air);

    assertThat(air.useItemInHand()).isNotEqualTo(Event.Result.DENY);
    assertThat(shards()).isEqualTo(10);
  }

  @Test
  void otherBlocksAreIgnored() {
    var listener = listener(RAIN, 0.99);
    var dirt = harness.world.getBlockAt(11, 64, 10);
    dirt.setType(Material.DIRT);

    var event = click(Action.RIGHT_CLICK_BLOCK, dirt, EquipmentSlot.HAND);
    listener.onInteract(event);

    assertThat(event.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(shards()).isEqualTo(10);
  }

  @Test
  void aReplacedAltarBlockIsNoLongerAnAltar() {
    var listener = listener(RAIN, 0.99);
    altar.setType(Material.DIRT);

    var event = clickAltar();
    listener.onInteract(event);

    assertThat(event.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(shards()).isEqualTo(10);
  }
}
