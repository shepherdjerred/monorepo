package com.shepherdjerred.thestorm.mechanics;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.adapter.paper.MechanicsPaper;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;

/**
 * The Mechanic track's mechanisms, replacing CraftBook: sign elevators, bridges, gates, doors,
 * switches, cooking pots, the sign copier, the painting switcher and special pistons. Each is gated
 * by a Mechanic track level and respects land protection, which the towns module provides.
 */
public final class MechanicsModule implements StormModule {

  @Override
  public String id() {
    return "mechanics";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("mechanics.yml", MechanicsConfig.class);
    var protection = context.services().require(Protection.class);
    MechanicsPaper.install(context, config, protection);
  }
}
