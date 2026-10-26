package com.shepherdjerred.thestorm.mobs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.expansion.FlagProviderUnavailableException;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.ActivityFeed;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.mobs.app.BeginnerTimeStore;
import com.shepherdjerred.thestorm.mobs.domain.config.MobsConfig;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.random.RandomGenerator;
import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Creeper;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Zombie;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityTargetEvent.TargetReason;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class BeginnerLuckListenerTest {
  @TempDir Path directory;
  ServerMock server;
  WorldMock world;
  StormDatabase database;
  LevelApplier levels;
  BeginnerProtection protection;
  BeginnerLuckListener listener;
  AfkTracker afk;
  final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-16T00:00:00Z"));
  final Map<UUID, Boolean> flags = new HashMap<>();
  final Set<UUID> unavailable = new HashSet<>();
  final Map<UUID, Long> saved = new HashMap<>();
  final SealedWorlds sealed = new SealedWorlds();

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    database = StormDatabase.open(directory.resolve("clock.db"));
    var plugin = MockBukkit.createMockPlugin("TheStorm");
    var services = new Services();
    afk = new AfkTracker(now::get, Duration.ofMinutes(5), ProductAnalytics.disabled());
    services.provide(AfkStatus.class, afk);
    services.provide(ActivityFeed.class, afk);
    services.provide(SealedWorlds.class, sealed);
    services.provide(
        ManagedGameplay.class,
        new ManagedGameplay(
            (key, id) ->
                unavailable.contains(id)
                    ? CompletableFuture.failedFuture(
                        new FlagProviderUnavailableException(
                            new java.io.IOException("fixture flag outage")))
                    : CompletableFuture.completedFuture(flags.getOrDefault(id, false)),
            () -> {},
            true,
            now::get));
    var context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            new PaperScheduler(plugin),
            new DirectComputePool(),
            database,
            services,
            directory,
            now::get,
            RandomGenerator.getDefault(),
            plugin.getComponentLogger(),
            ProductAnalytics.disabled());
    var config = ConfigFiles.load(MobsPaperTest.SHIPPED, MobsConfig.class);
    levels =
        new LevelApplier(
            config.scaling(), config.levels().cap(), config.nameplate(), (mob, name) -> name.run());
    BeginnerTimeStore store =
        new BeginnerTimeStore() {
          @Override
          public CompletableFuture<Map<UUID, Long>> load() {
            return CompletableFuture.completedFuture(Map.copyOf(saved));
          }

          @Override
          public CompletableFuture<Void> save(UUID id, long millis) {
            saved.merge(id, millis, Math::max);
            return CompletableFuture.completedFuture(null);
          }
        };
    protection = new BeginnerProtection(context, config.beginnerLuck(), store);
    listener = new BeginnerLuckListener(context, config, levels, protection);
    server
        .getPluginManager()
        .registerEvents(
            new StrengthListener(levels, (mob, killer) -> List.of(), context.random(), sealed),
            plugin);
    server.getPluginManager().registerEvents(listener, plugin);
    protection.start();
  }

  @AfterEach
  void stop() {
    protection.stop();
    MockBukkit.unmock();
    database.close();
  }

  Player player(String name, boolean enabled) {
    var player = server.addPlayer(name);
    flags.put(player.getUniqueId(), enabled);
    afk.joined(player.getUniqueId());
    player.teleport(new Location(world, 3000, 5, 0));
    server.getScheduler().performTicks(10);
    return player;
  }

  @Test
  void cachedNpcProtectionCoversTheRampAndEndsAtTwelveActiveHours() {
    var player = player("Newcomer", true);
    var id = player.getUniqueId();
    assertThat(protection.current(id)).isPresent();
    assertThat(protection.current(id).orElseThrow().protectsFromNpcs()).isTrue();
    now.updateAndGet(time -> time.plus(Duration.ofHours(11)));
    assertThat(protection.current(id).orElseThrow().protectsFromNpcs()).isTrue();
    now.updateAndGet(time -> time.plus(Duration.ofHours(1)));
    assertThat(protection.current(id).orElseThrow().protectsFromNpcs()).isFalse();
    protection.left(player);
    assertThat(protection.current(id)).isEmpty();
  }

  @Test
  void aFailedFlagRefreshKeepsNpcStatusUnknownUntilARealDecisionArrives() {
    var player = player("Newcomer", true);
    var id = player.getUniqueId();
    assertThat(protection.current(id).orElseThrow().protectsFromNpcs()).isTrue();
    unavailable.add(id);
    now.updateAndGet(time -> time.plusSeconds(31));
    var failed = protection.status(id);
    server.getScheduler().performTicks(10);
    assertThat(failed.join().enabled()).isFalse();
    assertThat(protection.current(id)).isEmpty();
    assertThat(protection.active(player)).isEmpty();

    unavailable.remove(id);
    flags.put(id, false);
    now.updateAndGet(time -> time.plusSeconds(31));
    var disabled = protection.status(id);
    server.getScheduler().performTicks(10);
    assertThat(disabled.join().enabled()).isFalse();
    assertThat(protection.current(id).orElseThrow().protectsFromNpcs()).isFalse();
  }

  @Test
  void anInitialFlagOutageDoesNotPublishADisabledNpcStatus() {
    var player = server.addPlayer("Newcomer");
    unavailable.add(player.getUniqueId());
    afk.joined(player.getUniqueId());
    server.getScheduler().performTicks(10);
    assertThat(protection.current(player.getUniqueId())).isEmpty();
    assertThat(protection.active(player)).isEmpty();
  }

  Zombie mob() {
    var mob = world.spawn(new Location(world, 3001, 5, 0), Zombie.class);
    levels.apply(mob, 50);
    return mob;
  }

  EntityDamageByEntityEvent hit(LivingEntity mob, Player player, double damage) {
    var source =
        DamageSource.builder(DamageType.MOB_ATTACK)
            .withCausingEntity(mob)
            .withDirectEntity(mob)
            .build();
    player.setNoDamageTicks(0);
    player.setHealth(20);
    var event =
        ((org.mockbukkit.mockbukkit.entity.LivingEntityMock) player).simulateDamage(damage, source);
    assertThat(event).isInstanceOf(EntityDamageByEntityEvent.class);
    return (EntityDamageByEntityEvent) event;
  }

  @Test
  void existingMobsBecomeRealLevelOneWithoutCancellingAggressionOrHealing() {
    var player = player("beginner", true);
    var mob = mob();
    mob.setHealth(7);
    var target = new EntityTargetLivingEntityEvent(mob, player, TargetReason.CLOSEST_PLAYER);
    server.getPluginManager().callEvent(target);
    assertThat(target.isCancelled()).isFalse();
    assertThat(levels.levelOf(mob)).hasValue(1);
    assertThat(levels.naturalLevel(mob)).isEqualTo(50);
    assertThat(mob.customName()).isEqualTo(levels.nameplate(mob, 1));
    assertThat(mob.getHealth()).isEqualTo(7);
    assertThat(hit(mob, player, 10).getDamage()).isCloseTo(1, within(0.000001));
  }

  @Test
  void aFourthOrdinaryMobDoesNotJoinTheFight() {
    var player = player("beginner", true);
    for (var i = 0; i < 3; i++) {
      var engaged = mob();
      engaged.setTarget(player);
      var joined = new EntityTargetLivingEntityEvent(engaged, player, TargetReason.CLOSEST_PLAYER);
      server.getPluginManager().callEvent(joined);
      assertThat(joined.isCancelled()).isFalse();
    }
    var fourth = mob();
    var refused = new EntityTargetLivingEntityEvent(fourth, player, TargetReason.CLOSEST_PLAYER);
    server.getPluginManager().callEvent(refused);
    assertThat(refused.isCancelled()).isTrue();
  }

  @Test
  void firstHitCorrectsOldMeleeAttributesAndVeteransShareTheReducedLevel() {
    var beginner = player("beginner", true);
    var veteran = player("veteran", false);
    var mob = mob();
    assertThat(hit(mob, beginner, 21).getDamage()).isCloseTo(1, within(0.000001));
    assertThat(levels.levelOf(mob)).hasValue(1);
    assertThat(hit(mob, veteran, 10).getDamage()).isEqualTo(10);
    assertThat(levels.levelOf(mob)).hasValue(1);
  }

  @Test
  void rampRestoresLevelsAndDamageButNeverHealthOrRewards() {
    var player = player("beginner", true);
    var mob = mob();
    listener.reconcile(mob);
    mob.setHealth(7);
    now.set(now.get().plus(Duration.ofHours(9)));
    listener.reconcile(mob);
    assertThat(levels.levelOf(mob)).hasValue(25);
    assertThat(hit(mob, player, 10).getDamage()).isCloseTo(5.5, within(0.000001));
    now.set(now.get().plus(Duration.ofHours(3)));
    listener.reconcile(mob);
    assertThat(levels.levelOf(mob)).hasValue(50);
    assertThat(hit(mob, player, 10).getDamage()).isEqualTo(10);
    assertThat(mob.getHealth()).isEqualTo(7);
    assertThat(levels.rewardBonus(mob, Stat.XP)).isZero();
    assertThat(levels.rewardBonus(mob, Stat.ITEM_DROPS)).isZero();
  }

  @Test
  void projectilesAndCreeperBlastsReceiveProtection() {
    var player = player("beginner", true);
    var mob = mob();
    var arrow = world.spawn(new Location(world, 3001, 5, 0), Arrow.class);
    arrow.setShooter(mob);
    var source =
        DamageSource.builder(DamageType.ARROW)
            .withCausingEntity(mob)
            .withDirectEntity(arrow)
            .build();
    var hit =
        ((org.mockbukkit.mockbukkit.entity.LivingEntityMock) player).simulateDamage(10, source);
    assertThat(hit.getDamage()).isCloseTo(1, within(0.000001));
    var creeper = world.spawn(new Location(world, 3001, 5, 0), Creeper.class);
    levels.apply(creeper, 50);
    var blast =
        DamageSource.builder(DamageType.EXPLOSION)
            .withCausingEntity(creeper)
            .withDirectEntity(creeper)
            .build();
    player.setNoDamageTicks(0);
    var explosion =
        ((org.mockbukkit.mockbukkit.entity.LivingEntityMock) player).simulateDamage(10, blast);
    assertThat(explosion.getDamage()).isCloseTo(1, within(0.000001));
  }

  @Test
  void disablingAndReenablingPreservesProgressAndRestoresMobs() {
    var player = player("beginner", true);
    var mob = mob();
    listener.reconcile(mob);
    now.set(now.get().plus(Duration.ofHours(2)));
    flags.put(player.getUniqueId(), false);
    listener.reconcile(mob);
    server.getScheduler().performTicks(10);
    listener.reconcile(mob);
    assertThat(levels.levelOf(mob)).hasValue(50);
    now.set(now.get().plus(Duration.ofDays(1)));
    flags.put(player.getUniqueId(), true);
    listener.reconcile(mob);
    server.getScheduler().performTicks(10);
    var status = protection.status(player.getUniqueId());
    server.getScheduler().performTicks(10);
    assertThat(status.join().active()).isEqualTo(Duration.ofHours(2));
  }

  @Test
  void endingProtectionRestoresLoadedMobsWithoutHealingOrReplacingCustomNames() {
    player("beginner", true);
    var mob = mob();
    listener.refreshLoaded();
    assertThat(levels.levelOf(mob)).hasValue(1);
    var custom = net.kyori.adventure.text.Component.text("Bob");
    mob.customName(custom);
    mob.setHealth(7);
    protection.stop();
    listener.refreshLoaded();
    assertThat(levels.levelOf(mob)).hasValue(50);
    assertThat(mob.getHealth()).isEqualTo(7);
    assertThat(mob.customName()).isEqualTo(custom);
    assertThat(levels.rewardBonus(mob, Stat.XP)).isZero();
  }

  @Test
  void pvpEnvironmentalDamageAndArenaCombatKeepTheirRules() {
    var beginner = player("beginner", true);
    var veteran = player("veteran", false);
    var pvp =
        DamageSource.builder(DamageType.PLAYER_ATTACK)
            .withCausingEntity(veteran)
            .withDirectEntity(veteran)
            .build();
    var body = (org.mockbukkit.mockbukkit.entity.LivingEntityMock) beginner;
    assertThat(body.simulateDamage(10, pvp).getDamage()).isEqualTo(10);
    beginner.setNoDamageTicks(0);
    assertThat(body.simulateDamage(10, DamageSource.builder(DamageType.FALL).build()).getDamage())
        .isEqualTo(10);
    var mob = mob();
    mob.getPersistentDataContainer()
        .set(MobKeys.ARENA_ENTITY, org.bukkit.persistence.PersistentDataType.BYTE, (byte) 1);
    assertThat(hit(mob, beginner, 10).getDamage()).isEqualTo(10);
    assertThat(levels.levelOf(mob)).hasValue(50);
    mob.getPersistentDataContainer().remove(MobKeys.ARENA_ENTITY);
    sealed.seal(world);
    assertThat(hit(mob, beginner, 10).getDamage()).isEqualTo(10);
    assertThat(levels.levelOf(mob)).hasValue(50);
  }
}
