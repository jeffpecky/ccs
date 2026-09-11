import { describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent } from '@tests/setup/test-utils';

import { OpenCodeModelConfigTab } from '@/components/cliproxy/cli-provider-editor/opencode-editor';

vi.mock('@/components/cliproxy/provider-model-selector', () => ({
  FlexibleModelSelector: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value?: string;
    onChange: (model: string) => void;
  }) => (
    <button type="button" onClick={() => onChange('model-c')}>
      {label}: {value || 'none'}
    </button>
  ),
}));

describe('OpenCodeModelConfigTab', () => {
  it('renders selected models and exposes active, remove, and add actions', async () => {
    const onAddModel = vi.fn();
    const onRemoveModel = vi.fn();
    const onSetActiveModel = vi.fn();

    render(
      <OpenCodeModelConfigTab
        currentModel="model-a"
        selectedModels={['model-a', 'model-b']}
        subagentModel="model-b"
        providerModels={[
          { id: 'model-a', owned_by: 'test' },
          { id: 'model-b', owned_by: 'test' },
          { id: 'model-c', owned_by: 'test' },
        ]}
        onUpdateEnvValue={vi.fn()}
        onAddModel={onAddModel}
        onRemoveModel={onRemoveModel}
        onSetActiveModel={onSetActiveModel}
      />
    );

    expect(screen.getByLabelText('Selected models')).toHaveTextContent('model-amodel-b');
    expect(screen.getByRole('button', { name: 'Add Model: model-a' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set model-b active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove model-b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Model: model-a' }));

    expect(onSetActiveModel).toHaveBeenCalledWith('model-b');
    expect(onSetActiveModel).toHaveBeenCalledWith('model-c');
    expect(onRemoveModel).toHaveBeenCalledWith('model-b');
    expect(onAddModel).toHaveBeenCalledWith('model-c');
  });

  it('allows final removal and shows explicit empty state', async () => {
    const onRemoveModel = vi.fn();
    render(
      <OpenCodeModelConfigTab
        currentModel=""
        selectedModels={[]}
        subagentModel=""
        providerModels={[]}
        onUpdateEnvValue={vi.fn()}
        onAddModel={vi.fn()}
        onRemoveModel={onRemoveModel}
        onSetActiveModel={vi.fn()}
      />
    );

    expect(screen.getByText('No models selected')).toBeInTheDocument();

    render(
      <OpenCodeModelConfigTab
        currentModel="model-a"
        selectedModels={['model-a']}
        subagentModel="model-a"
        providerModels={[]}
        onUpdateEnvValue={vi.fn()}
        onAddModel={vi.fn()}
        onRemoveModel={onRemoveModel}
        onSetActiveModel={vi.fn()}
      />
    );
    const remove = screen.getByRole('button', { name: 'Remove model-a' });
    expect(remove).toBeEnabled();
    await userEvent.click(remove);
    expect(onRemoveModel).toHaveBeenCalledWith('model-a');
  });
});
