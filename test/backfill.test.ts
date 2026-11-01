import { describe, expect, it } from 'vitest';
import { nextSegment } from '../src/backfill';

describe('backfill', () => {
  it('区間が終わったら次の開始位置へ進み、なくなったら null', () => {
    const st = { then: [100, 200] as number[] | undefined };
    expect(nextSegment(st)).toBe(100);
    expect(nextSegment(st)).toBe(200);
    expect(nextSegment(st)).toBeNull();
    expect(nextSegment({ then: undefined })).toBeNull();
  });
});
