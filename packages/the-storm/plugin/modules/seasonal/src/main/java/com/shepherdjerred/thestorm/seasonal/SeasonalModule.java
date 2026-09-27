package com.shepherdjerred.thestorm.seasonal;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the seasonal module. Scaffolded; not implemented yet. */
public final class SeasonalModule implements StormModule {

  @Override
  public String id() {
    return "seasonal";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
