import { describe, expect, it } from 'bun:test';
import { replaceFileAtomically } from '../generator';

describe('replaceFileAtomically', () => {
  it('writes, flushes, closes, then renames sibling temp file', () => {
    const calls: string[] = [];
    replaceFileAtomically('C:/config/runtime.yaml', 'next', {
      openSync: (path) => {
        calls.push(`open:${path}`);
        return 7;
      },
      writeFileSync: (fd, content) => calls.push(`write:${fd}:${content}`),
      fsyncSync: (fd) => calls.push(`fsync:${fd}`),
      closeSync: (fd) => calls.push(`close:${fd}`),
      renameSync: (from, to) => calls.push(`rename:${from}:${to}`),
      unlinkSync: (path) => calls.push(`unlink:${path}`),
    });
    expect(calls[0]).toContain('open:C:/config/runtime.yaml.');
    expect(calls.slice(1, 5)).toEqual([
      'write:7:next',
      'fsync:7',
      'close:7',
      expect.stringMatching(/^rename:C:\/config\/runtime\.yaml\..+:C:\/config\/runtime\.yaml$/),
    ]);
  });

  it('preserves destination and cleans temp when write or rename fails', () => {
    for (const failAt of ['write', 'rename'] as const) {
      let closed = false;
      let renamed = false;
      const unlinked: string[] = [];
      expect(() =>
        replaceFileAtomically('/runtime.yaml', 'next', {
          openSync: () => 8,
          writeFileSync: () => {
            if (failAt === 'write') throw new Error('write failed');
          },
          fsyncSync: () => undefined,
          closeSync: () => {
            closed = true;
          },
          renameSync: () => {
            renamed = true;
            if (failAt === 'rename') throw new Error('rename failed');
          },
          unlinkSync: (path) => unlinked.push(path),
        })
      ).toThrow();
      expect(closed).toBe(true);
      expect(unlinked).toHaveLength(1);
      expect(renamed).toBe(failAt === 'rename');
    }
  });
});
