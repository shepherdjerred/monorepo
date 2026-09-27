package com.shepherdjerred.thestorm.skills;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the skills module. Scaffolded; not implemented yet. */
public final class SkillsModule implements StormModule {

  @Override
  public String id() {
    return "skills";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
