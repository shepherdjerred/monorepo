package com.shepherdjerred.thestorm.rwf.app.view;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import org.junit.jupiter.api.Test;

final class WeaponProfileTest {
  @Test
  void crossbowsLoadAtTheirOwnChargeRateAndKeepTheirProjectileSpeed() {
    var ordinary = WeaponProfile.of(ItemSpec.of("CROSSBOW"));
    var quick = WeaponProfile.of(ItemSpec.of("CROSSBOW").enchanted("quick_charge", 2));
    assertThat(ordinary.kind()).isEqualTo(WeaponProfile.Kind.CROSSBOW);
    assertThat(ordinary.chargeTicks()).isEqualTo(25);
    assertThat(quick.chargeTicks()).isEqualTo(15);
    assertThat(quick.projectileSpeed()).isEqualTo(3.15);
    assertThat(WeaponProfile.of(ItemSpec.of("BOW")).chargeTicks()).isEqualTo(20);
  }

  @Test
  void modernMeleeAndReturningTridentsAreDistinctCapabilities() {
    var spear = WeaponProfile.of(ItemSpec.of("IRON_SPEAR"));
    assertThat(spear.nativeMelee()).isTrue();
    assertThat(spear.minReach()).isEqualTo(2);
    assertThat(spear.maxReach()).isEqualTo(4.5);
    assertThat(WeaponProfile.of(ItemSpec.of("MACE")).nativeMelee()).isTrue();
    var trident = WeaponProfile.of(ItemSpec.of("TRIDENT").enchanted("loyalty", 3));
    assertThat(trident.nativeMelee()).isTrue();
    assertThat(trident.ranged()).isTrue();
    assertThat(trident.chargeTicks()).isEqualTo(10);
    assertThat(trident.projectileSpeed()).isEqualTo(2.5);
    assertThat(WeaponProfile.of(ItemSpec.of("IRON_SWORD")).nativeMelee()).isFalse();
  }

  @Test
  void invalidCapabilitiesFailAtTheBoundary() {
    assertThatThrownBy(() -> new WeaponProfile(WeaponProfile.Kind.BOW, 0, 3, 20, Double.NaN))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new WeaponProfile(WeaponProfile.Kind.SPEAR, 5, 4, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new WeaponProfile(WeaponProfile.Kind.BOW, 0, 3, -1, 3))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
