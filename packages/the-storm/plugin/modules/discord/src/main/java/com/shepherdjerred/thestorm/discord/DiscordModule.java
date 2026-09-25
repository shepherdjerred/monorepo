package com.shepherdjerred.thestorm.discord;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the discord module. Scaffolded; not implemented yet. */
public final class DiscordModule implements StormModule {

  @Override
  public String id() {
    return "discord";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
