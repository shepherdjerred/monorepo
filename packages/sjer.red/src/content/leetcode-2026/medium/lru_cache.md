---
title: "LRU Cache"
date: 2026-03-22Z-0700
leetcode: true
---

## Problem

## Solution

I remembered the solution involved a list, but wasn't able to get to the end.

```java
class LRUCache {

    // basic LRU cache
    // has fixed capacity
    // on GET or PUT we consider the key used
    // on PUT, we evict IFF capacity is reached
    // we will definitely need a hashmap since that's foundational
    // we are not given "real time" so we should use some logic/virtual time source
    // easiest way to do this would be number of operations, but there is an overflow concern w/ that
    // in a real app we'd do something like get system time
    // we don't have system time. the only thing we really know about is when operations occur
    // O(n) complexity requirement for GET and PUSH
    // ah so perhaps we'd want a linked list or dequeue
    // this would still be an O(n) lookup though, so we'd need a way to go from key -> index
    //
    // ah the post lookup though, that would still be O(n) bc we'd need to propagate any updates
    // feels like there is a more elegant solution hiding here
    // we're now 7min in
    //
    // so my question is, how do I get O(1) lookup on a list?
    // we MUST have O(n) lookup because we need to move GET items to the back on access
    // and O(1) is a hard requirement
    // we MUST have a list/queue because it allows us to track relative usage (who came first, second, etc.)
    // well, it does say O(1) average so perhaps it is okay to amortize.
    // but, still, a GET would require O(n) to update indexes if we went with a secondary map approach
    // now we are 10min in
    // we could do something disgusting with pointers, e.g. make the pos field calculated
    //
    // looked at the solution. pretty sure it is going to make us use a custom class so we essentially use pointers
    // ok it didn't use dequeue at all

    int capacity;
    Map<Integer, Integer> cache;
    // HEAD: least recently used item
    // TAIL: most recently used item
    Deque<String> tracker;

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new HashMap<>();
    }

    public int get(int key) {
        // mark this as used
        // put it at the END of the tracker
        // if this already exists in the tracker, move it to the back
        // core issue here is traversing the tracker will be an O(n) operation
    }

    public void put(int key, int value) {

    }
}

/**
 * Your LRUCache object will be instantiated and called as such:
 * LRUCache obj = new LRUCache(capacity);
 * int param_1 = obj.get(key);
 * obj.put(key,value);
 */
```
