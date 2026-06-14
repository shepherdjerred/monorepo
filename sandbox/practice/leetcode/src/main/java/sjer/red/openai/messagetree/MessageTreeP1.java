package sjer.red.openai.messagetree;

import java.util.List;

/**
 * PROBLEM: Message Tree (Threaded Comments)
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Add, Get, Get Replies
 * - addMessage(id, parentId, content) — add a message; parentId null means root message
 * - getMessage(id) — return the message or null if not found
 * - getReplies(id) — return the direct children of the given message
 * <p>
 * Examples:
 * addMessage(1, null, "Hello world")
 * addMessage(2, 1, "Nice post!")
 * addMessage(3, 1, "I agree")
 * getMessage(2) → Message(2, 1, "Nice post!")
 * getReplies(1) → [Message(2, 1, "Nice post!"), Message(3, 1, "I agree")]
 * getReplies(2) → []
 * <p>
 * TIME TARGET: ~15-20 minutes
 */
public class MessageTreeP1 {

    public record Message(int id, Integer parentId, String content) {}

    public MessageTreeP1() {
        // TODO: initialize data structures
    }

    /**
     * Add a message with the given id, parent, and content.
     * If parentId is null, this is a root message.
     */
    public void addMessage(int id, Integer parentId, String content) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the message with the given id, or null if not found.
     */
    public Message getMessage(int id) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Return the direct children (replies) of the message with the given id.
     */
    public List<Message> getReplies(int id) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
