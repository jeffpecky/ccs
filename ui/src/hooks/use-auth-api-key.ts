/**
 * useAuthApiKey Hook
 * Shared hook to fetch the effective API key from the Auth tab.
 * Used by all CLI tool editors to auto-fill base URL and API key on save.
 */

import { useQuery } from '@tanstack/react-query';

interface AuthApiKeyResponse {
  apiKey: { value: string };
}

export function useAuthApiKey() {
  return useQuery<AuthApiKeyResponse>({
    queryKey: ['auth-tokens-raw'],
    queryFn: async () => {
      const response = await fetch('/api/settings/auth/tokens/raw');
      if (!response.ok) return { apiKey: { value: 'sk-dummy' } };
      return response.json();
    },
    staleTime: 60000,
  });
}

export function getEffectiveApiKey(authTokens?: AuthApiKeyResponse): string {
  return authTokens?.apiKey?.value ?? 'sk-dummy';
}
