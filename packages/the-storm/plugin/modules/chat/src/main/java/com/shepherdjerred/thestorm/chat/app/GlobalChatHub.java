package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatText;
import java.time.InstantSource;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** The {@link GlobalChat} port: fans Global lines out to bridges and shows relayed lines. */
public final class GlobalChatHub implements GlobalChat {

  private final ChatService service;
  private final ChatOutput output;
  private final InstantSource time;
  private final Consumer<RuntimeException> listenerFailures;
  private final List<Consumer<ChatLine>> listeners = new CopyOnWriteArrayList<>();

  /**
   * @param listenerFailures told when a listener throws; the other listeners still run and the
   *     player's message is still delivered
   */
  public GlobalChatHub(
      ChatService service,
      ChatOutput output,
      InstantSource time,
      Consumer<RuntimeException> listenerFailures) {
    this.service = service;
    this.output = output;
    this.time = time;
    this.listenerFailures = listenerFailures;
  }

  @Override
  public Subscription subscribe(Consumer<ChatLine> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  @Override
  public void broadcastExternal(String source, String author, String text) {
    var cleaned = ChatText.clean(text);
    if (cleaned.isEmpty()) {
      throw new IllegalArgumentException("relayed messages must not be blank");
    }
    output.deliverExternal(service.renderExternal(source, author, cleaned));
    notify(
        new ChatLine(
            time.instant(),
            new ChatAuthor.External(ChatText.clean(source), ChatText.clean(author)),
            cleaned));
  }

  /** Tells listeners about a delivered player line, if it was in Global. */
  public void published(OutgoingLine line) {
    if (line.channel() != ChannelKey.GLOBAL) {
      return;
    }
    notify(
        new ChatLine(
            line.at(),
            new ChatAuthor.InGame(line.speaker().id(), line.speaker().name()),
            line.text()));
  }

  private void notify(ChatLine line) {
    for (var listener : listeners) {
      try {
        listener.accept(line);
      } catch (RuntimeException e) {
        listenerFailures.accept(e);
      }
    }
  }
}
