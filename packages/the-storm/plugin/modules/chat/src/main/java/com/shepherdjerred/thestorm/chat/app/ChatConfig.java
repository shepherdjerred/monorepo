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
 * @param channels each channel's format
 * @param externalFormat the format of messages relayed from Discord; uses {@code <source>}, {@code
 *     <author>} and {@code <message>}
 */
public record ChatConfig(
    String defaultChannel, FilterSettings filter, ChannelFormats channels, String externalFormat) {

  public ChatConfig {
    var channel =
        ChannelKey.fromId(defaultChannel)
            .orElseThrow(
                () -> new IllegalArgumentException("unknown defaultChannel " + defaultChannel));
    if (channel.reach() != ChannelKey.Reach.EVERYONE) {
      throw new IllegalArgumentException("defaultChannel must be open to everyone: " + channel);
    }
    ChatFormat.externalTemplate(externalFormat);
  }

  /** The default channel as a key. */
  public ChannelKey defaultChannelKey() {
    return ChannelKey.fromId(defaultChannel).orElseThrow();
  }

  /** The parsed relayed-message format. */
  public LineTemplate externalTemplate() {
    return ChatFormat.externalTemplate(externalFormat);
  }
}
