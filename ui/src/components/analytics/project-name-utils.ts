/**
 * Project Name Utility Functions
 *
 * Utility functions for extracting meaningful project names from file paths
 */

/**
 * Extracts the leaf folder name from a project path
 *
 * This function takes a full project path and returns just the leaf folder name,
 * which represents the actual project name that the user would recognize.
 *
 * Examples:
 * - '/home/user/projects/my-app' → 'my-app'
 * - '/Users/joe/Developer/share-pi' → 'share-pi'
 * - '/Users/joe/Developer/ExaDev/.../worktrees/2026-01-08' → '2026-01-08'
 *
 * @param path - The full project path
 * @returns The leaf folder name (project name)
 */
export function getProjectDisplayName(path: string): string {
  if (!path) return '';

  // Remove leading/trailing slashes and split into segments
  const cleanPath = path.replace(/^\/|\/$/g, '');
  const segments = cleanPath.split('/').filter((segment) => segment.length > 0);

  // Return the last segment (leaf folder name)
  return segments[segments.length - 1] || '';
}
