package com.shepherdjerred.thestorm.arena.domain.game;

import java.util.Map;

/**
 * An announcement and the values for its placeholders, such as {@code wave -> "12"}.
 *
 * @param kind which message
 * @param values placeholder name (without braces) to value
 */
public record Notice(NoticeKind kind, Map<String, String> values) {

  public Notice {
    values = Map.copyOf(values);
  }

  public static Notice of(NoticeKind kind) {
    return new Notice(kind, Map.of());
  }

  public static Notice of(NoticeKind kind, String key, Object value) {
    return new Notice(kind, Map.of(key, String.valueOf(value)));
  }

  public static Notice of(NoticeKind kind, Map<String, String> values) {
    return new Notice(kind, values);
  }
}
