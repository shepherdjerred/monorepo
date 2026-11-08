package com.shepherdjerred.thestorm.client;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.ContainerEventHandler;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import tools.jackson.databind.JsonNode;

/** Bounded observations from the actual client, including private command feedback. */
final class ClientObservations {
  private record Message(long sequence, String text, boolean overlay) {}

  private final ArrayDeque<Message> messages = new ArrayDeque<>();
  private long sequence;

  void message(Component text, boolean overlay) {
    messages.addLast(new Message(++sequence, text.getString(), overlay));
    while (messages.size() > 100) messages.removeFirst();
  }

  Object messages(JsonNode args) {
    Protocol.keys(args, Set.of("since"));
    var since = args.required("since");
    if (!since.isIntegralNumber() || since.longValue() < 0)
      throw new IllegalArgumentException("Invalid message cursor");
    return Map.of(
        "cursor",
        sequence,
        "messages",
        messages.stream().filter(message -> message.sequence() > since.longValue()).toList());
  }

  Object screen(Minecraft client) {
    var widgets = widgets(client);
    var rows = new ArrayList<Object>();
    for (var index = 0; index < widgets.size(); index++) {
      var widget = widgets.get(index);
      rows.add(
          Map.of(
              "id",
              index,
              "label",
              widget.getMessage().getString(),
              "enabled",
              widget.active,
              "visible",
              widget.visible,
              "x",
              widget.getX(),
              "y",
              widget.getY(),
              "width",
              widget.getWidth(),
              "height",
              widget.getHeight(),
              "value",
              widget instanceof net.minecraft.client.gui.components.EditBox input
                  ? input.getValue()
                  : ""));
    }
    return Map.of("revision", revision(client, widgets), "controls", rows);
  }

  Object activate(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("revision", "id"));
    var widgets = widgets(client);
    if (!Protocol.text(args, "revision", 100).equals(revision(client, widgets)))
      throw new IllegalStateException("Screen changed; inspect controls again");
    var index = Protocol.integer(args, "id", 0, widgets.size() - 1);
    var widget = widgets.get(index);
    if (!widget.active || !widget.visible)
      throw new IllegalStateException("Control is disabled or hidden");
    var screen = java.util.Objects.requireNonNull(client.gui.screen());
    screen.setFocused(widget);
    if (!widget.keyPressed(new KeyEvent(40, 0, 0)))
      throw new IllegalStateException("Control does not support keyboard activation");
    return "Control activated";
  }

  Object type(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("revision", "id", "text"));
    var widgets = widgets(client);
    if (!Protocol.text(args, "revision", 100).equals(revision(client, widgets)))
      throw new IllegalStateException("Screen changed; inspect controls again");
    var widget = widgets.get(Protocol.integer(args, "id", 0, widgets.size() - 1));
    if (!(widget instanceof net.minecraft.client.gui.components.EditBox input)
        || !input.active
        || !input.visible) throw new IllegalStateException("Control is not an editable text field");
    var text = args.required("text");
    if (!text.isString()
        || text.stringValue().length() > 200
        || text.stringValue().contains("\n")
        || text.stringValue().contains("\r"))
      throw new IllegalArgumentException("Invalid screen text");
    input.setValue(text.stringValue());
    return "Text field updated";
  }

  private static String revision(Minecraft client, List<AbstractWidget> widgets) {
    var signature = new StringBuilder().append(System.identityHashCode(client.gui.screen()));
    for (var widget : widgets)
      signature
          .append(':')
          .append(System.identityHashCode(widget))
          .append(':')
          .append(widget.getMessage().getString())
          .append(':')
          .append(widget.active)
          .append(':')
          .append(widget.visible)
          .append(':')
          .append(
              widget instanceof net.minecraft.client.gui.components.EditBox input
                  ? input.getValue()
                  : "");
    return Integer.toHexString(signature.toString().hashCode());
  }

  private static List<AbstractWidget> widgets(Minecraft client) {
    var result = new ArrayList<AbstractWidget>();
    var screen = client.gui.screen();
    if (screen != null) collect(screen, result);
    return result;
  }

  private static void collect(ContainerEventHandler container, List<AbstractWidget> result) {
    for (GuiEventListener child : container.children()) {
      if (result.size() >= 512) throw new IllegalStateException("Screen control limit exceeded");
      if (child instanceof AbstractWidget widget) result.add(widget);
      if (child instanceof ContainerEventHandler nested) collect(nested, result);
    }
  }
}
