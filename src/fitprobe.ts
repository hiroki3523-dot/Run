/**
 * 【調査用】FIT ファイルの中に、ワークアウトの区間 (アップ・メイン・ダウン・レスト) の情報があるかを調べる。
 * 取り込み (fit.ts・coros.ts) とは別の読み取り専用の処理。保存はしない。
 * 見るもの:
 *  - lap (19): intensity (23: 0 運動・1 レスト・2 ウォームアップ・3 クールダウン・4 回復・5 インターバル)・lap_trigger (24)・wkt_step_index (71)
 *  - workout (26)・workout_step (27): ステップ名・種類・長さ・目標
 *  - そのほか、ファイルに入っているメッセージの種類と件数
 */
export const INTENSITY = ['運動', 'レスト', 'ウォームアップ', 'クールダウン', '回復', 'インターバル', 'その他'];
export const LAP_TRIGGER = ['手動', '時間', '距離', '位置 (開始)', '位置 (ラップ)', '位置 (地点)', '位置 (印)', '終了', 'フィットネス機器'];
export const DURATION_TYPE: Record<number, string> = { 0: '時間', 1: '距離', 2: '心拍以下', 3: '心拍以上', 4: 'カロリー', 5: '開く (手動)', 6: '前のステップから繰り返し', 28: 'パワー以下', 29: 'パワー以上' };

export interface ProbeLap { i: number; start: number | null; dist_m: number | null; timer_s: number | null; intensity: string | null; trigger: string | null; step: number | null }
export interface ProbeStep { i: number | null; name: string; duration: string; value: number | null; target_type: number | null; low: number | null; high: number | null; intensity: string | null; notes: string }
export interface FitProbe { messages: Record<string, number>; laps: ProbeLap[]; workout: { name: string; steps: number | null } | null; steps: ProbeStep[] }

const NAMES: Record<number, string> = { 0: 'file_id', 18: 'session', 19: 'lap', 20: 'record', 21: 'event', 23: 'device_info', 26: 'workout', 27: 'workout_step', 34: 'activity', 49: 'file_creator', 206: 'field_description', 207: 'developer_data_id', 312: 'split', 313: 'split_summary' };

