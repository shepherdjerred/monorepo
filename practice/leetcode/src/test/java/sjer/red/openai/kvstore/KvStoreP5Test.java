package sjer.red.openai.kvstore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

class KvStoreP5Test {
    private AtomicClock clock;
    private KvStoreP5 store;

    static class AtomicClock implements KvStoreP3.Clock {
        private final AtomicLong time;

        AtomicClock(long initial) {
            this.time = new AtomicLong(initial);
        }

        long advance(long delta) {
            return time.addAndGet(delta);
        }

        @Override
        public long now() {
            return time.incrementAndGet();
        }
    }

    private static boolean v(String val, String prefix) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(val.getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(hash);
            return hex.startsWith(prefix);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        clock = new AtomicClock(0);
        store = new KvStoreP5(clock);
    }

    // --- P3 regression (E1-E2) ---

    @Test
    void scenario_E1_set_then_get_single_thread() {
        store.set("foo", "bar");
        assertTrue(v(store.get("foo"), "fcde2b2e"));
    }

    @Test
    void scenario_E2_timestamp_lookup_single_thread() {
        store.set("foo", "bar");
        long t1 = clock.time.get();
        clock.advance(100);
        store.set("foo", "baz");
        assertTrue(v(store.get("foo", t1), "fcde2b2e"));
        assertTrue(v(store.get("foo"), "baa5a096"));
    }

    // --- Concurrent writes to different keys (E3) ---

    @Test
    void scenario_E3_concurrent_sets_different_keys_no_lost_data() throws Exception {
        int numThreads = 20;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch latch = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < numThreads; i++) {
            final String key = "key" + i;
            final String value = "value" + i;
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                store.set(key, value);
            }));
        }

        latch.countDown();
        for (Future<?> f : futures) {
            f.get(5, TimeUnit.SECONDS);
        }
        executor.shutdown();

        // All keys must be present
        for (int i = 0; i < numThreads; i++) {
            assertNotNull(store.get("key" + i), "key" + i + " should exist");
        }
    }

    // --- Concurrent writes to same key (E4) ---

    @Test
    void scenario_E4_concurrent_sets_same_key_final_state_consistent() throws Exception {
        int numThreads = 50;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch latch = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        Set<String> possibleValues = ConcurrentHashMap.newKeySet();
        for (int i = 0; i < numThreads; i++) {
            final String value = "v" + i;
            possibleValues.add(value);
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                store.set("contested", value);
            }));
        }

        latch.countDown();
        for (Future<?> f : futures) {
            f.get(5, TimeUnit.SECONDS);
        }
        executor.shutdown();

        String result = store.get("contested");
        assertNotNull(result, "key should have a value");
        assertTrue(possibleValues.contains(result), "value should be one of the written values");
    }

    // --- Concurrent get during set (E5) ---

    @Test
    void scenario_E5_concurrent_get_during_set_no_exceptions() throws Exception {
        store.set("key", "initial");

        int numWriters = 10;
        int numReaders = 10;
        ExecutorService executor = Executors.newFixedThreadPool(numWriters + numReaders);
        CountDownLatch latch = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < numWriters; i++) {
            final String value = "w" + i;
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                for (int j = 0; j < 100; j++) {
                    store.set("key", value);
                }
            }));
        }

        for (int i = 0; i < numReaders; i++) {
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                for (int j = 0; j < 100; j++) {
                    String val = store.get("key");
                    assertNotNull(val, "get should never return null for existing key");
                }
            }));
        }

        latch.countDown();
        for (Future<?> f : futures) {
            f.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();
    }

    // --- Concurrent delete during set (E6) ---

    @Test
    void scenario_E6_concurrent_delete_during_set_no_exceptions() throws Exception {
        int numThreads = 20;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch latch = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < numThreads; i++) {
            final int idx = i;
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                for (int j = 0; j < 50; j++) {
                    if (idx % 2 == 0) {
                        store.set("key", "val" + j);
                    } else {
                        store.delete("key");
                    }
                }
            }));
        }

        latch.countDown();
        for (Future<?> f : futures) {
            f.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();
        // No exception = pass. Final state is either a value or null, both valid.
    }

    // --- High-contention stress test (E7) ---

    @Test
    void scenario_E7_high_contention_stress_test() throws Exception {
        int numThreads = 50;
        int opsPerThread = 200;
        ExecutorService executor = Executors.newFixedThreadPool(numThreads);
        CountDownLatch latch = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < numThreads; i++) {
            final int idx = i;
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                for (int j = 0; j < opsPerThread; j++) {
                    String key = "key" + (j % 5); // 5 keys, high contention
                    switch (j % 3) {
                        case 0 -> store.set(key, "t" + idx + "_" + j);
                        case 1 -> store.get(key);
                        case 2 -> store.delete(key);
                    }
                }
            }));
        }

        latch.countDown();
        for (Future<?> f : futures) {
            f.get(30, TimeUnit.SECONDS);
        }
        executor.shutdown();
        // No exception = pass
    }

    // --- Reader consistency (E8) ---

    @Test
    void scenario_E8_readers_see_consistent_state() throws Exception {
        // Pre-populate with known value
        store.set("key", "hello");

        int numReaders = 20;
        ExecutorService executor = Executors.newFixedThreadPool(numReaders + 1);
        CountDownLatch latch = new CountDownLatch(1);
        CyclicBarrier barrier = new CyclicBarrier(numReaders + 1);
        List<Future<String>> futures = new ArrayList<>();

        // One writer thread that sets to "world" after barrier
        executor.submit(() -> {
            try {
                latch.await();
                barrier.await();
                store.set("key", "world");
            } catch (Exception e) {
                Thread.currentThread().interrupt();
            }
        });

        // Reader threads that read after barrier
        for (int i = 0; i < numReaders; i++) {
            futures.add(executor.submit(() -> {
                try {
                    latch.await();
                    barrier.await();
                } catch (Exception e) {
                    Thread.currentThread().interrupt();
                }
                return store.get("key");
            }));
        }

        latch.countDown();
        Set<String> seen = ConcurrentHashMap.newKeySet();
        for (Future<String> f : futures) {
            String val = f.get(5, TimeUnit.SECONDS);
            assertNotNull(val);
            seen.add(val);
        }
        executor.shutdown();

        // Each reader should see either "hello" or "world", never a corrupted value
        for (String s : seen) {
            assertTrue(s.equals("hello") || s.equals("world"),
                    "unexpected value: " + s);
        }
    }
}
