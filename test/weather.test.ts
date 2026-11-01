import { afterEach, describe, expect, it } from 'vitest';
import { cityFor, raceWeather, weatherAdvice } from '../src/weather';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const body = {
  daily: { time: ['2026-11-07', '2026-11-08'], temperature_2m_max: [17, 19.4], temperature_2m_min: [9, 10.2], precipitation_probability_max: [10, 60], wind_speed_10m_max: [4, 8.1] },
  hourly: {
    time: ['2026-11-08T09:00', '2026-11-08T10:00', '2026-11-08T12:00'],
    temperature_2m: [13, 15.2, 18.9], relative_humidity_2m: [70, 65, 55], precipitation_probability: [20, 40, 60], wind_speed_10m: [3, 4, 6],
  },
};

describe('weather', () => {
  it('大会名から都市を選ぶ', () => {
    expect(cityFor('福岡マラソン')?.[1]).toBe('福岡');
    expect(cityFor('どこかの大会')).toBeNull();
  });
  it('予報から当日の値と時間帯別を取り出す', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body))) as typeof fetch;
    const w = await raceWeather('福岡マラソン', '2026-11-08');
    expect(w!.tmax).toBe(19.4);
    expect(w!.hours.length).toBe(3);
    expect(w!.hours[1].temp).toBe(15.2);
    expect(await raceWeather('福岡マラソン', '2026-12-31')).toBeNull();
  });
  it('気温・雨・風でひと言を変える', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body))) as typeof fetch;
    const w = (await raceWeather('福岡マラソン', '2026-11-08'))!;
    const a = weatherAdvice(w);
    expect(a).toContain('暖かい');
    expect(a).toContain('雨');
    expect(a).toContain('風');
  });
});
