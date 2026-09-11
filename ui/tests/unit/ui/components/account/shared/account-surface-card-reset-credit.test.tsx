import { render, screen } from '@tests/setup/test-utils';
import { RotateCcw } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AccountSurfaceCard } from '@/components/account/shared/account-surface-card';
import { Button } from '@/components/ui/button';

describe('AccountSurfaceCard reset credit action', () => {
  it('renders reset credit action beside Codex plan badge and above paused status', () => {
    render(
      <AccountSurfaceCard
        mode="detailed"
        provider="codex"
        accountId="wankys644@gmail.com#plus"
        email="wankys644@gmail.com"
        displayEmail="wankys644@gmail.com"
        tier="pro"
        paused
        showQuota={false}
        resetCreditAction={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Reset Codex limit, 1 credit"
          >
            <RotateCcw className="w-3 h-3" />1
          </Button>
        }
      />
    );

    const reset = screen.getByRole('button', { name: 'Reset Codex limit, 1 credit' });
    expect(reset).toBeInTheDocument();
    expect(screen.getByText('Plus').parentElement).toContainElement(reset);
    expect(screen.getByText('Paused').parentElement).not.toContainElement(reset);
  });
});
