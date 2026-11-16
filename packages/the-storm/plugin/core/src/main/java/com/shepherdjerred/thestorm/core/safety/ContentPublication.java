package com.shepherdjerred.thestorm.core.safety;

import static java.util.Collections.synchronizedMap;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/** Captures admission mode and submission identity across chat and command publication. */
public final class ContentPublication {
  private static final ScopedValue<Context> CURRENT = ScopedValue.newInstance();
  private static final Map<Object, Context> EVENTS = synchronizedMap(new IdentityHashMap<>());
  private static final Map<UUID, CommandContext> COMMANDS = new ConcurrentHashMap<>();

  public record Context(Optional<UUID> submissionId, boolean screened) {}

  public static final class CommandContext {
    private final Context publication;
    private boolean rejected;

    private CommandContext(Context publication) {
      this.publication = publication;
    }

    public Context publication() {
      return publication;
    }

    public void markDelivered() {
      rejected = false;
    }

    public void markRejected() {
      rejected = true;
    }

    public boolean rejected() {
      return rejected;
    }
  }

  private ContentPublication() {}

  /** Native publications outside Safety retain the existing enforcement flow. */
  public static boolean screened() {
    return CURRENT.isBound() && CURRENT.get().screened();
  }

  public static Optional<Context> current() {
    return CURRENT.isBound() ? Optional.of(CURRENT.get()) : Optional.empty();
  }

  public static String deliver(boolean screened, Supplier<String> publication) {
    return ScopedValue.where(CURRENT, new Context(Optional.empty(), screened))
        .call(publication::get);
  }

  public static String deliver(UUID submissionId, boolean screened, Supplier<String> publication) {
    return ScopedValue.where(CURRENT, new Context(Optional.of(submissionId), screened))
        .call(publication::get);
  }

  public static void beginEvent(Object event, Context context) {
    EVENTS.put(event, context);
  }

  public static Optional<Context> eventContext(Object event) {
    return Optional.ofNullable(EVENTS.get(event));
  }

  public static Optional<Context> endEvent(Object event) {
    return Optional.ofNullable(EVENTS.remove(event));
  }

  public static CommandContext beginCommand(UUID player, Context context) {
    var created = new CommandContext(context);
    COMMANDS.put(player, created);
    return created;
  }

  public static Optional<CommandContext> commandContext(UUID player) {
    return Optional.ofNullable(COMMANDS.get(player));
  }

  public static void endCommand(UUID player, CommandContext command) {
    COMMANDS.remove(player, command);
  }
}
