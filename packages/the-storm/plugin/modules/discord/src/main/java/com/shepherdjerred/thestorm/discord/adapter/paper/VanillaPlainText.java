package com.shepherdjerred.thestorm.discord.adapter.paper;

import static java.nio.charset.StandardCharsets.UTF_8;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TranslatableComponent;
import net.kyori.adventure.text.flattener.ComponentFlattener;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;

/** Renders vanilla components for Discord using the running Minecraft server's English text. */
public final class VanillaPlainText {

  private static final String LANGUAGE = "assets/minecraft/lang/en_us.json";

  private final Map<String, String> translations;
  private final PlainTextComponentSerializer serializer;

  /** Loads the language bundled with the running server. A missing asset is a broken runtime. */
  public VanillaPlainText(ClassLoader serverLoader) {
    try (var stream = serverLoader.getResourceAsStream(LANGUAGE)) {
      if (stream == null) {
        throw new IllegalStateException("Minecraft server is missing " + LANGUAGE);
      }
      var parsed = JsonParser.parseReader(new InputStreamReader(stream, UTF_8)).getAsJsonObject();
      var values = new HashMap<String, String>();
      for (var entry : parsed.entrySet()) {
        values.put(entry.getKey(), entry.getValue().getAsString());
      }
      translations = Map.copyOf(values);
    } catch (IOException failure) {
      throw new UncheckedIOException("Could not read Minecraft server's English language", failure);
    }
    serializer =
        PlainTextComponentSerializer.builder()
            .flattener(
                ComponentFlattener.basic().toBuilder()
                    .mapper(TranslatableComponent.class, this::translate)
                    .build())
            .build();
  }

  public String plain(Component component) {
    return serializer.serialize(component);
  }

  private String translate(TranslatableComponent component) {
    var template = translations.get(component.key());
    if (template == null) {
      template = component.fallback();
    }
    if (template == null) {
      throw new IllegalStateException(
          "Minecraft has no English translation for " + component.key());
    }
    var args =
        component.arguments().stream()
            .map(
                argument ->
                    argument.value() instanceof Component nested ? plain(nested) : argument.value())
            .toArray();
    return String.format(java.util.Locale.US, template, args);
  }
}
