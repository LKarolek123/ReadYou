import type {
  Interest,
  OnboardingStep,
  Profile,
  ProfilePatch,
  ReportSubscription,
  Sense,
} from '@readyou/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Coś poszło nie tak', err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export interface Me {
  user: { id: string; email: string; name: string; emailVerified: boolean; image: string | null };
  profile: Profile;
  onboardingStep: OnboardingStep;
}

export interface PublicConfig {
  googleEnabled: boolean;
  email: { provider: string; localCapture: boolean };
  contentEngine: 'not-configured' | 'demo' | 'live';
}

export interface OnboardingView {
  step: OnboardingStep;
  roots: { id: string; label: string; description: string; illustration: import('@readyou/shared').IllustrationKey }[];
  selectedRoots: string[];
  question: { key: string; label: string; path: string[]; depth: number; options: { id: string; label: string }[] } | null;
  pending: number;
  dfsDone: boolean;
  canGoBack: boolean;
  selections: { key: string; label: string; path: string[]; source: 'taxonomy' | 'custom'; depth: number }[];
}

export type AmbiguityDetails = { label: string; senses: Sense[] };

export type { Interest, Profile, ProfilePatch, ReportSubscription };
