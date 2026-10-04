package com.shepherdjerred.thestorm.rwfbots;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Bot combatants for Red Warfare Search and Destroy. */
public final class RwfBotsModule implements StormModule {

  @Override
  public String id() {
    return "rwfbots";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("rwfbots: scaffold only, no bot roster yet");
  }
}
