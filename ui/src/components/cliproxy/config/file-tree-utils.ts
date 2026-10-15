/**
 * File Tree Utilities
 * Helper functions for building file tree structure
 */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  modified?: boolean;
  icon?: 'yaml' | 'json' | 'key';
}

// Helper to build file tree from flat list
export function buildFileTree(
  configModified: boolean,
  authFiles: Array<{ name: string; provider?: string }>
): FileNode[] {
  return [
    {
      name: 'config',
      path: 'config',
      type: 'folder',
      children: [
        {
          name: 'config.yaml',
          path: 'config.yaml',
          type: 'file',
          icon: 'yaml',
          modified: configModified,
        },
      ],
    },
    {
      name: 'auths',
      path: 'auths',
      type: 'folder',
      children: authFiles.map((f) => ({
        name: f.name,
        path: `auths/${f.name}`,
        type: 'file' as const,
        icon: 'key' as const,
      })),
    },
  ];
}
