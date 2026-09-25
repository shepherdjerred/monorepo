package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.AcceptedMessage;
import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatAttempt;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatFacts;
import com.shepherdjerred.thestorm.chat.domain.ChatFormat;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.ChatText;
import com.shepherdjerred.thestorm.chat.domain.LineTemplate;
import com.shepherdjerred.thestorm.chat.domain.MessageValidator;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.chat.domain.ProfileError;
import com.shepherdjerred.thestorm.chat.domain.RecentMessage;
import com.shepherdjerred.thestorm.chat.domain.Routing;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.InstantSource;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

/**
 * Chat's use cases. State lives in memory so the async chat thread never waits on storage; every
 * change is written through to {@link ChatStore} in order. Thread-safe.
 */
public final class ChatService {

  private final ChatConfig config;
  private final ChatStore store;
  private final InstantSource time;
  private final ChatExtensions extensions;
  private final MessageValidator validator;
  private final Map<ChannelKey, LineTemplate> templates = new EnumMap<>(ChannelKey.class);
  private final LineTemplate emoteTemplate;
  private final LineTemplate privateTemplate;
  private final LineTemplate externalTemplate;
  private final Map<UUID, ChatProfile> profiles = new ConcurrentHashMap<>();
  private final Map<UUID, Mute> mutes = new ConcurrentHashMap<>();
  private final Map<UUID, RecentMessage> recent = new ConcurrentHashMap<>();
  private final Map<UUID, Correspondent> lastCorrespondent = new ConcurrentHashMap<>();

  public ChatService(
      ChatConfig config, ChatStore store, InstantSource time, ChatExtensions extensions) {
    this.config = config;
    this.store = store;
    this.time = time;
    this.extensions = extensions;
    this.validator = MessageValidator.standard(config.filter());
    for (var channel : ChannelKey.values()) {
      templates.put(channel, config.channels().template(channel));
    }
    this.emoteTemplate = config.emoteTemplate();
    this.privateTemplate = config.privateTemplate();
    this.externalTemplate = config.externalTemplate();
  }

  /**
   * Loads stored state. The module waits for this before it starts; anything changed before the
   * load finished would still win over the stored value.
   */
  public CompletableFuture<Void> load() {
    return store
        .loadAll(time.instant(), config.defaultChannelKey())
        .thenAccept(
            snapshot -> {
              snapshot.profiles().forEach(profiles::putIfAbsent);
              snapshot.mutes().forEach(mutes::putIfAbsent);
            });
  }

  /** {@code player}'s preferences. */
  public ChatProfile profile(UUID player) {
    var profile = profiles.get(player);
    return profile != null ? profile : ChatProfile.fresh(config.defaultChannelKey());
  }

  /** Whether {@code speaker} may talk in {@code channel} now. */
  public ChannelAccess access(Speaker speaker, ChannelKey channel) {
    return resolve(speaker, channel).access();
  }

  /** Every channel with {@code speaker}'s standing in it, for {@code /channels}. */
  public List<ChannelStatus> channels(Speaker speaker) {
    var profile = profile(speaker.id());
    return Arrays.stream(ChannelKey.values())
        .map(
            channel ->
                new ChannelStatus(
                    channel,
                    access(speaker, channel),
                    profile.focus() == channel,
                    !profile.receives(channel)))
        .toList();
  }

  /** Makes {@code channel} where {@code speaker}'s plain chat goes. */
  public Result<ChatProfile, ChatDenial> focus(Speaker speaker, ChannelKey channel) {
    var access = access(speaker, channel);
    if (access != ChannelAccess.GRANTED) {
      return Result.err(new ChatDenial.NoAccess(channel, access));
    }
    return update(
        speaker.id(), profile -> Result.<ChatProfile, ChatDenial>ok(profile.focusOn(channel)));
  }

  /** Stops {@code player} receiving {@code channel}. */
  public Result<ChatProfile, ProfileError> hide(UUID player, ChannelKey channel) {
    return update(player, profile -> profile.hide(channel));
  }

