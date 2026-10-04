package com.shepherdjerred.thestorm.mail;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.mail.adapter.db.JooqMail;
import com.shepherdjerred.thestorm.mail.adapter.paper.MailCommands;
import com.shepherdjerred.thestorm.mail.app.Mail;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;

/** Durable mail is available before modules publish player recovery entitlements. */
public final class MailModule implements StormModule {
  @Override
  public String id() {
    return "mail";
  }

  @Override
  public void enable(ModuleContext context) {
    context.database().migrate(id(), MailModule.class.getClassLoader());
    var mail = new JooqMail(context.database());
    context.services().provide(Mail.class, mail);
    var commands = new MailCommands(context, mail);
    context.plugin().getServer().getPluginManager().registerEvents(commands, context.plugin());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
  }
}
