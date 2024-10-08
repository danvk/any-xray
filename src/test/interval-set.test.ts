import { describe, it, expect } from 'vitest';

import {intersects, IntervalSet} from '../interval-set';

describe('interval-set', () => {
  it('should fill gaps', () => {
    const set = new IntervalSet([[1, 3], [5, 7]]);
    expect(set.getIntervals()).toEqual([[1, 3], [5, 7]]);
    set.add([4, 4]);
    expect(set.getIntervals()).toEqual([[1, 7]]);
  });

  it('should union intervals', () => {
    const set = new IntervalSet([[1, 3], [7, 9]]);
    set.add([2, 4]);
    expect(set.getIntervals()).toEqual([[1, 4], [7, 9]]);
  });

  it('should check if a number is included', () => {
    const set = new IntervalSet([[1, 3], [5, 7]]);
    expect(set.includes(2)).toBe(true);
    expect(set.includes(3)).toBe(true);
    expect(set.includes(4)).toBe(false);
  });

  it('should check whether an IntervalSet contains an interval', () => {
    const set = new IntervalSet([[1, 3], [5, 7]]);
    expect(set.contains([1, 3])).toBe(true);
    expect(set.contains([1, 4])).toBe(false);
    expect(set.contains([1, 2])).toBe(true);

    const biggerSet = new IntervalSet([[1, 7]]);
    expect(biggerSet.contains([2, 6])).toBe(true);
    expect(biggerSet.contains([2, 8])).toBe(false);
    expect(biggerSet.contains([0, 8])).toBe(false);
    expect(biggerSet.contains([0, 7])).toBe(false);
    expect(biggerSet.contains([1, 7])).toBe(true);
  });

  it('should return the uncovered parts of an interval', () => {
    const set = new IntervalSet([[1, 3], [5, 7]]);
    let uncovered = set.uncovered([1, 7]);
    expect(uncovered.getIntervals()).toEqual([[4, 4]]);

    uncovered = set.uncovered([2, 9]);
    expect(uncovered.getIntervals()).toEqual([[4, 4], [8, 9]]);

    set.addOther(uncovered);
    expect(set.getIntervals()).toEqual([[1, 9]]);
  });

  it('should find intersecting intervals', () => {
    expect(intersects([0, 1], [1, 2])).toBe(false);
    expect(intersects([0, 2], [1, 2])).toBe(true);
    expect(intersects([10, 12], [9, 11])).toBe(true);
    expect(intersects([10, 12], [9, 10])).toBe(false);
  });

  it('should find intersecting intervals in an IntervalSet', () => {
    const set = new IntervalSet([[1, 3], [6, 8]]);
    expect(set.intersects([0, 1])).toBe(true);
    expect(set.intersects([0, 4])).toBe(true);
    expect(set.intersects([4, 5])).toBe(false);
    expect(set.intersects([4, 6])).toBe(true);
    expect(set.intersects([5, 7])).toBe(true);
    expect(set.intersects([3, 7])).toBe(true);
    expect(set.intersects([0, 9])).toBe(true);
    expect(set.intersects([9, 10])).toBe(false);
  });
});
