---
title: "Top k Frequent Elements"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

Given an integer array nums and an integer k, return the k most frequent elements. You may return the answer in any order.

Example 1:

```text
Input: nums = [1,1,1,2,2,3], k = 2
Output: [1,2]
```

Example 2:

```text
Input: nums = [1], k = 1
Output: [1]
```

Constraints:

- 1 <= nums.length <= 105
- -104 <= nums[i] <= 104
- k is in the range [1, the number of unique elements in the array].
- It is guaranteed that the answer is unique.

Follow up: Your algorithm's time complexity must be better than O(n log n), where n is the array's size.

## Solution

This isn't too hard to brute force. Sort the array then iterate until you find the first k unique values.

A more efficient way would be using a heap.

1. Build a HashMap of number -> freq (O(n))
1. Build a min heap
   - While building, ensure that the size is never > k
   - This felt crazy to me, but it actually works. I need to determine the time complexity of these operations.
1. Take the top k items from the heap -> freq O(n \* log k)

```java
class Solution {
    public int[] topKFrequent(int[] nums, int k) {
        var m = new HashMap<Integer, Integer>();

        for (var n : nums) {
            m.merge(n, 1, Integer::sum);
        }

        // min pq
        // we want to pin this to k elements, so we want the min to float to the
        // top so that it can be removed
        var pq = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(m.get(l), m.get(r));
        });

        // iterate over the map, insert, pin pq size to k
        for (var key : m.keySet()) {
            pq.offer(key);

            if (pq.size() > k) {
                pq.poll();
            }
        }

        // convert the pq to an array
        var out = new int[k];
        for (int i = 0; i < k; i++) {
            out[i] = pq.poll();
        }
        return out;
    }
}
```
