/**
 * Project Selection Hook
 *
 * Listens for WebSocket project selection events and manages the dialog state.
 * Used in conjunction with ProjectSelectionDialog component.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

interface GCloudProject {
  id: string;
  name: string;
  index: number;
}

interface ProjectSelectionPrompt {
  sessionId: string;
  provider: string;
  projects: GCloudProject[];
  defaultProjectId: string;
  supportsAll: boolean;
}

interface ProjectSelectionState {
  isOpen: boolean;
  prompt: ProjectSelectionPrompt | null;
}

export function useProjectSelection() {
  const [state, setState] = useState<ProjectSelectionState>({
    isOpen: false,
    prompt: null,
  });

  // Listen for WebSocket messages via custom events
  useEffect(() => {
    const handleMessage = (event: CustomEvent<{ type: string; [key: string]: unknown }>) => {
      const data = event.detail;

      if (data.type === 'projectSelectionRequired') {
        console.log('[ProjectSelection] Received prompt:', data.sessionId);
        setState({
          isOpen: true,
          prompt: {
            sessionId: data.sessionId as string,
            provider: data.provider as string,
            projects: data.projects as GCloudProject[],
            defaultProjectId: data.defaultProjectId as string,
            supportsAll: data.supportsAll as boolean,
          },
        });
      } else if (data.type === 'projectSelectionTimeout') {
        console.log('[ProjectSelection] Timeout:', data.sessionId);
        // Close dialog if this session timed out
        setState((prev) => {
          if (prev.prompt?.sessionId === data.sessionId) {
            return { isOpen: false, prompt: null };
          }
          return prev;
        });
      } else if (data.type === 'projectSelectionSubmitted') {
        console.log('[ProjectSelection] Submitted:', data.sessionId);
        // Close dialog if this session was submitted
        setState((prev) => {
          if (prev.prompt?.sessionId === data.sessionId) {
            return { isOpen: false, prompt: null };
          }
          return prev;
        });
      }
    };

    // Listen for custom ws-message events dispatched by useWebSocket
    window.addEventListener('ws-message', handleMessage as EventListener);

    return () => {
      window.removeEventListener('ws-message', handleMessage as EventListener);
    };
  }, []);

  const handleSelect = useCallback(
    async (selectedId: string) => {
      if (!state.prompt) return;

      const response = await fetch(
        `/api/cliproxy/auth/project-selection/${state.prompt.sessionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedId }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit project selection');
      }
    },
    [state.prompt]
  );

  const handleClose = useCallback(() => {
    setState({ isOpen: false, prompt: null });
  }, []);

  return useMemo(
    () => ({
      isOpen: state.isOpen,
      prompt: state.prompt,
      onSelect: handleSelect,
      onClose: handleClose,
    }),
    [state.isOpen, state.prompt, handleSelect, handleClose]
  );
}
