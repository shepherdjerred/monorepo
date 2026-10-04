package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;

/** Red Warfare Search and Destroy. */
public final class RwfModule implements StormModule {

  @Override
  public String id() {
    return "rwf";
  }

  @Override
  public void enable(ModuleContext context) {
    context.logger().info("rwf: scaffold only, no match runner yet");
  }
}
