package sjer.red.openai.messagetree;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MessageTreeP2Test {
    private MessageTreeP2 tree;

    @BeforeEach
    void setUp() {
        tree = new MessageTreeP2();
    }

    // P1 regression tests (A1-A3)

    @Test
    void scenario_A1_add_root_and_get() {
        tree.addMessage(1, null, "Hello world");
        var msg = tree.getMessage(1);
        assertNotNull(msg);
        assertEquals(1, msg.id());
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

    // P2 tests (B1-B8)

    @Test
    void scenario_B1_get_thread_returns_entire_tree_dfs() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Child A");
        tree.addMessage(3, 2, "Grandchild A.1");
        tree.addMessage(4, 1, "Child B");
        var thread = tree.getThread(1);
        assertEquals(4, thread.size());
        assertEquals(1, thread.get(0).id());
        assertEquals(2, thread.get(1).id());
        assertEquals(3, thread.get(2).id());
        assertEquals(4, thread.get(3).id());
    }

    @Test
    void scenario_B2_get_thread_on_leaf() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Leaf");
        var thread = tree.getThread(2);
        assertEquals(1, thread.size());
        assertEquals(2, thread.get(0).id());
    }

    @Test
    void scenario_B3_get_thread_on_mid_level() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Mid");
        tree.addMessage(3, 2, "Deep A");
        tree.addMessage(4, 2, "Deep B");
        tree.addMessage(5, 1, "Sibling");
        var thread = tree.getThread(2);
        assertEquals(3, thread.size());
        assertEquals(2, thread.get(0).id());
        // Children of 2 should follow
        assertTrue(thread.stream().map(MessageTreeP2.Message::id).toList().containsAll(List.of(2, 3, 4)));
        assertFalse(thread.stream().anyMatch(m -> m.id() == 1 || m.id() == 5));
    }

    @Test
    void scenario_B4_delete_leaf() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Leaf");
        tree.deleteMessage(2);
        assertNull(tree.getMessage(2));
        assertTrue(tree.getReplies(1).isEmpty());
    }

    @Test
    void scenario_B5_delete_mid_level_removes_descendants() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Mid");
        tree.addMessage(3, 2, "Deep A");
        tree.addMessage(4, 2, "Deep B");
        tree.deleteMessage(2);
        assertNull(tree.getMessage(2));
        assertNull(tree.getMessage(3));
        assertNull(tree.getMessage(4));
    }

    @Test
    void scenario_B6_delete_root_removes_everything() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Child");
        tree.addMessage(3, 2, "Grandchild");
        tree.deleteMessage(1);
        assertNull(tree.getMessage(1));
        assertNull(tree.getMessage(2));
        assertNull(tree.getMessage(3));
    }

    @Test
    void scenario_B7_get_replies_after_partial_delete() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "Child A");
        tree.addMessage(3, 1, "Child B");
        tree.addMessage(4, 1, "Child C");
        tree.deleteMessage(3);
        var replies = tree.getReplies(1);
        assertEquals(2, replies.size());
        assertTrue(replies.stream().noneMatch(m -> m.id() == 3));
    }

    @Test
    void scenario_B8_get_thread_ordering_parent_before_children() {
        tree.addMessage(1, null, "Root");
        tree.addMessage(2, 1, "A");
        tree.addMessage(3, 1, "B");
        tree.addMessage(4, 2, "A.1");
        tree.addMessage(5, 2, "A.2");
        tree.addMessage(6, 3, "B.1");
        var thread = tree.getThread(1);
        // Parent always before its children
        int rootIdx = indexOf(thread, 1);
        int aIdx = indexOf(thread, 2);
        int bIdx = indexOf(thread, 3);
        int a1Idx = indexOf(thread, 4);
        int a2Idx = indexOf(thread, 5);
        int b1Idx = indexOf(thread, 6);
        assertTrue(rootIdx < aIdx, "Root before A");
        assertTrue(rootIdx < bIdx, "Root before B");
        assertTrue(aIdx < a1Idx, "A before A.1");
        assertTrue(aIdx < a2Idx, "A before A.2");
        assertTrue(bIdx < b1Idx, "B before B.1");
    }

    private int indexOf(List<MessageTreeP2.Message> list, int id) {
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).id() == id) return i;
        }
        return -1;
    }
}
