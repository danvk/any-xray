import { describe, it, expect } from 'vitest';

import {Interval, IntervalSet} from '../interval-set';

describe('interval-set', () => {
  it('should union intervals', () => {
    const set = new IntervalSet([[1, 3], [5, 7]]);
    expect(set.getIntervals()).toEqual([[1, 3], [5, 7]]);
    set.add([4, 4]);
    expect(set.getIntervals()).toEqual([[1, 7]]);
  });
});
