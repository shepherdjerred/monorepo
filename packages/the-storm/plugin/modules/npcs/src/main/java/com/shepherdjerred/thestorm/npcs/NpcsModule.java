package com.shepherdjerred.thestorm.npcs;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the npcs module. Scaffolded; not implemented yet. */
public final class NpcsModule implements StormModule {

  @Override
  public String id() {
    return "npcs";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
