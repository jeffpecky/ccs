/**
 * File Tree Component
 * Left panel file browser for Config tab
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { FileNode } from './file-tree-utils';

interface FileTreeProps {
  files: FileNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}

function FileIcon({ type, icon }: { type: 'file' | 'folder'; icon?: string }) {
  if (type === 'folder') {
    return <Folder className="w-4 h-4 text-amber-500" />;
  }
  if (icon === 'key') {
    return <Key className="w-4 h-4 text-green-500" />;
  }
  return <FileText className="w-4 h-4 text-blue-500" />;
}

function TreeNode({
  node,
  depth,
  selectedFile,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  node: FileNode;
  depth: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFile === node.path;

  return (
    <div>
      <button
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1 text-sm text-left rounded-md transition-colors',
          'hover:bg-muted/50',
          isSelected && 'bg-accent/10 border-l-2 border-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (node.type === 'folder') {
            onToggleFolder(node.path);
          } else {
            onSelect(node.path);
          }
        }}
      >
        {node.type === 'folder' &&
          (isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          ))}
        <FileIcon type={node.type} icon={node.icon} />
        <span className="truncate flex-1">{node.name}</span>
        {node.modified && <span className="text-amber-500 ml-1">*</span>}
      </button>

      {node.type === 'folder' && isExpanded && node.children && (
        <div className="animate-in slide-in-from-top-1 duration-150">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedFile, onSelect }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['config', 'auths']));

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {files.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            onSelect={onSelect}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
