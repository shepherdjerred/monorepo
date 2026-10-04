package com.shepherdjerred.thestorm.mobs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.mobs.MobsModule;
import com.shepherdjerred.thestorm.mobs.app.MobLevels;
import com.shepherdjerred.thestorm.mobs.domain.config.MobsConfig;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import com.shepherdjerred.thestorm.mobs.testing.FixedRandom;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Drowned;
import org.bukkit.entity.Player;
import org.bukkit.entity.Slime;
import org.bukkit.entity.Zombie;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityTransformEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The mobs module enabled on MockBukkit with the shipped mobs.yml, the highest roll in every band,
 * and a spawn region covering |x|, |z| <= 16 around the configured anchor.
 */
final class MobsPaperTest {

  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/mobs.yml");

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the module, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  /** A spawn region at |x|, |z| <= 16 in "world"; everything else is wilderness. */
  static final class SpawnRegion implements Protection {

    static boolean inside(Location location) {
      return location.getWorld().getName().equals("world")
          && Math.abs(location.getBlockX()) <= 16
          && Math.abs(location.getBlockZ()) <= 16;
    }

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      return inside(location) ? new Decision.Denied(Component.text("spawn")) : Decision.allowed();
    }

    @Override
    public Decision checkHarm(
        UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
      return Decision.allowed();
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return inside(a) == inside(b);
    }
  }

  @TempDir Path directory;
  ServerMock server;
  WorldMock world;
  StormDatabase database;
  MobLevels levels;
  private @Nullable MobsPaper started;
  final FixedRandom random = FixedRandom.highest();
  int lootRolls;

  /** The mob's loot table, as a test double: one rotten flesh per roll. */
  final ExtraLoot loot =
      (mob, killer) -> {
        lootRolls++;
        return List.of(new ItemStack(Material.ROTTEN_FLESH));
      };

  @BeforeEach
  void start() throws IOException {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    world.setTime(6000);
    Files.writeString(directory.resolve("mobs.yml"), Files.readString(SHIPPED));
    database = StormDatabase.open(directory.resolve("t.db"));
    var services = new Services();
    services.provide(Protection.class, new SpawnRegion());
    enabling =
        plugin -> {
          var context =
              new ModuleContext(
                  plugin,
                  plugin.getLifecycleManager(),
                  new PaperScheduler(plugin),
                  new DirectComputePool(),
                  database,
                  services,
                  directory,
                  InstantSource.system(),
                  random,
                  plugin.getComponentLogger());
          var config = ConfigFiles.load(directory.resolve("mobs.yml"), MobsConfig.class);
          started =
              MobsPaper.start(
                  context,
                  config,
                  () -> services.require(Protection.class),
                  new MobsPaper.Hooks(loot, (mob, name) -> name.run()));
        };
    MockBukkit.loadWith(
        HarnessPlugin.class,
        new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
    levels = present(started).levels();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
    database.close();
  }

  Location at(double x) {
    return new Location(world, x, 5, 0);
  }

  static <T> T present(@Nullable T value) {
    if (value == null) {
      throw new AssertionError("expected a value");
    }
    return value;
  }

  static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  @Test
  void aNaturalZombieFarFromSpawnIsLevelledWithKeyedModifiersAndANameplate() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);

    // Band 2500 rolls its highest, 15; at y 5 depth adds floor(57/5 * 0.05 * 15) = 8.
    assertThat(levels.levelOf(zombie)).hasValue(23);
    var health = present(zombie.getAttribute(Attribute.MAX_HEALTH));
    var modifier = present(health.getModifier(MobKeys.modifier(Stat.MAX_HEALTH)));
    assertThat(modifier.getAmount()).isCloseTo(1.1 * 22 / 49, within(1e-9));
    assertThat(zombie.getHealth()).isEqualTo(health.getValue());
    var name = present(zombie.customName());
    assertThat(plain(name)).startsWith("Lv 23 ");
    assertThat(zombie.isCustomNameVisible()).isFalse();
  }

  @Test
  void naturalMonstersCannotSpawnInTheSpawnRegion() {
    var zombie = world.spawn(at(5), Zombie.class, SpawnReason.NATURAL);

    assertThat(zombie.isValid()).isFalse();
    assertThat(levels.levelOf(zombie)).isEmpty();
  }

  @Test
  void otherSpawnsInTheSpawnRegionStayVanilla() {
    var zombie = world.spawn(at(5), Zombie.class, SpawnReason.SPAWNER_EGG);

    assertThat(zombie.isValid()).isTrue();
    assertThat(levels.levelOf(zombie)).isEmpty();
    assertThat(zombie.customName()).isNull();
  }

  @Test
  void pluginSpawnsPassiveMobsAndArenaMobsStayVanilla() {
    assertThat(levels.levelOf(world.spawn(at(3000), Zombie.class, SpawnReason.CUSTOM))).isEmpty();
    assertThat(levels.levelOf(world.spawn(at(3000), Cow.class, SpawnReason.NATURAL))).isEmpty();
    var arena =
        world.spawn(
            at(3000),
            Zombie.class,
            SpawnReason.NATURAL,
            zombie ->
                zombie
                    .getPersistentDataContainer()
                    .set(
                        new NamespacedKey("thestorm", "arena_entity"),
                        PersistentDataType.BOOLEAN,
                        true));
    assertThat(levels.levelOf(arena)).isEmpty();
  }

  @Test
  void strippingPutsAMobBackToVanilla() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);

    levels.strip(zombie);

    assertThat(levels.levelOf(zombie)).isEmpty();
    Map.of(
            Stat.MAX_HEALTH, Attribute.MAX_HEALTH,
            Stat.ATTACK_DAMAGE, Attribute.ATTACK_DAMAGE,
            Stat.MOVEMENT_SPEED, Attribute.MOVEMENT_SPEED)
        .forEach(
            (stat, attribute) -> {
              var instance = zombie.getAttribute(attribute);
              if (instance != null) {
                assertThat(instance.getModifier(MobKeys.modifier(stat))).isNull();
              }
            });
    assertThat(zombie.getHealth()).isEqualTo(20);
    assertThat(zombie.customName()).isNull();
    levels.strip(zombie);
  }

  @Test
  void aPlayerRenamedMobKeepsItsNameWhenStripped() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    zombie.customName(Component.text("Gerald"));

    levels.strip(zombie);

    var name = present(zombie.customName());
    assertThat(plain(name)).isEqualTo("Gerald");
  }

  /** A level-50 zombie: far out and deep, with the lowest roll so every fraction rounds up. */
  Zombie capped() {
    random.moveTo(0.1);
    var zombie = world.spawn(at(40_000), Zombie.class, SpawnReason.NATURAL);
    assertThat(levels.levelOf(zombie)).hasValue(50);
    return zombie;
  }

  static DamageSource hitBy(Player player) {
    return DamageSource.builder(DamageType.PLAYER_ATTACK)
        .withCausingEntity(player)
        .withDirectEntity(player)
        .build();
  }

  EntityDeathEvent die(Zombie zombie, DamageSource source, List<ItemStack> drops) {
    var death = new EntityDeathEvent(zombie, source, new ArrayList<>(drops), 10);
    server.getPluginManager().callEvent(death);
    return death;
  }

  @Test
  void anEarnedKillPaysMoreExperienceAndExtraLootTableRolls() {
    var zombie = capped();
    var player = server.addPlayer();
    KillLedger.record(zombie, true, 20);

    var death = die(zombie, hitBy(player), List.of(new ItemStack(Material.ROTTEN_FLESH)));

    // At the cap: XP x(1 + 1.0), and ITEM_DROPS 0.5 is one extra roll (the roll draws 0.1).
    assertThat(death.getDroppedExp()).isEqualTo(20);
    assertThat(lootRolls).isEqualTo(1);
    assertThat(death.getDrops())
        .containsExactly(
            new ItemStack(Material.ROTTEN_FLESH), new ItemStack(Material.ROTTEN_FLESH));
  }

  @Test
  void whatAMobPickedUpIsNeverMultiplied() {
    var zombie = capped();
    var diamonds = new ItemStack(Material.DIAMOND, 32);
    zombie.getEquipment().setItemInMainHand(diamonds);
    var player = server.addPlayer();
    KillLedger.record(zombie, true, 20);

    var death = die(zombie, hitBy(player), List.of(diamonds));

    var diamondsDropped =
        death.getDrops().stream()
            .filter(stack -> stack.getType() == Material.DIAMOND)
            .mapToInt(ItemStack::getAmount)
            .sum();
    assertThat(diamondsDropped).isEqualTo(32);
    assertThat(death.getDrops())
        .filteredOn(stack -> stack.getType() != Material.DIAMOND)
        .containsOnly(new ItemStack(Material.ROTTEN_FLESH));
  }

  @Test
  void killsWithoutAPlayersFinalBlowPayVanilla() {
    var zombie = capped();
    KillLedger.record(zombie, true, 20);

    var lava = die(zombie, DamageSource.builder(DamageType.LAVA).build(), List.of());

    assertThat(lava.getDroppedExp()).isEqualTo(10);
    assertThat(lootRolls).isZero();
  }

  @Test
  void killsMostlyDoneByTrapsOrPetsPayVanilla() {
    var zombie = capped();
    var player = server.addPlayer();
    KillLedger.record(zombie, false, 18);
    KillLedger.record(zombie, true, 2);

    var death = die(zombie, hitBy(player), List.of());

    assertThat(death.getDroppedExp()).isEqualTo(10);
    assertThat(lootRolls).isZero();
  }

  @Test
  void theLedgerKeepsPlayerAndOtherDamageApart() {
    var zombie = capped();
    var player = server.addPlayer();

    KillLedger.record(zombie, true, 4);
    KillLedger.record(zombie, true, 1.5);
    KillLedger.record(zombie, false, 3);
    KillLedger.record(zombie, false, 0);

    assertThat(KillLedger.playerDamage(zombie)).isEqualTo(5.5);
    assertThat(KillLedger.otherDamage(zombie)).isEqualTo(3);
    assertThat(KillLedger.playerHit(player)).contains(player);
    assertThat(KillLedger.playerHit(zombie)).isEmpty();
    assertThat(KillLedger.finalBlow(hitBy(player))).contains(player);
    assertThat(KillLedger.finalBlow(DamageSource.builder(DamageType.FALL).build())).isEmpty();
  }

  @Test
  void onlyTheWorldsOwnSpawnsAreLevelled() {
    assertThat(levels.levelOf(world.spawn(at(3000), Zombie.class, SpawnReason.JOCKEY))).isPresent();
    for (var reason :
        List.of(
            SpawnReason.REINFORCEMENTS,
            SpawnReason.SLIME_SPLIT,
            SpawnReason.RAID,
            SpawnReason.NETHER_PORTAL,
            SpawnReason.SPAWNER,
            SpawnReason.DISPENSE_EGG)) {
      assertThat(levels.levelOf(world.spawn(at(3000), Zombie.class, reason))).isEmpty();
    }
  }

  @Test
  void aConvertedMobKeepsItsLevelUnderItsOwnName() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    var drowned = world.spawn(at(3000), Drowned.class, SpawnReason.DROWNED);
    // Conversion copies the zombie's name and data onto the drowned.
    drowned.customName(zombie.customName());
    drowned.getPersistentDataContainer().set(MobKeys.LEVEL, PersistentDataType.INTEGER, 23);

    server
        .getPluginManager()
        .callEvent(
            new EntityTransformEvent(
                zombie, List.of(drowned), EntityTransformEvent.TransformReason.DROWNED));

    assertThat(levels.levelOf(drowned)).hasValue(23);
    assertThat(drowned.customName()).isEqualTo(((LevelApplier) levels).nameplate(drowned, 23));
    assertThat(drowned.customName()).isNotEqualTo(zombie.customName());
  }

  @Test
  void splitSlimesDropTheirInheritedLevel() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    var slime = world.spawn(at(3000), Slime.class, SpawnReason.SLIME_SPLIT);
    slime.customName(zombie.customName());
    slime.getPersistentDataContainer().set(MobKeys.LEVEL, PersistentDataType.INTEGER, 23);

    server
        .getPluginManager()
        .callEvent(
            new EntityTransformEvent(
                zombie, List.of(slime), EntityTransformEvent.TransformReason.SPLIT));

    assertThat(levels.levelOf(slime)).isEmpty();
    assertThat(slime.customName()).isNull();
  }

  @Test
  void levelsSurviveAsModifiersNotBaseValues() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    var health = present(zombie.getAttribute(Attribute.MAX_HEALTH));

    assertThat(health.getBaseValue()).isEqualTo(20);
    assertThat(health.getValue()).isGreaterThan(20);
  }

  @Test
  void unknownNamesInTheConfigStopTheModule() throws IOException {
    MockBukkit.unmock();
    database.close();
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    Files.writeString(
        directory.resolve("mobs.yml"), Files.readString(SHIPPED).replace("[warden,", "[wardenn,"));
    database = StormDatabase.open(directory.resolve("t.db"));
    var services = new Services();
    services.provide(Protection.class, new SpawnRegion());
    var plugin = MockBukkit.createMockPlugin("TheStorm");
    var context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            new PaperScheduler(plugin),
            new DirectComputePool(),
            database,
            services,
            directory,
            InstantSource.system(),
            FixedRandom.highest(),
            plugin.getComponentLogger());

    assertThatThrownBy(() -> new MobsModule().enable(context)).hasMessageContaining("wardenn");
  }
}
