package com.shepherdjerred.thestorm.shops;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the shops module. Scaffolded; not implemented yet. */
public final class ShopsModule implements StormModule {

  @Override
  public String id() {
    return "shops";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
