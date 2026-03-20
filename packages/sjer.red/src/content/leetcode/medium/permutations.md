---
title: "Permutations"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

Given an array nums of distinct integers, return all the possible permutations. You can return the answer in any order.

Example 1:

```text
Input: nums = [1,2,3]
Output: [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]
```

Example 2:

```text
Input: nums = [0,1]
Output: [[0,1],[1,0]]
```

Example 3:

```text
Input: nums = [1]
Output: [[1]]
```

Constraints:

- 1 <= nums.length <= 6
- -10 <= nums[i] <= 10
- All the integers of nums are unique.

## Solution

I thought this was solvable with recursion, but it turns out it's actually a backtracking problem.

Time complexity: O(n \* n!)

Space complexity: O(n)

```java
class Solution {
    public List<List<Integer>> permute(int[] nums) {
        var answer = new ArrayList<List<Integer>>();
        permute(nums, List.of(), answer);
        return answer;
    }

    public void permute(int[] nums, List<Integer> curr, List<List<Integer>> answer) {
        if (curr.size() == nums.length) {
            answer.add(curr);
        }

        for (var n : nums) {
            if (curr.contains(n)) {
                continue;
            }
            var l = new ArrayList<>(curr);
            l.add(n);
            permute(nums, l, answer);
        }
    }
}
```
