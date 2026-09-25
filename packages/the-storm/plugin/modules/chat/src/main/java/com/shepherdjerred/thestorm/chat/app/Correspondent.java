package com.shepherdjerred.thestorm.chat.app;

import java.util.UUID;

/**
 * The other side of a private conversation.
 *
 * @param id the player
 * @param name their name when the message was sent
 */
public record Correspondent(UUID id, String name) {}
