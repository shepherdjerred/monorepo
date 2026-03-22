package sjer.red.openai.messagetree;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MessageTreeP1Test {
    private MessageTreeP1 tree;

    @BeforeEach
    void setUp() {
        tree = new MessageTreeP1();
    }

    @Test
    void scenario_A1_add_root_and_get() {
        tree.addMessage(1, null, "Hello world");
        var msg = tree.getMessage(1);
        assertNotNull(msg);
        assertEquals(1, msg.id());
        assertNull(msg.parentId());
        assertEquals("Hello world", msg.content());
    }

    @Test
    void scenario_A2_add_reply_and_get_replies() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Reply");
        var replies = tree.getReplies(1);
        assertEquals(1, replies.size());
        assertEquals(2, replies.get(0).id());
    }

    @Test
    void scenario_A3_get_nonexistent_returns_null() {
        assertNull(tree.getMessage(999));
    }

    @Test
    void scenario_A4_get_replies_for_leaf_returns_empty() {
        tree.addMessage(1, null, "Leaf");
        assertTrue(tree.getReplies(1).isEmpty());
    }

    @Test
    void scenario_A5_multiple_replies_to_same_parent() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Reply A");
        tree.addMessage(3, 1, "Reply B");
        tree.addMessage(4, 1, "Reply C");
        var replies = tree.getReplies(1);
        assertEquals(3, replies.size());
    }

    @Test
    void scenario_A6_nested_replies() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Reply");
        tree.addMessage(3, 2, "Nested reply");
        var msg = tree.getMessage(3);
        assertNotNull(msg);
        assertEquals(2, msg.parentId());
        assertEquals("Nested reply", msg.content());
    }

    @Test
    void scenario_A7_get_replies_returns_only_direct_children() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Child");
        tree.addMessage(3, 2, "Grandchild");
        var replies = tree.getReplies(1);
        assertEquals(1, replies.size());
        assertEquals(2, replies.get(0).id());
    }

    @Test
    void scenario_A8_multiple_root_messages() {
        tree.addMessage(1, null, "Root A");
        tree.addMessage(2, null, "Root B");
        tree.addMessage(3, null, "Root C");
        assertNotNull(tree.getMessage(1));
        assertNotNull(tree.getMessage(2));
        assertNotNull(tree.getMessage(3));
        assertNull(tree.getMessage(1).parentId());
        assertNull(tree.getMessage(2).parentId());
    }
}
