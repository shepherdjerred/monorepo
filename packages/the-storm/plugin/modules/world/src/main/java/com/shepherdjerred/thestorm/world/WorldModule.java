package com.shepherdjerred.thestorm.world;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the world module. Scaffolded; not implemented yet. */
public final class WorldModule implements StormModule {

  @Override
  public String id() {
    return "world";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
