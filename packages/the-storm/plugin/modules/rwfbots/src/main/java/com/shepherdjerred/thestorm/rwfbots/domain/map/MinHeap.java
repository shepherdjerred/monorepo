package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.Arrays;

/** A binary min-heap of (key, node) pairs over primitive arrays, for A* and Dijkstra. */
final class MinHeap {

  private float[] keys;
  private int[] nodes;
  private int size;

  MinHeap(int capacity) {
    keys = new float[Math.max(16, capacity)];
    nodes = new int[keys.length];
  }

  boolean isEmpty() {
    return size == 0;
  }

  void push(float key, int node) {
    if (size == keys.length) {
      keys = Arrays.copyOf(keys, size * 2);
      nodes = Arrays.copyOf(nodes, size * 2);
    }
    var i = size++;
    while (i > 0) {
      var parent = (i - 1) / 2;
      if (keys[parent] <= key) {
        break;
      }
      keys[i] = keys[parent];
      nodes[i] = nodes[parent];
      i = parent;
    }
    keys[i] = key;
    nodes[i] = node;
  }

  float peekKey() {
    return keys[0];
  }

  /** Removes and returns the node with the smallest key. */
  int pop() {
    var top = nodes[0];
    size--;
    if (size > 0) {
      var key = keys[size];
      var node = nodes[size];
      var i = 0;
      while (true) {
        var child = 2 * i + 1;
        if (child >= size) {
          break;
        }
        if (child + 1 < size && keys[child + 1] < keys[child]) {
          child++;
        }
        if (keys[child] >= key) {
          break;
        }
        keys[i] = keys[child];
        nodes[i] = nodes[child];
        i = child;
      }
      keys[i] = key;
      nodes[i] = node;
    }
    return top;
  }
}
