package com.shepherdjerred.thestorm.qol;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqGraveStore;
import com.shepherdjerred.thestorm.qol.adapter.paper.QolPaper;
import com.shepherdjerred.thestorm.qol.app.CombatStatus;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import org.jspecify.annotations.Nullable;

/**
 * Graves, combat tags, the sleep vote and chest sorting: The Storm's replacement for GravesX,
 * CombatLog, Sleeper and ChestSort. Needs essentials (teleport guards, AFK status) and land
 * protection from the towns module, both enabled first. Publishes {@link CombatStatus}.
 */
public final class QolModule implements StormModule {

  private @Nullable QolPaper paper;

  @Override
  public String id() {
    return "qol";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("qol.yml", QolConfig.class);
    context.database().migrate(id(), getClass().getClassLoader());
    var services = context.services();
    var combat = new CombatTracker(context.time(), config.combat().tagFor());
    var app =
        new QolPaper.App(
            new JooqGraveStore(context.database()),
            new GraveRegistry(),
            combat,
            services.require(Protection.class),
            services.require(TeleportGuards.class),
            services.require(AfkStatus.class));
    paper = QolPaper.start(context, config, app);
    services.provide(CombatStatus.class, combat);
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
  }
}
