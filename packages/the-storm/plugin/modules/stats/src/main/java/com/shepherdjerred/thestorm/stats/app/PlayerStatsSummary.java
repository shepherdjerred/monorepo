package com.shepherdjerred.thestorm.stats.app;

import java.time.Instant;
import java.util.UUID;

/** Durable per-player summary stored locally in SQLite for {@code /stats <player>}. */
public record PlayerStatsSummary(
    UUID playerUuid,
    String playerName,
    Instant firstSeenAt,
    Instant lastSeenAt,
    long connectedMs,
    long activeMs,
    int sessionsCount,
    int pvpKills,
    int pvpDeaths,
    int mobKills) {}
