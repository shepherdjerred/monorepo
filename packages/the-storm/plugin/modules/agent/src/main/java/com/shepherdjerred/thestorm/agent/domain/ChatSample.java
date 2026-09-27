package com.shepherdjerred.thestorm.agent.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * One chat line as the agent's pure logic sees it. Adapters map platform lines onto this; the
 * domain never imports another module's types.
 *
 * @param player who wrote it
 * @param playerName their name at the time, for brain prompts
 * @param text the cleaned, plain message
 * @param at when it was sent
 */
public record ChatSample(UUID player, String playerName, String text, Instant at) {}
