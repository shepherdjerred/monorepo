package com.shepherdjerred.thestorm.messages;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Entry point of the messages module. Scaffolded; not implemented yet. */
public final class MessagesModule implements StormModule {

  @Override
  public String id() {
    return "messages";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("{} module enabled (scaffold)", id());
  }
}
