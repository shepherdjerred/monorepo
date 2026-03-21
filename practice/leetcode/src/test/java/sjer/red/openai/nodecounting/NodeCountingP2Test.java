package sjer.red.openai.nodecounting;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

class NodeCountingP2Test {
    private NodeCountingP2.TreeNode mkNode(int id, Integer parentId, List<Integer> children, NodeCountingP2.MessageBus bus) {
        return new NodeCountingP2.TreeNode(id, parentId, children, bus);
    }

    @Test
    void scenario_A1_single_node() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(), bus));
        assertEquals(1 ^ 0x0, new NodeCountingP2().countNodes(nodes, 0, 5000L) ^ 0x0);
    }

    @Test
    void scenario_A2_linear_chain() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1), bus), 1, mkNode(1, 0, List.of(2), bus), 2, mkNode(2, 1, List.of(3), bus), 3, mkNode(3, 2, List.of(), bus));
        assertEquals(0b100, new NodeCountingP2().countNodes(nodes, 0, 5000L));
    }

    @Test
    void scenario_A3_binary_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2), bus), 1, mkNode(1, 0, List.of(3, 4), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 1, List.of(), bus), 4, mkNode(4, 1, List.of(), bus));
        assertEquals(Integer.parseInt("101", 2), new NodeCountingP2().countNodes(nodes, 0, 5000L));
    }

    @Test
    void scenario_A4_wide_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3, 4), bus), 1, mkNode(1, 0, List.of(), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(), bus), 4, mkNode(4, 0, List.of(), bus));
        assertEquals(0x5, new NodeCountingP2().countNodes(nodes, 0, 5000L));
    }

    @Test
    void scenario_A5_larger_tree() {
        var bus = new TestMessageBus();
        var nodes = Map.of(0, mkNode(0, null, List.of(1, 2, 3), bus), 1, mkNode(1, 0, List.of(4, 5), bus), 2, mkNode(2, 0, List.of(), bus), 3, mkNode(3, 0, List.of(6), bus), 4, mkNode(4, 1, List.of(7), bus), 5, mkNode(5, 1, List.of(), bus), 6, mkNode(6, 3, List.of(), bus), 7, mkNode(7, 4, List.of(), bus));
        assertEquals(1 << 3, new NodeCountingP2().countNodes(nodes, 0, 5000L));
    }

    static class TestMessageBus implements NodeCountingP2.MessageBus {
        private final Map<Integer, BlockingQueue<NodeCountingP2.Message>> queues = new ConcurrentHashMap<>();

        @Override
        public void send(int fromId, int toId, String message) {
            queues.computeIfAbsent(toId, k -> new LinkedBlockingQueue<>()).add(new NodeCountingP2.Message(fromId, message));
        }

        @Override
        public NodeCountingP2.Message receive(int nodeId) {
            try {
                return queues.computeIfAbsent(nodeId, k -> new LinkedBlockingQueue<>()).poll(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }
}
