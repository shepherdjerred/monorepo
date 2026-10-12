package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbySizing;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.OptionalInt;

/** Main-thread session preference and the target frozen when bots are drafted. */
public final class LobbySizes {
  private final int maximum;
  private LobbySizing.Selection selection;
  private int drafted;

  public LobbySizes(boolean automatic, int fixedTarget, int maximum) {
    this.maximum = maximum;
    selection =
        new LobbySizing.Selection(
            automatic ? LobbySizing.Mode.AUTO : LobbySizing.Mode.FIXED, fixedTarget);
  }

  public LobbySizing.Selection selection() {
    return selection;
  }

  public void select(LobbySizing.Selection preference) {
    selection = preference;
  }

  public int target(MapDefinition map) {
    return selection.target(map, maximum);
  }

  public int draft(MapDefinition map, OptionalInt showcase) {
    drafted = showcase.isPresent() ? showcase.getAsInt() : target(map);
    return drafted;
  }

  public int drafted() {
    return drafted;
  }

  public void resetDraft() {
    drafted = 0;
  }
}
