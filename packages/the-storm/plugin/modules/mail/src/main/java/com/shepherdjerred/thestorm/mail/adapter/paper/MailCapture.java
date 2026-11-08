package com.shepherdjerred.thestorm.mail.adapter.paper;

import com.shepherdjerred.thestorm.core.capture.CaptureInspection;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.mail.app.Mail;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import java.util.LinkedHashMap;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;

/** Module-owned documentation data, posted through the same durable API as recovery deliveries. */
public final class MailCapture {
  private MailCapture() {}

  public record Choice(String id, String material, int amount) {}

  public record Fixture(String resource, String title, List<Choice> choices) {}

  public static void install(ModuleContext context, Mail mail, Fixture fixture) {
    var options = new LinkedHashMap<String, List<MailItem>>();
    for (var choice : fixture.choices()) {
      if (choice.amount() < 1 || choice.amount() > 64 || options.containsKey(choice.id()))
        throw new IllegalArgumentException("Invalid mail capture choice");
      var item = new ItemStack(Material.valueOf(choice.material()), choice.amount());
      options.put(choice.id(), List.of(new MailItem(item.serializeAsBytes())));
    }
    context
        .services()
        .require(CaptureInspection.class)
        .registerPreparation(
            fixture.resource(),
            (player, id) -> mail.postOnce(new Mail.Message(id, player, fixture.title(), options)));
  }
}
