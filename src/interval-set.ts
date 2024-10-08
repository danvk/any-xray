import { arrayDifference, arrayUnion, contains } from "interval-operations";

export type Interval = [number, number];

/** Closed interval to half-open interval */
function open([a, b]: Interval): Interval {
  return [a, b + 1];
}
/** Half-open interval to closed interval */
function close([a, b]: Interval): Interval {
  return [a, b - 1];
}

/** Do two half-open intervals intersect? */
export function intersects(a: Interval, b: Interval): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** All intervals coming in and out of this class are closed. */
export class IntervalSet {
  // Invariant: intervals are disjoint, sorted, half-open.
  intervals: Interval[] = [];

  /** Intervals are closed, need not be sorted or disjoint */
  constructor(intervals?: Interval[]) {
    for (const interval of intervals ?? []) {
      this.add(interval);
    }
  }

  isEmpty() {
    return this.intervals.length === 0;
  }

  /** Interval is closed */
  add(interval: Interval) {
    const openIv = open(interval);
    this.intervals = arrayUnion(this.intervals, [openIv]);
  }

  addOther(other: IntervalSet) {
    this.intervals = arrayUnion(this.intervals, other.intervals);
  }

  includes(n: number): boolean {
    for (const [a, b] of this.intervals) {
      if (n >= a && n < b) {
        return true;
      }
    }
    return false;
  }

  /** Interval is closed */
  contains(interval: Interval): boolean {
    const openIv = open(interval);
    return this.intervals.some((iv) => contains(iv, openIv));
  }

  intersects(interval: Interval): boolean {
    const openIv = open(interval);
    return this.intervals.some((iv) => intersects(openIv, iv));
  }

  /** Returns the parts of interval that are not covered in this set. */
  uncovered(interval: Interval): IntervalSet {
    const openIv = open(interval);
    const uncovered = arrayDifference([openIv], this.intervals);
    const out = new IntervalSet();
    out.intervals = uncovered;
    return out;
  }

  getIntervals(): Interval[] {
    return this.intervals.map(close);
  }
}
