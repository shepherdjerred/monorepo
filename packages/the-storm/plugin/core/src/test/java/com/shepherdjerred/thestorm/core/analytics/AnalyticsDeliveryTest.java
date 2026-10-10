package com.shepherdjerred.thestorm.core.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.impl.DSL.table;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

final class AnalyticsDeliveryTest {
  @Test
  void retriesTheSameDurableIdsAfterHttpFailure(@TempDir Path directory) throws Exception {
    var requests = new CopyOnWriteArrayList<String>();
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/batch/",
        exchange -> {
          requests.add(
              new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          exchange.sendResponseHeaders(requests.size() == 1 ? 503 : 200, -1);
          exchange.close();
        });
    server.start();
    try (var database = StormDatabase.open(directory.resolve("analytics.db"))) {
      database.migrate("core", getClass().getClassLoader());
      var store = new AnalyticsStore(database, "beta");
      store.save(write()).get(5, TimeUnit.SECONDS);
      var bootstrap =
          new AnalyticsBootstrap(
              URI.create("http://localhost:" + server.getAddress().getPort()), "phc_test", "beta");
      try (var exporter = new AnalyticsExporter(store, new PostHogTransport(bootstrap))) {
        assertThatThrownBy(() -> exporter.flush().get(5, TimeUnit.SECONDS))
            .hasRootCauseMessage("PostHog capture returned HTTP 503");
        assertThat(store.pending().get(5, TimeUnit.SECONDS)).hasSize(1);
        exporter.flush().get(5, TimeUnit.SECONDS);
        assertThat(store.pending().get(5, TimeUnit.SECONDS)).isEmpty();
        assertThat(requests).hasSize(2);
        assertThat(requests.get(0)).isEqualTo(requests.get(1));
        var body = JsonMapper.builder().build().readTree(requests.get(1));
        var event = body.path("batch").get(0);
        assertThat(event.path("distinct_id").asString()).startsWith("the-storm:beta:player:");
        assertThat(event.path("properties").path("$geoip_disable").asBoolean()).isTrue();
        assertThat(event.path("properties").path("$set").path("name").asString())
            .isEqualTo("Player");
      }
    } finally {
      server.stop(0);
    }
  }

  @Test
  void crashRecoveryEndsAtCheckpointOnceAndKeepsStagesSeparate(@TempDir Path directory)
      throws Exception {
    var file = directory.resolve("analytics.db");
    var writes = new ArrayList<AnalyticsWrite>();
    var time = new SessionBookTest.Time();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    var player = UUID.randomUUID();
    book.joined(player, "Player");
    time.advance(60);
    book.checkpoint();
    try (var database = StormDatabase.open(file)) {
      database.migrate("core", getClass().getClassLoader());
      var store = new AnalyticsStore(database, "beta");
      for (var write : writes) store.save(write).get(5, TimeUnit.SECONDS);
    }
    time.advance(3600);
    try (var database = StormDatabase.open(file)) {
      var store = new AnalyticsStore(database, "beta");
      var prod = new AnalyticsStore(database, "prod");
      prod.recover().get(5, TimeUnit.SECONDS);
      assertThat(prod.pending().get(5, TimeUnit.SECONDS)).isEmpty();
      store.recover().get(5, TimeUnit.SECONDS);
      store.recover().get(5, TimeUnit.SECONDS);
      var pending = store.pending().get(5, TimeUnit.SECONDS);
      assertThat(pending).hasSize(4); // start, two midnight-split intervals, one recovered end
      var json = JsonMapper.builder().build();
      var ends =
          pending.stream()
              .map(event -> json.readTree(event.payload()))
              .filter(event -> event.path("event").asString().equals("storm_session_ended"))
              .toList();
      assertThat(ends).hasSize(1);
      assertThat(ends.getFirst().path("properties").path("connected_ms").asLong()).isEqualTo(60000);
      assertThat(ends.getFirst().path("timestamp").asString()).isEqualTo("2026-10-10T07:00:30Z");
    }
  }

