import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Interest, type Me, type OnboardingView, type ProfilePatch, type PublicConfig, type ReportSubscription } from './api.ts';

export const keys = {
  config: ['config'] as const,
  me: ['me'] as const,
  onboarding: ['onboarding'] as const,
  interests: ['interests'] as const,
  report: ['report-subscription'] as const,
};

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => api.get<PublicConfig>('/config'), staleTime: Infinity });
}

/** Sesja + profil. 401 → `null` (niezalogowany), inne błędy propagują się do UI. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<Me>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

export function usePatchProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.patch('/me/profile', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useOnboarding(enabled = true) {
  return useQuery({ queryKey: keys.onboarding, queryFn: () => api.get<OnboardingView>('/onboarding'), enabled });
}

export function useInterests() {
  return useQuery({ queryKey: keys.interests, queryFn: () => api.get<Interest[]>('/me/interests') });
}

export function useReportSubscription() {
  return useQuery({ queryKey: keys.report, queryFn: () => api.get<ReportSubscription>('/me/report-subscription') });
}

export function usePatchReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<ReportSubscription, 'enabled' | 'weekday' | 'localTime'>>) =>
      api.patch<ReportSubscription>('/me/report-subscription', patch),
    onSuccess: (data) => qc.setQueryData(keys.report, data),
  });
}
