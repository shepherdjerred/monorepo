package com.shepherdjerred.thestorm.stats;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.stats.domain.BounceCategory;
import com.shepherdjerred.thestorm.stats.domain.CombatKind;
import com.shepherdjerred.thestorm.stats.domain.EndReason;
import com.shepherdjerred.thestorm.stats.domain.GameModeBucket;
import com.shepherdjerred.thestorm.stats.domain.Platform;
import com.shepherdjerred.thestorm.stats.domain.WorldBucket;
import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Verifies 1-to-1 wire parity with {@code packages/storm-stats/contracts/ingest-v1.json}. */
final class IngestContractTest {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  @Test
  void wireEnumsLimitsAndRecordsMatchCanonicalContract() throws IOException {
    var contractPath = resolveContractPath();
    var contract = JSON.readTree(Files.readString(contractPath));

    assertThat(StatsWire.SCHEMA_VERSION).isEqualTo(contract.required("schemaVersion").asInt());
    assertThat(StatsWire.MAX_EVENTS_PER_BATCH)
        .isEqualTo(contract.required("maxEventsPerBatch").asInt());
    assertThat(StatsWire.MAX_PLAYER_SNAPSHOTS_PER_BATCH)
        .isEqualTo(contract.required("maxPlayerSnapshotsPerBatch").asInt());

    assertThat(Arrays.stream(Platform.values()).map(Platform::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("platforms")));
    assertThat(Arrays.stream(GameModeBucket.values()).map(GameModeBucket::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("modes")));
    assertThat(Arrays.stream(WorldBucket.values()).map(WorldBucket::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("worlds")));
    assertThat(Arrays.stream(CombatKind.values()).map(CombatKind::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("combatKinds")));
    assertThat(Arrays.stream(EndReason.values()).map(EndReason::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("endReasons")));
    assertThat(Arrays.stream(BounceCategory.values()).map(BounceCategory::wire).toList())
        .containsExactlyElementsOf(stringArray(contract.required("bounceCategories")));

    assertRecordMatches(contract.required("batchFields"), StatsWire.IngestBatch.class);
    assertRecordMatches(
        contract.required("playerSnapshotFields"), StatsWire.PlayerGameplaySnapshot.class);
    assertRecordMatches(contract.required("serverSnapshotFields"), StatsWire.ServerSnapshot.class);
    assertRecordMatches(
        contract.required("onlinePlayerFields"), StatsWire.OnlinePlayerSummary.class);
    assertRecordMatches(
        contract.required("townSummaryFields"), StatsWire.TownSummarySnapshot.class);

    var eventFields = contract.required("eventFields");
    assertRecordMatches(
        eventFields.required("session_started"), StatsWire.SessionStartedEvent.class);
    assertRecordMatches(
        eventFields.required("session_interval"), StatsWire.SessionIntervalEvent.class);
    assertRecordMatches(eventFields.required("session_ended"), StatsWire.SessionEndedEvent.class);
    assertRecordMatches(eventFields.required("combat_event"), StatsWire.CombatWireEvent.class);
    assertRecordMatches(
        eventFields.required("connection_bounce"), StatsWire.ConnectionBounceEvent.class);
  }

