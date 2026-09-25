package com.shepherdjerred.thestorm.messages.adapter.paper;

import java.util.List;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.ParsingException;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;

/**
 * Parses config text as MiniMessage once, at enable, so broken markup stops the module. Strict mode
 * rejects unclosed tags; a misspelled tag such as {@code <gren>} would otherwise render as literal
 * text, so any tag-shaped text left after parsing is rejected as well.
 */
public final class MiniText {

  private static final MiniMessage STRICT = MiniMessage.builder().strict(true).build();

  /** Anything that looks like a MiniMessage tag, such as {@code <gren>} or {@code </#4DCCC4>}. */
  private static final Pattern TAG = Pattern.compile("</?[#!?a-zA-Z_][^<>]*>");

  private MiniText() {}

  /** Parses {@code text}; {@code where} names it in the error. */
  public static Component parse(String text, String where) {
    Component component;
    try {
      component = STRICT.deserialize(text);
    } catch (ParsingException e) {
      throw new IllegalStateException("messages.yml " + where + " is not valid MiniMessage", e);
    }
    var unrecognized = TAG.matcher(PlainTextComponentSerializer.plainText().serialize(component));
    if (unrecognized.find()) {
      throw new IllegalStateException(
          "messages.yml "
              + where
              + " has an unrecognized MiniMessage tag "
              + unrecognized.group()
              + ": "
              + text);
    }
    return component;
  }

  /** Parses every entry of {@code texts}. */
  public static List<Component> parseAll(List<String> texts, String where) {
    return texts.stream().map(text -> parse(text, where)).toList();
  }
}
