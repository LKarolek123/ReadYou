import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { authClient, authErrorMessage } from '../../lib/auth-client.ts';
import { keys, useConfig } from '../../lib/queries.ts';
import { Alert, Button, TextField } from '../../components/ui.tsx';
import { AuthLayout, Divider, GoogleButton } from './AuthLayout.tsx';

const origin = () => window.location.origin;

function useGoogle() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setLoading(true);
    setError(null);
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${origin()}/`,
      newUserCallbackURL: `${origin()}/onboarding`,
      errorCallbackURL: `${origin()}/login?error=google`,
    });
    if (error) {
      setError(authErrorMessage(error));
      setLoading(false);
    }
  };
  return { start, loading, error };
}

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const config = useConfig();
  const google = useGoogle();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('error') ? 'Nie udało się zalogować przez Google.' : null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password, rememberMe: true });
    setLoading(false);
    if (error) return setError(authErrorMessage(error));
    await qc.invalidateQueries({ queryKey: keys.me });
    navigate('/', { replace: true });
  };

  return (
    <AuthLayout title="Witaj ponownie" subtitle="Zaloguj się, aby zobaczyć dzisiejsze propozycje.">
      {config.data?.googleEnabled && (
        <>
          <GoogleButton onClick={google.start} loading={google.loading} />
          <Divider>lub e-mailem</Divider>
        </>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {(error || google.error) && <Alert tone="error">{error ?? google.error}</Alert>}
        <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Hasło"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-violet hover:underline">
            Nie pamiętasz hasła?
          </Link>
        </div>
        <Button type="submit" block loading={loading}>
          Zaloguj się
        </Button>
      </form>
      <p className="mt-6 text-center text-[15px] text-muted">
        Nie masz konta?{' '}
        <Link to="/register" className="font-semibold text-violet hover:underline">
          Załóż je
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useConfig();
  const google = useGoogle();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError('Hasło musi mieć co najmniej 10 znaków.');
    setLoading(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: name.trim() || email.split('@')[0]!,
      email,
      password,
      callbackURL: `${origin()}/verified`,
    });
    setLoading(false);
    if (error) return setError(authErrorMessage(error));
    await qc.invalidateQueries({ queryKey: keys.me });
    navigate('/onboarding', { replace: true });
  };

  return (
    <AuthLayout title="Załóż konto" subtitle="Dwie minuty konfiguracji i dostaniesz pierwsze propozycje.">
      {config.data?.googleEnabled && (
        <>
          <GoogleButton onClick={google.start} loading={google.loading} />
          <Divider>lub e-mailem</Divider>
        </>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {(error || google.error) && <Alert tone="error">{error ?? google.error}</Alert>}
        <TextField label="Jak mamy się do Ciebie zwracać?" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} hint="Opcjonalnie" />
        <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Hasło"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Co najmniej 10 znaków."
        />
        <Button type="submit" block loading={loading}>
          Utwórz konto
        </Button>
        <p className="text-xs leading-relaxed text-muted">
          Wyślemy link potwierdzający adres. Potwierdzony e-mail jest potrzebny tylko do piątkowego raportu. ReadYou jest
          bezpłatne — nie prosimy o dane płatnicze.
        </p>
      </form>
      <p className="mt-6 text-center text-[15px] text-muted">
        Masz już konto?{' '}
        <Link to="/login" className="font-semibold text-violet hover:underline">
          Zaloguj się
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const config = useConfig();
  const emailDisabled = config.data?.email.enabled === false;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${origin()}/reset-password` });
    setLoading(false);
    // Nie zdradzamy, czy konto istnieje — zawsze ten sam komunikat (poza limitem prób).
    if (error?.status === 429) return setError(authErrorMessage(error));
    setSent(true);
  };

  return (
    <AuthLayout title="Reset hasła" subtitle="Podaj e-mail konta — wyślemy link do ustawienia nowego hasła.">
      {emailDisabled ? (
        <div className="space-y-4">
          <Alert tone="warning">
            Wysyłka e-maili nie jest jeszcze skonfigurowana, więc nie możemy wysłać linku do resetu hasła. Spróbuj później albo
            skontaktuj się z administratorem.
          </Alert>
          <Link to="/login" className="block text-center font-semibold text-violet hover:underline">
            Wróć do logowania
          </Link>
        </div>
      ) : sent ? (
        <div className="space-y-4">
          <Alert tone="success">
            <span className="inline-flex items-center gap-2 font-semibold">
              <MailCheck className="size-4" aria-hidden /> Sprawdź skrzynkę
            </span>
            <br />
            Jeśli konto z adresem {email} istnieje, za chwilę dostaniesz wiadomość z linkiem.
          </Alert>
          <Link to="/login" className="block text-center font-semibold text-violet hover:underline">
            Wróć do logowania
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" block loading={loading}>
            Wyślij link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-muted hover:text-ink">
            Anuluj
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('error') ? 'Link wygasł lub jest nieprawidłowy.' : null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 10) return setError('Hasło musi mieć co najmniej 10 znaków.');
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setLoading(false);
    if (error) return setError(authErrorMessage(error));
    navigate('/login', { replace: true });
  };

  return (
    <AuthLayout title="Ustaw nowe hasło">
      {!token ? (
        <div className="space-y-4">
          <Alert tone="error">{error ?? 'Brak tokenu resetu. Otwórz link z wiadomości e-mail.'}</Alert>
          <Link to="/forgot-password" className="block text-center font-semibold text-violet hover:underline">
            Poproś o nowy link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <TextField
            label="Nowe hasło"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Co najmniej 10 znaków. Inne sesje zostaną wylogowane."
          />
          <Button type="submit" block loading={loading}>
            Zapisz hasło
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifiedPage() {
  const [params] = useSearchParams();
  const failed = params.get('error');
  return (
    <AuthLayout title={failed ? 'Nie udało się potwierdzić adresu' : 'Adres potwierdzony'}>
      {failed ? (
        <Alert tone="error">Link wygasł lub był już użyty. Wyślij nowy z poziomu Profilu.</Alert>
      ) : (
        <Alert tone="success">
          <span className="inline-flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4" aria-hidden /> Gotowe!
          </span>
          <br />
          Możesz teraz zapisać się na piątkowy raport tygodniowy.
        </Alert>
      )}
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-5 font-semibold text-white shadow-lift"
      >
        Przejdź do aplikacji
      </Link>
    </AuthLayout>
  );
}
