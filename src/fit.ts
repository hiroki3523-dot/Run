/**
 * FIT ファイル (時計の記録の標準形式) の最小限の読み取り。
 * セッション (合計)・ラップ・1 秒ごとの記録 (距離・速度・心拍・ピッチ・標高) だけを取り出す。
 */

export interface FitRecord { t: number; dist?: number; speed?: number; hr?: number; cad?: number; alt?: number; power?: number; gct?: number; vo?: number; vr?: number }
export interface FitLap { start: number; elapsed: number; timer: number; dist: number; avg_speed?: number; avg_hr?: number; max_hr?: number; avg_cad?: number }
export interface FitSession {
  start: number; elapsed: number; timer: number; dist: number; sport?: number; sub_sport?: number;
  avg_hr?: number; max_hr?: number; avg_cad?: number; ascent?: number; calories?: number;
}
export interface FitData { session: FitSession | null; laps: FitLap[]; records: FitRecord[]; tz_offset_s: number | null }

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z

interface FieldDef { num: number; size: number; base: number }
interface Def { little: boolean; global: number; fields: FieldDef[]; devSize: number; size: number }

function readValue(v: DataView, off: number, base: number, size: number, little: boolean): number | null {
  const t = base & 0x1f;
  // 配列 (サイズが型の倍数) は先頭だけ読む
  switch (t) {
    case 0x00: case 0x02: case 0x0a: case 0x0d: { const x = v.getUint8(off); return (t === 0x0a ? x === 0 : x === 0xff) ? null : x; }
    case 0x01: { const x = v.getInt8(off); return x === 0x7f ? null : x; }
    case 0x03: { if (size < 2) return null; const x = v.getInt16(off, little); return x === 0x7fff ? null : x; }
    case 0x04: case 0x0b: { if (size < 2) return null; const x = v.getUint16(off, little); return (t === 0x0b ? x === 0 : x === 0xffff) ? null : x; }
    case 0x05: { if (size < 4) return null; const x = v.getInt32(off, little); return x === 0x7fffffff ? null : x; }
    case 0x06: case 0x0c: { if (size < 4) return null; const x = v.getUint32(off, little); return (t === 0x0c ? x === 0 : x === 0xffffffff) ? null : x; }
    case 0x08: { if (size < 4) return null; const x = v.getFloat32(off, little); return Number.isFinite(x) ? x : null; }
    case 0x09: { if (size < 8) return null; const x = v.getFloat64(off, little); return Number.isFinite(x) ? x : null; }
    default: return null; // 文字列・64 ビットなどは使わない
  }
}

export function parseFit(buf: ArrayBuffer): FitData {
  const v = new DataView(buf);
  const out: FitData = { session: null, laps: [], records: [], tz_offset_s: null };
  if (buf.byteLength < 12) throw new Error('FIT ファイルが短すぎます');
  const headerSize = v.getUint8(0);
  const dataSize = v.getUint32(4, true);
  if (String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11)) !== '.FIT') throw new Error('FIT ファイルではありません');
  const end = Math.min(buf.byteLength, headerSize + dataSize);
  const defs = new Map<number, Def>();
  let p = headerSize;
  let lastTs = 0;

  while (p < end) {
    const h = v.getUint8(p++);
    if (h & 0x80) {
      // 時刻を圧縮したヘッダー (下位 5 ビットが時刻のずれ)
      const local = (h >> 5) & 0x03;
      const off = h & 0x1f;
      const ts = (lastTs & 0xffffffe0) + off + (off < (lastTs & 0x1f) ? 0x20 : 0);
      lastTs = ts;
      const d = defs.get(local);
      if (!d) throw new Error('FIT: 定義のないメッセージ');
      handle(d, p, ts);
      p += d.size;
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const little = v.getUint8(p + 1) === 0;
      const global = v.getUint16(p + 2, little);
      const n = v.getUint8(p + 4);
      p += 5;
      const fields: FieldDef[] = [];
      let size = 0;
      for (let i = 0; i < n; i++) {
        const f = { num: v.getUint8(p), size: v.getUint8(p + 1), base: v.getUint8(p + 2) };
        fields.push(f);
        size += f.size;
        p += 3;
      }
      let devSize = 0;
      if (h & 0x20) {
        const nd = v.getUint8(p++);
        for (let i = 0; i < nd; i++) { devSize += v.getUint8(p + 1); p += 3; }
      }
      defs.set(local, { little, global, fields, devSize, size: size + devSize });
    } else {
      const d = defs.get(local);
      if (!d) throw new Error('FIT: 定義のないメッセージ');
      handle(d, p, null);
      p += d.size;
    }
  }
  return out;

  function handle(d: Def, at: number, compressedTs: number | null) {
    if (![18, 19, 20, 34].includes(d.global)) return;
    const f: Record<number, number | null> = {};
    let o = at;
    for (const fd of d.fields) {
      f[fd.num] = o + fd.size <= buf.byteLength ? readValue(v, o, fd.base, fd.size, d.little) : null;
      o += fd.size;
    }
    if (f[253] != null) lastTs = f[253]!;
    const ts = f[253] ?? compressedTs;
    const n = (k: number, scale = 1, offset = 0) => (f[k] == null ? undefined : f[k]! / scale - offset);
    if (d.global === 20) {
      if (ts == null) return;
      const speed = n(73, 1000) ?? n(6, 1000);
      const alt = n(78, 5, 500) ?? n(2, 5, 500);
      const cad = f[4] == null ? undefined : f[4]! + (f[53] != null ? f[53]! / 128 : 0);
      // パワー (W)・接地時間 (ms)・上下動 (cm)・垂直歩幅比 (%)。COROS などランニングダイナミクスのある時計だけ
      out.records.push({ t: ts + FIT_EPOCH, dist: n(5, 100), speed, hr: n(3), cad, alt, power: n(7), gct: n(41, 10), vo: f[39] == null ? undefined : f[39]! / 100, vr: n(83, 100) });
    } else if (d.global === 19) {
      out.laps.push({
        start: (f[2] ?? ts ?? 0) + FIT_EPOCH, elapsed: n(7, 1000) ?? 0, timer: n(8, 1000) ?? 0, dist: n(9, 100) ?? 0,
        avg_speed: n(110, 1000) ?? n(13, 1000), avg_hr: n(15), max_hr: n(16), avg_cad: n(17),
      });
    } else if (d.global === 18) {
      out.session = {
        start: (f[2] ?? ts ?? 0) + FIT_EPOCH, elapsed: n(7, 1000) ?? 0, timer: n(8, 1000) ?? 0, dist: n(9, 100) ?? 0,
        sport: n(5), sub_sport: n(6), avg_hr: n(16), max_hr: n(17), avg_cad: n(18), ascent: n(22), calories: n(11),
      };
    } else if (d.global === 34) {
      // activity: local_timestamp (5) − timestamp (253) が時差
      if (f[5] != null && f[253] != null) out.tz_offset_s = f[5]! - f[253]!;
    }
  }
}
