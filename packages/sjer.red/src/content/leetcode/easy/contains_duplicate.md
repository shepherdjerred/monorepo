---
title: "Contains Duplicate"
date: 2024-06-11Z-0700
leetcode: true
---

## Problem

Given an integer array nums, return true if any value appears at least twice in the array, and return false if every element is distinct.

Example 1:

```text
Input: nums = [1,2,3,1]
Output: true
Example 2:

Input: nums = [1,2,3,4]
Output: false
Example 3:

Input: nums = [1,1,1,3,3,4,3,2,4,2]
Output: true
```

Constraints:

- 1 <= nums.length <= 10^5
- -10^9 <= nums[i] <= 10^9

## Solution

There are a few ways to go about this. If the array were sorted this could be done in O(n) time with O(1) space, but unfortunately a sorted array is not guarenteed.

### Naive

```java
class Solution {
    // naive solution will be O(n^2)
    // sorting the array beforehand would make this O(n*log(n)) with O(n) verification
    // we could use a HashMap (or HashSet). O(1) insert/lookup in the average case, O(n) worst case
    // will use O(n) storage
    public boolean containsDuplicate(int[] nums) {
        var set = new HashSet<Integer>();
        for (int i = 0; i < nums.length; i++) {
            var val = nums[i];
            if (set.contains(val)) {
                return true;
            }
            set.add(val);
        }
        return false;
    }
}
```
