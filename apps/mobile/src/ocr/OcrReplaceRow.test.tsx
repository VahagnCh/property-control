import { fireEvent, screen } from '@testing-library/react-native';
import { OcrReplaceRow } from './OcrReplaceRow';
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

  it('does not offer Reemplazar when the field is empty', () => {
    renderWithSafeArea(<OcrReplaceRow actual="   " suggested="1,250.00" />);
    expect(screen.queryByText(/Reemplazar/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
