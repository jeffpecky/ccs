import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { AddAccountDialog } from '@/components/account/add-account-dialog';
import { render, screen, userEvent } from '@tests/setup/test-utils';

const authMocks = vi.hoisted(() => ({
  startAuth: vi.fn(),
  cancelAuth: vi.fn(),
  submitCallback: vi.fn(),
}));

const kiroImportMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock('@/hooks/use-cliproxy-auth-flow', () => ({
  useCliproxyAuthFlow: () => ({
    provider: null,
    isAuthenticating: false,
    error: null,
    authUrl: null,
    oauthState: null,
    isSubmittingCallback: false,
    isDeviceCodeFlow: false,
    startAuth: authMocks.startAuth,
    cancelAuth: authMocks.cancelAuth,
    submitCallback: authMocks.submitCallback,
  }),
}));

vi.mock('@/hooks/use-cliproxy', () => ({
  useKiroImport: () => ({
    isPending: false,
    mutate: kiroImportMocks.mutate,
  }),
}));

describe('AddAccountDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(Element.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  });

  it('submits GitLab PAT mode with base URL and token through the shared auth hook', async () => {
    render(<AddAccountDialog open onClose={vi.fn()} provider="gitlab" displayName="GitLab Duo" />);

    await userEvent.click(screen.getByRole('combobox', { name: 'GitLab auth method' }));
    await userEvent.click(screen.getByRole('option', { name: 'Personal Access Token' }));

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com');
    await userEvent.type(screen.getByLabelText('Personal Access Token'), 'glpat-test-token');

    await userEvent.click(screen.getByRole('button', { name: 'Authenticate' }));

    expect(authMocks.startAuth).toHaveBeenCalledWith(
      'gitlab',
      expect.objectContaining({
        gitlabAuthMode: 'pat',
        gitlabBaseUrl: 'https://gitlab.example.com',
        gitlabPersonalAccessToken: 'glpat-test-token',
        startEndpoint: 'start',
      })
    );
  }, 20000);
});
