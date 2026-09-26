package com.shepherdjerred.thestorm.mobs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

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
import org.bukkit.attribute.Attribute;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Zombie;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.event.entity.EntityDeathEvent;
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
        plugin ->
            new MobsModule()
                .enable(
                    new ModuleContext(
                        plugin,
                        plugin.getLifecycleManager(),
                        new PaperScheduler(plugin),
                        database,
                        services,
                        directory,
                        InstantSource.system(),
                        FixedRandom.highest(),
                        plugin.getComponentLogger()));
    MockBukkit.loadWith(
        HarnessPlugin.class,
        new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
    levels = services.require(MobLevels.class);
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
                    .set(MobKeys.ARENA, PersistentDataType.BOOLEAN, true));
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

  @Test
  void playerKillsOfLevelledMobsGiveMoreExperienceAndStackableDrops() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    zombie.setKiller(server.addPlayer());
    var drops =
        new ArrayList<>(
            List.of(new ItemStack(Material.ROTTEN_FLESH, 2), new ItemStack(Material.IRON_SWORD)));
    var death =
        new EntityDeathEvent(
            zombie, DamageSource.builder(DamageType.PLAYER_ATTACK).build(), drops, 10);

    server.getPluginManager().callEvent(death);

    // Level 23 of 50: XP x(1 + 3.0 * 22/49) = 23.5, drops x(1 + 2.0 * 22/49) = 3.8; the highest
    // roll never rounds up.
    assertThat(death.getDroppedExp()).isEqualTo(23);
    assertThat(drops.get(0).getAmount()).isEqualTo(3);
    assertThat(drops.get(1).getAmount()).isEqualTo(1);
  }

  @Test
  void killsWithoutAPlayerPayVanilla() {
    var zombie = world.spawn(at(3000), Zombie.class, SpawnReason.NATURAL);
    var death =
        new EntityDeathEvent(
            zombie, DamageSource.builder(DamageType.LAVA).build(), new ArrayList<>(), 10);

    server.getPluginManager().callEvent(death);

    assertThat(death.getDroppedExp()).isEqualTo(10);
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
            database,
            services,
            directory,
            InstantSource.system(),
            FixedRandom.highest(),
            plugin.getComponentLogger());

    assertThatThrownBy(() -> new MobsModule().enable(context)).hasMessageContaining("wardenn");
  }
}
