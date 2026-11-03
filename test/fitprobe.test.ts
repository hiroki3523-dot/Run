import { describe, expect, it } from 'vitest';
import { probeFit, probeLapJson } from '../src/fitprobe';

/** テスト用の小さな FIT を作る (lap に区間の種類とステップ番号、workout_step にステップ名) */
function makeFit(laps: { dist: number; timer: number; intensity: number; step: number }[], steps: { name: string; type: number; value: number; intensity: number }[]) {
  const b: number[] = [];
  const u8 = (x: number) => b.push(x & 0xff);
  const u16 = (x: number) => { u8(x); u8(x >> 8); };
  const u32 = (x: number) => { u16(x); u16(x >>> 16); };
  // workout_step の定義 (local 1)
  u8(0x41); u8(0); u8(0); u16(27); u8(4);
  for (const [n, sz, base] of [[254, 2, 0x84], [0, 16, 0x07], [1, 1, 0x00], [2, 4, 0x86]]) { u8(n); u8(sz); u8(base); }
  steps.forEach((s, i) => { u8(0x01); u16(i); const t = Buffer.from(s.name, 'utf8'); for (let k = 0; k < 16; k++) u8(t[k] ?? 0); u8(s.type); u32(s.value); });
  // lap の定義 (local 0)
  u8(0x40); u8(0); u8(0); u16(19); u8(6);
  for (const [n, sz, base] of [[254, 2, 0x84], [8, 4, 0x86], [9, 4, 0x86], [23, 1, 0x00], [24, 1, 0x00], [71, 2, 0x84]]) { u8(n); u8(sz); u8(base); }
  laps.forEach((l, i) => { u8(0x00); u16(i); u32(l.timer * 1000); u32(l.dist * 100); u8(l.intensity); u8(7); u16(l.step); });
  const head = [14, 0x10, 0x34, 0x08, b.length & 0xff, (b.length >> 8) & 0xff, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...head, ...b, 0, 0]).buffer;
}

describe('区間の調査 (FIT・ラップ API の読み取り)', () => {
  it('lap の区間の種類 (ウォームアップ・運動・クールダウン) とステップ番号を読める', () => {
    const fit = makeFit(
      [{ dist: 3000, timer: 990, intensity: 2, step: 0 }, { dist: 10000, timer: 2700, intensity: 0, step: 1 }, { dist: 2000, timer: 660, intensity: 3, step: 2 }],
      [{ name: 'Warm up', type: 1, value: 300000, intensity: 2 }, { name: 'Main', type: 1, value: 1000000, intensity: 0 }, { name: 'Cool down', type: 1, value: 200000, intensity: 3 }],
    );
    const p = probeFit(fit);
    expect(p.laps.map((l) => l.intensity)).toEqual(['ウォームアップ', '運動', 'クールダウン']);
    expect(p.laps.map((l) => l.step)).toEqual([0, 1, 2]);
    expect(p.laps[1].dist_m).toBe(10000);
    expect(p.steps.map((s) => s.name)).toEqual(['Warm up', 'Main', 'Cool down']);
    expect(p.steps[1].duration).toBe('距離');
    expect(p.messages['19 lap']).toBe(3);
    expect(p.messages['27 workout_step']).toBe(3);
  });
  it('ラップ API の形をまとめ、取り込みが使うグループ (ラップが一番多いもの) を示す', () => {
    const j = { data: { lapGroups: [
      { type: 2, laps: [{ distance: 300000, time: 990, type: 'warmup' }, { distance: 1000000, time: 2700, type: 'active' }] },
      { type: 1, laps: Array.from({ length: 15 }, () => ({ distance: 100000, time: 270 })) },
    ] } };
    const r = probeLapJson(j);
    expect(r.groups.length).toBe(2);
    expect(r.used_by_import).toBe(1);
    expect(r.groups[0].lapKeys).toContain('type');
    expect(r.groups[0].info).toEqual({ type: 2 });
  });
});
