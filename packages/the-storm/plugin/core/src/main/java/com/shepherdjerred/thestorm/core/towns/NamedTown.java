package com.shepherdjerred.thestorm.core.towns;

import java.util.UUID;

/**
 * A town another module can trade for, without the rest of the town.
 *
 * @param id the town's id, also its treasury account
 * @param name the town's display name
 */
public record NamedTown(UUID id, String name) {}
