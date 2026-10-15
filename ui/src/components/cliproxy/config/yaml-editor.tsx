/**
 * YAML Editor Component
 * Right panel YAML editor with syntax highlighting and validation
 */

import { useState, useCallback } from 'react';
import Editor from 'react-simple-code-editor';
import { Highlight, themes } from 'prism-react-renderer';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  errorLine?: number;
  className?: string;
}

export function YamlEditor({
  value,
  onChange,
  readonly = false,
  errorLine,
  className,
}: YamlEditorProps) {
  const { isDark } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const highlightCode = useCallback(
    (code: string) => (
      <Highlight theme={isDark ? themes.nightOwl : themes.github} code={code} language="yaml">
        {({ tokens, getLineProps, getTokenProps }) => (
          <>
            {tokens.map((line, i) => (
              <div
                key={i}
                {...getLineProps({ line })}
                className={cn(
                  'px-2',
                  errorLine === i + 1 && 'bg-destructive/20 border-l-2 border-destructive'
                )}
              >
                <span className="inline-block w-8 text-right mr-4 text-muted-foreground/50 select-none text-xs">
                  {i + 1}
                </span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </>
        )}
      </Highlight>
    ),
    [isDark, errorLine]
  );

  return (
    <div
      className={cn(
        'relative rounded-md border overflow-hidden bg-muted/30 h-full',
        isFocused && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        readonly && 'opacity-70',
        className
      )}
    >
      <Editor
        value={value}
        onValueChange={readonly ? () => {} : onChange}
        highlight={highlightCode}
        key={isDark ? 'dark' : 'light'}
        padding={12}
        disabled={readonly}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        textareaClassName="focus:outline-none font-mono text-sm leading-6"
        preClassName="font-mono text-sm leading-6"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.875rem',
          minHeight: '100%',
        }}
      />
    </div>
  );
}

interface EditorStatusBarProps {
  validation: { valid: boolean; error?: string; line?: number };
  isDirty: boolean;
  cursorLine?: number;
  cursorCol?: number;
}

export function EditorStatusBar({
  validation,
  isDirty,
  cursorLine,
  cursorCol,
}: EditorStatusBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/30 text-xs">
      <div className="flex items-center gap-4">
        {validation.valid ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            Valid YAML
          </span>
        ) : (
          <span className="flex items-center gap-1 text-destructive">
            <AlertCircle className="w-3 h-3" />
            {validation.error}
            {validation.line && ` (line ${validation.line})`}
          </span>
        )}

        {isDirty && <span className="text-amber-500">{t('cliproxyConfig.unsavedChanges')}</span>}
      </div>

      {cursorLine && cursorCol && (
        <span className="text-muted-foreground">
          Ln {cursorLine}, Col {cursorCol}
        </span>
      )}
    </div>
  );
}
