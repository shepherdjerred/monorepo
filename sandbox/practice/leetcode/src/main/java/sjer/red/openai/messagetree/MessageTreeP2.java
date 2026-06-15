package sjer.red.openai.messagetree;

import java.util.List;

/**
 * PROBLEM: Message Tree (Threaded Comments)
 * <p>
 * PART 2: Get Thread and Delete
 * - All Part 1 methods: addMessage, getMessage, getReplies
 * - getThread(id) — return the entire subtree rooted at id in DFS pre-order
 * - deleteMessage(id) — delete the message and all its descendants
 * <p>
 * Examples:
 * addMessage(1, null, "Root")
 * addMessage(2, 1, "Reply A")
 * addMessage(3, 2, "Reply A.1")
 * addMessage(4, 1, "Reply B")
 * getThread(1) → [Message(1,..), Message(2,..), Message(3,..), Message(4,..)]
 * deleteMessage(2) // deletes 2 and 3
 * getThread(1) → [Message(1,..), Message(4,..)]
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~30-40 minutes)
 */
public class MessageTreeP2 {

    public record Message(int id, Integer parentId, String content) {}

    public MessageTreeP2() {
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

    /**
     * Return the entire subtree rooted at the given id in DFS pre-order.
     * The message with the given id is first, followed by its descendants.
     */
    public List<Message> getThread(int id) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Delete the message with the given id and all its descendants.
     */
    public void deleteMessage(int id) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
