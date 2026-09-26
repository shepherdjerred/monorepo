package com.shepherdjerred.thestorm.shards;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the shards module. Scaffolded; not implemented yet. */
public final class ShardsModule implements StormModule {

  @Override
  public String id() {
    return "shards";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
