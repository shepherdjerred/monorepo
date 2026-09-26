package com.shepherdjerred.thestorm.quests;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the quests module. Scaffolded; not implemented yet. */
public final class QuestsModule implements StormModule {

  @Override
  public String id() {
    return "quests";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
