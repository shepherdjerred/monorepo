package com.shepherdjerred.mcbridge.domain;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Bootstrap configuration, read from the environment only: the bearer token is a credential and the
 * port and bind address are bootstrap values.
 *
 * @param token the bearer token every request must present
 * @param port the TCP port to listen on
 * @param bind the address to bind
 */
public record BridgeConfig(String token, int port, String bind) {
  public static final String TOKEN_ENV = "MC_BRIDGE_TOKEN";
  public static final String PORT_ENV = "MC_BRIDGE_PORT";
  public static final String BIND_ENV = "MC_BRIDGE_BIND";
  public static final int MIN_TOKEN_LENGTH = 32;
  public static final int DEFAULT_PORT = 25_580;
  public static final String DEFAULT_BIND = "0.0.0.0";

  /**
   * Parses the environment. A missing or short token is a startup error, never a default.
   *
   * @throws IllegalStateException with an operator-facing message when the environment is invalid
   */
  public static BridgeConfig fromEnv(Map<String, String> env) {
    String token = env.get(TOKEN_ENV);
    if (token == null || token.isBlank()) {
      throw new IllegalStateException(TOKEN_ENV + " is not set; MCBridge refuses to start");
    }
    if (token.length() < MIN_TOKEN_LENGTH) {
      throw new IllegalStateException(
          TOKEN_ENV + " must be at least " + MIN_TOKEN_LENGTH + " characters");
    }
    return new BridgeConfig(token, parsePort(env.get(PORT_ENV)), parseBind(env.get(BIND_ENV)));
  }

  private static int parsePort(@Nullable String raw) {
    if (raw == null) {
      return DEFAULT_PORT;
    }
    int port;
    try {
      port = Integer.parseInt(raw.trim());
    } catch (NumberFormatException e) {
      throw new IllegalStateException(PORT_ENV + " is not a number: " + raw, e);
    }
    if (port < 1 || port > 65_535) {
      throw new IllegalStateException(PORT_ENV + " is out of range: " + port);
    }
    return port;
  }

  private static String parseBind(@Nullable String raw) {
    if (raw == null) {
      return DEFAULT_BIND;
    }
    if (raw.isBlank()) {
      throw new IllegalStateException(BIND_ENV + " is set but blank");
    }
    return raw.trim();
  }

  @Override
  public String toString() {
    return "BridgeConfig[token=<redacted>, port=" + port + ", bind=" + bind + "]";
  }
}
