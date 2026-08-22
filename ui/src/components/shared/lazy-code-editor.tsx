import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import type { CodeEditorProps } from '@/components/shared/code-editor';

type EditorLoader = () => Promise<{ default: ComponentType<CodeEditorProps> }>;

class EditorErrorBoundary extends Component<
  { children: ReactNode; minHeight: string; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-md border bg-muted/30 p-4 text-center"
        style={{ minHeight: this.props.minHeight }}
      >
        <p className="text-sm text-muted-foreground">Code editor failed to load</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium"
            onClick={this.props.onRetry}
          >
            Retry
          </button>
          <button
            type="button"
            className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export function LazyCodeEditorFactory(loader: EditorLoader) {
  return function LazyCodeEditor(props: CodeEditorProps) {
    const [attempt, setAttempt] = useState(0);
    const [Editor, setEditor] = useState(() => lazy(loader));
    const minHeight = props.minHeight ?? (props.heightMode === 'fill-parent' ? '100%' : '12rem');

    const retry = () => {
      setEditor(lazy(loader));
      setAttempt((current) => current + 1);
    };

    return (
      <EditorErrorBoundary key={attempt} minHeight={minHeight} onRetry={retry}>
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="Loading code editor"
              className="flex items-center justify-center bg-muted/20 text-sm text-muted-foreground"
              style={{ minHeight }}
            >
              Loading editor...
            </div>
          }
        >
          <Editor {...props} />
        </Suspense>
      </EditorErrorBoundary>
    );
  };
}

export const CodeEditor = LazyCodeEditorFactory(() =>
  import('@/components/shared/code-editor').then((module) => ({ default: module.CodeEditor }))
);

