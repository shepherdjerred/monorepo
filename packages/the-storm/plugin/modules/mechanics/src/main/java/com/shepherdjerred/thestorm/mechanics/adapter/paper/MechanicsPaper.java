package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.app.Gatekeeper;
import com.shepherdjerred.thestorm.mechanics.app.SignCreation;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.creation.CreationRules;

/** Wires the mechanics' listeners into Paper. */
public final class MechanicsPaper {

  private MechanicsPaper() {}

  public static void install(ModuleContext context, MechanicsConfig config, Protection protection) {
    Materials.verify(config);
    var plugin = context.plugin();
    var gatekeeper = new Gatekeeper(config);
    var signs = new Signs(plugin);
    var kit = new Kit(config, gatekeeper, signs, new Guard(protection), context.scheduler());
    var structures = new Structures(kit);
    var copier = new SignCopier(kit);
    var handlers =
        new SignClickListener.Handlers(
            new Elevators(kit), structures, new CookingPots(kit), new LightSwitches(kit));
    var creation = new SignCreation(gatekeeper, CreationRules.standard(config));
    var events = plugin.getServer().getPluginManager();
    events.registerEvents(new SignWriteListener(creation, signs, protection), plugin);
    events.registerEvents(new SignClickListener(kit, copier, handlers), plugin);
    events.registerEvents(copier, plugin);
    events.registerEvents(new HiddenSwitchListener(kit), plugin);
    events.registerEvents(new RedstoneListener(kit, structures), plugin);
    events.registerEvents(new PistonListener(kit), plugin);
    events.registerEvents(new DropListener(kit), plugin);
    events.registerEvents(new PaintingListener(kit), plugin);
  }
}
