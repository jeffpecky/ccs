/**
 * CLIProxy Logs Hook
 * Manages log streaming with buffering and throttling
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  provider?: string;
  requestId?: string;
}

interface LogsState {
  logs: LogEntry[];
  isPaused: boolean;
  isConnected: boolean;
  lastTimestamp: string | null;
  stats: {
    total: number;
    errors: number;
    warnings: number;
  };
}

const MAX_LOGS = 500;
const FLUSH_INTERVAL = 100; // ms
const POLL_INTERVAL = 1000; // ms

interface CliproxyErrorLogFile {
  name: string;
  size: number;
  modified: number;
  statusCode?: number;
  model?: string;
}

function toTimestampMs(modified: number): number {
  return modified > 1_000_000_000_000 ? modified : modified * 1000;
}

function buildLogMessage(file: CliproxyErrorLogFile): string {
  const parts = [file.name];
  if (typeof file.statusCode === 'number') {
    parts.push(`HTTP ${file.statusCode}`);
  }
  if (file.model) {
    parts.push(file.model);
  }
  return parts.join(' | ');
}

export function useCliproxyLogs() {
  const [state, setState] = useState<LogsState>({
    logs: [],
    isPaused: false,
    isConnected: false,
    lastTimestamp: null,
    stats: { total: 0, errors: 0, warnings: 0 },
  });

  const bufferRef = useRef<LogEntry[]>([]);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);
  const lastTimestampRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    isPausedRef.current = state.isPaused;
  }, [state.isPaused]);

  useEffect(() => {
    lastTimestampRef.current = state.lastTimestamp;
  }, [state.lastTimestamp]);

  // Flush buffer to state
  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    if (isPausedRef.current) return;

    const newLogs = bufferRef.current;
    bufferRef.current = [];

    setState((prev) => {
      const combined = [...prev.logs, ...newLogs];
      const trimmed = combined.slice(-MAX_LOGS);

      const errorCount = trimmed.filter((l) => l.level === 'error').length;
      const warnCount = trimmed.filter((l) => l.level === 'warn').length;

      return {
        ...prev,
        logs: trimmed,
        stats: {
          total: trimmed.length,
          errors: errorCount,
          warnings: warnCount,
        },
      };
    });
  }, []);

  // Poll for new logs
  const pollLogs = useCallback(async () => {
    if (isPausedRef.current) return;

    try {
      const afterIso = lastTimestampRef.current ?? new Date(Date.now() - 60000).toISOString();
      const parsedAfterMs = Date.parse(afterIso);
      const afterMs = Number.isNaN(parsedAfterMs) ? Date.now() - 60000 : parsedAfterMs;
      const response = await fetch('/api/cliproxy/error-logs');

      if (!response.ok) {
        throw new Error('Failed to fetch logs');
      }

      const data = (await response.json()) as { files?: CliproxyErrorLogFile[] };
      const entries: LogEntry[] = (data.files ?? [])
        .filter((file) => toTimestampMs(file.modified) > afterMs)
        .sort((a, b) => toTimestampMs(a.modified) - toTimestampMs(b.modified))
        .map((file) => ({
          id: file.name,
          timestamp: new Date(toTimestampMs(file.modified)).toISOString(),
          level: 'error' as const,
          message: buildLogMessage(file),
          provider: 'cliproxy',
          requestId: file.name,
        }));

      if (entries.length > 0) {
        bufferRef.current.push(...entries);
        const lastEntry = entries[entries.length - 1];
        setState((prev) => ({
          ...prev,
          isConnected: true,
          lastTimestamp: lastEntry.timestamp,
        }));
      } else {
        setState((prev) => ({ ...prev, isConnected: true }));
      }
    } catch {
      setState((prev) => ({ ...prev, isConnected: false }));
    }

    // Schedule next poll
    if (!isPausedRef.current) {
      pollTimeoutRef.current = setTimeout(pollLogs, POLL_INTERVAL);
    }
  }, []);

  // Start polling on mount
  useEffect(() => {
    // Start flush interval
    flushIntervalRef.current = setInterval(flushBuffer, FLUSH_INTERVAL);
    // Start polling
    pollLogs();

    return () => {
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [flushBuffer, pollLogs]);

  // Actions
  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: true }));
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: false }));
    pollLogs();
  }, [pollLogs]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    setState((prev) => ({
      ...prev,
      logs: [],
      stats: { total: 0, errors: 0, warnings: 0 },
    }));
  }, []);

  return {
    logs: state.logs,
    isPaused: state.isPaused,
    isConnected: state.isConnected,
    stats: state.stats,
    pause,
    resume,
    clear,
  };
}

// Filter hook for search and level filtering
export function useLogsFilter(logs: LogEntry[]) {
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = logs.filter((log) => {
    // Level filter
    if (levelFilter !== 'all' && log.level !== levelFilter) {
      return false;
    }
    // Search filter
    if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return {
    filteredLogs,
    levelFilter,
    setLevelFilter,
    searchQuery,
    setSearchQuery,
  };
}
