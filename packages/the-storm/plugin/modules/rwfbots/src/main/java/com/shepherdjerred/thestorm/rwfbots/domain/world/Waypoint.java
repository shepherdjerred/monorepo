package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** One point on a path and how to get onto it. */
public record Waypoint(Vec3 pos, Hop hop) {}
