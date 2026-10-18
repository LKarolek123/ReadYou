import { describe, expect, it } from 'vitest';
import { poolConfig } from '../src/db-config.ts';

describe('poolConfig', () => {
  it('dla Supabase wymusza TLS z weryfikacją wbudowanym CA i usuwa sslmode z adresu', () => {
    const c = poolConfig('postgresql://postgres.ref:x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require');
    expect(c.ssl).toMatchObject({ rejectUnauthorized: true });
    expect((c.ssl as { ca: string }).ca).toContain('BEGIN CERTIFICATE');
    expect(c.connectionString).not.toContain('sslmode');
  });

  it('jawny DATABASE_CA_CERT ma pierwszeństwo', () => {
    const c = poolConfig('postgres://u:p@db.example.com:5432/x', 'PEM');
    expect(c.ssl).toEqual({ ca: 'PEM', rejectUnauthorized: true });
  });

  it('lokalna baza bez CA zostaje bez zmian', () => {
    const url = 'postgres://readyou:readyou@127.0.0.1:15432/readyou';
    expect(poolConfig(url)).toEqual({ connectionString: url });
  });

  it('nie myli obcej domeny z Supabase', () => {
    expect(poolConfig('postgres://u:p@notsupabase.com/x').ssl).toBeUndefined();
  });
});
