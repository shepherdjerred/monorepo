package com.shepherdjerred.thestorm.core.expansion;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ManagedGameplayRemoteTest {
  private static final UUID ACTOR = new UUID(1, 1);

  private static void withProvider(int status, String body, Consumer<ManagedGameplay> verify)
      throws IOException {
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/v1/evaluate",
        exchange -> {
          var bytes = body.getBytes(UTF_8);
          exchange.sendResponseHeaders(status, bytes.length);
          try (var stream = exchange.getResponseBody()) {
            stream.write(bytes);
          }
        });
    server.start();
    try (var flags =
        ManagedGameplay.remote(
            "http://127.0.0.1:" + server.getAddress().getPort(), "minecraft/tsmc")) {
      verify.accept(flags);
    } finally {
      server.stop(0);
    }
  }

  @ParameterizedTest
  @ValueSource(ints = {429, 503})
  void retryableHttpFailuresUseTheDeclaredOffDefault(int status) throws IOException {
    withProvider(
        status,
        "temporarily unavailable",
        flags -> {
          var observed = new AtomicBoolean();
          assertThat(
                  flags
                      .enabledOrDefault(
                          ManagedGameplay.CONTENT_SAFETY,
                          ACTOR,
                          false,
                          failure -> observed.set(true))
                      .join())
              .isFalse();
          assertThat(observed.get()).isTrue();
          assertThat(flags.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, ACTOR)).contains(false);
        });
  }

  @ParameterizedTest
  @ValueSource(ints = {400, 401, 403, 404})
  void missingFlagsAndInvalidRequestsFailLoudly(int status) throws IOException {
    withProvider(
        status,
        "broken flag contract",
        flags -> {
          assertThatThrownBy(() ->
                  flags
                      .enabledOrDefault(ManagedGameplay.CONTENT_SAFETY, ACTOR, false, failure -> {})
                      .join())
              .hasRootCauseMessage("Flags evaluation returned HTTP %s", status);
          assertThat(flags.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, ACTOR)).isEmpty();
        });
  }

  @ParameterizedTest
  @ValueSource(strings = {"invalid json", "{\"enabled\":\"false\"}", "{}"})
  void malformedSuccessfulAnswersNeverBecomeFalse(String body) throws IOException {
    withProvider(
        200,
        body,
        flags -> {
          var observed = new AtomicBoolean();
          assertThatThrownBy(() ->
                  flags
                      .enabledOrDefault(
                          ManagedGameplay.CONTENT_SAFETY,
                          ACTOR,
                          false,
                          failure -> observed.set(true))
                      .join())
              .isInstanceOf(java.util.concurrent.CompletionException.class);
          assertThat(observed.get()).isFalse();
          assertThat(flags.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, ACTOR)).isEmpty();
        });
  }

  @Test
  void explicitFalseIsPreservedOverATrueDefault() throws IOException {
    withProvider(
        200,
        "{\"enabled\":false}",
        flags ->
            assertThat(
                    flags
                        .enabledOrDefault(
                            ManagedGameplay.CONTENT_SAFETY,
                            ACTOR,
                            true,
                            failure -> {
                              throw new AssertionError("False is not unavailable");
                            })
                        .join())
                .isFalse());
  }

  @Test
  void aConnectionOutageUsesTheDeclaredOffDefault() throws IOException {
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    var port = server.getAddress().getPort();
    server.start();
    server.stop(0);
    try (var flags = ManagedGameplay.remote("http://127.0.0.1:" + port, "minecraft/tsmc")) {
      assertThat(flags.ipEnforcementDefault()).isFalse();
      assertThat(
              flags
                  .enabledOrDefault(ManagedGameplay.CONTENT_SAFETY, ACTOR, false, failure -> {})
                  .join())
          .isFalse();
      assertThat(flags.cachedEnabled(ManagedGameplay.CONTENT_SAFETY, ACTOR)).contains(false);
      assertThat(flags.enabled(ManagedGameplay.ASYNC_CHAT_MODERATION, ACTOR).join()).isTrue();
      assertThat(flags.enabled(ManagedGameplay.STAFF, ACTOR).join()).isTrue();
    }
    try (var betaFlags = ManagedGameplay.remote("http://127.0.0.1:" + port, "minecraft/sandbox")) {
      assertThat(betaFlags.ipEnforcementDefault()).isTrue();
      assertThat(betaFlags.enabled(ManagedGameplay.ASYNC_CHAT_MODERATION, ACTOR).join()).isTrue();
      assertThatThrownBy(() -> betaFlags.enabled(ManagedGameplay.STAFF, ACTOR).join())
          .hasCauseInstanceOf(FlagProviderUnavailableException.class);
    }
  }
}
