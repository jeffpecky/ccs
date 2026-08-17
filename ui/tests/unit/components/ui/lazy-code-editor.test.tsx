import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LazyCodeEditorFactory } from '@/components/shared/lazy-code-editor';

const Editor = () => <div>Loaded editor</div>;

describe('LazyCodeEditor', () => {
  it('keeps an editor-sized region while loading', () => {
    const LazyCodeEditor = LazyCodeEditorFactory(() => new Promise(() => {}));

    render(<LazyCodeEditor value="" onChange={vi.fn()} minHeight="320px" />);

    expect(screen.getByRole('status', { name: 'Loading code editor' })).toHaveStyle({
      minHeight: '320px',
    });
  });

  it('recovers from a rejected import when retried', async () => {
    const user = userEvent.setup();
    const loader = vi
      .fn<() => Promise<{ default: typeof Editor }>>()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ default: Editor });
    const LazyCodeEditor = LazyCodeEditorFactory(loader);

    render(<LazyCodeEditor value="" onChange={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Code editor failed to load');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Loaded editor')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