  @Test
  void serializedJsonPayloadsPreserveExactKeysIncludingNulls() {
    var contract = readContract();
    var id = UUID.fromString("11111111-2222-4333-8444-555555555555").toString();
    var ts = "2026-11-22T19:00:00Z";

    var started =
        new StatsWire.SessionStartedEvent(
            "session_started", id, ts, id, id, "Alice", ts, "java", "26.3", null, null, null, null);
    var interval =
        new StatsWire.SessionIntervalEvent(
            "session_interval",
            id,
            ts,
            ts,
            id,
            id,
            "Alice",
            "world",
            "survival",
            60_000L,
            45_000L,
            null);
    var ended =
        new StatsWire.SessionEndedEvent(
            "session_ended",
            id,
            ts,
            id,
            id,
            "Alice",
            ts,
            60_000L,
            45_000L,
            "disconnect",
            null,
            null,
            null);
    var combat =
        new StatsWire.CombatWireEvent(
            "combat_event",
            id,
            ts,
            id,
            "pvp",
            id,
            "Alice",
            id,
            "Bob",
            null,
            "DIAMOND_SWORD",
            "world");
    var bounce =
        new StatsWire.ConnectionBounceEvent(
            "connection_bounce", id, ts, id, "Alice", "maintenance", "Server restarting", null);

    var eventTypes =
        List.of(started.type(), interval.type(), ended.type(), combat.type(), bounce.type());
    assertThat(eventTypes).containsExactlyElementsOf(stringArray(contract.required("eventTypes")));

    var eventFields = contract.required("eventFields");
    assertJsonKeysMatch(eventFields.required("session_started"), started);
    assertJsonKeysMatch(eventFields.required("session_interval"), interval);
    assertJsonKeysMatch(eventFields.required("session_ended"), ended);
    assertJsonKeysMatch(eventFields.required("combat_event"), combat);
    assertJsonKeysMatch(eventFields.required("connection_bounce"), bounce);

    var playerSnapshot =
        new StatsWire.PlayerGameplaySnapshot(
            id,
            "Alice",
            ts,
            null,
            "default",
            500L,
            null,
            null,
            0,
            12,
            "mining",
            12,
            Map.of("mining", 12),
            Map.of("governor", 1),
            3,
            Map.of("colosseum", 15),
            4,
            2,
            2,
            8,
            5);
    assertJsonKeysMatch(contract.required("playerSnapshotFields"), playerSnapshot);

    var onlinePlayer =
        new StatsWire.OnlinePlayerSummary(id, "Alice", "survival", "world", false, 32, ts);
    var townSummary = new StatsWire.TownSummarySnapshot("Spawn", 4, 16, "player");
    var serverSnapshot =
        new StatsWire.ServerSnapshot(ts, List.of(onlinePlayer), 100, 1, List.of(townSummary));
    assertJsonKeysMatch(contract.required("onlinePlayerFields"), onlinePlayer);
    assertJsonKeysMatch(contract.required("townSummaryFields"), townSummary);
    assertJsonKeysMatch(contract.required("serverSnapshotFields"), serverSnapshot);

    var batch =
        new StatsWire.IngestBatch(
            1,
            id,
            "The Storm",
            ts,
            List.of(started, interval, ended, combat, bounce),
            List.of(playerSnapshot),
            serverSnapshot);
    assertJsonKeysMatch(contract.required("batchFields"), batch);
  }

  private static JsonNode readContract() {
    try {
      return JSON.readTree(Files.readString(resolveContractPath()));
    } catch (IOException e) {
      throw new AssertionError("Failed to read ingest-v1.json", e);
    }
  }

  private static Path resolveContractPath() {
    var candidates =
        List.of(
            Path.of("../../../../storm-stats/contracts/ingest-v1.json"),
            Path.of("../../../../../storm-stats/contracts/ingest-v1.json"),
            Path.of("packages/storm-stats/contracts/ingest-v1.json"));
    for (var candidate : candidates) {
      if (Files.isRegularFile(candidate)) {
        return candidate.normalize();
      }
    }
    var current = Path.of("").toAbsolutePath();
    while (current != null) {
      var fromPackages = current.resolve("packages/storm-stats/contracts/ingest-v1.json");
      if (Files.isRegularFile(fromPackages)) {
        return fromPackages;
      }
      var sibling = current.resolve("storm-stats/contracts/ingest-v1.json");
      if (Files.isRegularFile(sibling)) {
        return sibling;
      }
      current = current.getParent();
    }
    throw new AssertionError("Could not locate packages/storm-stats/contracts/ingest-v1.json");
  }

  private static void assertRecordMatches(JsonNode expectedNode, Class<? extends Record> type) {
    var actual = Arrays.stream(type.getRecordComponents()).map(RecordComponent::getName).toList();
    assertThat(actual).containsExactlyElementsOf(stringArray(expectedNode));
  }

  private static void assertJsonKeysMatch(JsonNode expectedNode, Object instance) {
    var tree = JSON.readTree(JSON.writeValueAsString(instance));
    var keys = new ArrayList<String>();
    tree.propertyNames().forEach(keys::add);
    assertThat(keys).containsExactlyInAnyOrderElementsOf(stringArray(expectedNode));
  }

  private static List<String> stringArray(JsonNode arrayNode) {
    return arrayNode.valueStream().map(JsonNode::asString).toList();
  }
}
