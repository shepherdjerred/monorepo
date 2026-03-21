package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ResumableIteratorP1Test {

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

    @Test
    void scenario_A1_basic_iteration() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of(10, 20, 30));
        var acc = drain(it);
        assertEquals(sig(List.of(10, 20, 30)), sig(acc));
    }

    @Test
    void scenario_A2_empty_list() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A3_single_element() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of(99));
        assertTrue(it.hasNext());
        assertEquals(99, it.next());
        assertFalse(it.hasNext());
    }
}
