package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.UUID;

/**
 * A grave chest. The items sit in the chest block; this row is who owns it and when it spills, so
 * an unloaded chunk does not forget the grave.
 */
public record StoredGrave(
    UUID id, UUID owner, String world, int x, int y, int z, Instant expires) {}
