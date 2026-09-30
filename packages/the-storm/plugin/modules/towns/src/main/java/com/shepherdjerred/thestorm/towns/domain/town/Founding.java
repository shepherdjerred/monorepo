package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Instant;
import java.util.UUID;

/**
 * A player asking to found a town.
 *
 * @param founder who asks; they become its owner
 * @param name the name they chose
 * @param id the new town's id
 * @param at when
 * @param governorLevel the founder's Governor level now
 */
public record Founding(UUID founder, String name, UUID id, Instant at, int governorLevel) {}
