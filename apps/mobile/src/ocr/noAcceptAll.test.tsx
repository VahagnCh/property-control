import fs from 'fs';
import path from 'path';
import { fireEvent, screen } from '@testing-library/react-native';
import { OcrReplaceRow } from './OcrReplaceRow';
import { renderWithSafeArea } from '../test/renderTabs';

const ACCEPT_ALL = /aceptar\s+tod(?:o|os|as)?|accept\s+all|aplicar\s+tod(?:o|os|as)?/i;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.expo') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function visibleText(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const found: string[] = [];
  const quoted = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(clean))) {
    found.push(match[2]);
  }
  const jsxText = />([^<{]+)</g;
  while ((match = jsxText.exec(clean))) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (text) {
      found.push(text);
    }
  }
  return found;
}

function collectRendered(node: unknown, acc: string[]): void {
  if (node == null) {
    return;
  }
  if (typeof node === 'string') {
    acc.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectRendered(child, acc);
    }
    return;
  }
  if (typeof node === 'object') {
    const record = node as { children?: unknown; props?: Record<string, unknown> };
    const props = record.props ?? {};
    for (const value of Object.values(props)) {
      if (typeof value === 'string') {
        acc.push(value);
      }
    }
    collectRendered(record.children, acc);
  }
}

describe('AC-OCR-09 no accept-all control', () => {
  it('has no Aceptar todas label in user-facing copy or a rendered OCR row', () => {
    const root = process.cwd();
    const files = walk(path.join(root, 'src'));
    files.push(path.join(root, 'App.tsx'), path.join(root, 'index.ts'));
    const strings = files.flatMap((file) => visibleText(fs.readFileSync(file, 'utf8')));
    const hits = strings.filter((value) => ACCEPT_ALL.test(value));
    expect(hits).toEqual([]);

    const rendered: string[] = [];
    const filled = renderWithSafeArea(<OcrReplaceRow actual="1,200.00" suggested="1,250.00" />);
    collectRendered(filled.toJSON(), rendered);
    fireEvent.press(filled.getByRole('button', { name: 'Reemplazar' }));
    collectRendered(filled.toJSON(), rendered);
    const buttonLabels = filled
      .getAllByRole('button')
      .map((button) => button.props.accessibilityLabel)
      .filter((value): value is string => typeof value === 'string');

    const empty = renderWithSafeArea(<OcrReplaceRow actual="   " suggested="1,250.00" />);
    collectRendered(empty.toJSON(), rendered);
    expect(empty.queryByRole('button')).toBeNull();

    const labels = [...rendered, ...buttonLabels];
    expect(labels.filter((value) => ACCEPT_ALL.test(value))).toEqual([]);
    expect(labels.join('\n')).not.toMatch(ACCEPT_ALL);
    expect(filled.queryByRole('button', { name: ACCEPT_ALL })).toBeNull();
    expect(screen.queryByRole('button', { name: ACCEPT_ALL })).toBeNull();
  });
});
