package com.shepherdjerred.thestorm.tracks;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the tracks module. Scaffolded; not implemented yet. */
public final class TracksModule implements StormModule {

  @Override
  public String id() {
    return "tracks";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
