package com.shepherdjerred.thestorm.qol;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqQolStore;
import com.shepherdjerred.thestorm.qol.adapter.paper.QolPaper;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;

/** Graves and random teleport far from claims. */
public final class QolModule implements StormModule {

  @Override
  public String id() {
    return "qol";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("qol.yml", QolConfig.class);
    context.database().migrate(id(), QolModule.class.getClassLoader());
    QolPaper.install(context, new JooqQolStore(context.database()), config);
    context.logger().info("{} module enabled", id());
  }
}
