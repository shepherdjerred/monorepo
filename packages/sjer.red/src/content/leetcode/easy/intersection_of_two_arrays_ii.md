---
title: "Intersection of Two Arrays II"
date: 2024-06-13Z-0700
leetcode: true
---

## Problem

Given two integer arrays nums1 and nums2, return an array of their intersection. Each element in the result must appear as many times as it shows in both arrays and you may return the result in any order.

Example 1:

```text
Input: nums1 = [1,2,2,1], nums2 = [2,2]
Output: [2,2]
Example 2:

Input: nums1 = [4,9,5], nums2 = [9,4,9,8,4]
Output: [4,9]
Explanation: [9,4] is also accepted.
```

Constraints:

- 1 <= nums1.length, nums2.length <= 1000
- 0 <= nums1[i], nums2[i] <= 1000

Follow up:

- What if the given array is already sorted? How would you optimize your algorithm?
- What if nums1's size is small compared to nums2's size? Which algorithm is better?
- What if elements of nums2 are stored on disk, and the memory is limited such that you cannot load all elements into the memory at once?

## Solution

Gross code.

```java
class Solution {
    // space: o(n)
    // time: o(n)
    public int[] intersect(int[] nums1, int[] nums2) {
        var counts1 = new HashMap<Integer, Integer>();
        var counts2 = new HashMap<Integer, Integer>();
        for (var i : nums1) {
            counts1.compute(i, (key, value) -> (value == null) ? 1 : value + 1);
        }
        for (var i : nums2) {
            counts2.compute(i, (key, value) -> (value == null) ? 1 : value + 1);
        }

        var intersection = new ArrayList<Integer>();
        for (var entry : counts1.entrySet()) {
            var val1 = counts1.get(entry.getKey());
            var val2 = counts2.getOrDefault(entry.getKey(), 0);

            while (val1 != 0 && val2 != 0) {
                val1 -= 1;
                val2 -= 1;
                intersection.add(entry.getKey());
            }
        }

        // convert type
        var out = new int[intersection.size()];
        for (var i = 0; i < out.length; i++) {
            out[i] = intersection.get(i);
        }
        return out;
    }
}
```
