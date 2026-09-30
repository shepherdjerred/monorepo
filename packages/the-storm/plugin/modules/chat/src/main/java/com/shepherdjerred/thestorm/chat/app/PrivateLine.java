package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.AcceptedMessage;
import com.shepherdjerred.thestorm.chat.domain.Speaker;

/**
 * A private message that passed every rule. Only the sender and recipient see it.
 *
 * @param sender who sent it
 * @param recipient who receives it
 * @param message the accepted text
 */
public record PrivateLine(Speaker sender, Correspondent recipient, AcceptedMessage message) {}
