import type pg from 'pg';
import { SUPABASE_ROOT_CA } from './certs/supabase-ca.ts';

const isSupabaseHost = (host: string) => /(^|\.)supabase\.(com|co)$/i.test(host);

/**
 * Konfiguracja połączenia. Z CA (DATABASE_CA_CERT, a dla hostów Supabase domyślnie wbudowany
 * Supabase Root 2021 CA): TLS z weryfikacją certyfikatu i nazwy hosta. Bez tego pg łączyłby się
 * z Supabase BEZ szyfrowania (adres z panelu nie ma sslmode). Parametry ssl* z URL-a są usuwane,
 * bo pg nadpisałby nimi opcję `ssl`.
 */
export function poolConfig(connectionString: string, explicitCa?: string): pg.PoolConfig {
  const url = new URL(connectionString);
  const ca = explicitCa ?? (isSupabaseHost(url.hostname) ? SUPABASE_ROOT_CA : undefined);
  if (!ca) return { connectionString };
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('ssl')) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}
