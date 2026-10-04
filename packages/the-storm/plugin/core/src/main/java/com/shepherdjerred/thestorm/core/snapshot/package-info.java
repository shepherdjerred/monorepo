/**
 * Crash-safe snapshots of a player's belongings: what a player carried before joining an arena or a
 * match, stored before anything is cleared and restored exactly afterwards, even across a restart.
 * Each module keeps its own snapshot table behind {@link
 * com.shepherdjerred.thestorm.core.snapshot.SnapshotStore} and drives the lifecycle through {@link
 * com.shepherdjerred.thestorm.core.snapshot.SnapshotKeeper}.
 */
@NullMarked
package com.shepherdjerred.thestorm.core.snapshot;

import org.jspecify.annotations.NullMarked;
