package sjer.red.from_2026;

import java.util.Iterator;
import java.util.List;
import java.util.Stack;

public class FlattenNested implements Iterator<Integer> {


    Stack<Iterator<NestedInteger>> stack = new Stack<>();

    // basic idea
    // we have a list of integers nested arbitrarily deep
    // we want an iterator that can go through one-by-one
    //
    // what's tricky here?
    // we are going to have to somehow keep track of an arbitrary position.
    // I think we'll want to know:
    // current pos in the overall list
    // depth
    // pos in nested list
    //
    // e.g.
    // [0, 1, [[[3, 4, 5]]]]
    // it is trivial to represent where 0/1 are:
    //
    // 3,4,5 are harder. we'd need to say: overall current pos is `2`, depth `3`, depth pos is `0/1/2`
    // this works ASSUMING the follow is not valid: [0, 1, [[[3, 4, [5]]]]]
    // if the above is valid, we need a more structured approach, probably a class/object with similar structure to `NestedInteger`
    // the spec seems to allow the trouble case I mentioned.
    //
    // consider type Pos = { int index; int depth; Pos?: more; }
    // we could represent `5` as:
    // { index: 2, depth: 3, more: { index: 0, depth: 1 }}
    // I think this would work, but it is pretty annoying.
    // algorithmically it is going to be a little complex, too.
    //
    // Claude gave me the answer... when I asked it not to
    // It mentioned Stacks + iterators.
    // my thought:
    // push an iterator when entering a list
    // pop when exiting
    List<NestedInteger> list;
    NestedInteger nextVal = null;

    public FlattenNested(List<NestedInteger> nestedList) {
        this.list = nestedList;
        stack.push(nestedList.iterator());
    }

    @Override
    public Integer next() {
        var val = nextVal.getInteger();
        nextVal = null;
        return val;
    }

    @Override
    public boolean hasNext() {
        if (nextVal != null) {
            return true;
        }

        while (!stack.isEmpty()) {
            // push all lists
            while (stack.peek().hasNext()) {
                nextVal = stack.peek().next();
                if (nextVal.isInteger()) {
                    return true;
                }
                stack.push(nextVal.getList().iterator());
                nextVal = null;
            }

            // clear any empty lists
            while (!stack.isEmpty() && !stack.peek().hasNext()) {
                stack.pop();
            }
        }

        return !stack.isEmpty();
    }

    // [[]]
    // got caught on this for 5-10min, had to ask Claude
    // best solution: have hasNext prime next such that next is a simpler lookup

    // This is the interface that allows for creating nested lists.
    // You should not implement it, or speculate about its implementation
    public interface NestedInteger {
        // @return true if this NestedInteger holds a single integer, rather than a nested list.
        boolean isInteger();

        // @return the single integer that this NestedInteger holds, if it holds a single integer
        // Return null if this NestedInteger holds a nested list
        Integer getInteger();

        // @return the nested list that this NestedInteger holds, if it holds a nested list
        // Return empty list if this NestedInteger holds a single integer
        List<NestedInteger> getList();
    }

    /**
     * Your NestedIterator object will be instantiated and called as such:
     * NestedIterator i = new NestedIterator(nestedList);
     * while (i.hasNext()) v[f()] = i.next();
     */
}
