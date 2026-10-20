package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.util.formatting.text.Component;
import com.sk89q.worldedit.util.formatting.text.TextComponent;

/**
 * Aborts a creative WorldEdit before any further block in that edit is applied. The component
 * constructor formats through a WorldEdit platform, so the message is kept here and returned from
 * {@link #getRichMessage()} when the server prints the refusal.
 */
final class RefusedEdit extends WorldEditException {

  @java.io.Serial private static final long serialVersionUID = 1L;

  private final String reason;

  RefusedEdit(String message) {
    this.reason = message;
  }

  @Override
  public String getMessage() {
    return reason;
  }

  @Override
  public Component getRichMessage() {
    return TextComponent.of(reason);
  }
}
