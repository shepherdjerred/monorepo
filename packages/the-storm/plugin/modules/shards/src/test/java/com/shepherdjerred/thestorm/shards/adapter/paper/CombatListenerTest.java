package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.shards.domain.StormTier;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Firework;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.ArrowMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class CombatListenerTest {

  private static final double EPSILON = 1e-9;

  private final Harness harness = new Harness();
  private final CombatListener listener = new CombatListener(harness.bonuses, harness.gear);
  private final PlayerMock attacker = harness.server.addPlayer();
  private final LivingEntity zombie =
      (LivingEntity) harness.world.spawnEntity(attacker.getLocation(), EntityType.ZOMBIE);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  /** An arrow that remembers its bow; MockBukkit's arrow does not implement the weapon. */
  private static final class FiredArrow extends ArrowMock {
    private final ItemStack weapon;

    FiredArrow(ServerMock server, ItemStack weapon) {
      super(server, UUID.randomUUID());
      this.weapon = weapon;
    }

    @Override
    public ItemStack getWeapon() {
      return weapon;
    }
  }

  private ItemStack storm(Material material, int level) {
    var item = ItemStack.of(material);
    harness.gear.apply(item, new StormTier(level));
    return item;
  }

  private double swing(DamageCause cause, LivingEntity victim) {
    return listener.dealtMultiplier(attacker, attacker, cause, victim);
  }

  @Test
  void aStormSwordSwingHitsHarderAgainstMobs() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));

    assertThat(swing(DamageCause.ENTITY_ATTACK, zombie)).isCloseTo(1.25, within(EPSILON));
  }

  @Test
  void sweepsCountAsSwings() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));

    assertThat(swing(DamageCause.ENTITY_SWEEP_ATTACK, zombie)).isCloseTo(1.25, within(EPSILON));
  }

  @Test
  void playersTakeOnlyThePvpShare() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));

    assertThat(swing(DamageCause.ENTITY_ATTACK, harness.server.addPlayer()))
        .isCloseTo(1.10, within(EPSILON));
  }

  @Test
  void thornsGetNoBonus() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));

    assertThat(swing(DamageCause.THORNS, zombie)).isEqualTo(1);
  }

  @Test
  void aBowSwungInMeleeGetsNoBonus() {
    attacker.getInventory().setItemInMainHand(storm(Material.BOW, 5));

    assertThat(swing(DamageCause.ENTITY_ATTACK, zombie)).isEqualTo(1);
  }

  @Test
  void ordinaryGearGetsNoBonus() {
    attacker.getInventory().setItemInMainHand(ItemStack.of(Material.DIAMOND_SWORD));

    assertThat(swing(DamageCause.ENTITY_ATTACK, zombie)).isEqualTo(1);
  }

  @Test
  void mobsAndSelfHarmGetNoBonus() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));

    assertThat(listener.dealtMultiplier(zombie, zombie, DamageCause.ENTITY_ATTACK, attacker))
        .isEqualTo(1);
    assertThat(swing(DamageCause.ENTITY_ATTACK, attacker)).isEqualTo(1);
  }

  @Test
  void anArrowCarriesItsBowsBonus() {
    var arrow = new FiredArrow(harness.server, storm(Material.BOW, 3));
    // The player now holds something else; the arrow's bow still counts.
    attacker.getInventory().setItemInMainHand(ItemStack.of(Material.DIRT));

    assertThat(listener.dealtMultiplier(attacker, arrow, DamageCause.PROJECTILE, zombie))
        .isCloseTo(1.15, within(EPSILON));
  }

  @Test
  void anArrowFromAStormSwordHolderGetsNothing() {
    attacker.getInventory().setItemInMainHand(storm(Material.DIAMOND_SWORD, 5));
    var arrow = new FiredArrow(harness.server, ItemStack.of(Material.BOW));

    assertThat(listener.dealtMultiplier(attacker, arrow, DamageCause.PROJECTILE, zombie))
        .isEqualTo(1);
  }

  @Test
  void aCrossbowRocketCarriesTheCrossbowsBonus() {
    var rocket = harness.world.spawn(attacker.getLocation(), Firework.class);
    listener.tagRocket(rocket, storm(Material.CROSSBOW, 2));

    assertThat(listener.dealtMultiplier(attacker, rocket, DamageCause.ENTITY_EXPLOSION, zombie))
        .isCloseTo(1.10, within(EPSILON));
  }

  @Test
  void rocketsFromOrdinaryLaunchersStayUntagged() {
    var plain = harness.world.spawn(attacker.getLocation(), Firework.class);
    listener.tagRocket(plain, ItemStack.of(Material.CROSSBOW));
    var handThrown = harness.world.spawn(attacker.getLocation(), Firework.class);
    listener.tagRocket(handThrown, null);

    assertThat(listener.dealtMultiplier(attacker, plain, DamageCause.ENTITY_EXPLOSION, zombie))
        .isEqualTo(1);
    assertThat(listener.dealtMultiplier(attacker, handThrown, DamageCause.ENTITY_EXPLOSION, zombie))
        .isEqualTo(1);
  }

  private PlayerMock armored() {
    var wearer = harness.server.addPlayer();
    var inventory = wearer.getInventory();
    inventory.setHelmet(storm(Material.IRON_HELMET, 5));
    inventory.setChestplate(storm(Material.IRON_CHESTPLATE, 5));
    inventory.setLeggings(storm(Material.IRON_LEGGINGS, 5));
    inventory.setBoots(storm(Material.IRON_BOOTS, 5));
    return wearer;
  }

  @Test
  void stormArmorIsCappedAgainstMobs() {
    // 5 + 7 + 6 + 5 = 23%, capped at 20%.
    assertThat(listener.takenMultiplier(armored(), zombie)).isCloseTo(0.80, within(EPSILON));
  }

  @Test
  void stormArmorGivesThePvpShareAgainstPlayers() {
    assertThat(listener.takenMultiplier(armored(), attacker)).isCloseTo(0.92, within(EPSILON));
  }

  @Test
  void stormArmorDoesNotSoftenFallsOrSelfHarm() {
    var wearer = armored();

    assertThat(listener.takenMultiplier(wearer, null)).isEqualTo(1);
    assertThat(listener.takenMultiplier(wearer, wearer)).isEqualTo(1);
  }

  @Test
  void ordinaryArmorDoesNothing() {
    var wearer = harness.server.addPlayer();
    wearer.getInventory().setChestplate(ItemStack.of(Material.NETHERITE_CHESTPLATE));

    assertThat(listener.takenMultiplier(wearer, zombie)).isEqualTo(1);
  }
}
