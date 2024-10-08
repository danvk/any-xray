import { describe, it, expect } from 'vitest';
import { union, arrayUnion } from 'interval-operations';

type Interval = [number, number];

describe('interval-set', () => {
  it('should union intervals', () => {
    let set: Interval[] = [[1, 3], [5, 7], [9, 11]];
    set = union(...set, [2, 6]);
    expect(set).toEqual([[1, 7], [9, 11]]);
  });
});
