package sjer.red.from_2026;

public class FlattenVector {
    // this can be done O(n)
    // 1. track which array we are in
    // 2. track position are are in of that array
    // print.
    int outerPos = 0;
    int innerPos = 0;
    int[][] vec;

    // [[], []]]
    // il = 3
    // ol = 5
    //
    // ip = 0
    // op = 3

    public FlattenVector(int[][] vec) {
        this.vec = vec;
        // bootstrap the first read
        prime();
    }

    // this will setup the iterator to the next valid value
    public void prime() {
        var outerLength = vec.length;
        if (outerLength == 0) {
            // empty input
            outerPos = -1;
            innerPos = -1;
            return;
        }
        // check if we have exhausted the inner. if we have, we need the next outer
        while (innerPos >= vec[outerPos].length) {
            outerPos += 1;
            innerPos = 0;
            if (outerPos >= outerLength) {
                // exhausted
                outerPos = -1;
                innerPos = -1;
                return;
            }
        }
    }

    public int next() {
        var val = vec[outerPos][innerPos];
        innerPos += 1;
        prime();
        return val;
    }

    public boolean hasNext() {
        return outerPos != -1;
    }
}
