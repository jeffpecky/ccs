/**
 * Types for Error Logs Monitor
 */

export type TabType = 'overview' | 'headers' | 'request' | 'response' | 'raw';

export interface ErrorLogItemProps {
  name: string;
  size: number;
  modified: number;
  isSelected: boolean;
  onClick: () => void;
  /** HTTP status code from pre-parsed metadata */
  statusCode?: number;
  /** Model name from pre-parsed metadata */
  model?: string;
}

export interface LogContentPanelProps {
  name: string | null;
  absolutePath?: string;
}