export function probeFit(buf: ArrayBuffer): FitProbe {
  const v = new DataView(buf);
  const out: FitProbe = { messages: {}, laps: [], workout: null, steps: [] };
  if (buf.byteLength < 12) throw new Error('FIT ファイルが短すぎます');
  const headerSize = v.getUint8(0);
  const end = Math.min(buf.byteLength, headerSize + v.getUint32(4, true));
  const defs = new Map<number, { little: boolean; global: number; fields: { num: number; size: number; base: number }[]; size: number }>();
  let p = headerSize;
  const str = (at: number, size: number) => { let t = ''; for (let k = 0; k < size && at + k < buf.byteLength; k++) { const c = v.getUint8(at + k); if (!c) break; t += String.fromCharCode(c); } try { return decodeURIComponent(escape(t)); } catch { return t; } };
  const num = (at: number, base: number, size: number, little: boolean): number | null => {
    const t = base & 0x1f;
    if (at + size > buf.byteLength) return null;
    if (t === 0 || t === 2 || t === 10 || t === 13) { const x = v.getUint8(at); return x === 0xff ? null : x; }
    if (t === 1) { const x = v.getInt8(at); return x === 0x7f ? null : x; }
    if ((t === 3) && size >= 2) { const x = v.getInt16(at, little); return x === 0x7fff ? null : x; }
    if ((t === 4 || t === 11) && size >= 2) { const x = v.getUint16(at, little); return x === 0xffff ? null : x; }
    if (t === 5 && size >= 4) { const x = v.getInt32(at, little); return x === 0x7fffffff ? null : x; }
    if ((t === 6 || t === 12) && size >= 4) { const x = v.getUint32(at, little); return x === 0xffffffff ? null : x; }
    return null;
  };
  while (p < end) {
    const h = v.getUint8(p++);
    let d;
    if (h & 0x80) d = defs.get((h >> 5) & 0x03);
    else if (h & 0x40) {
      const little = v.getUint8(p + 1) === 0;
      const global = v.getUint16(p + 2, little);
      const n = v.getUint8(p + 4);
      p += 5;
      const fields = [];
      let size = 0;
      for (let k = 0; k < n; k++) { const f = { num: v.getUint8(p), size: v.getUint8(p + 1), base: v.getUint8(p + 2) }; fields.push(f); size += f.size; p += 3; }
      if (h & 0x20) { const nd = v.getUint8(p++); for (let k = 0; k < nd; k++) { size += v.getUint8(p + 1); p += 3; } }
      defs.set(h & 0x0f, { little, global, fields, size });
      continue;
    } else d = defs.get(h & 0x0f);
    if (!d) throw new Error('FIT: 定義のないメッセージ');
    const key = `${d.global}${NAMES[d.global] ? ` ${NAMES[d.global]}` : ''}`;
    out.messages[key] = (out.messages[key] ?? 0) + 1;
    if ([19, 26, 27].includes(d.global)) {
      const f: Record<number, number | null> = {}, s: Record<number, string> = {};
      let o = p;
      for (const fd of d.fields) { if ((fd.base & 0x1f) === 7) s[fd.num] = str(o, fd.size); else f[fd.num] = num(o, fd.base, fd.size, d.little); o += fd.size; }
      const lab = (arr: string[], x: number | null | undefined) => (x == null ? null : arr[x] ?? `${x}`);
      if (d.global === 19) out.laps.push({ i: f[254] ?? out.laps.length, start: f[2] ?? null, dist_m: f[9] == null ? null : Math.round(f[9]! / 100), timer_s: f[8] == null ? null : Math.round(f[8]! / 1000), intensity: lab(INTENSITY, f[23]), trigger: lab(LAP_TRIGGER, f[24]), step: f[71] ?? null });
      else if (d.global === 26) out.workout = { name: s[8] ?? '', steps: f[6] ?? null };
      else out.steps.push({ i: f[254] ?? null, name: s[0] ?? '', duration: f[1] == null ? '-' : DURATION_TYPE[f[1]!] ?? `${f[1]}`, value: f[2] ?? null, target_type: f[3] ?? null, low: f[5] ?? null, high: f[6] ?? null, intensity: lab(INTENSITY, f[7]), notes: s[8] ?? '' });
    }
    p += d.size;
  }
  return out;
}

/** COROS のラップ API の返り値の「形」をまとめる (どのキーがあるか・グループごとのラップの数と中身) */
export function probeLapJson(j: any): { keys: string[]; groups: { keys: string[]; info: Record<string, unknown>; count: number; lapKeys: string[]; laps: Record<string, unknown>[] }[]; used_by_import: number | null } {
  const root = j?.data ?? j ?? {};
  const groups: any[] = Array.isArray(root.lapGroups) ? root.lapGroups : [];
  const scalar = (o: any) => Object.fromEntries(Object.entries(o ?? {}).filter(([, x]) => x == null || typeof x !== 'object'));
  const lens = groups.map((g) => g.laps?.length ?? 0);
  return {
    keys: Object.keys(root),
    groups: groups.map((g) => ({
      keys: Object.keys(g ?? {}),
      info: scalar(g),
      count: g.laps?.length ?? 0,
      lapKeys: [...new Set((g.laps ?? []).flatMap((l: any) => Object.keys(l ?? {})))] as string[],
      laps: (g.laps ?? []).slice(0, 40).map(scalar),
    })),
    // 取り込み (buildExt) は、ラップの数が一番多いグループを使っている
    used_by_import: groups.length ? lens.indexOf(Math.max(...lens)) : null,
  };
}
