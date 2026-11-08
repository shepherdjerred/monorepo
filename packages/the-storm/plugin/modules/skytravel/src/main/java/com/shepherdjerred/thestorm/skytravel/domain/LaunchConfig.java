package com.shepherdjerred.thestorm.skytravel.domain;

import java.util.HashSet;
import java.util.List;

/** Shared tower catalog. Only commissioned towers become public controls or map markers. */
public record LaunchConfig(
    String world,
    int apex,
    int assistanceSeconds,
    int descentSeconds,
    int countdownSeconds,
    int cooldownSeconds,
    List<Tower> towers) {
  public LaunchConfig {
    if (!world.matches("[a-z0-9_]+")
        || apex < 350
        || apex > 512
        || assistanceSeconds < 30
        || assistanceSeconds > 180
        || descentSeconds < 1
        || descentSeconds > 30
        || countdownSeconds < 1
        || countdownSeconds > 5
        || cooldownSeconds < 15
        || cooldownSeconds > assistanceSeconds)
      throw new IllegalArgumentException("Invalid Skylands launch bounds");
    towers = List.copyOf(towers);
    var ids = new HashSet<String>();
    var controls = new HashSet<Block>();
    for (var tower : towers) {
      if (!ids.add(tower.id()) || !controls.add(tower.button()))
        throw new IllegalArgumentException("Duplicate launch tower or button");
    }
  }

  public record Block(int x, int y, int z) {}

  public record Tower(
      String id, boolean commissioned, Block base, Block pad, Block button, List<Block> entrances) {
    public Tower {
      if (!id.matches("H|I[1-6]|O([1-9]|1[0-2])")
          || base.y() < -48
          || base.y() > 280
          || pad.y() <= base.y()
          || pad.y() >= 319
          || entrances.isEmpty()
          || Math.hypot(base.x(), base.z()) > 2900
          || Math.abs(button.x() - pad.x()) > 4
          || Math.abs(button.z() - pad.z()) > 4
          || Math.abs(button.y() - pad.y()) > 2)
        throw new IllegalArgumentException("Invalid launch tower " + id);
      entrances = List.copyOf(entrances);
    }

    /** Standing within the three by three launch pad, rather than beside its button. */
    public boolean onPad(double x, double y, double z) {
      return x >= pad.x() - 1
          && x < pad.x() + 2
          && z >= pad.z() - 1
          && z < pad.z() + 2
          && y >= pad.y()
          && y < pad.y() + 0.75;
    }
  }
}
