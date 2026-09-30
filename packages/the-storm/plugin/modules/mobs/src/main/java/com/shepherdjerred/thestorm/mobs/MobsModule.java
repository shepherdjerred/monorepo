package com.shepherdjerred.thestorm.mobs;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the mobs module. Scaffolded; not implemented yet. */
public final class MobsModule implements StormModule {

  @Override
  public String id() {
    return "mobs";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
