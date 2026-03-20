---
title: "Combination Sum"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

Given an array of distinct integers candidates and a target integer target, return a list of all unique combinations of candidates where the chosen numbers sum to target. You may return the combinations in any order.

The same number may be chosen from candidates an unlimited number of times. Two combinations are unique if the
frequency
of at least one of the chosen numbers is different.

The test cases are generated such that the number of unique combinations that sum up to target is less than 150 combinations for the given input.

Example 1:

```text
Input: candidates = [2,3,6,7], target = 7
Output: [[2,2,3],[7]]
Explanation:
2 and 3 are candidates, and 2 + 2 + 3 = 7. Note that 2 can be used multiple times.
7 is a candidate, and 7 = 7.
These are the only two combinations.
```

Example 2:

```text
Input: candidates = [2,3,5], target = 8
Output: [[2,2,2,2],[2,3,3],[3,5]]
```

Example 3:

```text
Input: candidates = [2], target = 1
Output: []
```

Constraints:

- 1 <= candidates.length <= 30
- 2 <= candidates[i] <= 40
- All elements of candidates are distinct.
- 1 <= target <= 40

## Solution

```java
class Solution {
    public List<List<Integer>> combinationSum(int[] candidates, int target) {
        var answers = new ArrayList<List<Integer>>();
        solve(candidates, 0, target, List.of(), answers);
        return answers;
    }

    public void solve(int[] candidates, int n, int target, List<Integer> current, List<List<Integer>> answers) {
        var sum = current.stream().reduce(Integer::sum).orElse(0);

        if (sum == target) {
            answers.add(current);
            return;
        }

        for (var i = n; i < candidates.length; i++) {
            if (sum + candidates[i] > target) {
                continue;
            }
            var copy = new ArrayList<>(current);
            copy.add(candidates[i]);
            solve(candidates, i, target, copy, answers);
        }
    }
}
```
