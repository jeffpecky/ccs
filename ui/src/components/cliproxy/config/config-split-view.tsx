/**
 * Config Split View Container
 * Main split layout for Config tab with file tree and YAML editor
 */

import { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { Save, RotateCcw, GitCompare, Loader2 } from 'lucide-react';
import { FileTree } from './file-tree';
import { buildFileTree } from './file-tree-utils';
import { YamlEditor, EditorStatusBar } from './yaml-editor';
import { DiffDialog } from './diff-dialog';
import { useCliproxyConfig, useCliproxyAuthFile } from '@/hooks/use-cliproxy-config';
import { useTranslation } from 'react-i18next';

export function ConfigSplitView() {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<string>('config.yaml');
  const [showDiff, setShowDiff] = useState(false);

  const {
    content,
    originalContent,
    isDirty,
    validation,
    isLoading,
    authFiles,
    updateContent,
    resetContent,
    saveContent,
    isSaving,
  } = useCliproxyConfig();

  // For viewing auth files (read-only)
  const [viewingAuthFile, setViewingAuthFile] = useState<string | null>(null);
  const { data: authFileContent } = useCliproxyAuthFile(viewingAuthFile);

  const handleFileSelect = (path: string) => {
    if (path === 'config.yaml') {
      setSelectedFile(path);
      setViewingAuthFile(null);
    } else if (path.startsWith('auths/')) {
      const fileName = path.replace('auths/', '');
      setSelectedFile(path);
      setViewingAuthFile(fileName);
    }
  };

  // Build file tree
  const fileTree = buildFileTree(isDirty, authFiles);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && validation.valid) {
          saveContent();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, validation.valid, saveContent]);

  const isEditingConfig = selectedFile === 'config.yaml';
  const currentContent = isEditingConfig ? content : (authFileContent ?? '');
  const isReadonly = !isEditingConfig;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[500px] border rounded-lg">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{selectedFile}</span>
          {isDirty && isEditingConfig && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {t('cliproxyConfig.modified')}
            </span>
          )}
        </div>
        {isEditingConfig && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDiff(true)}
              disabled={!isDirty}
              className="h-7 gap-1.5"
            >
              <GitCompare className="w-3.5 h-3.5" />
              Diff
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetContent}
              disabled={!isDirty}
              className="h-7 gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={saveContent}
              disabled={!isDirty || !validation.valid || isSaving}
              className="h-7 gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Split Panels */}
      <PanelGroup direction="horizontal" className="h-[500px]">
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <FileTree files={fileTree} selectedFile={selectedFile} onSelect={handleFileSelect} />
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-accent transition-colors cursor-col-resize" />

        <Panel>
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto">
              <YamlEditor
                value={currentContent}
                onChange={updateContent}
                readonly={isReadonly}
                errorLine={validation.line}
              />
            </div>
            <EditorStatusBar validation={validation} isDirty={isDirty && isEditingConfig} />
          </div>
        </Panel>
      </PanelGroup>

      {/* Diff Dialog */}
      <DiffDialog
        open={showDiff}
        onClose={() => setShowDiff(false)}
        original={originalContent}
        modified={content}
        onConfirmSave={() => {
          saveContent();
          setShowDiff(false);
        }}
        isSaving={isSaving}
      />
    </div>
  );
}
