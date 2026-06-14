package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ResumableIteratorP2Test {

    // --- Helpers ---
    private static <T> List<T> drain(Iterator<T> it) {
        var list = new ArrayList<T>();
        while (it.hasNext()) list.add(it.next());
        return list;
    }

    private static <T> String sig(List<T> items) {
        try {
            var md = MessageDigest.getInstance("MD5");
            for (var item : items) {
                md.update(String.valueOf(item).getBytes(StandardCharsets.UTF_8));
                md.update((byte) 0x1F);
            }
            byte[] hash = md.digest();
            var sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // --- A1-A3 (from P1) ---
    @Test
    void scenario_A1_basic_iteration() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(10, 20, 30));
        var acc = drain(it);
        assertEquals(sig(List.of(10, 20, 30)), sig(acc));
    }

    @Test
    void scenario_A2_empty_list() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A3_single_element() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(99));
        assertTrue(it.hasNext());
        assertEquals(99, (int) it.next());
        assertFalse(it.hasNext());
    }

    // --- A4-A5 (new in P2) ---
    @Test
    void scenario_A4_save_restore() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(1, 2, 3, 4, 5));
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        assertEquals(3, (int) it.next()); // 3
        assertEquals(4, (int) it.next()); // 4
        it.setState(state);
        // Should replay from position after 2
        assertEquals(3, (int) it.next());
        assertEquals(4, (int) it.next());
        assertEquals(5, (int) it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A5_multiple_saves() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(10, 20, 30, 40));
        var s1 = it.getState();
        it.next(); // 10
        var s2 = it.getState();
        it.next(); // 20
        it.next(); // 30
        it.setState(s1);
        assertEquals(10, (int) it.next());
        it.setState(s2);
        assertEquals(20, (int) it.next());
    }

    @Test
    void scenario_A6_save_at_beginning() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(1, 2, 3));
        var state = it.getState();
        it.next(); // 1
        it.next(); // 2
        it.setState(state);
        assertEquals(1, (int) it.next());
        assertEquals(2, (int) it.next());
        assertEquals(3, (int) it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A7_save_after_exhaustion() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(1, 2));
        it.next(); // 1
        it.next(); // 2
        assertFalse(it.hasNext());
        var state = it.getState();
        it.setState(state);
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A8_save_advance_restore_advance_restore() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(1, 2, 3, 4, 5));
        it.next(); // 1
        var state = it.getState();
        it.next(); // 2
        it.next(); // 3
        it.setState(state);
        assertEquals(2, (int) it.next());
        it.setState(state);
        assertEquals(2, (int) it.next());
        assertEquals(3, (int) it.next());
    }

    @Test
    void scenario_A9_restore_then_save() {
        var it = new ResumableIteratorP2.ResumableListIterator<>(List.of(1, 2, 3, 4));
        it.next(); // 1
        it.next(); // 2
        var state = it.getState();
        it.next(); // 3
        it.setState(state);
        var state2 = it.getState();
        // state2 should be at same position as state (before element 3)
        assertEquals(3, (int) it.next());
        it.setState(state2);
        assertEquals(3, (int) it.next());
    }
}
