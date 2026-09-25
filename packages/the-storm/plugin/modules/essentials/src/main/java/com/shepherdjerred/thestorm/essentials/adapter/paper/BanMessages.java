package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Ban;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import java.time.Instant;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;

/** The screens a kicked or banned player sees. */
final class BanMessages {

  private BanMessages() {}

  static Component kicked(String reason) {
    return title("You were kicked from The Storm")
        .append(Component.newline())
        .append(line("Reason: ", reason));
  }

  static Component banned(Ban ban, Instant now) {
    var ends = ban.remaining(now).map(left -> "in " + DurationText.format(left)).orElse("never");
    return title("You are banned from The Storm")
        .append(Component.newline())
        .append(line("Reason: ", ban.reason()))
        .append(Component.newline())
        .append(line("Ends: ", ends));
  }

  private static Component title(String text) {
    return Component.text(text, HouseStyle.BRAND).append(Component.newline());
  }

  private static Component line(String label, String value) {
    return Component.text(label, NamedTextColor.GRAY)
        .append(Component.text(value, NamedTextColor.WHITE));
  }
}
