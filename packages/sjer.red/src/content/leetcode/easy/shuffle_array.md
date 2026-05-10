---
title: "Shuffle an Array"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given an integer array nums, design an algorithm to randomly shuffle the array. All permutations of the array should be equally likely as a result of the shuffling.

Implement the Solution class:

- Solution(int[] nums) Initializes the object with the integer array nums.
- int[] reset() Resets the array to its original configuration and returns it.
- int[] shuffle() Returns a random shuffling of the array.

Example 1:

```text
Input
["Solution", "shuffle", "reset", "shuffle"]
[[[1, 2, 3]], [], [], []]
Output
[null, [3, 1, 2], [1, 2, 3], [1, 3, 2]]

Explanation
Solution solution = new Solution([1, 2, 3]);
solution.shuffle();    // Shuffle the array [1,2,3] and return its result.
                       // Any permutation of [1,2,3] must be equally likely to be returned.
                       // Example: return [3, 1, 2]
solution.reset();      // Resets the array back to its original configuration [1,2,3]. Return [1, 2, 3]
solution.shuffle();    // Returns the random shuffling of array [1,2,3]. Example: return [1, 3, 2]
```

Constraints:

- 1 <= nums.length <= 50
- -106 <= nums[i] <= 106
- All the elements of nums are unique.
- At most 104 calls in total will be made to reset and shuffle.

## Solution

Using the [Fisher-Yates algorithm](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) for an in-place shuffle.

I actually learned the Fisher-Yates algorithm via my Anki flashcards, so this was quite helpful!

```java
class Solution {

    int[] original;

    public Solution(int[] nums) {
        this.original = nums;
    }

    public int[] reset() {
        return this.original;
    }

    public int[] shuffle() {
        var r = new Random();
        var copy = new int[this.original.length];
        System.arraycopy(this.original, 0, copy, 0, this.original.length);
        for (int i = copy.length - 1; i > 0; i--) {
            var j = r.nextInt(i + 1);
            var tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
        }
        return copy;
    }
}

/**
 * Your Solution object will be instantiated and called as such:
 * Solution obj = new Solution(nums);
 * int[] param_1 = obj.reset();
 * int[] param_2 = obj.shuffle();
 */
```
