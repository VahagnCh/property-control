import { screen } from '@testing-library/react-native';
import { PlaceholderScreen } from './PlaceholderScreen';
import { renderWithSafeArea } from '../test/renderTabs';

const accents = '¿El año en Mérida trae la obligación? ¡Revisa el folio: á é í ó ú ñ ü!';

describe('long Spanish copy', () => {
  it('renders accents and a very long string intact', () => {
    const repeated = `${accents} ${'La propiedad sigue en el listado. '.repeat(200)}fin áéíóúñü¿¡`;
    expect(repeated.length).toBeGreaterThan(4000);
    expect(repeated).toContain('á');
    expect(repeated).toContain('é');
    expect(repeated).toContain('í');
    expect(repeated).toContain('ó');
    expect(repeated).toContain('ú');
    expect(repeated).toContain('ñ');
    expect(repeated).toContain('ü');
    expect(repeated).toContain('¿');
    expect(repeated).toContain('¡');

    renderWithSafeArea(<PlaceholderScreen title={accents} body={repeated} />);

    expect(screen.getByText(accents)).toBeTruthy();
    expect(screen.getByText(repeated)).toBeTruthy();
    expect(screen.getByText('DueRecord')).toBeTruthy();
  });
});
