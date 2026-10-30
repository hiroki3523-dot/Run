import { DEFAULT_SETTINGS, type Env, type Settings } from './types';

export async function getSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key = 'settings'").first<{ value: string }>();
  if (!row) return DEFAULT_SETTINGS;
  const saved = JSON.parse(row.value) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    paces: { ...DEFAULT_SETTINGS.paces, ...saved.paces },
    hr_targets: { ...DEFAULT_SETTINGS.hr_targets, ...saved.hr_targets },
  };
}

export async function saveSettings(env: Env, s: Settings): Promise<void> {
  await kvSet(env, 'settings', JSON.stringify(s));
}

export async function kvGet(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function kvSet(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
