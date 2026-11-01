import { describe, expect, it } from 'vitest';
import { estimateWbgt, forecast, heatPaceCost, indexLabel, runIndex, wbgtLevel } from '../src/forecast';

describe('forecast', () => {
  it('暑さ指数は暑く湿って日射が強いほど高い', () => {
    const cool = estimateWbgt(10, 50, 0, 2);
    const hot = estimateWbgt(32, 70, 0.8, 1);
    expect(cool).toBeLessThan(15);
    expect(hot).toBeGreaterThan(28);
    expect(['厳重警戒', '運動は原則中止'].includes(wbgtLevel(hot))).toBe(true);
    expect(wbgtLevel(cool)).toBe('ほぼ安全');
  });
  it('走りやすさ: 涼しくて風が弱ければ最適、暑ければ避けたい', () => {
    const best = runIndex(8, 55, 1.5, 0, 0, estimateWbgt(8, 55, 0, 1.5));
    const hot = runIndex(33, 70, 1, 0, 0, estimateWbgt(33, 70, 0.8, 1));
    expect(best).toBeGreaterThanOrEqual(90);
    expect(indexLabel(best)).toBe('最適');
    expect(hot).toBeLessThan(30);
    expect(runIndex(8, 55, 9, 80, 3, 8)).toBeLessThan(best - 25);
  });
  it('暑さによるペース低下の目安', () => {
    expect(heatPaceCost(10)).toBe(0);
    expect(heatPaceCost(20)).toBe(20);
  });
  it('1 日のうちでいちばん走りやすい連続 2 時間を選ぶ', async () => {
    const date = '2026-11-02';
    const times: string[] = [];
    const temp: number[] = [];
    for (let h = 0; h < 24; h++) { times.push(`${date}T${String(h).padStart(2, '0')}:00`); temp.push(h === 7 || h === 8 ? 8 : 26); }
    const hourly = {
      time: times, temperature_2m: temp, apparent_temperature: temp, relative_humidity_2m: times.map(() => 60),
      precipitation_probability: times.map(() => 0), precipitation: times.map(() => 0), weather_code: times.map(() => 0),
      wind_speed_10m: times.map(() => 1), wind_gusts_10m: times.map(() => 2), uv_index: times.map(() => 0), shortwave_radiation: times.map(() => 0),
    };
    const daily = { time: [date], weather_code: [0], temperature_2m_max: [26], temperature_2m_min: [8], apparent_temperature_max: [26], precipitation_sum: [0], precipitation_probability_max: [0], wind_speed_10m_max: [2], sunrise: [`${date}T06:20`], sunset: [`${date}T17:10`], uv_index_max: [3] };
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => (String(u).includes('air-quality') ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ hourly, daily })))) as typeof fetch;
    try {
      const f = await forecast({ name: 'テスト', lat: 33.6, lon: 130.4 }, Date.parse(`${date}T00:30:00+09:00`));
      expect(f!.daily[0].best!.from).toBe(7);
      expect(f!.daily[0].best!.to).toBe(9);
      expect(f!.daily[0].best!.label).toBe('最適');
      expect(f!.advice.join('')).toContain('7〜9時');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
