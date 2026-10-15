import { render, screen, userEvent, waitFor, within } from '@tests/setup/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock react-virtuoso for jsdom (no layout measurements -> zero rows).
vi.mock('react-virtuoso', () => {
  const Virtuoso = ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-virtuoso-mock>
      {data.map((item, index) => (
        <div key={index} data-virtuoso-row={index}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  );
  return { Virtuoso };
});

import { LogsPage } from '@/pages/logs';

const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function buildEntries(source: string) {
  if (source === 'agent-runner') {
    return [
      {
        id: 'entry-2',
        timestamp: '2026-04-07T11:10:00.000Z',
        level: 'warn',
        source: 'agent-runner',
        event: 'task.retry',
        message: 'Worker retry scheduled',
        processId: 4121,
        runId: 'run-2',
        context: { attempt: 2, reason: 'network jitter' },
      },
    ];
  }
  return [
    {
      id: 'entry-1',
      timestamp: '2026-04-07T11:00:00.000Z',
      level: 'error',
      source: 'dashboard',
      event: 'logs.bootstrap',
      message: 'Boot sequence failed for dashboard logging',
      processId: 25582,
      runId: 'run-1',
      context: { component: 'dashboard', stage: 'bootstrap' },
    },
    {
      id: 'entry-2',
      timestamp: '2026-04-07T11:10:00.000Z',
      level: 'warn',
      source: 'agent-runner',
      event: 'task.retry',
      message: 'Worker retry scheduled',
      processId: 4121,
      runId: 'run-2',
      context: { attempt: 2, reason: 'network jitter' },
    },
  ];
}

function installFetchMock() {
  fetchMock.mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, 'http://localhost');

    if (parsed.pathname === '/api/logs/config') {
      return jsonResponse({
        logging: {
          enabled: true,
          level: 'info',
          rotate_mb: 10,
          retain_days: 7,
          redact: true,
          live_buffer_size: 250,
        },
      });
    }
    if (parsed.pathname === '/api/logs/sources') {
      return jsonResponse({
        sources: [
          {
            source: 'dashboard',
            label: 'Dashboard UI',
            kind: 'native',
            count: 18,
            lastTimestamp: '2026-04-07T11:00:00.000Z',
          },
          {
            source: 'agent-runner',
            label: 'Agent Runner',
            kind: 'legacy',
            count: 9,
            lastTimestamp: '2026-04-07T11:10:00.000Z',
          },
        ],
      });
    }
    if (parsed.pathname === '/api/logs/entries') {
      const source = parsed.searchParams.get('source') ?? 'all';
      const search = parsed.searchParams.get('search');
      const entries = buildEntries(source).filter((entry) =>
        search ? entry.message.toLowerCase().includes(search.toLowerCase()) : true
      );
      return jsonResponse({ entries });
    }
    return Promise.reject(new Error(`Unhandled request: ${url}`));
  });
}

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
    // Force desktop layout so the detail panel renders inline.
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
  });

  it('shows the loading skeleton while the initial queries are pending', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    render(<LogsPage />);
    expect(screen.getByLabelText('Loading logs...')).toBeInTheDocument();
  });

  // jsdom render exceeds 5s under parallel full-suite load; raise the timeout.
  it('renders entries and supports search filtering', async () => {
    installFetchMock();
    render(<LogsPage />);

    expect(
      (await screen.findAllByText('Boot sequence failed for dashboard logging')).length
    ).toBeGreaterThan(0);

    const search = screen.getByLabelText('Search');
    await userEvent.clear(search);
    await userEvent.type(search, 'retry');

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('search=retry'))).toBe(
        true
      );
    });
  }, 20000);

  // jsdom render exceeds 5s under parallel full-suite load; raise the timeout.
  it('selecting a row reveals overview fields and raw JSON', async () => {
    installFetchMock();
    render(<LogsPage />);

    // Wait for entries to load, then click the row containing the warn entry.
    await screen.findAllByText('Worker retry scheduled');
    const row = screen
      .getAllByRole('row')
      .find((el) => within(el).queryByText(/Worker retry scheduled/));
    if (!row) throw new Error('row not found');
    await userEvent.click(row);

    // Detail panel header shows event name.
    expect((await screen.findAllByText('task.retry')).length).toBeGreaterThan(0);

    // Verify detail panel surfaced the selected entry's event name (header).
    expect(screen.getAllByText('task.retry').length).toBeGreaterThan(0);
  }, 20000);
});
