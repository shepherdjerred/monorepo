package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import java.util.List;
import java.util.UUID;

/**
 * A player's chat, ready to classify.
 *
 * @param player who wrote it
 * @param playerName their name, for prompts
 * @param lines the suspicious line and its context, newest first
 */
public record ClassifyCase(UUID player, String playerName, List<ChatSample> lines) {}
