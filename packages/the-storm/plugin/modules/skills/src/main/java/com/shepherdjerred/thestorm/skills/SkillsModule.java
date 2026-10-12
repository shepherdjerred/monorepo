package com.shepherdjerred.thestorm.skills;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.skills.adapter.db.JooqSkillLevels;
import com.shepherdjerred.thestorm.skills.adapter.discord.SkillDiscordPosts;
import com.shepherdjerred.thestorm.skills.adapter.paper.SkillsPaper;
import com.shepherdjerred.thestorm.skills.app.SkillLevelUp;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import java.util.function.Consumer;

/**
 * Eleven retro skills with persistent 1–1000 progression and a power-level ranking. When the
 * discord module is on, level milestones are announced there.
 */
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
    var server = context.plugin().getServer();
    Consumer<SkillLevelUp> levelUps =
        context
            .services()
            .find(DiscordRelay.class)
            .map(relay -> new SkillDiscordPosts(relay, server, context.logger()))
            .<Consumer<SkillLevelUp>>map(posts -> posts::accept)
            .orElse(levelUp -> {});
    SkillsPaper.install(context, levels, config, levelUps);
  }
}
