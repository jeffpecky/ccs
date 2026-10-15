/**
 * Device Code Hook
 *
 * Listens for WebSocket device code events and manages dialog state.
 * Similar to useProjectSelection but for Device Code OAuth flows
 * (GitHub Copilot, Qwen, Kiro, etc.)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getDeviceCodeProviderDisplayName } from '@/lib/provider-config';

export interface DeviceCodePrompt {
  sessionId: string;
  provider: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
}

interface DeviceCodeState {
  isOpen: boolean;
  prompt: DeviceCodePrompt | null;
  error: string | null;
}

function coerceProvider(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalized = value.trim().toLowerCase();
  return normalized || 'unknown';
}

export function useDeviceCode() {
  const { t } = useTranslation();
  const [state, setState] = useState<DeviceCodeState>({
    isOpen: false,
    prompt: null,
    error: null,
  });

  // Listen for WebSocket messages via custom events
  useEffect(() => {
    const handleMessage = (event: CustomEvent<{ type: string; [key: string]: unknown }>) => {
      const data = event.detail;

      if (data.type === 'deviceCodeReceived') {
        console.log('[DeviceCode] Received prompt:', data.sessionId);
        const provider = coerceProvider(data.provider);
        const displayName = getDeviceCodeProviderDisplayName(provider);
        toast.info(t('toasts.authRequired', { provider: displayName }));

        setState({
          isOpen: true,
          prompt: {
            sessionId: data.sessionId as string,
            provider,
            userCode: data.userCode as string,
            verificationUrl: data.verificationUrl as string,
            expiresAt: data.expiresAt as number,
          },
          error: null,
        });
      } else if (data.type === 'deviceCodeCompleted') {
        console.log('[DeviceCode] Auth completed:', data.sessionId);
        setState((prev) => {
          if (prev.prompt && prev.prompt.sessionId === data.sessionId) {
            const displayName = getDeviceCodeProviderDisplayName(prev.prompt.provider);
            toast.success(t('toasts.authSuccess', { provider: displayName }));
            return { isOpen: false, prompt: null, error: null };
          }
          return prev;
        });
      } else if (data.type === 'deviceCodeFailed') {
        console.log('[DeviceCode] Auth failed:', data.sessionId, data.error);
        setState((prev) => {
          if (prev.prompt && prev.prompt.sessionId === data.sessionId) {
            const displayName = getDeviceCodeProviderDisplayName(prev.prompt.provider);
            toast.error(t('toasts.authFailed', { provider: displayName }));
            return { isOpen: false, prompt: null, error: data.error as string };
          }
          return prev;
        });
      } else if (data.type === 'deviceCodeExpired') {
        console.log('[DeviceCode] Code expired:', data.sessionId);
        setState((prev) => {
          if (prev.prompt?.sessionId === data.sessionId) {
            toast.error(t('toasts.deviceCodeExpired'));
            return { isOpen: false, prompt: null, error: 'Device code expired' };
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
  }, [t]);

  const handleClose = useCallback(() => {
    setState({ isOpen: false, prompt: null, error: null });
  }, []);

  const handleOpenUrl = useCallback(() => {
    if (state.prompt?.verificationUrl) {
      window.open(state.prompt.verificationUrl, '_blank', 'noopener,noreferrer');
    }
  }, [state.prompt]);

  const handleCopyCode = useCallback(async () => {
    if (state.prompt?.userCode) {
      try {
        await navigator.clipboard.writeText(state.prompt.userCode);
        toast.success(t('toasts.codeCopied'));
      } catch {
        toast.error(t('toasts.failedCopy'));
      }
    }
  }, [state.prompt, t]);

  return useMemo(
    () => ({
      isOpen: state.isOpen,
      prompt: state.prompt,
      error: state.error,
      onClose: handleClose,
      onOpenUrl: handleOpenUrl,
      onCopyCode: handleCopyCode,
    }),
    [state.isOpen, state.prompt, state.error, handleClose, handleOpenUrl, handleCopyCode]
  );
}
