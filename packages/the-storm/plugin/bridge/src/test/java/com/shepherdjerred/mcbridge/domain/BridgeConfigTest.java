package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

class BridgeConfigTest {
  private static final String TOKEN = "t".repeat(32);

  @Test
  void appliesBootstrapDefaults() {
    BridgeConfig config = BridgeConfig.fromEnv(Map.of(BridgeConfig.TOKEN_ENV, TOKEN));

    assertThat(config.port()).isEqualTo(25_580);
    assertThat(config.bind()).isEqualTo("0.0.0.0");
    assertThat(config.toString()).doesNotContain(TOKEN);
  }

  @Test
  void readsPortAndBind() {
    BridgeConfig config =
        BridgeConfig.fromEnv(
            Map.of(
                BridgeConfig.TOKEN_ENV, TOKEN,
                BridgeConfig.PORT_ENV, "9000",
                BridgeConfig.BIND_ENV, "127.0.0.1"));

    assertThat(config.port()).isEqualTo(9000);
    assertThat(config.bind()).isEqualTo("127.0.0.1");
  }

  @Test
  void refusesMissingOrShortTokens() {
    assertThatThrownBy(() -> BridgeConfig.fromEnv(Map.of()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("MC_BRIDGE_TOKEN is not set");
    assertThatThrownBy(() -> BridgeConfig.fromEnv(Map.of(BridgeConfig.TOKEN_ENV, "short")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("at least 32");
  }

  @Test
  void refusesInvalidPorts() {
    assertThatThrownBy(
            () ->
                BridgeConfig.fromEnv(
                    Map.of(BridgeConfig.TOKEN_ENV, TOKEN, BridgeConfig.PORT_ENV, "http")))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () ->
                BridgeConfig.fromEnv(
                    Map.of(BridgeConfig.TOKEN_ENV, TOKEN, BridgeConfig.PORT_ENV, "70000")))
        .isInstanceOf(IllegalStateException.class);
  }
}
