package com.shepherdjerred.thestorm.stats.adapter.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.stats.adapter.db.JooqStatsStore;
import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.stats.domain.BounceCategory;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

final class HttpStatsTransportTest {

  private static final StatsConfig CONFIG =
      new StatsConfig(
          "The Storm",
          "https://ts-mc.net",
          "STORM_STATS_INGEST_URL",
          "STORM_STATS_INGEST_TOKEN",
          15,
          60);
  private static final JsonMapper JSON = JsonMapper.builder().build();

  @Test
  void endpointResolvesLocalModeValidatesPartialSecretsAndRedactsToken() {
    assertThat(StatsEndpoint.resolve(CONFIG, ignored -> Optional.empty())).isEmpty();
    assertThat(StatsEndpoint.resolve(CONFIG, ignored -> Optional.of("   "))).isEmpty();

    var secret = "super-secret-ingest-token-never-print";
    var missingUrl = Map.of("STORM_STATS_INGEST_TOKEN", secret);
    assertThatThrownBy(
            () -> StatsEndpoint.resolve(CONFIG, key -> Optional.ofNullable(missingUrl.get(key))))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("STORM_STATS_INGEST_URL")
        .message()
        .doesNotContain(secret);

    var missingToken = Map.of("STORM_STATS_INGEST_URL", "http://127.0.0.1:7422");
    assertThatThrownBy(
            () -> StatsEndpoint.resolve(CONFIG, key -> Optional.ofNullable(missingToken.get(key))))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("STORM_STATS_INGEST_TOKEN");

    var rootUrl =
        Map.of(
            "STORM_STATS_INGEST_URL", "http://127.0.0.1:7422", "STORM_STATS_INGEST_TOKEN", secret);
    var resolved =
        StatsEndpoint.resolve(CONFIG, key -> Optional.ofNullable(rootUrl.get(key))).orElseThrow();
    assertThat(resolved.ingestUri().toString()).isEqualTo("http://127.0.0.1:7422/api/v1/ingest");
    assertThat(resolved.toString()).doesNotContain(secret).contains("<redacted>");

    var customPath =
        Map.of(
            "STORM_STATS_INGEST_URL",
            "http://127.0.0.1:9999/custom/ingest",
            "STORM_STATS_INGEST_TOKEN",
            secret);
    var customResolved =
        StatsEndpoint.resolve(CONFIG, key -> Optional.ofNullable(customPath.get(key)))
            .orElseThrow();
    assertThat(customResolved.ingestUri().toString())
        .isEqualTo("http://127.0.0.1:9999/custom/ingest");
  }

  @Test
  void exportsBatchesRetainsOutboxOn500AndHonorsFlagGate(@TempDir Path tempDir) throws Exception {
    var statusCode = new AtomicInteger(500);
    var receivedAuth = new CopyOnWriteArrayList<String>();
    var receivedBodies = new CopyOnWriteArrayList<JsonNode>();
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/api/v1/ingest",
        exchange -> {
          receivedAuth.add(exchange.getRequestHeaders().getFirst("Authorization"));
          var bytes = exchange.getRequestBody().readAllBytes();
          receivedBodies.add(JSON.readTree(new String(bytes, StandardCharsets.UTF_8)));
          int code = statusCode.get();
          var reply =
              "{\"acceptedEvents\":1,\"duplicateEvents\":0,\"updatedPlayers\":1}"
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(code, reply.length);
          exchange.getResponseBody().write(reply);
          exchange.close();
        });
    server.start();

    try (var db = StormDatabase.open(tempDir.resolve("http-test.db"))) {
      db.migrate("stats", JooqStatsStore.class.getClassLoader());
      var store = new JooqStatsStore(db);
      var env =
          Map.of(
              "STORM_STATS_INGEST_URL",
              "http://127.0.0.1:" + server.getAddress().getPort(),
              "STORM_STATS_INGEST_TOKEN",
              "test-token-123");
      var endpoint =
          StatsEndpoint.resolve(CONFIG, key -> Optional.ofNullable(env.get(key))).orElseThrow();
      var transport = new HttpStatsTransport(endpoint);
      var gateOpen = new AtomicBoolean(false);

      try (var service =
          new StatsService(
              new StatsService.Dependencies(
                  CONFIG,
                  store,
                  transport,
                  () -> CompletableFuture.completedFuture(gateOpen.get())),
              new StatsService.Clocks(
                  () -> Instant.parse("2026-11-22T15:00:00Z"),
                  UUID::randomUUID,
                  LoggerFactory.getLogger(HttpStatsTransportTest.class)))) {

        service.recordBounce(
            new StatsService.BounceInput(
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                "Alice",
                BounceCategory.FULL,
                "Server full",
                "ts-mc.net"));
        service.bufferSnapshots(
            new StatsWire.ServerSnapshot("2026-11-22T15:00:00Z", List.of(), 100, 0, List.of()),
            List.of());

        // Wait for async bounce write to settle in SQLite
        assertThat(store.pendingEvents(10).get()).hasSize(1);

        // Gate closed -> no HTTP request sent, event stays queued
        service.flush().get();
        assertThat(receivedBodies).isEmpty();
        assertThat(store.pendingEvents(10).get()).hasSize(1);

        // Gate open, server returns 500 -> event stays queued and serverSnapshot restored!
        gateOpen.set(true);
        service.flush().get();
        assertThat(receivedBodies).hasSize(1);
        assertThat(store.pendingEvents(10).get()).hasSize(1);

        // Server returns 200 -> event acknowledged and deleted from outbox!
        statusCode.set(200);
        service.flush().get();
        assertThat(receivedBodies).hasSize(2);
        assertThat(receivedAuth).allMatch("Bearer test-token-123"::equals);
        assertThat(store.pendingEvents(10).get()).isEmpty();

        var delivered = receivedBodies.getLast();
        assertThat(delivered.required("schemaVersion").asInt()).isEqualTo(2);
        assertThat(delivered.required("serverName").asString()).isEqualTo("The Storm");
        assertThat(delivered.required("events").size()).isEqualTo(1);
        assertThat(delivered.required("serverSnapshot").isNull()).isFalse();
      }
    } finally {
      server.stop(0);
    }
  }
}
