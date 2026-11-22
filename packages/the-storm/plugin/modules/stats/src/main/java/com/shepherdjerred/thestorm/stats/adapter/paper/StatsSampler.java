package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.towns.NamedTown;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * Periodic main-thread sampler advancing open session intervals and assembling {@link
 * StatsWire.ServerSnapshot} and {@link StatsWire.PlayerGameplaySnapshot}s asynchronously.
 */
public final class StatsSampler {

  private static final int TOWN_PAGE_SIZE = 25;
  private static final int MAX_TOWN_PAGES = 4;
  private static final int MAX_ONLINE_SUMMARY = 256;

  private final Server server;
  private final StatsService service;
  private final StatsPaperPorts ports;
  private final PlayerStateReader stateReader;
  private final InstantSource time;
  private final Logger logger;

  public record Context(
      Server server, StatsService service, StatsPaperPorts ports, PlayerStateReader stateReader) {}

  public StatsSampler(Context context, InstantSource time, Logger logger) {
    this.server = context.server();
    this.service = context.service();
    this.ports = context.ports();
    this.stateReader = context.stateReader();
    this.time = time;
    this.logger = logger;
  }

  /** Runs on Paper's main thread every {@code snapshotIntervalSeconds}. */
  public void sample() {
    var capturedAt = Instant.ofEpochMilli(time.instant().toEpochMilli());
    var townsData = readTownsOnMainThread();
    var onlinePlayers = new ArrayList<StatsWire.OnlinePlayerSummary>();
    var captures = new ArrayList<MainThreadPlayerCapture>();

    for (var player : server.getOnlinePlayers()) {
      if (!Humans.isHuman(player)) {
        continue;
      }
      var state = stateReader.sample(player);
      service.checkpointPlayer(player.getUniqueId(), state);
      if (!PlayerVisibility.hidden(player) && onlinePlayers.size() < MAX_ONLINE_SUMMARY) {
        var startedAt = service.sessionStartedAt(player.getUniqueId()).orElse(capturedAt);
        onlinePlayers.add(
            new StatsWire.OnlinePlayerSummary(
                player.getUniqueId().toString(),
                CombatClassifier.boundName(player.getName()),
                state.mode().wire(),
                state.world().wire(),
                state.afk(),
                state.pingMs(),
                startedAt.toString()));
      }
      if (captures.size() < StatsWire.MAX_PLAYER_SNAPSHOTS_PER_BATCH) {
        captures.add(captureMainThreadPlayer(player, capturedAt, townsData.namesById()));
      }
    }

    int maxPlayers = Math.clamp(server.getMaxPlayers(), 1, 1000);
    var serverSnapshot =
        new StatsWire.ServerSnapshot(
            capturedAt.toString(),
            onlinePlayers,
            maxPlayers,
            townsData.totalTowns(),
            townsData.summaries());

    if (captures.isEmpty()) {
      service.bufferSnapshots(serverSnapshot, List.of());
      return;
    }

    var futures = captures.stream().map(this::enrichOffThread).toList();
    var _ =
        CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
            .whenComplete((done, failure) -> {
              if (failure != null) {
                logger.warn("Gameplay snapshot enrichment encountered an error", failure);
              }
              var completed =
                  futures.stream()
                      .filter(f -> f.isDone() && !f.isCompletedExceptionally())
                      .map(f -> f.getNow(null))
                      .filter(java.util.Objects::nonNull)
                      .toList();
              service.bufferSnapshots(serverSnapshot, completed);
            });
  }

  /** Captures and buffers a final gameplay snapshot for a disconnecting human player. */
  public void samplePlayer(Player player) {
    if (!Humans.isHuman(player)) {
      return;
    }
    var capturedAt = Instant.ofEpochMilli(time.instant().toEpochMilli());
    var townNamesById =
        ports.townMembership().flatMap(m -> m.townIdOf(player.getUniqueId())).isPresent()
            ? readTownsOnMainThread().namesById()
            : Map.<UUID, String>of();
    var capture = captureMainThreadPlayer(player, capturedAt, townNamesById);
    var _ =
        enrichOffThread(capture)
            .whenComplete((snapshot, failure) -> {
              if (failure != null) {
                logger.warn(
                    "Gameplay snapshot enrichment encountered an error for {}",
                    capture.playerUuid(),
                    failure);
                return;
              }
              if (snapshot != null) {
                service.bufferPlayerSnapshot(snapshot);
              }
            });
  }

