package com.shepherdjerred.thestorm.economy;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the economy module. Scaffolded; not implemented yet. */
public final class EconomyModule implements StormModule {

  @Override
  public String id() {
    return "economy";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
