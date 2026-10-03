package com.shepherdjerred.thestorm.npcs.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.npcs.adapter.content.ContentLoader;
import com.shepherdjerred.thestorm.npcs.app.NpcStateStore;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Tests chase and startup policy without invoking MockBukkit's missing pathfinding APIs. */
final class NpcCombatTest {
  private final NpcWorld npcs = mock(NpcWorld.class);
  private final World world = mock(World.class);
  private final Server server = mock(Server.class);
  private final NpcStateStore store = mock(NpcStateStore.class);
  private final AtomicLong clock = new AtomicLong(100);
  private final CompletableFuture<NpcLedger.Snapshot> loaded = new CompletableFuture<>();
  private final Mannequin guard = mock(Mannequin.class);
  private final Mannequin victim = mock(Mannequin.class);
  private final Player attacker = mock(Player.class);
  private final UUID attackerId = UUID.randomUUID();
  private NpcDefinition guardDefinition;
  private NpcDefinition civilian;
  private NpcCombat combat;

  @BeforeEach
  void wire() {
    var config = ConfigFiles.load(NpcsTestPlugin.SHIPPED_CONFIG, NpcsConfig.class);
    var content =
        ContentLoader.load(
                requireNonNull(NpcsTestPlugin.SHIPPED_CONFIG.getParent()),
                new ContentRules(
                    Set.of("minecraft:overworld"),
                    Set.of("shopkeeper", "mechanic", "engineer", "spellcaster", "governor")))
            .fold(
                value -> value,
                problems -> {
                  throw new AssertionError(problems);
                });
    guardDefinition = content.npc("guard-captain").orElseThrow();
    civilian = content.npc("stan").orElseThrow();
    var context = mock(ModuleContext.class);
    var plugin = mock(JavaPlugin.class);
    var scheduler = mock(Scheduler.class);
    when(context.plugin()).thenReturn(plugin);
    when(plugin.getServer()).thenReturn(server);
    when(context.scheduler()).thenReturn(scheduler);
    when(scheduler.mainThread()).thenReturn(Runnable::run);
    when(context.logger()).thenReturn(ComponentLogger.logger("npc-combat-test"));
    when(context.random()).thenReturn(new SplittableRandom(8));
    when(world.getKey()).thenReturn(NamespacedKey.minecraft("overworld"));
    when(world.getFullTime()).thenAnswer(_ -> clock.get());
    when(world.getNearbyEntities(any(Location.class), anyDouble(), anyDouble(), anyDouble()))
        .thenReturn(List.of(attacker));
    when(server.getWorlds()).thenReturn(List.of(world));
    when(store.load()).thenReturn(loaded);
    when(store.save(any())).thenReturn(CompletableFuture.completedFuture(null));
    when(npcs.npcOf(any())).thenReturn(Optional.empty());
    when(npcs.definitions()).thenReturn(List.of(guardDefinition));
    when(npcs.entity(guardDefinition.id())).thenReturn(Optional.of(guard));
    when(npcs.reconcile()).thenReturn(new NpcWorld.Report(0, 0, 0, 0));
    when(guard.isValid()).thenReturn(true);
    when(guard.getWorld()).thenReturn(world);
    when(guard.getLocation()).thenReturn(new Location(world, 1, 64, 0));
    when(guard.hasLineOfSight(any(org.bukkit.entity.Entity.class))).thenReturn(true);
    when(victim.getWorld()).thenReturn(world);
    when(victim.getLocation()).thenReturn(new Location(world, 0, 64, 0));
    when(attacker.getUniqueId()).thenReturn(attackerId);
    when(attacker.getGameMode()).thenReturn(GameMode.SURVIVAL);
    when(attacker.getWorld()).thenReturn(world);
    when(attacker.getLocation()).thenReturn(new Location(world, 2, 64, 0));
    when(attacker.isValid()).thenReturn(true);
    when(server.getEntity(attackerId)).thenReturn(attacker);
    combat = new NpcCombat(npcs, config, context, store);
    combat.initialize();
  }