  private TownsCapture readTownsOnMainThread() {
    if (ports.townRead().isEmpty()) {
      return new TownsCapture(0, List.of(), Map.of());
    }
    var townRead = ports.townRead().orElseThrow();
    var summaries = new ArrayList<StatsWire.TownSummarySnapshot>();
    var namesById = new HashMap<UUID, String>();
    int total = 0;
    for (int page = 1; page <= MAX_TOWN_PAGES; page++) {
      var listing = townRead.page(page, TOWN_PAGE_SIZE);
      total = listing.total();
      if (listing.towns().isEmpty()) {
        break;
      }
      for (var summary : listing.towns()) {
        summaries.add(toTownWire(summary));
        ports
            .townDirectory()
            .flatMap(dir -> dir.named(summary.name()))
            .map(NamedTown::id)
            .ifPresent(id -> namesById.put(id, summary.name()));
      }
      if (summaries.size() >= total) {
        break;
      }
    }
    return new TownsCapture(Math.max(0, total), List.copyOf(summaries), Map.copyOf(namesById));
  }

  private static StatsWire.TownSummarySnapshot toTownWire(TownRead.TownSummary summary) {
    var name = summary.name().strip();
    if (name.isEmpty()) {
      name = "Unknown";
    } else if (name.length() > 80) {
      name = name.substring(0, 80);
    }
    Object rawKind = summary.kind();
    var kind = String.valueOf(rawKind).toLowerCase(Locale.ROOT);
    if (kind.isEmpty()) {
      kind = "player";
    } else if (kind.length() > 40) {
      kind = kind.substring(0, 40);
    }
    return new StatsWire.TownSummarySnapshot(
        name, Math.max(0, summary.members()), Math.max(0, summary.claims()), kind);
  }

  private MainThreadPlayerCapture captureMainThreadPlayer(
      Player player, Instant capturedAt, Map<UUID, String> townNamesById) {
    var uuid = player.getUniqueId();
    int townClaims =
        ports
            .townRead()
            .map(read -> read.claims(uuid))
            .filter(OptionalInt::isPresent)
            .map(OptionalInt::getAsInt)
            .orElse(0);
    var townId = ports.townMembership().flatMap(m -> m.townIdOf(uuid));
    @Nullable String townName = null;
    @Nullable String townRole = null;
    if (townId.isPresent()) {
      var resolvedName = townNamesById.get(townId.orElseThrow());
      if (resolvedName != null && !resolvedName.isBlank()) {
        townName = resolvedName.length() > 80 ? resolvedName.substring(0, 80) : resolvedName;
        townRole = resolveTownRole(uuid, townId.orElseThrow());
      }
    }
    var tracks = new LinkedHashMap<String, Integer>();
    ports
        .trackLevels()
        .ifPresent(levels -> {
          if (levels.isLoaded(uuid)) {
            for (var track : Track.values()) {
              tracks.put(track.id(), Math.max(0, levels.level(player, track)));
            }
          }
        });
    int questsCompleted =
        ports
            .questCompletions()
            .map(q -> q.counted(uuid))
            .filter(OptionalInt::isPresent)
            .map(count -> Math.max(0, count.getAsInt()))
            .orElse(0);
    return new MainThreadPlayerCapture(
        uuid,
        CombatClassifier.boundName(player.getName()),
        capturedAt,
        stateReader.nickname(player),
        stateReader.primaryGroup(player),
        townName,
        townRole,
        Math.max(0, townClaims),
        Map.copyOf(tracks),
        questsCompleted);
  }

  private String resolveTownRole(UUID playerUuid, UUID townId) {
    if (ports.townMembership().isPresent()
        && ports.townMembership().orElseThrow() instanceof TownsState state
        && state.manages(playerUuid, townId)) {
      return "officer";
    }
    return "member";
  }

  private CompletableFuture<StatsWire.PlayerGameplaySnapshot> enrichOffThread(
      MainThreadPlayerCapture base) {
    var coinsFuture = readCoins(base.playerUuid());
    var skillsFuture = readSkills(base.playerUuid());
    var wavesFuture = readArenaWaves(base.playerUuid());
    var rwfFuture = readRwfTotals(base.playerUuid());

    return coinsFuture
        .thenCombine(skillsFuture, CoinsAndSkills::new)
        .thenCombine(
            wavesFuture, (cs, waves) -> new EnrichedProgress(cs.coins(), cs.skills(), waves))
        .thenCombine(rwfFuture, (progress, rwf) -> buildPlayerSnapshot(base, progress, rwf));
  }

  private CompletableFuture<Long> readCoins(UUID playerUuid) {
    if (ports.wallets().isEmpty()) {
      return CompletableFuture.completedFuture(0L);
    }
    return ports
        .wallets()
        .orElseThrow()
        .balance(new AccountId.Player(playerUuid), CurrencyId.CRYSTALS)
        .thenApply(Money::amount);
  }

