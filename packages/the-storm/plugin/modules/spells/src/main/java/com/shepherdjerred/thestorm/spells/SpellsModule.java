package com.shepherdjerred.thestorm.spells;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the spells module. Scaffolded; not implemented yet. */
public final class SpellsModule implements StormModule {

  @Override
  public String id() {
    return "spells";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
