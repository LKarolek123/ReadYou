import { createAuthClient } from 'better-auth/react';

/** Klient Better Auth — działa na tym samym originie (Vite proxy / reverse proxy na produkcji). */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/** Tłumaczenie typowych błędów Better Auth na polski. */
export function authErrorMessage(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!err) return 'Coś poszło nie tak. Spróbuj ponownie.';
  const map: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: 'Nieprawidłowy e-mail lub hasło.',
    USER_ALREADY_EXISTS: 'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.',
    PASSWORD_TOO_SHORT: 'Hasło musi mieć co najmniej 10 znaków.',
    PASSWORD_TOO_LONG: 'Hasło jest za długie.',
    INVALID_EMAIL: 'Podaj poprawny adres e-mail.',
    INVALID_TOKEN: 'Link wygasł lub jest nieprawidłowy. Poproś o nowy.',
    EMAIL_NOT_VERIFIED: 'Najpierw potwierdź adres e-mail.',
  };
  if (err.status === 429) return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  return (err.code && map[err.code]) || 'Coś poszło nie tak. Spróbuj ponownie.';
}
