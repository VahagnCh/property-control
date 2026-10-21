import fs from 'fs';
import path from 'path';
import {
  COPY,
  OCR_REPLACE_BUTTON_LABEL,
  OCR_REPLACE_KEEP_LABEL,
  OCR_REPLACE_TOAST,
  OCR_UNREVIEWED_DISCARD_COPY,
  TAB_BODIES,
  TAB_LABELS,
  ocrReplacePrompt,
} from './userFacing';

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'pagar ahora', pattern: /pagar\s+ahora/i },
  { label: 'enviar pago', pattern: /enviar\s+pago/i },
  { label: 'pagar', pattern: /\bpagar\b/i },
  { label: 'cobrar', pattern: /\bcobrar\b/i },
  { label: 'transferir', pattern: /\btransferir\b/i },
  { label: 'depositar', pattern: /\bdepositar\b/i },
  { label: 'cartera', pattern: /\bcartera\b/i },
  { label: 'wallet', pattern: /\bwallet\b/i },
  { label: 'banco', pattern: /\bbanco\b/i },
  { label: 'SAT', pattern: /\bsat\b/i },
  { label: 'Hacienda', pattern: /\bhacienda\b/i },
  { label: 'paga tu', pattern: /paga\s+tu/i },
];

function hits(value: string): string[] {
  return FORBIDDEN.filter((item) => item.pattern.test(value)).map((item) => item.label);
}

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function extractStrings(source: string): string[] {
  const clean = stripComments(source);
  const found: string[] = [];
  const quoted = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(clean))) {
    found.push(match[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"'));
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

describe('copy lint', () => {
  it('walks every user-facing string and allows only the statement that money is not moved', () => {
    const root = process.cwd();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      expo: {
        name: string;
        slug: string;
        scheme: string;
        ios?: { bundleIdentifier?: string };
        android?: { package?: string };
      };
    };

    expect(app.expo.name).toBe('DueRecord');
    expect(app.expo.slug).toBe('property-control');
    expect(app.expo.scheme).toBe('property-control');
    expect(app.expo.ios?.bundleIdentifier).toBeUndefined();
    expect(app.expo.android?.package).toBeUndefined();

    const files = walk(path.join(root, 'src'));
    files.push(path.join(root, 'App.tsx'), path.join(root, 'index.ts'));
    const strings = files.flatMap((file) => extractStrings(fs.readFileSync(file, 'utf8')));
    strings.push(app.expo.name);

    expect(hits('no mueve dinero')).toEqual([]);
    expect(hits('DueRecord no mueve dinero')).toEqual([]);
    expect(hits('no mueve dinero. cobrar')).toEqual(['cobrar']);

    for (const item of FORBIDDEN) {
      const sample =
        item.label === 'SAT' ? 'Consulta el SAT' : item.label === 'Hacienda' ? 'Aviso de Hacienda' : item.label;
      expect(hits(sample)).toContain(item.label);
    }

    const failures = strings
      .map((value) => ({ value, found: hits(value) }))
      .filter((item) => item.found.length > 0);
    expect(failures).toEqual([]);

    for (const label of TAB_LABELS) {
      expect(strings).toContain(label);
    }
    expect(strings).toContain(TAB_BODIES.Pagos);
    expect(strings).toContain('DueRecord');
    expect(strings.join('\n')).toContain('DueRecord no mueve dinero');
    expect(strings.join('\n').toLowerCase()).toContain('comprobante es opcional');
    expect(strings).not.toContain('Aceptar todas');
    expect(strings).not.toContain('Aceptar todo');

    const requiredCopy = [
      COPY['ocr.edit.invalid'],
      COPY['form.text.invalidChars'],
      COPY['form.title.tooLong'],
      COPY['form.body.tooLong'],
      COPY['obligation.nextDueDate.invalid'],
      OCR_REPLACE_KEEP_LABEL,
      OCR_REPLACE_BUTTON_LABEL,
      OCR_REPLACE_TOAST,
      OCR_UNREVIEWED_DISCARD_COPY,
      ocrReplacePrompt('1,200.00', '1,250.00'),
    ];
    for (const value of requiredCopy) {
      expect(hits(value)).toEqual([]);
    }
    expect(strings).toEqual(expect.arrayContaining(requiredCopy.slice(0, -1)));
    expect(strings.some((value) => value.includes('Reemplazar «') && value.includes('» por «'))).toBe(true);
    expect(ocrReplacePrompt('1,200.00', '1,250.00')).toBe('Reemplazar «1,200.00» por «1,250.00»');

    const raw = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(raw).not.toMatch(/Property Control/);
    expect(raw).not.toMatch(/AlDía|AlDia/);
    expect(raw).not.toMatch(/deletedAt/);
    expect(raw).not.toMatch(/method:\s*['"]DELETE['"]/);
  });
});
