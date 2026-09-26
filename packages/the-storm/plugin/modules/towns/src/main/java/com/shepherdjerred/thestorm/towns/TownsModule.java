package com.shepherdjerred.thestorm.towns;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the towns module. Scaffolded; not implemented yet. */
public final class TownsModule implements StormModule {

  @Override
  public String id() {
    return "towns";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
