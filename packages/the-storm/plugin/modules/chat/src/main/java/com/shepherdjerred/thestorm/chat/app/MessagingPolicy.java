package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.UUID;

/** The common communication boundary used by letters as well as private chat. */
public interface MessagingPolicy {
  record Attempt(
      UUID sender,
      String realName,
      boolean staff,
      boolean bypass,
      UUID recipient,
      String text,
      int maxLength,
      boolean recipientIdentityEnabled) {
    public Attempt(
        UUID sender,
        String realName,
        boolean staff,
        boolean bypass,
        UUID recipient,
        String text,
        int maxLength) {
      this(sender, realName, staff, bypass, recipient, text, maxLength, true);
    }
  }

  Result<String, String> letter(Attempt attempt);

  void delivered(UUID sender, String text);
}
