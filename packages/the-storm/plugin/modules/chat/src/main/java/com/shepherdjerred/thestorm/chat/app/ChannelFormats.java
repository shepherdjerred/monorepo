package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatFormat;
import com.shepherdjerred.thestorm.chat.domain.LineTemplate;

/**
 * The MiniMessage format of each channel. Every format must use {@code <prefix>}, {@code <player>}
 * and {@code <message>}.
 */
public record ChannelFormats(String global, String war, String staff, String town, String nation) {

  public ChannelFormats {
    for (var format : new String[] {global, war, staff, town, nation}) {
      ChatFormat.channelTemplate(format);
    }
  }

  /** The parsed format of {@code channel}. */
  public LineTemplate template(ChannelKey channel) {
    return ChatFormat.channelTemplate(
        switch (channel) {
          case GLOBAL -> global;
          case WAR -> war;
          case STAFF -> staff;
          case TOWN -> town;
          case NATION -> nation;
        });
  }
}
