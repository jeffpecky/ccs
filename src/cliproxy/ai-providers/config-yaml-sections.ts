export function rewriteTopLevelYamlSection(
  content: string,
  sectionKey: string,
  newSection: string | null
): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inSection = false;
  let sectionFound = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(`${sectionKey}:`)) {
      inSection = true;
      sectionFound = true;
      if (newSection) {
        result.push(newSection.trimEnd());
      }
      continue;
    }

    if (inSection) {
      const isTopLevelKey =
        line.length > 0 &&
        !line.startsWith(' ') &&
        !line.startsWith('\t') &&
        !line.startsWith('#') &&
        /^[a-zA-Z_][a-zA-Z0-9_-]*\s*:/.test(line);

      if (isTopLevelKey) {
        inSection = false;
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  if (!sectionFound && newSection) {
    // A flow-map root ({}) or empty file cannot be appended to; the section
    // becomes the whole document.
    if (content.trim() === '{}' || content.trim() === '') {
      return `${newSection.trimEnd()}\n`;
    }
    result.push('');
    result.push(newSection.trimEnd());
  }

  return `${result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