  /** Lets {@code player} receive {@code channel} again. */
  public Result<ChatProfile, ProfileError> show(UUID player, ChannelKey channel) {
    return update(player, profile -> profile.show(channel));
  }

  /** {@code player} stops receiving messages from {@code target}. */
  public Result<ChatProfile, ProfileError> ignore(UUID player, ChatProfile.IgnoreTarget target) {
    return update(player, profile -> profile.ignore(player, target));
  }

  /** {@code player} receives messages from {@code target} again. */
  public Result<ChatProfile, ProfileError> unignore(UUID player, UUID target) {
    return update(player, profile -> profile.unignore(target));
  }

  /** Mutes {@code player} for {@code length} from now, replacing any earlier mute. */
  public Mute mute(UUID player, Duration length, String reason, String issuer) {
    var mute = Mute.starting(time.instant(), length, reason, issuer);
    mutes.compute(
        player,
        (id, previous) -> {
          store.saveMute(id, mute);
          return mute;
        });
    return mute;
  }

  /** Lifts {@code player}'s mute. Returns whether they were muted. */
  public boolean unmute(UUID player) {
    var wasMuted = activeMute(player).isPresent();
    var removed = mutes.remove(player);
    if (removed != null) {
      store.deleteMute(player);
    }
    return wasMuted;
  }

  /** {@code player}'s mute, if it has not ended. */
  public Optional<Mute> activeMute(UUID player) {
    return Optional.ofNullable(mutes.get(player)).filter(mute -> mute.activeAt(time.instant()));
  }

  /**
   * Checks a channel message against the rules. On success it is remembered for the repeat limit
   * and returned ready to deliver; otherwise every reason it was refused is returned.
   */
  public Result<OutgoingLine, List<ChatDenial>> prepare(
      Speaker speaker, ChannelKey channel, String rawText) {
    return prepareLine(speaker, channel, rawText, false);
  }

  /** Checks a {@code /me} action, which goes to the speaker's focused channel. */
  public Result<OutgoingLine, List<ChatDenial>> prepareEmote(Speaker speaker, String rawAction) {
    return prepareLine(speaker, profile(speaker.id()).focus(), rawAction, true);
  }

  /**
   * Checks a private message. It follows the same rules as channel chat; a recipient who ignores
   * the sender makes it {@link ChatDenial.Undeliverable}, without saying why. On success both
   * players can {@code /r} each other.
   */
  public Result<PrivateLine, List<ChatDenial>> preparePrivate(
      Speaker sender, Correspondent recipient, String rawText) {
    if (recipient.id().equals(sender.id())) {
      return Result.err(List.of(new ChatDenial.ToSelf()));
    }
    var now = time.instant();
    var checked =
        validator.validate(
            new ChatAttempt(sender, rawText, now),
            new ChatFacts(mutes.get(sender.id()), recent.get(sender.id())));
    return switch (checked) {
      case Result.Err<AcceptedMessage, List<ChatDenial>>(var denials) -> Result.err(denials);
      case Result.Ok<AcceptedMessage, List<ChatDenial>>(var message) -> {
        if (profile(recipient.id()).ignores(sender.id())) {
          yield Result.err(List.of(new ChatDenial.Undeliverable()));
        }
        recent.put(sender.id(), RecentMessage.of(message.text(), now));
        lastCorrespondent.put(sender.id(), recipient);
        lastCorrespondent.put(recipient.id(), new Correspondent(sender.id(), sender.name()));
        yield Result.ok(new PrivateLine(sender, recipient, message));
      }
    };
  }

  /** Who {@code player} last messaged or was messaged by this session, for {@code /r}. */
  public Optional<Correspondent> replyTarget(UUID player) {
    return Optional.ofNullable(lastCorrespondent.get(player));
  }

  /** What to tell a player whose shouting was lowercased. */
  public String capsNotice() {
    return config.capsNotice();
  }

