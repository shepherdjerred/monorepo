package com.shepherdjerred.mcbridge.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * Messages a synthetic actor received while running one op. Errors are kept apart so the op result
 * can report {@code ok=false}.
 */
public final class MessageLog {
  private final List<String> messages = new ArrayList<>();
  private final List<String> errors = new ArrayList<>();

  public synchronized void message(String text) {
    messages.add(PlainText.strip(text));
  }

  public synchronized void error(String text) {
    errors.add(PlainText.strip(text));
  }

  public synchronized List<String> messages() {
    return List.copyOf(messages);
  }

  public synchronized List<String> errors() {
    return List.copyOf(errors);
  }

  /** Clears both lists before the next op. */
  public synchronized void clear() {
    messages.clear();
    errors.clear();
  }
}
