package com.shepherdjerred.thestorm.messages.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class PublicQueryContractTest {
  @Test
  void loadsPackagedLanguageNeutralContract() {
    var contract = PublicQueryContract.load();
    assertThat(contract.schemaVersion()).isEqualTo(1);
    assertThat(contract.queryIdentity()).startsWith("The Storm public query/");
    assertThatThrownBy(() -> new PublicQueryContract(2, "wrong"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PublicQueryContract(1, ""))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
