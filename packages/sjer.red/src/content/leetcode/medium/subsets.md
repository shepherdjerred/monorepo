---
title: "Subsets"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

Given an integer array nums of unique elements, return all possible
subsets
(the power set).

The solution set must not contain duplicate subsets. Return the solution in any order.

Example 1:

```text
Input: nums = [1,2,3]
Output: [[],[1],[2],[1,2],[3],[1,3],[2,3],[1,2,3]]
```

Example 2:

```text
Input: nums = [0]
Output: [[],[0]]
```

Constraints:

- 1 <= nums.length <= 10
- -10 <= nums[i] <= 10
- All the numbers of nums are unique.

## Solution

Time: 2^n

Space: n

```java
class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        var ans = new ArrayList<List<Integer>>();
        solve(nums, 0, List.of(), ans);
        return ans;
    }

    public void solve(int[] nums, int n, List<Integer> curr, List<List<Integer>> ans) {
        if (n == nums.length) {
            ans.add(curr);
            return;
        }
        // we have the choice of adding or not

        // don't add
        solve(nums, n + 1, curr, ans);

        // add
        var copy = new ArrayList<>(curr);
        copy.add(nums[n]);
        solve(nums, n + 1, copy, ans);
    }
}
```
