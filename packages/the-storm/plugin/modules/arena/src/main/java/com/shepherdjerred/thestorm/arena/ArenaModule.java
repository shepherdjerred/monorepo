package com.shepherdjerred.thestorm.arena;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the arena module. Scaffolded; not implemented yet. */
public final class ArenaModule implements StormModule {

  @Override
  public String id() {
    return "arena";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
