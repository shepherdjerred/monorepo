package sjer.red.openai.resumableiterator;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import java.util.NoSuchElementException;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

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
assertTrue(sig(List.of(10, 20, 30)).equals(sig(acc)));
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
assertTrue(99 == it.next());
        assertFalse(it.hasNext());
    }

    @Test
    void scenario_A4_next_after_exhaustion() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of(1, 2));
        it.next(); // 1
        it.next(); // 2
        assertFalse(it.hasNext());
        assertThrows(NoSuchElementException.class, it::next);
    }

    @Test
    void scenario_A5_hasNext_idempotent() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of(1, 2, 3));
        for (int i = 0; i < 5; i++) {
            assertTrue(it.hasNext());
        }
        // Should still return first element
assertTrue(1 == it.next());
    }

    @Test
    void scenario_A6_next_without_hasNext() {
        var it = new ResumableIteratorP1.ResumableListIterator<>(List.of(10, 20, 30));
assertTrue(10 == it.next());
assertTrue(20 == it.next());
assertTrue(30 == it.next());
    }

    @Test
    void scenario_A7_large_list() {
        var data = IntStream.rangeClosed(1, 1000).boxed().collect(Collectors.toList());
        var it = new ResumableIteratorP1.ResumableListIterator<>(data);
        var acc = drain(it);
assertTrue(sig(data).equals(sig(acc)));
assertTrue(1000 == acc.size());
assertTrue(1000 == acc.get(999));
    }
}