  private Result<OutgoingLine, List<ChatDenial>> prepareLine(
      Speaker speaker, ChannelKey channel, String rawText, boolean emote) {
    var resolution = resolve(speaker, channel);
    if (resolution.access() != ChannelAccess.GRANTED) {
      return Result.err(List.of(new ChatDenial.NoAccess(channel, resolution.access())));
    }
    var now = time.instant();
    return validator
        .validate(
            new ChatAttempt(speaker, rawText, now),
            new ChatFacts(mutes.get(speaker.id()), recent.get(speaker.id())))
        .map(
            message -> {
              recent.put(speaker.id(), RecentMessage.of(message.text(), now));
              return new OutgoingLine(channel, speaker, message, resolution.members(), emote);
            });
  }

  /** Whether {@code viewer} receives {@code line}. */
  public boolean receives(OutgoingLine line, UUID viewer, boolean viewerIsStaff) {
    return Routing.receives(
        line.channel(),
        line.speaker().id(),
        new Routing.Viewer(viewer, viewerIsStaff, profile(viewer)),
        line.members());
  }

  /** Whether {@code viewer} receives relayed Global lines. */
  public boolean receivesExternal(UUID viewer, boolean viewerIsStaff) {
    return Routing.receivesExternal(new Routing.Viewer(viewer, viewerIsStaff, profile(viewer)));
  }

  /** {@code line} as MiniMessage in its channel's format, or the emote format for {@code /me}. */
  public String render(OutgoingLine line) {
    var prefix = extensions.prefix(line.speaker().id());
    if (line.emote()) {
      return ChatFormat.emoteLine(
          emoteTemplate,
          line.channel(),
          new ChatFormat.Speech(prefix, line.speaker().name(), line.text()));
    }
    return ChatFormat.channelLine(
        template(line.channel()), prefix, line.speaker().name(), line.text());
  }

  /** {@code line} as MiniMessage in the private message format. */
  public String renderPrivate(PrivateLine line) {
    return ChatFormat.privateLine(
        privateTemplate, line.sender().name(), line.recipient().name(), line.message().text());
  }

  /** A relayed line as MiniMessage; every value is cleaned and escaped. */
  public String renderExternal(String source, String author, String text) {
    return ChatFormat.externalLine(
        externalTemplate, ChatText.clean(source), ChatText.clean(author), ChatText.clean(text));
  }

  private LineTemplate template(ChannelKey channel) {
    var template = templates.get(channel);
    if (template == null) {
      throw new IllegalStateException("no format for " + channel);
    }
    return template;
  }

  private Resolution resolve(Speaker speaker, ChannelKey channel) {
    return switch (channel.reach()) {
      case EVERYONE -> Resolution.granted(Set.of());
      case STAFF ->
          speaker.staff()
              ? Resolution.granted(Set.of())
              : new Resolution(ChannelAccess.NO_PERMISSION, Set.of());
      case TOWN -> resolveTown(speaker);
    };
  }

  private Resolution resolveTown(Speaker speaker) {
    return extensions
        .townMembership()
        .map(
            membership ->
                membership
                    .members(speaker.id())
                    .map(Resolution::granted)
                    .orElseGet(() -> new Resolution(ChannelAccess.NOT_A_MEMBER, Set.of())))
        .orElseGet(() -> new Resolution(ChannelAccess.UNAVAILABLE, Set.of()));
  }

  private <E> Result<ChatProfile, E> update(
      UUID player, Function<ChatProfile, Result<ChatProfile, E>> change) {
    var outcome = new AtomicReference<Result<ChatProfile, E>>();
    profiles.compute(
        player,
        (id, current) -> {
          var base = current != null ? current : ChatProfile.fresh(config.defaultChannelKey());
          var result = change.apply(base);
          outcome.set(result);
          return switch (result) {
            case Result.Ok<ChatProfile, E>(var next) -> {
              store.saveProfile(id, next);
              yield next;
            }
            case Result.Err<ChatProfile, E> _ -> base;
          };
        });
    return outcome.get();
  }

  private record Resolution(ChannelAccess access, Set<UUID> members) {

    static Resolution granted(Set<UUID> members) {
      return new Resolution(ChannelAccess.GRANTED, members);
    }
  }
}
