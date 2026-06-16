/**
 * Delegation System Types
 */

/**
 * Session metadata for delegation tracking
 */
export interface SessionMetadata {
  id: string; // Unique session ID
  profile: string; // Target profile (glm, kimi)
  prompt: string; // Initial prompt
  workingDir: string; // CWD at execution time
  startTime: number; // Unix timestamp (ms)
  endTime?: number; // Unix timestamp (ms)
  exitCode?: number; // Process exit code
  duration?: number; // Execution duration (seconds)
}

/**
 * Delegation session (persisted)
 */
export interface DelegationSession {
  metadata: SessionMetadata;
  turns: number; // Conversation turns
  lastPrompt?: string; // Last user prompt (for :continue)
}

/**
 * Sessions registry
 * Located at: ~/.ccs/delegation-sessions.json
 */
export interface DelegationSessionsRegistry {
  sessions: Record<string, DelegationSession>; // sessionId → session
  lastSessionId?: string; // Most recent session ID
}

/**
 * Real-time output event
 */
export interface ToolEvent {
  type: 'tool';
  tool: string; // Tool name (Write, Edit, Bash, etc.)
  args: string; // Simplified args (file path, command, etc.)
  timestamp: number;
}

export interface OutputEvent {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

export type DelegationEvent = ToolEvent | OutputEvent;
