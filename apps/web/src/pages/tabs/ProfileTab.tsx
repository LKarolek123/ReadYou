import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Download,
  LayoutGrid,
  Layers,
  LogOut,
  MailWarning,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { ACTIVITY_TYPES, TIME_SLOTS, WEEKDAYS, weekdayName, type ActivityType, type ProfilePatch } from '@readyou/shared';
import { api, ApiError, type Me } from '../../lib/api.ts';
import { authClient } from '../../lib/auth-client.ts';
import { keys, useMe, usePatchProfile, usePatchReport, useReportSubscription } from '../../lib/queries.ts';
import { PageHeader } from '../../components/AppShell.tsx';
import { Alert, Button, Card, Chip, Segmented, Spinner, TextField } from '../../components/ui.tsx';
import { TagEditor } from '../../components/TagEditor.tsx';

export function ProfileTab() {
  const me = useMe();
  if (me.isLoading || !me.data) return <Spinner />;
  return <Profile me={me.data} />;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 text-[15px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

const missing = <span className="font-normal text-muted">nie podano</span>;

function Profile({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const patch = usePatchProfile();
  const p = me.profile;
  const [editing, setEditing] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const resetLearned = useMutation({
    mutationFn: () => api.post<{ removed: number }>('/me/interests/reset-learned'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.interests }),
  });

  const logout = async () => {
    await authClient.signOut();
    qc.clear();
    navigate('/login', { replace: true });
  };

  const initial = (me.user.name || me.user.email).trim().charAt(0).toUpperCase();
  const activities = p.activityTypes.map((a) => ACTIVITY_TYPES.find((x) => x.id === a)?.label).filter(Boolean);
  const budget =
    p.budget.maxEventPrice === null ? missing : p.budget.maxEventPrice === 0 ? 'Tylko bezpłatne' : `do ${p.budget.maxEventPrice} ${p.budget.currency}`;
  const days = p.availability.days.map((d) => WEEKDAYS.find((w) => w.id === d)?.short).join(', ');
  const slots = p.availability.slots.map((s) => TIME_SLOTS.find((t) => t.id === s)?.label.toLowerCase()).join(', ');

  return (
    <>
      <PageHeader title="Profil" />
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-5 lg:grid-cols-[1.2fr_1fr] lg:px-8">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="h-20 bg-brand" aria-hidden />
            <div className="-mt-10 px-5 pb-5">
              <div className="inline-flex size-20 items-center justify-center rounded-2xl border-4 border-surface bg-brand font-display text-3xl font-extrabold text-white shadow-lift">
                {initial}
              </div>
              <p className="mt-3 font-display text-xl font-bold">{me.user.name}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-[15px] text-muted">
                {me.user.email}
                {me.user.emailVerified ? (
                  <BadgeCheck className="size-4 text-success" aria-label="Adres potwierdzony" />
                ) : (
                  <MailWarning className="size-4 text-amber-600" aria-label="Adres niepotwierdzony" />
                )}
                {p.city && <span>· {p.city}</span>}
              </p>
              {!me.user.emailVerified && (
                <div className="mt-3">
                  <Alert tone="warning">
                    Adres niepotwierdzony.{' '}
                    {verificationSent ? (
                      <strong>Wysłano link — sprawdź skrzynkę.</strong>
                    ) : (
                      <button
                        type="button"
                        className="font-semibold underline"
                        onClick={async () => {
                          await authClient.sendVerificationEmail({ email: me.user.email, callbackURL: `${window.location.origin}/verified` });
                          setVerificationSent(true);
                        }}
                      >
                        Wyślij link potwierdzający
                      </button>
                    )}
                  </Alert>
                </div>
              )}
              {/* Tagi bezpośrednio pod adresem e-mail (spec. 1, 3G) */}
              <div className="mt-5">
                <h2 className="mb-2 text-sm font-semibold">Zainteresowania</h2>
                <TagEditor />
              </div>
            </div>
          </Card>

          <Link to="/articles/yours" className="flex min-h-14 items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-5 shadow-card transition hover:border-violet/40">
            <span className="inline-flex items-center gap-3 font-semibold">
              <BookOpen className="size-5 text-violet" aria-hidden /> Twoje artykuły
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-muted">
              Polubione / Przeczytane <ChevronRight className="size-4" aria-hidden />
            </span>
          </Link>

          <Section
            title="O Tobie"
            action={
              <Button variant="ghost" className="min-h-9 px-3 text-sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Edytuj
              </Button>
            }
          >
            <dl>
              <Row label="Miasto" value={p.city ?? missing} />
              <Row label="Lokalizacja" value={p.approxLat != null ? 'przybliżona (~1 km)' : missing} />
              <Row label="Strefa czasowa" value={p.timezone} />
              <Row label="Uczelnia" value={p.university ?? missing} />
              <Row label="Kierunek" value={p.studyField ?? missing} />
              <Row label="Budżet na wydarzenie" value={budget} />
              <Row
                label="Czas"
                value={
                  p.availability.hoursPerWeek == null && !days && !slots ? missing : (
                    <>
                      {p.availability.hoursPerWeek != null && `ok. ${p.availability.hoursPerWeek} h/tydz.`}
                      {days && <span className="block text-sm font-normal text-muted">{days}</span>}
                      {slots && <span className="block text-sm font-normal text-muted">{slots}</span>}
                    </>
                  )
                }
              />
              <Row label="Aktywności" value={activities.length ? activities.join(', ') : missing} />
            </dl>
          </Section>
        </div>

        <div className="space-y-4">
          <ReportSection me={me} />

          <Section title="Wygląd">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] text-muted">Preferowany widok kart</span>
              <Segmented
                label="Preferowany widok"
                value={p.preferredView}
                onChange={(v) => patch.mutate({ preferredView: v })}
                options={[
                  { value: 'grid', label: 'Grid', icon: <LayoutGrid className="size-4" aria-hidden /> },
                  { value: 'swipe', label: 'Swipe', icon: <Layers className="size-4" aria-hidden /> },
                ]}
              />
            </div>
          </Section>

          <Section title="Prywatność i dane">
            <p className="text-sm leading-relaxed text-muted">
              Do wyszukiwania przekazujemy tylko tematy i przybliżone miasto — nigdy e-mail ani identyfikator konta. Streszczenia
              tworzy zewnętrzny model AI na podstawie źródeł.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="secondary"
                onClick={() => resetLearned.mutate()}
                loading={resetLearned.isPending}
                className="justify-start"
              >
                <RotateCcw className="size-4" aria-hidden />
                {resetLearned.isSuccess ? `Zresetowano (${resetLearned.data.removed})` : 'Zresetuj wyuczone preferencje'}
              </Button>
              <a
                href="/api/me/export"
                download="readyou-export.json"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold hover:border-violet/40"
              >
                <Download className="size-4" aria-hidden /> Eksportuj moje dane (JSON)
              </a>
              <DeleteAccount />
            </div>
          </Section>

          <Button variant="secondary" block onClick={logout}>
            <LogOut className="size-4" aria-hidden /> Wyloguj się
          </Button>
        </div>
      </div>

      <EditProfileDialog open={editing} onClose={() => setEditing(false)} me={me} />
    </>
  );
}

function ReportSection({ me }: { me: Me }) {
  const sub = useReportSubscription();
  const patch = usePatchReport();
  const s = sub.data;

  const next = s?.nextSendAt
    ? new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: s.timezone }).format(
        new Date(s.nextSendAt),
      )
    : null;

  return (
    <Section title="Raport tygodniowy">
      {!s ? (
        <p className="text-sm text-muted">Ładowanie…</p>
      ) : (
        <>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Wysyłaj raport e-mailem</span>
              <span className="block text-sm capitalize text-muted">
                {weekdayName(s.weekday)}, {s.localTime}
              </span>
            </span>
            <input
              type="checkbox"
              className="size-6 accent-violet"
              checked={s.enabled}
              disabled={patch.isPending || (!s.enabled && !me.user.emailVerified)}
              onChange={(e) => patch.mutate({ enabled: e.target.checked })}
            />
          </label>
          {!me.user.emailVerified && <p className="mt-2 text-sm text-amber-700">Potwierdź adres e-mail, aby włączyć raport.</p>}
          {patch.error && <div className="mt-2"><Alert tone="error">{(patch.error as ApiError).message}</Alert></div>}
          {s.enabled && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="mb-1 block text-xs font-medium text-muted">Dzień</span>
                  <select
                    value={s.weekday}
                    onChange={(e) => patch.mutate({ weekday: Number(e.target.value) })}
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 capitalize"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {weekdayName(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-28">
                  <span className="mb-1 block text-xs font-medium text-muted">Godzina</span>
                  <input
                    type="time"
                    step={900}
                    value={s.localTime}
                    onChange={(e) => e.target.value && patch.mutate({ localTime: e.target.value })}
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                  />
                </label>
              </div>
              {next && (
                <p className="inline-flex items-center gap-2 rounded-xl bg-violet-soft/60 px-3 py-2 text-sm text-violet">
                  <CalendarClock className="size-4" aria-hidden /> Następna wysyłka: {next}
                </p>
              )}
              <p className="text-xs text-muted">Archiwum raportów pojawi się tutaj po pierwszej wysyłce.</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function DeleteAccount() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState('');
  const del = useMutation({
    mutationFn: () => api.delete('/me'),
    onSuccess: () => {
      qc.clear();
      navigate('/register', { replace: true });
    },
  });
  if (!confirming)
    return (
      <Button variant="danger" className="justify-start" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" aria-hidden /> Usuń konto
      </Button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-danger/30 p-3">
      <p className="text-sm">
        To usunie profil, zainteresowania, polubienia, historię i raporty. Operacji nie można cofnąć. Wpisz <strong>USUŃ</strong>, aby potwierdzić.
      </p>
      <input value={text} onChange={(e) => setText(e.target.value)} className="min-h-11 w-full rounded-xl border border-line px-3" aria-label="Potwierdzenie usunięcia" />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Anuluj
        </Button>
        <Button variant="danger" disabled={text !== 'USUŃ'} loading={del.isPending} onClick={() => del.mutate()}>
          Usuń na zawsze
        </Button>
      </div>
    </div>
  );
}

function EditProfileDialog({ open, onClose, me }: { open: boolean; onClose: () => void; me: Me }) {
  const ref = useRef<HTMLDialogElement>(null);
  const patch = usePatchProfile();
  const p = me.profile;
  const [form, setForm] = useState({
    city: p.city ?? '',
    timezone: p.timezone,
    university: p.university ?? '',
    studyField: p.studyField ?? '',
    price: p.budget.maxEventPrice == null ? '' : String(p.budget.maxEventPrice),
    currency: p.budget.currency,
    hours: p.availability.hoursPerWeek == null ? '' : String(p.availability.hoursPerWeek),
    activityTypes: p.activityTypes,
    clearLocation: false,
  });

  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values: ProfilePatch = {
      city: form.city.trim() || null,
      timezone: form.timezone,
      university: form.university.trim() || null,
      studyField: form.studyField.trim() || null,
      budget: { currency: form.currency, maxEventPrice: form.price === '' ? null : Number(form.price) },
      availability: { hoursPerWeek: form.hours === '' ? null : Math.min(80, Number(form.hours)), days: p.availability.days, slots: p.availability.slots },
      activityTypes: form.activityTypes,
      ...(form.clearLocation ? { approxLat: null, approxLon: null } : {}),
    };
    await patch.mutateAsync(values);
    onClose();
  };

  const toggleActivity = (a: ActivityType) =>
    setForm((f) => ({ ...f, activityTypes: f.activityTypes.includes(a) ? f.activityTypes.filter((x) => x !== a) : [...f.activityTypes, a] }));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto max-h-[90dvh] w-[min(94vw,520px)] overflow-y-auto rounded-[20px] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
      aria-labelledby="edit-title"
    >
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 id="edit-title" className="font-display text-xl font-bold">
          Edytuj profil
        </h2>
        {patch.error && <Alert tone="error">{(patch.error as ApiError).message}</Alert>}
        <TextField label="Miasto" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <TextField
          label="Strefa czasowa (IANA)"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          hint="np. Europe/Warsaw"
        />
        {p.approxLat != null && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-violet" checked={form.clearLocation} onChange={(e) => setForm({ ...form, clearLocation: e.target.checked })} />
            Usuń zapisaną przybliżoną lokalizację
          </label>
        )}
        <TextField label="Uczelnia" value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} />
        <TextField label="Kierunek (ogólnie)" value={form.studyField} onChange={(e) => setForm({ ...form, studyField: e.target.value })} />
        <div className="flex gap-2">
          <TextField
            className="flex-1"
            label="Maks. cena wydarzenia"
            inputMode="numeric"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, '').slice(0, 6) })}
            hint="Puste = nie wiem, 0 = tylko bezpłatne"
          />
          <label className="w-24">
            <span className="mb-1.5 block text-sm font-medium">Waluta</span>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="min-h-12 w-full rounded-xl border border-line bg-surface px-3">
              {['PLN', 'EUR', 'USD', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <TextField
          label="Godziny tygodniowo"
          inputMode="numeric"
          value={form.hours}
          onChange={(e) => setForm({ ...form, hours: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          hint="Puste = nie wiem"
        />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Aktywności</legend>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_TYPES.map((a) => (
              <Chip key={a.id} size="sm" selected={form.activityTypes.includes(a.id)} onClick={() => toggleActivity(a.id)}>
                {a.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" loading={patch.isPending}>
            Zapisz
          </Button>
        </div>
      </form>
    </dialog>
  );
}
