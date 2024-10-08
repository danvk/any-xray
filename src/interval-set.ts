export type Interval = [number, number];

function contains(interval: Interval, point: number) {
  const [start, end] = interval;
  return start <= point && point < end;
}

function overlaps(a: Interval, b: Interval) {
  const [aStart, aEnd] = a;
  const [bStart, bEnd] = b;
  return aStart < bEnd && bStart < aEnd;
}

export class IntervalSet {
  // Invariant: intervals are disjoint, sorted.
  intervals: Interval[] = [];

  constructor(intervals: Interval[]) {
    this.intervals = intervals;
  }

  add(interval: Interval) {
    if (this.intervals.length === 0) {
      this.intervals.push(interval);
      return;
    }

    const [start, end] = interval;
    // TODO: replace with binary search
    const i = this.intervals.findIndex((i) => i[0] > start);

  }
}