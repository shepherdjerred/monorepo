package com.shepherdjerred.thestorm.messages.adapter.paper;

import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.ParsingException;

/** Parses config text as strict MiniMessage once, at enable, so a broken tag stops the module. */
public final class MiniText {

  private static final MiniMessage STRICT = MiniMessage.builder().strict(true).build();

  private MiniText() {}

  /** Parses {@code text}; {@code where} names it in the error. */
  public static Component parse(String text, String where) {
    try {
      return STRICT.deserialize(text);
    } catch (ParsingException e) {
      throw new IllegalStateException("messages.yml " + where + " is not valid MiniMessage", e);
    }
  }

  /** Parses every entry of {@code texts}. */
  public static List<Component> parseAll(List<String> texts, String where) {
    return texts.stream().map(text -> parse(text, where)).toList();
  }
}
