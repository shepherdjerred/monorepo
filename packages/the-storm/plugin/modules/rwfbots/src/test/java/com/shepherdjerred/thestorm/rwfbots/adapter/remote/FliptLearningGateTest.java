package com.shepherdjerred.thestorm.rwfbots.adapter.remote;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.app.learning.LearningGate;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

final class FliptLearningGateTest {
  @Test
  void sendsMatchTargetingAndDistinguishesAnswersFromOutagesAndInvalidValues() throws Exception {
    var json = JsonMapper.builder().build();
    var request = new AtomicReference<String>();
    var authorization = new AtomicReference<String>();
    var response = new AtomicReference<>("{\"enabled\":true}");
    var status = new AtomicInteger(200);
    var server =
        HttpServer.create(
            new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 0);
    server.createContext(
        "/v1/evaluate",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
          authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
          var bytes = response.get().getBytes(UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          try (var body = exchange.getResponseBody()) {
            body.write(bytes);
          }
        });
    server.start();
    var context = new LearningGate.Context(new UUID(1, 2), "map\"name", "rwf", 123);
    try (var gate =
        new FliptLearningGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "the-storm/beta")) {
      assertThat(gate.evaluate(context).join())
          .isEqualTo(new LearningGate.Decision(true, LearningGate.Source.FLIPT));
      var payload = json.readTree(request.get());
      assertThat(payload.path("deployment").asString()).isEqualTo("the-storm/beta");
      assertThat(payload.path("key").asString()).isEqualTo("the-storm-rwfbots-learning-enabled");
      assertThat(payload.path("context").path("match").asString())
          .isEqualTo(context.match().toString());
      assertThat(payload.path("context").path("map").asString()).isEqualTo(context.map());
      assertThat(payload.path("context").path("world").asString()).isEqualTo("rwf");
      assertThat(authorization.get()).isNull();
      response.set("{\"enabled\":false}");
      assertThat(gate.evaluate(context).join())
          .isEqualTo(new LearningGate.Decision(false, LearningGate.Source.FLIPT));
      for (var invalid :
          new String[] {"{}", "{\"enabled\":0}", "{\"enabled\":\"true\"}", "{\"enabled\":null}"}) {
        response.set(invalid);
        assertThatThrownBy(() -> gate.evaluate(context).join())
            .isInstanceOf(CompletionException.class)
            .hasCauseInstanceOf(IllegalStateException.class);
      }
      for (int unavailable : new int[] {429, 503}) {
        status.set(unavailable);
        assertThat(gate.evaluate(context).join())
            .isEqualTo(new LearningGate.Decision(false, LearningGate.Source.UNAVAILABLE));
      }
      for (int invalid : new int[] {400, 403, 404}) {
        status.set(invalid);
        assertThatThrownBy(() -> gate.evaluate(context).join())
            .hasCauseInstanceOf(IllegalStateException.class);
      }
      server.stop(0);
      assertThat(gate.evaluate(context).join())
          .isEqualTo(new LearningGate.Decision(false, LearningGate.Source.UNAVAILABLE));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void refusesInvalidBootstrapValuesAndEnabledDefaults() {
    assertThatThrownBy(() -> new FliptLearningGate(URI.create("ftp://flags"), "minecraft/tsmc"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new FliptLearningGate(URI.create("http://user@flags"), "minecraft/tsmc"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FliptLearningGate(URI.create("http://flags"), "staging"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FliptLearningGate(URI.create("http://flags"), "the-storm/staging"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new LearningGate.Decision(true, LearningGate.Source.ABSENT))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
