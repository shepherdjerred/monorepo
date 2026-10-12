package com.shepherdjerred.thestorm.rwfbots.domain.world;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Known kit ids resolve exactly; unknown ones read as the closest known kit by what is seen. */
final class KitTest {

  @Test
  void everyKnownKitRoundTripsThroughItsId() {
    for (var kit : Kit.values()) {
      assertThat(Kit.known(kit.id())).contains(kit);
      assertThat(Kit.closest(kit.id(), new Kit.Traits(true, true))).isEqualTo(kit);
    }
  }

  @Test
  void idsAreMatchedExactlyAndLowerCase() {
    assertThat(Kit.known("longbow")).contains(Kit.LONGBOW);
    assertThat(Kit.known("LONGBOW")).isEmpty();
    assertThat(Kit.known("paladin")).isEmpty();
    assertThat(Kit.known("")).isEmpty();
  }

  @Test
  void anUnknownKitReadsAsTheClosestKnownOneByItsTraits() {
    assertThat(Kit.closest("paladin", Kit.Traits.NONE)).isEqualTo(Kit.TROOPER);
    assertThat(Kit.closest("crossbowman", new Kit.Traits(true, false))).isEqualTo(Kit.LONGBOW);
    assertThat(Kit.closest("shade", new Kit.Traits(false, true))).isEqualTo(Kit.GHOST);
    assertThat(Kit.closest("shade", new Kit.Traits(true, true)))
        .as("invisibility is what a bot must account for first")
        .isEqualTo(Kit.GHOST);
  }
}
