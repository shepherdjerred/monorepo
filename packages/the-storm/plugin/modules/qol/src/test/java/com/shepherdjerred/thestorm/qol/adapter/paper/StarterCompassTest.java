package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class StarterCompassTest {
  private ServerMock server;
  private PlayerMock player;
  private StarterCompass compass;
  private final QolStore store = mock(QolStore.class);
  private final ArrivalDialog dialog = mock(ArrivalDialog.class);
  private StarterCompassListener listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    player = server.addPlayer();
    var context = mock(ModuleContext.class);
    var scheduler = mock(Scheduler.class);
    when(context.scheduler()).thenReturn(scheduler);
    when(scheduler.mainThread()).thenReturn(Runnable::run);
    when(context.logger()).thenReturn(ComponentLogger.logger("starter-compass-test"));
    compass = new StarterCompass(context, store);
    listener = new StarterCompassListener(compass, dialog);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void reconnectReplacesAMissingCompassWithoutReplacingOrdinaryItems() {
    var sword = new ItemStack(Material.DIAMOND_SWORD);
    player.getInventory().setItem(8, sword);
    compass.loaded(player, true);
    assertThat(player.getInventory().getItem(0)).isEqualTo(sword);
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    player.getInventory().setItem(1, StarterCompass.item(player));
    compass.left(player);
    compass.loaded(player, true);
    assertThat(Arrays.stream(player.getInventory().getContents()).filter(StarterCompass::marked))
        .hasSize(1);
    assertThat(player.getInventory().getItem(0)).isEqualTo(sword);
  }

  @Test
  void aFullInventoryNeverLosesAnItemAndReconcilesWhenSpaceIsFreed() {
    for (var slot = 0; slot < 36; slot++) {
      player.getInventory().setItem(slot, new ItemStack(Material.DIAMOND, 64));
    }
    compass.loaded(player, true);
    assertThat(player.getInventory().getItem(8)).isEqualTo(new ItemStack(Material.DIAMOND, 64));
    player.getInventory().setItem(20, null);
    compass.reconcile(player);
    assertThat(player.getInventory().getItem(20)).isEqualTo(new ItemStack(Material.DIAMOND, 64));
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
  }

  @Test
  void onlyDurableSuccessfulArrivalRemovesTheCompass() {
    var persisted = new CompletableFuture<Void>();
    when(store.completeStarterRtp(player.getUniqueId())).thenReturn(persisted);
    compass.loaded(player, true);
    compass.arrived(player);
    assertThat(compass.pending(player)).isTrue();
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    persisted.complete(null);
    assertThat(compass.pending(player)).isFalse();
    assertThat(player.getInventory().getItem(8)).isNull();
    compass.loaded(player, false);
    assertThat(player.getInventory().getItem(8)).isNull();
  }

  @Test
  void failedPersistenceKeepsTheCompassAndAllowsARetry() {
    when(store.completeStarterRtp(player.getUniqueId()))
        .thenReturn(
            CompletableFuture.failedFuture(new IllegalStateException("fixture write failure")))
        .thenReturn(CompletableFuture.completedFuture(null));
    compass.loaded(player, true);
    compass.arrived(player);
    assertThat(compass.pending(player)).isTrue();
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    compass.arrived(player);
    assertThat(compass.pending(player)).isFalse();
  }

  @Test
  void leftAndRightClickOpenThePickerAndCancelOrdinaryUse() {
    compass.loaded(player, true);
    for (var action : new Action[] {Action.LEFT_CLICK_AIR, Action.RIGHT_CLICK_AIR}) {
      var event =
          new PlayerInteractEvent(
              player,
              action,
              player.getInventory().getItem(8),
              null,
              BlockFace.SELF,
              EquipmentSlot.HAND);
      listener.use(event);
      assertThat(event.useItemInHand()).isEqualTo(org.bukkit.event.Event.Result.DENY);
    }
    verify(dialog, org.mockito.Mockito.times(2)).show(player);
  }

  @Test
  void compassClickOnACitizenOpensThePickerInsteadOfDialogueAndCannotBeDropped() {
    compass.loaded(player, true);
    player.getInventory().setHeldItemSlot(8);
    var click = new NpcInteractEvent(player, mock(NpcRef.class));
    listener.npc(click);
    assertThat(click.isCancelled()).isTrue();
    verify(dialog).show(player);
    var drop =
        new PlayerDropItemEvent(
            player,
            server
                .getWorlds()
                .getFirst()
                .dropItem(player.getLocation(), StarterCompass.item(player)));
    listener.drop(drop);
    assertThat(drop.isCancelled()).isTrue();
  }

  @Test
  void biomeNamesUseTitleCase() {
    assertThat(ArrivalDialog.label("dark_forest")).isEqualTo("Dark Forest");
    assertThat(ArrivalDialog.label("snowy_plains")).isEqualTo("Snowy Plains");
    assertThat(ArrivalDialog.label("jungle")).isEqualTo("Jungle");
  }

  @Test
  void deathKeepsTheCompassOutOfGraveDropsAndInventoryTransferIsCancelled() {
    compass.loaded(player, true);
    var drops = new ArrayList<ItemStack>();
    var kept = new ArrayList<ItemStack>();
    drops.add(StarterCompass.item(player));
    drops.add(new ItemStack(Material.IRON_PICKAXE));
    var death = mock(PlayerDeathEvent.class);
    when(death.getEntity()).thenReturn(player);
    when(death.getDrops()).thenReturn(drops);
    when(death.getItemsToKeep()).thenReturn(kept);
    listener.death(death);
    assertThat(drops).containsExactly(new ItemStack(Material.IRON_PICKAXE));
    assertThat(kept).singleElement().matches(StarterCompass::marked);
    var click = mock(InventoryClickEvent.class);
    when(click.getWhoClicked()).thenReturn(player);
    when(click.getCurrentItem()).thenReturn(StarterCompass.item(player));
    listener.click(click);
    verify(click).setCancelled(true);
  }
}
