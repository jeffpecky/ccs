import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor, within } from '@tests/setup/test-utils';
import { toast } from 'sonner';

import { TokenSaverPage } from '@/pages/token-saver';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const config = {
  enabled: true,
  rtk: true,
  caveman: { enabled: false, level: 'standard' },
  ponytail: { enabled: true, level: 'standard' },
  headroom: {
    enabled: true,
    url: 'http://127.0.0.1:8787',
    mode: 'local',
    timeout_ms: 3000,
    compress_user_messages: false,
    token_env: 'HEADROOM_PROXY_TOKEN',
    code_aware: false,
    kompress: true,
  },
  pxpipe: { enabled: false, min_chars: 25000, timeout_ms: 15000 },
};

describe('TokenSaverPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/status')) {
          return new Response(
            JSON.stringify({
              running: true,
              healthy: true,
              managed: true,
              installed: true,
              port: 8787,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/extras')) {
          return new Response(
            JSON.stringify({
              installed: true,
              version: '0.35.0',
              extras: { code: true, ml: true },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
  });

  it('renders exactly four primary saver rows and hides global and PXPipe controls', async () => {
    render(<TokenSaverPage />);

    expect(await screen.findByRole('heading', { name: 'Token Saver' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('token-saver-row');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Compress tool output')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Compress context')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Compress LLM output')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Lazy senior dev')).toBeInTheDocument();
    expect(screen.getByLabelText('RTK')).toBeChecked();
    expect(screen.getByLabelText('Headroom')).toBeChecked();
    expect(screen.getByLabelText('Caveman')).not.toBeChecked();
    expect(screen.getByLabelText('Ponytail')).toBeChecked();
    expect(screen.queryByLabelText('Token Saver')).not.toBeInTheDocument();
    expect(screen.queryByText('PXPipe')).not.toBeInTheDocument();
    expect(screen.queryByText('CLIProxy')).not.toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
  });

  it('offers accessible Lite Full Ultra levels for Caveman and Ponytail', async () => {
    render(<TokenSaverPage />);
    await screen.findByText('Compress LLM output');

    const cavemanLevels = screen.getByRole('group', { name: 'Caveman compression level' });
    const ponytailLevels = screen.getByRole('group', { name: 'Ponytail compression level' });
    expect(
      within(cavemanLevels)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Lite', 'Full', 'Ultra']);
    expect(
      within(ponytailLevels)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Lite', 'Full', 'Ultra']);
    expect(within(cavemanLevels).getByRole('button', { name: 'Full' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(ponytailLevels).getByRole('button', { name: 'Full' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps Headroom configuration and lifecycle inside Headroom modal', async () => {
    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Manage' }));

    const dialog = screen.getByRole('dialog', { name: 'Headroom' });
    expect(within(dialog).getByLabelText('Headroom URL')).toHaveValue('http://127.0.0.1:8787');
    expect(await within(dialog).findByLabelText('Code-aware compression')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Kompress ML')).toBeChecked();
    expect(within(dialog).getByText('Healthy')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open Headroom dashboard' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:8787/dashboard'
    );
    expect(within(dialog).getByRole('link', { name: 'Open Headroom dashboard' })).toHaveAttribute(
      'rel',
      'noreferrer'
    );
  });

  it('refreshes extras before showing install actions in Headroom modal', async () => {
    let extrasCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return new Response(
          JSON.stringify({
            running: true,
            healthy: true,
            managed: true,
            installed: true,
            port: 8787,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/extras')) {
        extrasCalls += 1;
        return new Response(
          JSON.stringify({
            installed: true,
            version: '0.35.0',
            extras: extrasCalls === 1 ? { code: false, ml: false } : { code: true, ml: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage|Setup Headroom/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(extrasCalls).toBeGreaterThanOrEqual(2));
    expect(within(dialog).getAllByRole('button', { name: 'Uninstall' })).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('shows checking state instead of install while extras status is unknown', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return new Response(
          JSON.stringify({
            running: true,
            healthy: true,
            managed: true,
            installed: true,
            port: 8787,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/extras')) {
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage|Setup Headroom/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Checking...')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('shows retry state instead of install when extras status cannot be verified', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return new Response(
          JSON.stringify({
            running: true,
            healthy: true,
            managed: true,
            installed: true,
            port: 8787,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/extras')) {
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 502 });
      }
      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Manage|Setup Headroom/ }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findAllByText('Unable to verify')).toHaveLength(2);
    expect(within(dialog).getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('derives global enabled from four visible savers and preserves disabled PXPipe config', async () => {
    render(<TokenSaverPage />);
    await screen.findByText('Compress tool output');

    await userEvent.click(screen.getByLabelText('RTK'));
    await userEvent.click(screen.getByLabelText('Headroom'));
    await userEvent.click(screen.getByLabelText('Ponytail'));
    await userEvent.click(screen.getByLabelText('Caveman'));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Caveman compression level' })).getByRole('button', {
        name: 'Lite',
      })
    );
    await waitFor(() => {
      const saved = vi
        .mocked(fetch)
        .mock.calls.filter(([, options]) => options?.method === 'PUT')
        .map(([, options]) => JSON.parse(String(options?.body)))
        .find((body) => body.caveman?.enabled === true || body.caveman?.level === 'terse');
      expect(saved).toBeDefined();
      expect(saved.enabled).toBe(true);
      expect(saved.caveman.enabled || saved.caveman.level === 'terse').toBe(true);
      expect(saved.pxpipe).toEqual(config.pxpipe);
    });
  });

  it('sets global enabled false when all four visible savers are off', async () => {
    render(<TokenSaverPage />);
    await screen.findByText('Compress tool output');

    await userEvent.click(screen.getByLabelText('RTK'));
    await userEvent.click(screen.getByLabelText('Headroom'));
    await userEvent.click(screen.getByLabelText('Ponytail'));
    await waitFor(() => {
      const saved = vi
        .mocked(fetch)
        .mock.calls.filter(([, options]) => options?.method === 'PUT')
        .map(([, options]) => JSON.parse(String(options?.body)))
        .find(
          (body) =>
            body.rtk === false &&
            body.headroom?.enabled === false &&
            body.ponytail?.enabled === false
        );
      expect(saved?.enabled).toBe(false);
    });
  });

  it('preserves hidden PXPipe config while auto-saving visible saver changes', async () => {
    const enabledPxpipe = {
      ...config,
      rtk: false,
      ponytail: { ...config.ponytail, enabled: false },
      headroom: { ...config.headroom, enabled: false },
      pxpipe: { ...config.pxpipe, enabled: true },
    };
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/status')
              ? { running: false, healthy: false }
              : { config: enabledPxpipe }
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    render(<TokenSaverPage />);
    await screen.findByText('Compress tool output');
    await userEvent.click(screen.getByLabelText('Caveman'));
    await waitFor(() => {
      const saved = vi
        .mocked(fetch)
        .mock.calls.filter(([, options]) => options?.method === 'PUT')
        .map(([, options]) => JSON.parse(String(options?.body)))
        .find((body) => body.caveman?.enabled === true);
      expect(saved?.enabled).toBe(true);
      expect(saved?.pxpipe).toEqual(enabledPxpipe.pxpipe);
    });
  });

  it('auto-saves visible saver changes', async () => {
    render(<TokenSaverPage />);
    await screen.findByText('Compress tool output');
    await userEvent.click(screen.getByLabelText('RTK'));
    await waitFor(() => {
      const saved = vi
        .mocked(fetch)
        .mock.calls.filter(([, options]) => options?.method === 'PUT')
        .map(([, options]) => JSON.parse(String(options?.body)))
        .find((body) => body.rtk === false);
      expect(saved?.enabled).toBe(true);
    });
  });

  it('disables mutating controls while lifecycle action is pending', async () => {
    let releaseAction: (() => void) | undefined;
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      if (String(input).endsWith('/stop')) {
        await new Promise<void>((resolve) => {
          releaseAction = resolve;
        });
      }
      return new Response(
        JSON.stringify(
          String(input).endsWith('/status')
            ? { running: true, healthy: true, managed: true }
            : options?.method === 'POST'
              ? { success: true }
              : { config }
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByLabelText('Headroom URL')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh status', hidden: true })).toBeDisabled();
    expect(screen.getByText('Updating Headroom process')).toBeInTheDocument();
    releaseAction?.();
    await waitFor(() => expect(screen.getByLabelText('Headroom URL')).not.toBeDisabled());
  });

  it('shows actionable Headroom startup diagnostics', async () => {
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ running: false, healthy: false, installed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/extras')) {
        return new Response(
          JSON.stringify({ installed: true, version: '0.37.0', extras: { code: false, ml: true } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/start') && options?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'HEADROOM_STARTUP_FAILED',
            stage: 'readiness_timeout',
            error: 'Headroom did not become healthy within 30s. Process tree stopped.',
            hint: 'Run `headroom doctor`, then repair or update Headroom and retry.',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Setup' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Headroom did not become healthy within 30s. Process tree stopped. Run `headroom doctor`, then repair or update Headroom and retry. (readiness_timeout)'
      )
    );
  });

  it('shows accessible loading status', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    render(<TokenSaverPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Token Saver');
  });

  it('survives invalid persisted URL and offers setup repair without dashboard link', async () => {
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/status')
              ? { running: false, healthy: false }
              : { config: { ...config, headroom: { ...config.headroom, url: 'not a url' } } }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    render(<TokenSaverPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Setup' }));
    expect(screen.getByText('Enter a valid HTTP or HTTPS Headroom URL.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Headroom dashboard' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Headroom URL')).toHaveValue('not a url');
  });

  it('aborts stale refresh and ignores its later response', async () => {
    render(<TokenSaverPage />);
    const refreshButton = await screen.findByRole('button', { name: 'Refresh status' });
    const configResolvers: Array<(response: Response) => void> = [];
    vi.mocked(fetch).mockImplementation((input, options) => {
      if (String(input).endsWith('/status')) {
        return Promise.resolve(
          new Response(JSON.stringify({ running: false, healthy: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (String(input).endsWith('/extras')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ installed: true, version: null, extras: { code: false, ml: false } }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        );
      }
      return new Promise<Response>((resolve, reject) => {
        configResolvers.push(resolve);
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });
    refreshButton.click();
    refreshButton.click();
    await waitFor(() => expect(configResolvers).toHaveLength(2));
    configResolvers[1](
      new Response(JSON.stringify({ config: { ...config, rtk: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(await screen.findByLabelText('RTK')).not.toBeChecked();
    configResolvers[0](
      new Response(JSON.stringify({ config: { ...config, rtk: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByLabelText('RTK')).not.toBeChecked();
  });
});
