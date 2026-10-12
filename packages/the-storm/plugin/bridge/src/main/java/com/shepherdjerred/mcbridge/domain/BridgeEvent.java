package com.shepherdjerred.mcbridge.domain;

import java.time.Instant;
import org.jspecify.annotations.Nullable;

/**
 * One captured server event.
 *
 * @param seq monotonically increasing sequence number, starting at 1
 * @param ts when it was captured
 * @param type the event kind
 * @param player the player involved, if any
 * @param text plain text (chat message, command line, death message or log line)
 */
public record BridgeEvent(
    long seq, Instant ts, EventType type, @Nullable String player, String text) {}
