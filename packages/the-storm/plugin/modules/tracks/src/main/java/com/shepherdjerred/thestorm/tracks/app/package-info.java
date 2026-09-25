/**
 * The tracks' public ports and use cases. A player's level in each track is also granted as
 * permissions ({@link Track#permission(int)}), so most modules gate features with a plain
 * permission check; {@link TrackLevels} answers from memory for online players, and {@link
 * TrackPurchases} lets trainer NPCs sell levels.
 */
@NullMarked
package com.shepherdjerred.thestorm.tracks.app;

import org.jspecify.annotations.NullMarked;
