package com.shepherdjerred.thestorm.essentials;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the essentials module. Scaffolded; not implemented yet. */
public final class EssentialsModule implements StormModule {

  @Override
  public String id() {
    return "essentials";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
