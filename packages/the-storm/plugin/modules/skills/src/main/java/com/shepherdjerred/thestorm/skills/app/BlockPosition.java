package com.shepherdjerred.thestorm.skills.app;

import java.util.UUID;

/** A block's identity, including the world UUID across mining-world resets. */
public record BlockPosition(UUID world, int x, int y, int z) {}
