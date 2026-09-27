package com.shepherdjerred.thestorm.skills;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.skills.adapter.db.JooqSkillLevels;
import com.shepherdjerred.thestorm.skills.adapter.paper.SkillsPaper;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;

/** Eleven retro skills with persistent 1–1000 progression and a power-level ranking. */
public final class SkillsModule implements StormModule {

  @Override
  public String id() {
    return "skills";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("skills.yml", SkillsConfig.class);
    context.database().migrate(id(), SkillsModule.class.getClassLoader());
    SkillLevels levels = new JooqSkillLevels(context.database());
    context.services().provide(SkillLevels.class, levels);
    SkillsPaper.install(context, levels, config);
  }
}
