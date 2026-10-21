import { fireEvent, screen } from '@testing-library/react-native';
import { OcrReplaceRow } from './OcrReplaceRow';
import { OcrTargetRequiredRow } from './OcrTargetRequiredRow';
import {
  confirmOcrSuggestion,
  serializeOcrDecision,
  suggestOcrField,
  type ReplaceFieldResult,
} from './applyOcrSuggestion';
import { renderWithSafeArea } from '../test/renderTabs';
import { OCR_REPLACE_TOAST, ocrReplacePrompt } from '../copy/userFacing';

describe('OcrReplaceRow', () => {
  it('shows the exact prompt and highlights Mantener lo que escribí', () => {
    renderWithSafeArea(<OcrReplaceRow actual="1,200.00" suggested="1,250.00" />);

    expect(screen.getByText(ocrReplacePrompt('1,200.00', '1,250.00'))).toBeTruthy();
    expect(screen.getByText('Reemplazar «1,200.00» por «1,250.00»')).toBeTruthy();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBe(screen.getByRole('button', { name: 'Mantener lo que escribí' }));
    expect(screen.getByRole('button', { name: 'Mantener lo que escribí', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reemplazar', selected: false })).toBeTruthy();
    expect(screen.queryByText('Aceptar todas')).toBeNull();
    expect(screen.queryByText(OCR_REPLACE_TOAST)).toBeNull();
  });

  it('shows the toast only after Reemplazar', () => {
    const onKeep = jest.fn();
    const onReplace = jest.fn();
    renderWithSafeArea(
      <OcrReplaceRow actual="efectivo" suggested="transferencia interna" onKeep={onKeep} onReplace={onReplace} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Mantener lo que escribí' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(OCR_REPLACE_TOAST)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Valor reemplazado. Puedes editarlo antes de registrar.')).toBeTruthy();
  });

  it('offers only Mantener and Reemplazar when the field already has a value (AC-OCR-12)', () => {
    renderWithSafeArea(<OcrReplaceRow actual="BBVA ya capturado" suggested="BBVA Hipoteca" />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Mantener lo que escribí', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reemplazar', selected: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByText('Aceptar')).toBeNull();
    expect(screen.queryByText('Editar')).toBeNull();
  });

  it('produces replace only from the Reemplazar tap', () => {
    const form = { providerName: 'lo que escribí' };
    const suggestion = confirmOcrSuggestion(
      suggestOcrField('providerName', 'BBVA Hipoteca', 0.9, {
        suggestionId: 'sug-1',
        savedValue: 'lo que escribí',
      }),
    );
    const onKeep = jest.fn();
    const onReplace = jest.fn();
    renderWithSafeArea(
      <OcrReplaceRow
        actual="lo que escribí"
        suggested="BBVA Hipoteca"
        form={form}
        suggestion={suggestion}
        field="providerName"
        onKeep={onKeep}
        onReplace={onReplace}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Mantener lo que escribí' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    const result = onReplace.mock.calls[0]?.[0] as ReplaceFieldResult<{ providerName: string }>;
    expect(result.decision?.ui).toBe('replaced');
    expect(result.form.providerName).toBe('BBVA Hipoteca');
    expect(JSON.parse(serializeOcrDecision(result.decision!))).toEqual({
      suggestionId: 'sug-1',
      action: 'replace',
    });
    expect(screen.queryByRole('button', { name: 'Aceptar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('shows the missing-target copy on the row and asks to scroll that row into view', () => {
    const onScrollIntoView = jest.fn();
    renderWithSafeArea(<OcrTargetRequiredRow suggestionId="sug-open" onScrollIntoView={onScrollIntoView} />);

    expect(screen.getByText('Elige a qué pago aplica esta sugerencia.')).toBeTruthy();
    expect(screen.getByTestId('ocr-suggestion-sug-open')).toBeTruthy();
    expect(onScrollIntoView).toHaveBeenCalledWith('ocr-suggestion-sug-open');
  });

  it('does not offer Reemplazar when the field is empty', () => {
    renderWithSafeArea(<OcrReplaceRow actual="   " suggested="1,250.00" />);
    expect(screen.queryByText(/Reemplazar/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
