package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.NpcChat;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;

/**
 * {@link NpcChat} on Paper: the line is checked like a player's, shown to every player in its
 * audience who receives it (the channel's reach, hidden channels and ignores), and tapped. It is
 * never published to {@link com.shepherdjerred.thestorm.chat.app.GlobalChat}, so no NPC line leaves
 * the game. Main thread only.
 */
public final class PaperNpcChat implements NpcChat {

  private final ChatService service;
  private final PaperChatOutput output;

  public PaperNpcChat(ChatService service, PaperChatOutput output) {
    this.service = service;
    this.output = output;
  }

  @Override
  public Optional<String> say(Line line) {
    return switch (service.prepareNpc(line)) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var outgoing) -> {
        output.deliver(outgoing, line.audience());
        service.delivered(outgoing);
        yield Optional.empty();
      }
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) ->
          Optional.of(denials.stream().map(Feedback::describe).toList().toString());
    };
  }
}