  @Test
  void aDuplicateEventRollsBackItsSessionAndOutboxTogether(@TempDir Path directory)
      throws Exception {
    try (var database = StormDatabase.open(directory.resolve("analytics.db"))) {
      database.migrate("core", getClass().getClassLoader());
      var store = new AnalyticsStore(database, "prod");
      var write = write();
      var duplicate =
          new AnalyticsWrite(
              write.connection(), List.of(write.events().getFirst(), write.events().getFirst()));
      assertThatThrownBy(() -> store.save(duplicate).get(5, TimeUnit.SECONDS))
          .hasCauseInstanceOf(RuntimeException.class);
      assertThat(store.pending().get(5, TimeUnit.SECONDS)).isEmpty();
      assertThat(
              database
                  .read(dsl -> dsl.fetchCount(table("core_analytics_session")))
                  .get(5, TimeUnit.SECONDS))
          .isZero();
    }
  }

  private static AnalyticsWrite write() {
    var now = Instant.parse("2026-10-09T12:00:00Z");
    return new AnalyticsWrite(
        new AnalyticsWrite.Connection(
            UUID.randomUUID(), UUID.randomUUID(), "Player", now, now, 0, 0, false),
        List.of(new AnalyticsEvent(UUID.randomUUID(), "storm_session_started", now, Map.of())));
  }

  @Test
  void reconnectKeepsFirstSeenButProductionStartsItsOwnHistory(@TempDir Path directory)
      throws Exception {
    try (var database = StormDatabase.open(directory.resolve("analytics.db"))) {
      database.migrate("core", getClass().getClassLoader());
      var beta = new AnalyticsStore(database, "beta");
      var prod = new AnalyticsStore(database, "prod");
      var first = write();
      beta.save(first).get(5, TimeUnit.SECONDS);
      var session = first.connection();
      var later = session.started().plusSeconds(86400);
      var reconnect =
          new AnalyticsWrite(
              new AnalyticsWrite.Connection(
                  UUID.randomUUID(), session.player(), "Renamed", later, later, 0, 0, false),
              List.of(
                  new AnalyticsEvent(UUID.randomUUID(), "storm_session_started", later, Map.of())));
      beta.save(reconnect).get(5, TimeUnit.SECONDS);
      var productionJoin =
          new AnalyticsWrite(
              new AnalyticsWrite.Connection(
                  UUID.randomUUID(), session.player(), "Renamed", later, later, 0, 0, false),
              List.of(
                  new AnalyticsEvent(UUID.randomUUID(), "storm_session_started", later, Map.of())));
      prod.save(productionJoin).get(5, TimeUnit.SECONDS);
      var json = JsonMapper.builder().build();
      var betaEvents = beta.pending().get(5, TimeUnit.SECONDS);
      assertThat(betaEvents).hasSize(2);
      for (var event : betaEvents)
        assertThat(
                json.readTree(event.payload()).path("properties").path("first_seen_at").asString())
            .isEqualTo(session.started().toString());
      var production = json.readTree(prod.pending().get(5, TimeUnit.SECONDS).getFirst().payload());
      assertThat(production.path("properties").path("first_seen_at").asString())
          .isEqualTo(later.toString());
      assertThat(production.path("properties").path("$set").path("name").asString())
          .isEqualTo("Renamed");
    }
  }

  @Test
  void drainsTheOutboxInBatchesOfAtMostOneHundred(@TempDir Path directory) throws Exception {
    try (var database = StormDatabase.open(directory.resolve("analytics.db"))) {
      database.migrate("core", getClass().getClassLoader());
      var store = new AnalyticsStore(database, "beta");
      var first = write();
      var events =
          java.util.stream.IntStream.range(0, 201)
              .mapToObj(
                  index ->
                      new AnalyticsEvent(
                          UUID.randomUUID(),
                          "storm_feature_interacted",
                          first.connection().started(),
                          Map.<String, Object>of("action", "cast", "feature", "spells")))
              .toList();
      store.save(new AnalyticsWrite(first.connection(), events)).get(5, TimeUnit.SECONDS);
      var sizes = new ArrayList<Integer>();
      var transport =
          new AnalyticsTransport() {
            @Override
            public java.util.concurrent.CompletableFuture<Void> send(
                List<AnalyticsStore.Pending> batch) {
              sizes.add(batch.size());
              return java.util.concurrent.CompletableFuture.completedFuture(null);
            }

            @Override
            public void close() {}
          };
      try (var exporter = new AnalyticsExporter(store, transport)) {
        exporter.flush().get(5, TimeUnit.SECONDS);
        assertThat(sizes).containsExactly(100, 100, 1);
        assertThat(store.pending().get(5, TimeUnit.SECONDS)).isEmpty();
      }
    }
  }
}
