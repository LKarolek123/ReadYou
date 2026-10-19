import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, LocateFixed, MapPin, Plus, X } from 'lucide-react';
import {
  ACTIVITY_TYPES,
  ONBOARDING_STEPS,
  POLISH_CITIES,
  STUDY_FIELDS,
  TIME_SLOTS,
  WEEKDAYS,
  type ActivityType,
  type OnboardingStep,
  type ProfilePatch,
  type TimeSlot,
  type Weekday,
} from '@readyou/shared';
import { api, ApiError, type AmbiguityDetails, type Me, type OnboardingView } from '../../lib/api.ts';
import { keys, useConfig, useMe, useOnboarding, usePatchProfile, usePatchReport } from '../../lib/queries.ts';
import { authClient } from '../../lib/auth-client.ts';
import { Alert, Button, Chip, Spinner, TextField } from '../../components/ui.tsx';
import { SenseDialog } from '../../components/SenseDialog.tsx';
import { TagEditor } from '../../components/TagEditor.tsx';
import { CategoryIllustration } from '../../graphics/CategoryIllustration.tsx';
import { OnboardingLayout } from './OnboardingLayout.tsx';

const LINEAR: OnboardingStep[] = ONBOARDING_STEPS.filter((s) => s !== 'done');
const indexOf = (s: OnboardingStep) => Math.max(0, LINEAR.indexOf(s));

function useStepMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: OnboardingStep) => api.post<OnboardingView>('/onboarding/step', { step }),
    onSuccess: (data) => {
      qc.setQueryData(keys.onboarding, data);
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function OnboardingPage() {
  const me = useMe();
  const onboarding = useOnboarding(Boolean(me.data));
  const navigate = useNavigate();

  useEffect(() => {
    if (me.data === null) navigate('/login', { replace: true });
  }, [me.data, navigate]);

  if (me.isLoading || onboarding.isLoading || !me.data || !onboarding.data) {
    if (me.error || onboarding.error) return <div className="p-6"><Alert tone="error">Nie udało się wczytać konfiguracji. Odśwież stronę.</Alert></div>;
    return <Spinner />;
  }
  return <Wizard me={me.data} view={onboarding.data} />;
}

function Wizard({ me, view }: { me: Me; view: OnboardingView }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const stepMut = useStepMutation();
  const step = view.step === 'done' ? 'report' : view.step;
  const go = (s: OnboardingStep) => stepMut.mutateAsync(s);
  const prev = () => {
    const i = indexOf(step);
    if (i > 0) go(LINEAR[i - 1]!);
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const common = { me, view, go, prev, busy: stepMut.isPending };
  switch (step) {
    case 'location':
      return <LocationStep {...common} />;
    case 'studies':
      return <StudiesStep {...common} />;
    case 'budget':
      return <BudgetStep {...common} />;
    case 'activities':
      return <ActivitiesStep {...common} />;
    case 'interests':
      return <InterestsStep {...common} />;
    case 'deepen':
      return <DeepenStep {...common} />;
    case 'tags':
      return <TagsStep {...common} />;
    case 'report':
      return (
        <ReportStep
          {...common}
          onFinish={async () => {
            await go('done');
            // Guard aplikacji czyta profil z cache — najpierw pobierz świeży stan „onboarding ukończony”.
            await qc.refetchQueries({ queryKey: keys.me });
            navigate('/articles', { replace: true });
          }}
        />
      );
    default:
      return null;
  }
}

interface StepProps {
  me: Me;
  view: OnboardingView;
  go: (s: OnboardingStep) => Promise<unknown>;
  prev: () => void;
  busy: boolean;
}

/** Zapis fragmentu profilu i przejście dalej. */
function useSaveAndGo(go: StepProps['go']) {
  const patch = usePatchProfile();
  const [error, setError] = useState<string | null>(null);
  const run = async (values: ProfilePatch, next: OnboardingStep) => {
    setError(null);
    try {
      if (Object.keys(values).length) await patch.mutateAsync(values);
      await go(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać. Spróbuj ponownie.');
    }
  };
  return { run, error, pending: patch.isPending };
}

/* ───────────────────────────── 1. Miasto i strefa ───────────────────────────── */

const TIMEZONES = ['Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo'];

function LocationStep({ me, go, busy }: StepProps) {
  const p = me.profile;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [city, setCity] = useState(p.city ?? '');
  const [timezone, setTimezone] = useState(p.timezone);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
    p.approxLat != null && p.approxLon != null ? { lat: p.approxLat, lon: p.approxLon } : null,
  );
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'denied'>('idle');
  const save = useSaveAndGo(go);
  const tzOptions = useMemo(() => Array.from(new Set([timezone, browserTz, ...TIMEZONES])), [timezone, browserTz]);

  const locate = () => {
    if (!('geolocation' in navigator)) return setGeoState('denied');
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Przybliżenie do ~1 km już po stronie klienta; dokładna pozycja nie opuszcza urządzenia.
        setCoords({ lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 });
        setGeoState('idle');
      },
      () => setGeoState('denied'),
      { maximumAge: 600_000, timeout: 10_000, enableHighAccuracy: false },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run({ city: city.trim() || null, timezone, approxLat: coords?.lat ?? null, approxLon: coords?.lon ?? null }, 'studies');
  };

  return (
    <OnboardingLayout
      index={0}
      title="Gdzie szukać dla Ciebie wydarzeń?"
      subtitle="Miasto służy tylko do wydarzeń i klubów. Artykuły nadal mogą pochodzić z całego świata."
      footer={
        <Button type="submit" form="step-form" loading={save.pending || busy} disabled={!city.trim()}>
          Dalej <ChevronRight className="size-4" aria-hidden />
        </Button>
      }
    >
      <form id="step-form" onSubmit={submit} className="space-y-6">
        {save.error && <Alert tone="error">{save.error}</Alert>}
        <div>
          <TextField label="Miasto" list="cities" value={city} onChange={(e) => setCity(e.target.value)} placeholder="np. Kraków" autoComplete="address-level2" />
          <datalist id="cities">
            {POLISH_CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="mt-3 flex flex-wrap gap-2">
            {POLISH_CITIES.slice(0, 6).map((c) => (
              <Chip key={c} size="sm" selected={city === c} onClick={() => setCity(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-violet" aria-hidden />
            <div className="flex-1 text-sm">
              <p className="font-semibold">Przybliżona lokalizacja (opcjonalnie)</p>
              <p className="mt-0.5 text-muted">
                Pomaga ocenić odległość do wydarzeń. Zaokrąglamy ją do ok. 1 km i nie śledzimy jej w tle.
              </p>
              {coords ? (
                <p className="mt-2 inline-flex items-center gap-2 font-medium text-success">
                  <Check className="size-4" aria-hidden /> Zapisano przybliżone położenie
                  <button type="button" className="text-muted underline" onClick={() => setCoords(null)}>
                    usuń
                  </button>
                </p>
              ) : (
                <Button type="button" variant="secondary" className="mt-3" onClick={locate} loading={geoState === 'asking'}>
                  <LocateFixed className="size-4" aria-hidden /> Użyj mojej lokalizacji
                </Button>
              )}
              {geoState === 'denied' && <p className="mt-2 text-danger">Nie udało się pobrać lokalizacji — wystarczy samo miasto.</p>}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Strefa czasowa</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-[15px] focus:border-violet focus:outline-none focus:ring-4 focus:ring-violet/15"
          >
            {tzOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace('_', ' ')}
                {tz === browserTz ? ' (Twoje urządzenie)' : ''}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-sm text-muted">Według niej liczymy „dzisiaj” i godzinę raportu.</span>
        </label>
      </form>
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 2. Studia ───────────────────────────── */

function StudiesStep({ me, go, prev, busy }: StepProps) {
  const [university, setUniversity] = useState(me.profile.university ?? '');
  const [field, setField] = useState(me.profile.studyField ?? '');
  const save = useSaveAndGo(go);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run({ university: university.trim() || null, studyField: field.trim() || null }, 'budget');
  };
  return (
    <OnboardingLayout
      index={1}
      onBack={prev}
      title="Studiujesz?"
      subtitle="Opcjonalnie. Ogólny kierunek pomoże dobrać np. hackathony czy konferencje — nie potrzebujemy specjalizacji."
      footer={
        <>
          <Button variant="ghost" onClick={() => save.run({}, 'budget')}>
            Pomiń
          </Button>
          <Button type="submit" form="step-form" loading={save.pending || busy}>
            Dalej <ChevronRight className="size-4" aria-hidden />
          </Button>
        </>
      }
    >
      <form id="step-form" onSubmit={submit} className="space-y-6">
        {save.error && <Alert tone="error">{save.error}</Alert>}
        <TextField label="Uczelnia" value={university} onChange={(e) => setUniversity(e.target.value)} placeholder="np. AGH, UJ, PW" maxLength={120} />
        <div>
          <TextField label="Kierunek (ogólnie)" value={field} onChange={(e) => setField(e.target.value)} placeholder="np. Informatyka" maxLength={80} />
          <div className="mt-3 flex flex-wrap gap-2">
            {STUDY_FIELDS.map((f) => (
              <Chip key={f} size="sm" selected={field === f} onClick={() => setField(field === f ? '' : f)}>
                {f}
              </Chip>
            ))}
          </div>
        </div>
      </form>
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 3. Budżet i czas ───────────────────────────── */

const PRICE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Nie wiem' },
  { value: 0, label: 'Tylko bezpłatne' },
  { value: 30, label: 'do 30' },
  { value: 60, label: 'do 60' },
  { value: 100, label: 'do 100' },
  { value: 200, label: 'do 200' },
];
const HOURS = [2, 5, 10, 15];

function BudgetStep({ me, go, prev, busy }: StepProps) {
  const p = me.profile;
  const [currency, setCurrency] = useState(p.budget.currency);
  const [price, setPrice] = useState<number | null>(p.budget.maxEventPrice);
  const [custom, setCustom] = useState(price != null && !PRICE_OPTIONS.some((o) => o.value === price) ? String(price) : '');
  const [hours, setHours] = useState<number | null>(p.availability.hoursPerWeek);
  const [days, setDays] = useState<Weekday[]>(p.availability.days);
  const [slots, setSlots] = useState<TimeSlot[]>(p.availability.slots);
  const save = useSaveAndGo(go);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const finalPrice = custom.trim() ? Math.max(0, Math.round(Number(custom))) : price;
    save.run(
      {
        budget: { currency, maxEventPrice: Number.isFinite(finalPrice as number) ? finalPrice : null },
        availability: { hoursPerWeek: hours, days, slots },
      },
      'activities',
    );
  };

  return (
    <OnboardingLayout
      index={2}
      onBack={prev}
      title="Budżet i wolny czas"
      subtitle="Orientacyjnie — wpływa tylko na kolejność wydarzeń. „Nie wiem” to nie to samo co „tylko bezpłatne”."
      footer={
        <>
          <Button variant="ghost" onClick={() => save.run({}, 'activities')}>
            Pomiń
          </Button>
          <Button type="submit" form="step-form" loading={save.pending || busy}>
            Dalej <ChevronRight className="size-4" aria-hidden />
          </Button>
        </>
      }
    >
      <form id="step-form" onSubmit={submit} className="space-y-8">
        {save.error && <Alert tone="error">{save.error}</Alert>}
        <fieldset>
          <legend className="mb-3 flex w-full items-center justify-between text-sm font-semibold">
            Maksymalna komfortowa cena jednego wydarzenia
            <select
              aria-label="Waluta"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm font-medium"
            >
              {['PLN', 'EUR', 'USD', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </legend>
          <div className="flex flex-wrap gap-2">
            {PRICE_OPTIONS.map((o) => (
              <Chip
                key={o.label}
                selected={!custom && price === o.value}
                onClick={() => {
                  setPrice(o.value);
                  setCustom('');
                }}
              >
                {o.value != null && o.value > 0 ? `${o.label} ${currency}` : o.label}
              </Chip>
            ))}
          </div>
          <TextField
            className="mt-3 max-w-[200px]"
            label="Albo wpisz kwotę"
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={`np. 150 ${currency}`}
          />
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Ile godzin w tygodniu masz na wydarzenia?</legend>
          <div className="flex flex-wrap gap-2">
            <Chip selected={hours === null} onClick={() => setHours(null)}>
              Nie wiem
            </Chip>
            {HOURS.map((h) => (
              <Chip key={h} selected={hours === h} onClick={() => setHours(h)}>
                {h === 15 ? '15+ h' : `ok. ${h} h`}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">
            Kiedy zwykle masz czas? <span className="font-normal text-muted">(opcjonalnie)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <Chip key={d.id} size="sm" selected={days.includes(d.id)} onClick={() => setDays(toggle(days, d.id))}>
                {d.short}
              </Chip>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIME_SLOTS.map((t) => (
              <Chip key={t.id} size="sm" selected={slots.includes(t.id)} onClick={() => setSlots(toggle(slots, t.id))}>
                {t.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      </form>
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 4. Typy aktywności ───────────────────────────── */

const ACTIVITY_ART: Record<ActivityType, import('@readyou/shared').IllustrationKey> = {
  sport: 'sport',
  social: 'events',
  tech: 'tech',
  culture: 'culture',
  calm: 'nature',
  outdoor: 'mountains',
};

function ActivitiesStep({ me, go, prev, busy }: StepProps) {
  const [selected, setSelected] = useState<ActivityType[]>(me.profile.activityTypes);
  const save = useSaveAndGo(go);
  return (
    <OnboardingLayout
      index={3}
      onBack={prev}
      title="Jakie aktywności lubisz?"
      subtitle="Zaznacz dowolnie wiele. To preferencje, nie ocena osobowości."
      footer={
        <>
          <Button variant="ghost" onClick={() => save.run({}, 'interests')}>
            Pomiń
          </Button>
          <Button onClick={() => save.run({ activityTypes: selected }, 'interests')} loading={save.pending || busy}>
            Dalej <ChevronRight className="size-4" aria-hidden />
          </Button>
        </>
      }
    >
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ACTIVITY_TYPES.map((a) => {
          const on = selected.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
              className={`group relative overflow-hidden rounded-2xl border-2 bg-surface text-left transition ${
                on ? 'border-violet shadow-lift' : 'border-transparent shadow-card hover:border-violet/30'
              }`}
            >
              <CategoryIllustration kind={ACTIVITY_ART[a.id]} seed={a.id} decorative className="aspect-[16/9] w-full" />
              <span className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 text-[15px] font-semibold">
                {a.label}
                <span
                  className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    on ? 'border-transparent bg-brand text-white' : 'border-line'
                  }`}
                  aria-hidden
                >
                  {on && <Check className="size-3.5" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 5. Zainteresowania główne ───────────────────────────── */

type CustomItem = { label: string; sense?: string };

function useDfs() {
  const qc = useQueryClient();
  const [ambiguity, setAmbiguity] = useState<AmbiguityDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<OnboardingView>('/onboarding/next', body),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(keys.onboarding, data);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AMBIGUOUS') setAmbiguity(e.details as AmbiguityDetails);
      else setError(e instanceof ApiError ? e.message : 'Coś poszło nie tak');
    },
  });
  return { mut, ambiguity, setAmbiguity, error };
}

function CustomInput({ items, onChange, placeholder }: { items: CustomItem[]; onChange: (v: CustomItem[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !items.some((i) => i.label.toLowerCase() === v.toLowerCase())) onChange([...items, { label: v }]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex gap-2">
        <label htmlFor="custom-interest" className="sr-only">
          Własne zainteresowanie
        </label>
        <input
          id="custom-interest"
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-[15px] focus:border-violet focus:outline-none focus:ring-4 focus:ring-violet/15"
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className="inline-flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-violet disabled:opacity-40" aria-label="Dodaj własne">
          <Plus className="size-5" />
        </button>
      </div>
      {items.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {items.map((i) => (
            <li key={i.label} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-brand pl-3 text-sm font-medium text-white">
              {i.sense ?? i.label}
              <button type="button" onClick={() => onChange(items.filter((x) => x !== i))} className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/15" aria-label={`Usuń ${i.label}`}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InterestsStep({ view, go, prev }: StepProps) {
  const [selected, setSelected] = useState<string[]>(view.selectedRoots.filter((r) => view.roots.some((x) => x.id === r)));
  const [custom, setCustom] = useState<CustomItem[]>(
    view.selections.filter((s) => s.depth === 0 && s.source === 'custom').map((s) => ({ label: s.label })),
  );
  const { mut, ambiguity, setAmbiguity, error } = useDfs();

  const submit = async (items = custom) => {
    try {
      await mut.mutateAsync({ action: 'start', rootIds: selected, custom: items });
      await go('deepen');
    } catch {
      /* błąd/wieloznaczność obsłużone w useDfs */
    }
  };

  return (
    <OnboardingLayout
      index={4}
      onBack={prev}
      title="Co Cię interesuje?"
      subtitle="Wybierz kategorie główne — za chwilę je doprecyzujemy. Możesz też wpisać coś własnego."
      footer={
        <Button onClick={() => submit()} loading={mut.isPending} disabled={selected.length === 0 && custom.length === 0}>
          Dalej ({selected.length + custom.length}) <ChevronRight className="size-4" aria-hidden />
        </Button>
      }
    >
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {view.roots.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected(on ? selected.filter((x) => x !== r.id) : [...selected, r.id])}
              className={`relative overflow-hidden rounded-2xl border-2 bg-surface text-left transition ${
                on ? 'border-violet shadow-lift' : 'border-transparent shadow-card hover:border-violet/30'
              }`}
            >
              <CategoryIllustration kind={r.illustration} decorative className="aspect-[16/10] w-full" />
              <span className="block px-3 pt-2 text-[15px] font-semibold leading-snug">{r.label}</span>
              <span className="block px-3 pb-3 text-xs leading-snug text-muted">{r.description}</span>
              {on && (
                <span className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-white text-violet shadow" aria-hidden>
                  <Check className="size-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Coś innego?</h2>
        <CustomInput items={custom} onChange={setCustom} placeholder="np. Szydełkowanie, Tesla, Formuła 1" />
      </div>
      <SenseDialog
        details={ambiguity}
        onCancel={() => setAmbiguity(null)}
        onPick={(sense) => {
          const next = custom.map((c) => (c.label.toLowerCase() === ambiguity?.label.toLowerCase() ? { ...c, sense } : c));
          setCustom(next);
          setAmbiguity(null);
          submit(next);
        }}
      />
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 6. Pogłębianie DFS ───────────────────────────── */

/** Polska odmiana: 1 temat, 2–4 tematy, 5+ tematów (z wyjątkiem 12–14). */
function plTopics(n: number) {
  if (n === 1) return 'temat';
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'tematy' : 'tematów';
}

function DeepenStep({ view, go }: StepProps) {
  const { mut, ambiguity, setAmbiguity, error } = useDfs();
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomItem[]>([]);
  const q = view.question;

  // Nowe pytanie → czysty wybór.
  useEffect(() => {
    setPicked([]);
    setCustom([]);
  }, [q?.key]);

  // Koniec pogłębiania → przegląd tagów (jednorazowo).
  const leaving = useRef(false);
  useEffect(() => {
    if (view.dfsDone && !mut.isPending && !leaving.current) {
      leaving.current = true;
      go('tags');
    }
  }, [view.dfsDone, mut.isPending, go]);

  const act = (body: Record<string, unknown>) => mut.mutate(body);
  const answer = (items = custom) =>
    picked.length || items.length ? act({ action: 'answer', optionIds: picked, custom: items }) : act({ action: 'skip' });
  // Przy pierwszym pytaniu „Wstecz” wraca do wyboru kategorii bez gubienia zaznaczeń.
  const isFirstQuestion = q?.key === view.selectedRoots[0];
  const back = () => (isFirstQuestion || !view.canGoBack ? go('interests') : act({ action: 'back' }));

  if (!q) return <Spinner label="Przygotowujemy Twoje tagi…" />;
  const root = view.roots.find((r) => r.id === view.selections.find((s) => s.label === q.path[0])?.key);

  return (
    <OnboardingLayout
      index={5}
      onBack={back}
      title={<span className="text-brand">{q.label}</span>}
      subtitle={
        <>
          Co dokładnie Cię tu interesuje?
          {view.pending > 1 && <> Potem jeszcze {view.pending - 1} {plTopics(view.pending - 1)} do doprecyzowania.</>}
        </>
      }
      aside={
        <>
          {root && (
            <div className="mb-4 overflow-hidden rounded-2xl">
              <CategoryIllustration kind={root.illustration} seed={q.key} decorative className="h-24 w-full sm:h-32" />
            </div>
          )}
          {q.path.length > 1 && (
            <nav aria-label="Ścieżka" className="mb-1 flex flex-wrap items-center gap-1 text-sm font-medium text-muted">
              {q.path.slice(0, -1).map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                  {p}
                </span>
              ))}
              <ChevronRight className="size-3.5" aria-hidden />
            </nav>
          )}
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => act({ action: 'enough' })} disabled={mut.isPending}>
            Wystarczy
          </Button>
          <Button variant="secondary" onClick={() => act({ action: 'skip' })} disabled={mut.isPending}>
            Pomiń
          </Button>
          <Button onClick={() => answer()} loading={mut.isPending}>
            Dalej <ChevronRight className="size-4" aria-hidden />
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <p className="mb-3 text-sm text-muted">Wybierz jedno lub kilka — doprecyzujemy każde po kolei. „Pomiń” zostawi ogólny temat, „Wystarczy” kończy doprecyzowanie.</p>
      <div className="flex flex-wrap gap-2">
        {q.options.map((o) => (
          <Chip key={o.id} selected={picked.includes(o.id)} onClick={() => setPicked(picked.includes(o.id) ? picked.filter((x) => x !== o.id) : [...picked, o.id])}>
            {o.label}
          </Chip>
        ))}
      </div>
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Albo dopisz własne</h2>
        <CustomInput items={custom} onChange={setCustom} placeholder={`Coś konkretnego w: ${q.label}`} />
      </div>
      <SenseDialog
        details={ambiguity}
        onCancel={() => setAmbiguity(null)}
        onPick={(sense) => {
          const next = custom.map((c) => (c.label.toLowerCase() === ambiguity?.label.toLowerCase() ? { ...c, sense } : c));
          setCustom(next);
          setAmbiguity(null);
          answer(next);
        }}
      />
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 7. Przegląd tagów ───────────────────────────── */

function TagsStep({ go, busy }: StepProps) {
  return (
    <OnboardingLayout
      index={6}
      onBack={() => go('interests')}
      title="Twoje tagi zainteresowań"
      subtitle="Tak będziemy dobierać treści. Ogólne tematy i szczegóły działają razem — RAG nie wyklucza newsów o agentach AI."
      footer={
        <Button onClick={() => go('report')} loading={busy}>
          Wygląda dobrze <ChevronRight className="size-4" aria-hidden />
        </Button>
      }
    >
      <TagEditor showLearned={false} />
    </OnboardingLayout>
  );
}

/* ───────────────────────────── 8. Raport ───────────────────────────── */

function ReportStep({ me, prev, onFinish }: StepProps & { onFinish: () => Promise<void> }) {
  const patchReport = usePatchReport();
  const [wants, setWants] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = me.user.emailVerified;
  const config = useConfig();

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      if (wants && verified) await patchReport.mutateAsync({ enabled: true });
      await onFinish();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać.');
      setFinishing(false);
    }
  };

  const resend = async () => {
    await authClient.sendVerificationEmail({ email: me.user.email, callbackURL: `${window.location.origin}/verified` });
    setResent(true);
  };

  return (
    <OnboardingLayout
      index={7}
      onBack={prev}
      title="Piątkowy raport tygodniowy"
      subtitle="W piątek o 20:00 wyślemy krótkie podsumowanie tygodnia i wydarzenia na kolejne 7 dni. Bezpłatnie, wypiszesz się jednym kliknięciem."
      footer={
        <Button onClick={finish} loading={finishing}>
          Zaczynamy <ChevronRight className="size-4" aria-hidden />
        </Button>
      }
    >
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <CategoryIllustration kind="events" seed="report" decorative className="h-28 w-full" />
        <div className="p-4">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Chcę dostawać raport</span>
              <span className="block text-sm text-muted">Piątek, 20:00 · {me.profile.timezone}</span>
            </span>
            <input
              type="checkbox"
              checked={wants}
              onChange={(e) => setWants(e.target.checked)}
              className="size-6 shrink-0 accent-violet"
            />
          </label>
        </div>
      </div>
      {wants && !verified && (
        <div className="mt-4">
          <Alert tone="warning">
            Raport wymaga potwierdzonego adresu <strong>{me.user.email}</strong>. Kliknij link z wiadomości, a potem włącz raport w
            Profilu.{' '}
            {config.data?.email.enabled === false ? (
              <span>Wysyłka e-maili nie jest jeszcze skonfigurowana — link wyślemy, gdy będzie dostępna.</span>
            ) : resent ? (
              <span className="font-semibold">Wysłano ponownie.</span>
            ) : (
              <button type="button" onClick={resend} className="font-semibold underline">
                Wyślij link ponownie
              </button>
            )}
          </Alert>
        </div>
      )}
    </OnboardingLayout>
  );
}
