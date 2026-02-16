---
title: "Find All Numbers Disappeared in an Array"
date: 2024-08-14Z-0700
leetcode: true
---

## Problem

Given an array nums of n integers where nums[i] is in the range [1, n], return an array of all the integers in the range [1, n] that do not appear in nums.

Example 1:

```text
Input: nums = [4,3,2,7,8,2,3,1]
Output: [5,6]
```

Example 2:

```text
Input: nums = [1,1]
Output: [2]
```

Constraints:

- n == nums.length
- 1 <= n <= 105
- 1 <= nums[i] <= n

Follow up: Could you do it without extra space and in O(n) runtime? You may assume the returned list does not count as extra space.

## Solution

```java
class Solution {
    public List<Integer> findDisappearedNumbers(int[] nums) {
        // cyclic sort
        var i = 0;
        while (i < nums.length) {
            var dst = nums[i] - 1;
            if (nums[dst] == nums[i]) {
                i += 1;
            } else {
                swap(nums, i, dst);
            }
        }

        var ans = new ArrayList<Integer>();
        for (i = 0; i < nums.length; i++) {
            if (nums[i] != i + 1) {
                ans.add(i + 1);
            }
        }
        return ans;
    }

    void swap(int[] nums, int x, int y) {
        nums[x] ^= nums[y];
        nums[y] ^= nums[x];
        nums[x] ^= nums[y];
    }
}
```
