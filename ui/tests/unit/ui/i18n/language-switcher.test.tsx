import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@tests/setup/test-utils';
import i18n from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(Element.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    await i18n.changeLanguage('en');
  });

  // jsdom render exceeds 5s under parallel full-suite load; raise the timeout.
  it('renders the language switcher with English selected', () => {
    render(<LanguageSwitcher />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  }, 20000);
});
