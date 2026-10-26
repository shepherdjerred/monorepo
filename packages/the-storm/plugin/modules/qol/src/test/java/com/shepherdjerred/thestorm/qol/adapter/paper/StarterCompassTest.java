package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
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
  private SealedWorlds sealed;
  private final ArenaPresence presence = mock(ArenaPresence.class);
  private final ArrayList<Runnable> scheduled = new ArrayList<>();

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    player = server.addPlayer();
    var context = mock(ModuleContext.class);
    var scheduler = mock(Scheduler.class);
    when(context.scheduler()).thenReturn(scheduler);
    when(scheduler.mainThread()).thenReturn(Runnable::run);
    doAnswer(
            invocation -> {
              scheduled.add(invocation.getArgument(0, Runnable.class));
              return null;
            })
        .when(scheduler)
        .runOnMainThread(any(Runnable.class));
    when(context.logger()).thenReturn(ComponentLogger.logger("starter-compass-test"));
    var services = new Services();
    services.provide(ArenaPresence.class, presence);
    when(context.services()).thenReturn(services);
    sealed = new SealedWorlds();
    compass = new StarterCompass(context, store, sealed);
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
    compass.loaded(player, 8);
    assertThat(player.getInventory().getItem(0)).isEqualTo(sword);
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    player.getInventory().setItem(1, StarterCompass.item(player, 8));
    compass.left(player);
    compass.loaded(player, 8);
    assertThat(Arrays.stream(player.getInventory().getContents()).filter(StarterCompass::marked))
        .hasSize(1);
    assertThat(player.getInventory().getItem(0)).isEqualTo(sword);
  }

  @Test
  void aFullInventoryNeverLosesAnItemAndReconcilesWhenSpaceIsFreed() {
    for (var slot = 0; slot < 36; slot++) {
      player.getInventory().setItem(slot, new ItemStack(Material.DIAMOND, 64));
    }
    compass.loaded(player, 8);
    assertThat(player.getInventory().getItem(8)).isEqualTo(new ItemStack(Material.DIAMOND, 64));
    player.getInventory().setItem(20, null);
    compass.reconcile(player);
    assertThat(player.getInventory().getItem(20)).isEqualTo(new ItemStack(Material.DIAMOND, 64));
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
  }

  @Test
  void onlyDurableSuccessfulArrivalRemovesTheCompass() {
    var persisted = new CompletableFuture<Integer>();
    when(store.spendStarterCharge(player.getUniqueId())).thenReturn(persisted);
    compass.loaded(player, 1);
    compass.arrived(player);
    assertThat(compass.pending(player)).isTrue();
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    persisted.complete(0);
    assertThat(compass.pending(player)).isFalse();
    assertThat(player.getInventory().getItem(8)).isNull();
    compass.loaded(player, 0);
    assertThat(player.getInventory().getItem(8)).isNull();
  }

  @Test
  void failedPersistenceKeepsTheCompassAndAllowsARetry() {
    when(store.spendStarterCharge(player.getUniqueId()))
        .thenReturn(
            CompletableFuture.failedFuture(new IllegalStateException("fixture write failure")))
        .thenReturn(CompletableFuture.completedFuture(0));
    compass.loaded(player, 1);
    compass.arrived(player);
    assertThat(compass.pending(player)).isTrue();
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
    compass.arrived(player);
    assertThat(compass.pending(player)).isFalse();
  }

  @Test
  void leftAndRightClickOpenThePickerAndCancelOrdinaryUse() {
    compass.loaded(player, 8);
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
    compass.loaded(player, 8);
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
                .dropItem(player.getLocation(), StarterCompass.item(player, 8)));
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
    compass.loaded(player, 8);
    var drops = new ArrayList<ItemStack>();
    var kept = new ArrayList<ItemStack>();
    drops.add(StarterCompass.item(player, 8));
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
    when(click.getCurrentItem()).thenReturn(StarterCompass.item(player, 8));
    listener.click(click);
    verify(click).setCancelled(true);
  }

  @Test
  void lateProfileAndMenuReconciliationPreserveTheArenaBodyAndResumeAfterLeaving() {
    var ordinaryWorld = player.getWorld();
    var arena = server.addSimpleWorld("settlement");
    when(presence.arenaOf(player.getUniqueId())).thenReturn(Optional.of("settlement"));
    player.teleport(arena.getSpawnLocation());
    var ability = new ItemStack(Material.COMPASS);
    ability.editMeta(
        meta -> meta.displayName(net.kyori.adventure.text.Component.text("Arena ability")));
    player.getInventory().setItem(8, ability);
    player.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
    var before = player.getInventory().getContents();
    compass.loaded(player, 8);
    compass.reconcile(player);
    assertThat(player.getInventory().getContents()).containsExactly(before);
    assertThat(compass.pending(player)).isFalse();
    var click = mock(InventoryClickEvent.class);
    when(click.getWhoClicked()).thenReturn(player);
    when(click.getCurrentItem()).thenReturn(ability);
    when(click.getHotbarButton()).thenReturn(8);
    listener.click(click);
    verify(click, never()).setCancelled(true);
    // The arena restores the ordinary body before its deferred world-change reconciliation.
    player.getInventory().clear();
    player.getInventory().setItem(8, new ItemStack(Material.IRON_SWORD));
    when(presence.arenaOf(player.getUniqueId())).thenReturn(Optional.empty());
    player.teleport(ordinaryWorld.getSpawnLocation());
    listener.world(new PlayerChangedWorldEvent(player, arena));
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isFalse();
    assertThat(scheduled).hasSize(1);
    scheduled.removeFirst().run();
    assertThat(compass.pending(player)).isTrue();
    assertThat(player.getInventory().getItem(0)).isEqualTo(new ItemStack(Material.IRON_SWORD));
    assertThat(StarterCompass.marked(player.getInventory().getItem(8))).isTrue();
  }

  @Test
  void sealedWorldInteractionsAndDeathLeaveEveryInventoryAndDropToItsOwner() {
    compass.loaded(player, 8);
    var creative = server.addSimpleWorld("creative");
    sealed.seal(creative);
    player.teleport(creative.getSpawnLocation());
    var original = player.getInventory().getContents();
    var event =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_AIR,
            StarterCompass.item(player, 8),
            null,
            BlockFace.SELF,
            EquipmentSlot.HAND);
    listener.use(event);
    verify(dialog, never()).show(player);
    var drops = new ArrayList<ItemStack>();
    drops.add(StarterCompass.item(player, 8));
    drops.add(new ItemStack(Material.DIAMOND));
    var death = mock(PlayerDeathEvent.class);
    when(death.getEntity()).thenReturn(player);
    when(death.getDrops()).thenReturn(drops);
    listener.death(death);
    assertThat(drops).hasSize(2);
    assertThat(player.getInventory().getContents()).containsExactly(original);
    verify(death, never()).getItemsToKeep();
  }
}
