/**
 * CLIProxy Config Hook
 * Manages config.yaml loading, editing, validation, and saving
 *
 * Uses a controlled editing pattern where edits are tracked separately
 * from server state to comply with React Compiler rules.
 */

import { useCallback, useMemo, useReducer } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { parse as parseYaml } from 'yaml';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
}

type EditAction =
  | { type: 'EDIT'; content: string; serverContent: string }
  | { type: 'RESET'; serverContent: string }
  | { type: 'SAVE_SUCCESS'; content: string };

interface EditState {
  // Local edit content (empty means using server content)
  localContent: string | null;
  // Last known server content for dirty detection
  lastServerContent: string;
}

function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'EDIT':
      // If editing back to server content, clear local state
      if (action.content === action.serverContent) {
        return { localContent: null, lastServerContent: action.serverContent };
      }
      return { localContent: action.content, lastServerContent: action.serverContent };
    case 'RESET':
      return { localContent: null, lastServerContent: action.serverContent };
    case 'SAVE_SUCCESS':
      return { localContent: null, lastServerContent: action.content };
    default:
      return state;
  }
}

function validateYaml(code: string): ValidationResult {
  if (!code.trim()) {
    return { valid: true };
  }

  try {
    parseYaml(code);
    return { valid: true };
  } catch (e: unknown) {
    const error = e as { linePos?: Array<{ line: number; col: number }>; message: string };
    const linePos = error.linePos?.[0];
    return {
      valid: false,
      error: error.message,
      line: linePos?.line,
      column: linePos?.col,
    };
  }
}

export function useCliproxyConfig() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Fetch config.yaml - server state
  const configQuery = useQuery({
    queryKey: ['cliproxy-config-yaml'],
    queryFn: () => api.cliproxy.getConfigYaml(),
  });

  // Fetch auth files list
  const authFilesQuery = useQuery({
    queryKey: ['cliproxy-auth-files'],
    queryFn: () => api.cliproxy.getAuthFiles(),
  });

  // Server content
  const serverContent = configQuery.data ?? '';

  // Edit state - tracks local edits separate from server
  const [editState, dispatch] = useReducer(editReducer, {
    localContent: null,
    lastServerContent: '',
  });

  // Derived: current content (local edit or server)
  const content = editState.localContent ?? serverContent;

  // Derived: dirty flag
  const isDirty = editState.localContent !== null && editState.localContent !== serverContent;

  // Derived: validation
  const validation = useMemo(() => validateYaml(content), [content]);

  // Update content
  const updateContent = useCallback(
    (newContent: string) => {
      dispatch({ type: 'EDIT', content: newContent, serverContent });
    },
    [serverContent]
  );

  // Reset to server content
  const resetContent = useCallback(() => {
    dispatch({ type: 'RESET', serverContent });
  }, [serverContent]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (contentToSave: string) => api.cliproxy.saveConfigYaml(contentToSave),
    onSuccess: (_data, variables) => {
      dispatch({ type: 'SAVE_SUCCESS', content: variables });
      queryClient.invalidateQueries({ queryKey: ['cliproxy-config-yaml'] });
      queryClient.invalidateQueries({ queryKey: ['cliproxy'] });
      toast.success(t('toasts.configSaved'));
    },
    onError: (error: Error) => {
      toast.error(t('toasts.configSaveFailed', { error: error.message }));
    },
  });

  // Save handler
  const saveContent = useCallback(() => {
    if (!validation.valid) {
      toast.error(t('toasts.invalidYaml'));
      return;
    }
    saveMutation.mutate(content);
  }, [content, validation.valid, saveMutation, t]);

  return {
    // State
    content,
    originalContent: serverContent,
    isDirty,
    validation,

    // Queries
    isLoading: configQuery.isLoading,
    isError: configQuery.isError,
    authFiles: authFilesQuery.data?.files ?? [],

    // Actions
    updateContent,
    resetContent,
    saveContent,
    isSaving: saveMutation.isPending,

    // Refresh
    refetch: configQuery.refetch,
  };
}

export function useCliproxyAuthFile(fileName: string | null) {
  return useQuery({
    queryKey: ['cliproxy-auth-file', fileName],
    queryFn: () => (fileName ? api.cliproxy.getAuthFile(fileName) : null),
    enabled: Boolean(fileName),
  });
}
