package com.shepherdjerred.thestorm.mechanics;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the mechanics module. Scaffolded; not implemented yet. */
public final class MechanicsModule implements StormModule {

  @Override
  public String id() {
    return "mechanics";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
