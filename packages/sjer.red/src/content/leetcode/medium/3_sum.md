---
title: "3 Sum"
date: 2024-07-31Z-0700
leetcode: true
---

## Problem

Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0.

Notice that the solution set must not contain duplicate triplets.

Example 1:

```text
Input: nums = [-1,0,1,2,-1,-4]
Output: [[-1,-1,2],[-1,0,1]]
Explanation:
nums[0] + nums[1] + nums[2] = (-1) + 0 + 1 = 0.
nums[1] + nums[2] + nums[4] = 0 + 1 + (-1) = 0.
nums[0] + nums[3] + nums[4] = (-1) + 2 + (-1) = 0.
The distinct triplets are [-1,0,1] and [-1,-1,2].
Notice that the order of the output and the order of the triplets does not matter.
```

Example 2:

```text
Input: nums = [0,1,1]
Output: []
Explanation: The only possible triplet does not sum up to 0.
```

Example 3:

```text
Input: nums = [0,0,0]
Output: [[0,0,0]]
Explanation: The only possible triplet sums up to 0.
```

Constraints:

- 3 <= nums.length <= 3000
- -105 <= nums[i] <= 105

## Solution

Nobody could possibly derive this during an interview.

```java
class Solution {
    public List<List<Integer>> threeSum(int[] nums) {
        Arrays.sort(nums);
        var ans = new ArrayList<List<Integer>>();
        for (var i = 0; i < nums.length - 2; i++) {
            if (i > 0 && nums[i] == nums[i - 1]) {
                continue;
            }
            twoSum(nums, i, ans);
        }
        return ans;
    }

    public void twoSum(int[] nums, int i, List<List<Integer>> ans) {
        var li = i + 1;
        var ri = nums.length - 1;
        while (li < ri) {
            var sum = nums[li] + nums[ri] + nums[i];
            if (sum == 0) {
                ans.add(List.of(nums[i], nums[li], nums[ri]));
                li += 1;
                ri -= 1;
                while (li < ri && nums[li] == nums[li - 1]) {
                    li += 1;
                }
            } else if (sum < 0) {
                li += 1;
            } else {
                ri -= 1;
            }
        }
    }
}
```
