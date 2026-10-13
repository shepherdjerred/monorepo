package com.shepherdjerred.thestorm.rwf.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class RwfWorldsConfigTest {

  @Test
  void parsesExplicitOwnedVoidProvisioning() {
    assertThat(
            StrictYaml.parse(
                "rwf.yml",
                "lobby: rwf_lobby\nmaps: rwf\nlobbyProvisioning: owned-void\n",
                RwfConfig.Worlds.class))
        .isEqualTo(
            Result.ok(
                new RwfConfig.Worlds("rwf_lobby", "rwf", RwfConfig.LobbyProvisioning.OWNED_VOID)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "lobbyProvisioning: unknown\n", "lobbyProvisioning: null\n"})
  void refusesAbsentOrInvalidProvisioning(String declaration) {
    assertThat(
            StrictYaml.parse(
                "rwf.yml", "lobby: rwf_lobby\nmaps: rwf\n" + declaration, RwfConfig.Worlds.class))
        .isInstanceOf(Result.Err.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        ".",
        "..",
        "../world",
        "RWF_Lobby",
        "world",
        "overworld",
        "world_nether",
        "world_the_end",
        "the_nether",
        "the_end",
        "namespace:lobby"
      })
  void refusesUnsafeOrPrimaryLobbyNames(String name) {
    assertThatThrownBy(
            () -> new RwfConfig.Worlds(name, "rwf", RwfConfig.LobbyProvisioning.OWNED_VOID))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