  private CompletableFuture<SkillSnapshot> readSkills(UUID playerUuid) {
    if (ports.skillLevels().isEmpty()) {
      return CompletableFuture.completedFuture(SkillSnapshot.EMPTY);
    }
    return ports
        .skillLevels()
        .orElseThrow()
        .progress(playerUuid)
        .thenApply(StatsSampler::toSkillSnapshot);
  }

  private static SkillSnapshot toSkillSnapshot(SkillProgress progress) {
    var levels = progress.levels();
    var topEntry =
        levels.entrySet().stream()
            .filter(entry -> entry.getValue() > 0)
            .max(
                Map.Entry.<String, Integer>comparingByValue()
                    .thenComparing(Map.Entry.comparingByKey()));
    return new SkillSnapshot(
        Math.max(0, progress.powerLevel()),
        topEntry.map(Map.Entry::getKey).orElse(null),
        topEntry.map(Map.Entry::getValue).orElse(0),
        levels);
  }

  private CompletableFuture<Map<String, Integer>> readArenaWaves(UUID playerUuid) {
    if (ports.arenaCatalog().isEmpty() || ports.arenaRecords().isEmpty()) {
      return CompletableFuture.completedFuture(Map.of());
    }
    var records = ports.arenaRecords().orElseThrow();
    CompletableFuture<Map<String, Integer>> acc =
        CompletableFuture.completedFuture(new LinkedHashMap<>());
    for (var arenaId : ports.arenaCatalog().orElseThrow().ids()) {
      var waveFuture = records.bestWave(playerUuid, arenaId);
      acc =
          acc.thenCombine(
              waveFuture,
              (map, wave) -> {
                if (wave.isPresent() && wave.getAsInt() > 0) {
                  map.put(arenaId, wave.getAsInt());
                }
                return map;
              });
    }
    return acc.thenApply(Map::copyOf);
  }

  private CompletableFuture<Optional<StatsStore.Totals>> readRwfTotals(UUID playerUuid) {
    if (ports.rwfStats().isEmpty()) {
      return CompletableFuture.completedFuture(Optional.empty());
    }
    return ports.rwfStats().orElseThrow().totals(playerUuid);
  }

  private static StatsWire.PlayerGameplaySnapshot buildPlayerSnapshot(
      MainThreadPlayerCapture base,
      EnrichedProgress progress,
      Optional<StatsStore.Totals> rwfTotals) {
    int rwfMatches = rwfTotals.map(t -> Math.max(0, t.matches())).orElse(0);
    int rwfWins = rwfTotals.map(t -> Math.max(0, t.wins())).orElse(0);
    int rwfLosses = rwfTotals.map(t -> Math.max(0, t.losses())).orElse(0);
    int rwfKills = rwfTotals.map(t -> Math.max(0, t.kills())).orElse(0);
    int rwfDeaths = rwfTotals.map(t -> Math.max(0, t.deaths())).orElse(0);
    long clampedCoins = Math.clamp(progress.coins(), 0L, 9_000_000_000_000_000L);

    return new StatsWire.PlayerGameplaySnapshot(
        base.playerUuid().toString(),
        base.playerName(),
        base.capturedAt().toString(),
        base.nickname(),
        base.primaryGroup(),
        clampedCoins,
        base.townName(),
        base.townRole(),
        base.townClaims(),
        progress.skills().powerLevel(),
        progress.skills().topSkill(),
        progress.skills().topSkillLevel(),
        progress.skills().levels(),
        base.tracks(),
        base.questsCompleted(),
        progress.arenaWaves(),
        rwfMatches,
        rwfWins,
        rwfLosses,
        rwfKills,
        rwfDeaths);
  }

  private record TownsCapture(
      int totalTowns, List<StatsWire.TownSummarySnapshot> summaries, Map<UUID, String> namesById) {}

  private record MainThreadPlayerCapture(
      UUID playerUuid,
      String playerName,
      Instant capturedAt,
      @Nullable String nickname,
      String primaryGroup,
      @Nullable String townName,
      @Nullable String townRole,
      int townClaims,
      Map<String, Integer> tracks,
      int questsCompleted) {}

  private record SkillSnapshot(
      int powerLevel, @Nullable String topSkill, int topSkillLevel, Map<String, Integer> levels) {
    static final SkillSnapshot EMPTY = new SkillSnapshot(0, null, 0, Map.of());
  }

  private record CoinsAndSkills(long coins, SkillSnapshot skills) {}

  private record EnrichedProgress(
      long coins, SkillSnapshot skills, Map<String, Integer> arenaWaves) {}
}
