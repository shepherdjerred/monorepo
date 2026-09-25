package com.shepherdjerred.thestorm.qol;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the qol module. Scaffolded; not implemented yet. */
public final class QolModule implements StormModule {

  @Override
  public String id() {
    return "qol";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
