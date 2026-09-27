package com.shepherdjerred.thestorm.chat;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the chat module. Scaffolded; not implemented yet. */
public final class ChatModule implements StormModule {

  @Override
  public String id() {
    return "chat";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
