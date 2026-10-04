package com.shepherdjerred.mcbridge.adapter.paper;

import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.mcbridge.domain.PlainText;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.Logger;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Property;

/**
 * Copies server log lines into the event ring as {@code log} events. Lines from the bridge's own
 * logger are skipped so request diagnostics never feed back into the ring.
 */
public final class LogCapture extends AbstractAppender {
  private static final String OWN_LOGGER = "MCBridge";

  private final EventRing ring;

  private LogCapture(EventRing ring) {
    super("MCBridgeLogCapture", null, null, true, Property.EMPTY_ARRAY);
    this.ring = ring;
  }

  /** Attaches a started appender to the root logger. */
  public static LogCapture attach(EventRing ring) {
    LogCapture appender = new LogCapture(ring);
    appender.start();
    root().addAppender(appender);
    return appender;
  }

  /** Detaches and stops the appender. */
  public void detach() {
    root().removeAppender(this);
    stop();
  }

  @Override
  public void append(LogEvent event) {
    String loggerName = event.getLoggerName();
    if (loggerName != null && loggerName.contains(OWN_LOGGER)) {
      return;
    }
    String message = event.getMessage().getFormattedMessage();
    if (message == null || message.isBlank()) {
      return;
    }
    ring.add(EventType.LOG, null, PlainText.strip(message));
  }

  private static Logger root() {
    return (Logger) LogManager.getRootLogger();
  }
}
