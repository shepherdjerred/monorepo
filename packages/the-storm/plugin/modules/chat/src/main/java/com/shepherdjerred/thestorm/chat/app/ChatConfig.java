package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatFormat;
import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import com.shepherdjerred.thestorm.chat.domain.LineTemplate;

/**
 * {@code plugins/TheStorm/chat.yml}.
 *
 * @param defaultChannel the channel new players talk in: {@code global} or {@code war}
 * @param filter the caps, repeat and length limits
 * @param capsNotice told to a player whose shouting was lowercased
 * @param channels each channel's format
 * @param emoteFormat the {@code /me} format; uses {@code <channel>}, {@code <prefix>}, {@code
 *     <player>} and {@code <message>}
 * @param privateFormat the private message format; uses {@code <from>}, {@code <to>} and {@code
 *     <message>}
 * @param externalFormat the format of messages relayed from Discord; uses {@code <source>}, {@code
 *     <author>} and {@code <message>}
 */
public record ChatConfig(
    String defaultChannel,
    FilterSettings filter,
    String capsNotice,
    ChannelFormats channels,
    String emoteFormat,
    String privateFormat,
    String externalFormat) {

  public ChatConfig {
    var channel =
        ChannelKey.fromId(defaultChannel)
            .orElseThrow(
                () -> new IllegalArgumentException("unknown defaultChannel " + defaultChannel));
    if (channel.reach() != ChannelKey.Reach.EVERYONE) {
      throw new IllegalArgumentException("defaultChannel must be open to everyone: " + channel);
    }
    if (capsNotice.isBlank()) {
      throw new IllegalArgumentException("capsNotice must not be blank");
    }
    ChatFormat.emoteTemplate(emoteFormat);
    ChatFormat.privateTemplate(privateFormat);
    ChatFormat.externalTemplate(externalFormat);
  }

  /** The default channel as a key. */
  public ChannelKey defaultChannelKey() {
    return ChannelKey.fromId(defaultChannel).orElseThrow();
  }

  /** The parsed {@code /me} format. */
  public LineTemplate emoteTemplate() {
    return ChatFormat.emoteTemplate(emoteFormat);
  }

  /** The parsed private message format. */
  public LineTemplate privateTemplate() {
    return ChatFormat.privateTemplate(privateFormat);
  }

  /** The parsed relayed-message format. */
  public LineTemplate externalTemplate() {
    return ChatFormat.externalTemplate(externalFormat);
  }
}
