package com.shepherdjerred.thestorm.arena.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.kit.Slot;
import com.shepherdjerred.thestorm.arena.domain.wave.Behavior;
import com.shepherdjerred.thestorm.arena.domain.wave.MobArchetype;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnGroup;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveEntry;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveFile;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveScaling;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Zombie;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** Arena mobs get their archetype's attributes, equipment and tag (MockBukkit). */
final class MobFactoryTest {

  private static final MobArchetype KNIGHT =
      new MobArchetype(
          "ZOMBIE",
          1.5,
          2,
          1.2,
          2,
          Optional.of("Grave Knight"),
          Map.of(Slot.HEAD, "IRON_HELMET", Slot.MAIN_HAND, "IRON_SWORD"),
          Optional.empty(),
          Behavior.CHASE,
          0);

  private @Nullable World world;

  @BeforeEach
  void mock() {
    ServerMock server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
  }

  @AfterEach
  void unmock() {
    MockBukkit.unmock();
  }

  private static WaveTable table(Map<String, MobArchetype> mobs) {
    var file =
        new WaveFile(
            1,
            mobs,
            Map.of(),
            List.of(
                new WaveEntry(
                    1,
                    1,
                    WaveKind.STANDARD,
                    List.of(new SpawnGroup("knight", 1, 0)),
                    Optional.empty())));
    return WaveTable.of(file)
        .fold(
            table -> table,
            problems -> {
              throw new AssertionError(problems);
            });
  }

  private Zombie zombie() {
    var at = requireNonNull(world);
    return at.spawn(new Location(at, 0.5, 5, 0.5), Zombie.class);
  }

  @Test
  void aMobIsScaledEquippedNamedAndTagged() {
    Plugin plugin = MockBukkit.createMockPlugin();
    var keys = new Keys(plugin);
    var factory = MobFactory.create(keys, table(Map.of("knight", KNIGHT)));
    var zombie = zombie();
    var baseHealth = requireNonNull(zombie.getAttribute(Attribute.MAX_HEALTH)).getBaseValue();
    var baseSpeed = requireNonNull(zombie.getAttribute(Attribute.MOVEMENT_SPEED)).getBaseValue();

    factory.configure(zombie, KNIGHT, MobFactory.Tuning.relative(1.5, 2), "colosseum");

    assertThat(requireNonNull(zombie.getAttribute(Attribute.MAX_HEALTH)).getBaseValue())
        .isEqualTo(baseHealth * 1.5);
    assertThat(zombie.getHealth()).isEqualTo(baseHealth * 1.5);
    // MockBukkit's zombie has no attack damage attribute; damage is an E2E case.
    assertThat(requireNonNull(zombie.getAttribute(Attribute.MOVEMENT_SPEED)).getBaseValue())
        .isEqualTo(baseSpeed * 1.2);
    // Nor a scale attribute; the colossus's size is an E2E case.
    var equipment = zombie.getEquipment();
    assertThat(equipment.getItem(EquipmentSlot.HEAD).getType()).isEqualTo(Material.IRON_HELMET);
    assertThat(equipment.getItem(EquipmentSlot.HAND).getType()).isEqualTo(Material.IRON_SWORD);
    assertThat(equipment.getDropChance(EquipmentSlot.HEAD)).isZero();
    assertThat(zombie.isCustomNameVisible()).isTrue();
    assertThat(keys.arenaOf(zombie)).contains("colosseum");
    assertThat(zombie.isPersistent()).isFalse();
  }

  @Test
  void aBossGetsItsAbsoluteHealthCappedAtTheGamesLimit() {
    var keys = new Keys(MockBukkit.createMockPlugin());
    var factory = MobFactory.create(keys, table(Map.of("knight", KNIGHT)));
    var zombie = zombie();

    factory.configure(zombie, KNIGHT, MobFactory.Tuning.boss(300, 1), "colosseum");
    assertThat(requireNonNull(zombie.getAttribute(Attribute.MAX_HEALTH)).getBaseValue())
        .isEqualTo(300);

    var giant = zombie();
    factory.configure(giant, KNIGHT, MobFactory.Tuning.boss(5000, 1), "colosseum");
    assertThat(requireNonNull(giant.getAttribute(Attribute.MAX_HEALTH)).getBaseValue())
        .isEqualTo(WaveScaling.MAX_HEALTH);
  }

  @Test
  void unknownTypesAndEquipmentStopTheModule() {
    var keys = new Keys(MockBukkit.createMockPlugin());
    var bad =
        new MobArchetype(
            "DRAGONFLY",
            1,
            1,
            1,
            1,
            Optional.empty(),
            Map.of(Slot.HEAD, "GLASS_HAT"),
            Optional.empty(),
            Behavior.VANILLA,
            0);
    var notAMob =
        new MobArchetype(
            "ARROW", 1, 1, 1, 1, Optional.empty(), Map.of(), Optional.empty(), Behavior.VANILLA, 0);

    assertThatThrownBy(
            () -> MobFactory.create(keys, table(Map.of("knight", bad, "arrow", notAMob))))
        .hasMessageContaining("DRAGONFLY is not a mob")
        .hasMessageContaining("GLASS_HAT is not an item")
        .hasMessageContaining("ARROW is not a mob");
  }

  @Test
  void keysTellArenaItemsApart() {
    var keys = new Keys(MockBukkit.createMockPlugin());
    var sword = ItemStack.of(Material.IRON_SWORD);
    var plain = ItemStack.of(Material.IRON_SWORD);

    keys.tag(sword);

    assertThat(keys.isArenaItem(sword)).isTrue();
    assertThat(keys.isArenaItem(plain)).isFalse();
    assertThat(keys.isArenaItem(ItemStack.empty())).isFalse();
  }
}
