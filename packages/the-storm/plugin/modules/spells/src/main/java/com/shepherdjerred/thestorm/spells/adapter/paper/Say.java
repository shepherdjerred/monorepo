package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.CastProblem;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

/** Messages in the house style, under the module's configured label. */
public final class Say {

  private final String label;

  public Say(String label) {
    this.label = label;
  }

  public void info(Audience to, String message) {
    to.sendMessage(HouseStyle.info(label, Component.text(message)));
  }

  public void success(Audience to, String message) {
    to.sendMessage(HouseStyle.success(label, Component.text(message)));
  }

  public void error(Audience to, String message) {
    to.sendMessage(HouseStyle.error(label, Component.text(message)));
  }

  /** Tells {@code to} why a cast or bind was refused. */
  public void problem(Audience to, CastProblem problem) {
    switch (problem) {
      case CastProblem.Refused(var refusal) -> refusal(to, refusal);
      case CastProblem.Protected(var reason) -> to.sendMessage(HouseStyle.error(label, reason));
    }
  }

  /** Cooldowns go to the action bar, where they do not flood chat; everything else to chat. */
  public void refusal(Audience to, Refusal refusal) {
    var text = RefusalText.describe(refusal);
    if (refusal instanceof Refusal.OnCooldown) {
      to.sendActionBar(Component.text(text, HouseStyle.BRAND));
    } else {
      error(to, text);
    }
  }
}
