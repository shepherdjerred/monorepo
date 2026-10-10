package com.shepherdjerred.thestorm.messages.config;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Language-neutral contract shared with the forum's Query reader. */
public record PublicQueryContract(int schemaVersion, String queryIdentity) {
  public PublicQueryContract {
    if (schemaVersion != 1 || queryIdentity == null || queryIdentity.isBlank()) {
      throw new IllegalArgumentException("Invalid public Query contract");
    }
  }

  public static PublicQueryContract load() {
    try (var stream = PublicQueryContract.class.getResourceAsStream("/public-status.json")) {
      if (stream == null) throw new IllegalStateException("Missing public Query contract");
      return StrictYaml.parseJson(
              "public-status.json",
              new String(stream.readAllBytes(), StandardCharsets.UTF_8),
              PublicQueryContract.class)
          .fold(
              value -> value,
              problems -> {
                throw new IllegalStateException("Invalid public Query contract: " + problems);
              });
    } catch (IOException error) {
      throw new IllegalStateException("Cannot read public Query contract", error);
    }
  }
}
