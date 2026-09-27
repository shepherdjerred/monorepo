package com.shepherdjerred.thestorm.chat.domain;

import java.util.UUID;

/**
 * The player sending a message.
 *
 * @param id the player
 * @param name their name
 * @param staff whether they hold the staff permission
 * @param bypassFilters whether caps and repeat limits skip them
 */
public record Speaker(UUID id, String name, boolean staff, boolean bypassFilters) {}
