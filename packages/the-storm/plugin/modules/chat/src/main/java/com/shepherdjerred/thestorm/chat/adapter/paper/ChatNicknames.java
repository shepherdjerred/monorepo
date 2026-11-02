package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.IdentityService;
import com.shepherdjerred.thestorm.core.players.Nicknames;
import java.util.Optional;
import java.util.UUID;

/** Chat's nicknames, for commands that name a player. */
public final class ChatNicknames implements Nicknames {

  private final IdentityService identities;

  public ChatNicknames(IdentityService identities) {
    this.identities = identities;
  }

  @Override
  public Optional<UUID> named(String nickname) {
    return identities.named(nickname);
  }

  @Override
  public String display(UUID player, String accountName) {
    return identities.effective(player).nickname().orElse(accountName);
  }
}
