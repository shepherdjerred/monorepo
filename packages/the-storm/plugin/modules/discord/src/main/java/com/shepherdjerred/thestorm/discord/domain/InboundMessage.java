package com.shepherdjerred.thestorm.discord.domain;

/**
 * A message posted in the bridged Discord channel.
 *
 * @param author the author's display name
 * @param content the message as Discord displays it (mentions resolved to names)
 * @param automated whether a bot or webhook posted it
 * @param attachments how many files are attached
 */
public record InboundMessage(
    String author,
    String content,
    boolean automated,
    int attachments,
    String authorId,
    String messageId,
    String channelId,
    java.util.List<String> attachmentNames,
    String revision) {
  public InboundMessage(String author, String content, boolean automated, int attachments) {
    this(
        author,
        content,
        automated,
        attachments,
        "unknown:" + author,
        "unknown",
        "unknown",
        java.util.List.of(),
        "created");
  }

  public InboundMessage {
    attachmentNames = java.util.List.copyOf(attachmentNames);
  }
}