  @Test
  void startupDoesNotReconcileUntilDeathsAreHydrated() {
    assertThat(combat.ready()).isFalse();
    verify(npcs, never()).reconcile();
    loaded.complete(
        new NpcLedger.Snapshot(
            List.of(),
            List.of(),
            List.of(new NpcLedger.Death("minecraft:overworld", "stan", 24000))));
    assertThat(combat.awaitingDawn("stan")).isTrue();
    verify(npcs).reconcile();
  }

  @Test
  void aFailedStartupReadStopsTheServerInsteadOfSpawningFromEmptyState() {
    loaded.completeExceptionally(new IllegalStateException("fixture read failure"));
    verify(server).shutdown();
    verify(npcs, never()).reconcile();
    assertThat(combat.ready()).isFalse();
  }

  @Test
  void warningsDoNotAssignGuardsButTheThirdHitDoesAndDawnStopsIt() {
    loaded.complete(NpcLedger.Snapshot.empty());
    combat.hit(civilian, victim, attacker, false);
    combat.hit(civilian, victim, attacker, false);
    verify(npcs, never()).interrupt(guardDefinition.id());
    assertThat(combat.threat(guardDefinition, guard)).isEmpty();
    combat.hit(civilian, victim, attacker, false);
    verify(npcs).interrupt(guardDefinition.id());
    assertThat(combat.threat(guardDefinition, guard)).contains(attacker);
    clock.set(24000);
    assertThat(combat.threat(guardDefinition, guard)).isEmpty();
  }

  @Test
  void aLethalProjectileStillRecordsItsOwnerAfterDisconnect() {
    loaded.complete(NpcLedger.Snapshot.empty());
    when(attacker.isValid()).thenReturn(false);
    combat.hit(civilian, victim, attacker, true);
    var saved = ArgumentCaptor.forClass(NpcLedger.Snapshot.class);
    verify(store).save(saved.capture());
    assertThat(saved.getValue().wanted())
        .singleElement()
        .extracting(NpcLedger.Wanted::player)
        .isEqualTo(attackerId);
    verify(npcs, never()).interrupt(guardDefinition.id());
  }

  @Test
  void escapingDoesNotRestartTheSameChaseAtANewOrigin() {
    loaded.complete(NpcLedger.Snapshot.empty());
    combat.hit(civilian, victim, attacker, true);
    when(guard.getLocation()).thenReturn(new Location(world, 64, 64, 0));
    when(attacker.getLocation()).thenReturn(new Location(world, 65, 64, 0));
    assertThat(combat.threat(guardDefinition, guard)).isEmpty();
    assertThat(combat.threat(guardDefinition, guard)).isEmpty();
    // Once the guard returns home and the offender leaves, a later return is recognized.
    when(guard.getLocation()).thenReturn(new Location(world, 1, 64, 0));
    combat.threat(guardDefinition, guard);
    when(attacker.getLocation()).thenReturn(new Location(world, 2, 64, 0));
    for (var tick = 0; tick < 20; tick++) {
      combat.tick();
    }
    assertThat(combat.threat(guardDefinition, guard)).contains(attacker);
  }

  @Test
  void invalidAttackersAndFailedPersistenceDoNotLeaveAStalePursuit() {
    loaded.complete(NpcLedger.Snapshot.empty());
    combat.hit(civilian, victim, attacker, true);
    when(attacker.isValid()).thenReturn(false);
    assertThat(combat.threat(guardDefinition, guard)).isEmpty();
    when(attacker.isValid()).thenReturn(true);
    when(store.save(any()))
        .thenReturn(
            CompletableFuture.failedFuture(new IllegalStateException("fixture storage failure")));
    combat.hit(civilian, victim, attacker, false);
    verify(server).shutdown();
    assertThat(combat.ready()).isFalse();
  }
}
