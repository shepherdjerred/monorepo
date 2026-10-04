package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PackedShopsTest {
  @Test
  void replacementTokenIsStableForARecoveryAndPreviousToken() {
    var recovery = UUID.fromString("3c383068-32e0-4f0d-8c4a-51bb970982d5");
    var previous = UUID.fromString("9e502a86-1f7b-435d-9c80-7d02c941b57d");
    var otherRecovery = UUID.fromString("67829b62-444b-43a4-ab61-1648643676da");

    assertThat(PackedShops.replacementToken(recovery, previous))
        .isEqualTo(PackedShops.replacementToken(recovery, previous))
        .isNotEqualTo(previous)
        .isNotEqualTo(PackedShops.replacementToken(otherRecovery, previous));
  }
}
