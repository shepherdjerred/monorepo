package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** An approximate, anonymous sensor reading. It permits investigation, never targeting an enemy. */
public record SensorClue(Vec3 position, double uncertainty, long tick) {
  public boolean fresh(long now) {
    return now >= tick && now - tick <= 80;
  }
}
