import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { confirmOcrSuggestion, suggestOcrField } from './applyOcrSuggestion';
import { OcrSuggestionReview, type OcrReviewForm } from './OcrSuggestionReview';

const target = '11111111-1111-4111-8111-111111111111';
const suggestion = confirmOcrSuggestion(
  suggestOcrField('amount', '1250.00', 0.99, { suggestionId: 'sug-9', targetEntityId: target }),
);
const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function reviewTree(
  form: OcrReviewForm,
  onFormChange: (form: OcrReviewForm) => void,
  onConfirm: (body: string) => void,
): ReactElement {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <OcrSuggestionReview
        form={form}
        suggestion={suggestion}
        field="amount"
        otherField="note"
        onFormChange={onFormChange}
        onConfirm={onConfirm}
      />
    </SafeAreaProvider>
  );
}

function shownAmount(): string {
  return screen.getByTestId('ocr-field-amount').props.value as string;
}

describe('OcrSuggestionReview', () => {
  it('keeps the first undo across a re-render with a copied form', () => {
    const onFormChange = jest.fn();
    const onConfirm = jest.fn();
    const view = render(reviewTree({ amount: '1.00', note: '' }, onFormChange, onConfirm));

    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    const replaced = onFormChange.mock.calls[0]?.[0] as OcrReviewForm;
    expect(replaced.amount).toBe('1250.00');

    view.rerender(reviewTree({ ...replaced }, onFormChange, onConfirm));
    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    const replacedAgain = onFormChange.mock.calls.at(-1)?.[0] as OcrReviewForm;
    expect(replacedAgain.amount).toBe('1250.00');

    view.rerender(reviewTree({ ...replacedAgain }, onFormChange, onConfirm));
    fireEvent.press(screen.getByRole('button', { name: 'Mantener lo que escribí' }));

    const kept = onFormChange.mock.calls.at(-1)?.[0] as OcrReviewForm;
    expect(kept.amount).toBe('1.00');
    view.rerender(reviewTree(kept, onFormChange, onConfirm));
    expect(shownAmount()).toBe('1.00');
    expect(screen.getByDisplayValue('1.00')).toBeTruthy();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onConfirm.mock.calls[0]?.[0] as string)).toEqual({
      decisions: [{ suggestionId: 'sug-9', action: 'reject', targetEntityId: target }],
    });
  });

  it('keeps the first undo when another field is typed between Reemplazar taps', () => {
    const onFormChange = jest.fn();
    const onConfirm = jest.fn();
    const view = render(reviewTree({ amount: '1.00', note: '' }, onFormChange, onConfirm));

    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    const replaced = onFormChange.mock.calls[0]?.[0] as OcrReviewForm;
    view.rerender(reviewTree({ ...replaced }, onFormChange, onConfirm));

    fireEvent.changeText(screen.getByLabelText('Nota'), 'folio 2');
    const typed = onFormChange.mock.calls.at(-1)?.[0] as OcrReviewForm;
    expect(typed).toEqual({ amount: '1250.00', note: 'folio 2' });
    view.rerender(reviewTree({ ...typed }, onFormChange, onConfirm));

    fireEvent.press(screen.getByRole('button', { name: 'Reemplazar' }));
    const replacedAgain = onFormChange.mock.calls.at(-1)?.[0] as OcrReviewForm;
    expect(replacedAgain).toEqual({ amount: '1250.00', note: 'folio 2' });
    view.rerender(reviewTree({ ...replacedAgain }, onFormChange, onConfirm));

    fireEvent.press(screen.getByRole('button', { name: 'Mantener lo que escribí' }));
    const kept = onFormChange.mock.calls.at(-1)?.[0] as OcrReviewForm;
    expect(kept).toEqual({ amount: '1.00', note: 'folio 2' });
    view.rerender(reviewTree(kept, onFormChange, onConfirm));

    expect(shownAmount()).toBe('1.00');
    expect(screen.getByDisplayValue('1.00')).toBeTruthy();
    expect(screen.getByTestId('ocr-field-note').props.value).toBe('folio 2');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const body = onConfirm.mock.calls[0]?.[0] as string;
    expect(JSON.parse(body)).toEqual({
      decisions: [{ suggestionId: 'sug-9', action: 'reject', targetEntityId: target }],
    });
    expect(body).not.toContain('1.00');
    expect(body).not.toContain('1250.00');
    expect(body).not.toContain('folio 2');
    expect(body).not.toContain('previousValue');
    expect(body).not.toContain('clientPriorValue');
  });
});
