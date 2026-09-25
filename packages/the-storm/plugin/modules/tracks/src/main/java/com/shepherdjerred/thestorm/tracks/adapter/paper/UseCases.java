package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.tracks.app.LevelCache;
import com.shepherdjerred.thestorm.tracks.app.PurchaseService;
import com.shepherdjerred.thestorm.tracks.app.TrackAdmin;
import com.shepherdjerred.thestorm.tracks.app.TrackSessions;

/**
 * The tracks' use cases, as the Paper adapter drives them.
 *
 * @param purchases buying levels
 * @param admin administrator changes
 * @param sessions join and quit
 * @param cache online players' levels
 */
public record UseCases(
    PurchaseService purchases, TrackAdmin admin, TrackSessions sessions, LevelCache cache) {}
