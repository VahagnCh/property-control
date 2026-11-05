import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, PixelRatio } from 'react-native';
import type { ApiClient } from '../api/client';
import { createApiClient } from '../api/client';
import { REFRESH_PATH } from '../api/contract';
import { createContractFakeServer, type FakeServer, type RouteResult } from '../api/testing/fakeServer';
import { OBLIGATION_ID, PROPERTY_ID } from '../api/testing/fixtures';
import type { TokenStore } from '../auth/tokenStore';
import { COPY, SCREEN_STATE_COPY, copyText } from '../copy/userFacing';
import { resetSessionState, setSessionSignedIn, setSessionUnavailable } from '../session/readSession';
import { renderWithSafeArea } from '../test/renderTabs';
import { buildObligationWrite, suggestedNextDueDate } from './buildObligationWrite';
import { buildPropertyWrite } from './buildPropertyWrite';
import { FIELD_LIMITS } from './fieldLimits';
import { ObligationFormScreen } from './ObligationFormScreen';
import { PropertiesTab } from './PropertiesTab';
import { PropertyDetailScreen } from './PropertyDetailScreen';
import { PropertyFormScreen } from './PropertyFormScreen';
import { PropertyListScreen } from './PropertyListScreen';

/** The only demo row this client uses: Casa, with CFE at $850. */
const CASA = {
  id: PROPERTY_ID,
  name: 'Casa',
  propertyType: 'house' as const,
  occupancyStatus: 'owned' as const,
  addressLine: null,
  city: 'Ciudad de México',
  state: 'CMX',
  country: 'MX',
  postalCode: null,
  timezone: 'America/Mexico_City',
  createdAt: '2026-10-29T18:00:00.000Z',
  updatedAt: '2026-10-29T18:00:00.000Z',
};

const CFE = {
  id: OBLIGATION_ID,
  category: 'electricity' as const,
  title: 'CFE',
  providerName: 'CFE',
  recurrence: 'monthly' as const,
  nextDueDate: '2026-11-02',
  expectedAmount: '850.00',
  reminderOffsets: [7, 1],
  isActive: true,
};

const FOREIGN_ID = '99999999-9999-4999-8999-999999999999';

function memoryStore(): TokenStore {
  let current: { accessToken: string; refreshToken: string } | null = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  };
  return {
    async read() {
      return current;
    },
    async save(tokens) {
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}

function clientFor(server: FakeServer, randomUUID?: () => string): ApiClient {
  return createApiClient({
    baseUrl: 'http://127.0.0.1:4010',
    env: 'test',
    tokenStore: memoryStore(),
    fetchImpl: server.fetch,
    randomUUID,
  });
}

function v4(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

describe('properties and obligations', () => {
  beforeEach(() => {
    resetSessionState();
    setSessionSignedIn();
  });

  it('routes to sign-in and does not load properties without a session', async () => {
    resetSessionState();
    const server = createContractFakeServer();
    server.route('GET', '/v1/properties', () => ({ status: 200, body: { items: [CASA] } }));
    renderWithSafeArea(<PropertiesTab client={clientFor(server)} />);
    expect(await screen.findByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.queryByText('Casa')).toBeNull();
    expect(screen.queryByText('CFE')).toBeNull();
    expect(server.calls('GET', '/v1/properties')).toHaveLength(0);
  });

  it('shows connecting on a store failure and does not sign out or list rows', () => {
    setSessionUnavailable();
    const server = createContractFakeServer();
    server.route('GET', '/v1/properties', () => ({ status: 200, body: { items: [CASA] } }));
    renderWithSafeArea(<PropertiesTab client={clientFor(server)} />);
    expect(screen.queryByText(COPY['auth.email.title'])).toBeNull();
    expect(screen.queryByText('Casa')).toBeNull();
    expect(server.calls('GET', '/v1/properties')).toHaveLength(0);
  });

  it('shows an empty list, then Casa and CFE $850 on the detail', async () => {
    const server = createContractFakeServer();
    server.route('GET', '/v1/properties', () => ({ status: 200, body: { items: [] } }));
    const client = clientFor(server);
    const view = renderWithSafeArea(
      <PropertyListScreen client={client} onCreate={() => undefined} onOpen={() => undefined} />,
    );
    expect(await screen.findByText(COPY['property.empty.title'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['cta.addProperty'] })).toBeTruthy();
    expect(screen.queryByText('Casa')).toBeNull();
    view.unmount();

    server.route('GET', '/v1/properties', () => ({ status: 200, body: { items: [CASA] } }));
    server.route('GET', `/v1/properties/${PROPERTY_ID}`, () => ({ status: 200, body: CASA }));
    server.route('GET', `/v1/properties/${PROPERTY_ID}/obligations`, () => ({
      status: 200,
      body: { items: [CFE] },
    }));
    const open = jest.fn();
    renderWithSafeArea(
      <PropertyListScreen client={clientFor(server)} onCreate={() => undefined} onOpen={open} />,
    );
    fireEvent.press(await screen.findByRole('button', { name: 'Casa' }));
    expect(open).toHaveBeenCalledWith(PROPERTY_ID);
    expect(screen.getAllByText('Casa').length).toBeGreaterThan(0);
    expect(screen.queryByText('CFE')).toBeNull();

    renderWithSafeArea(
      <PropertyDetailScreen
        client={clientFor(server)}
        propertyId={PROPERTY_ID}
        onAddObligation={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByText('CFE')).toBeTruthy();
    expect(screen.getByText('CFE/Electricidad')).toBeTruthy();
    expect(screen.getByText('$850.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['cta.addObligation'] })).toBeTruthy();
    expect(screen.queryByText(/Casa Roma|Depto demo|Agua demo/)).toBeNull();
  });

  it('shows loading, then an offline error with Reintentar, and recovers', async () => {
    const server = createContractFakeServer();
    let release: (result: RouteResult) => void = () => undefined;
    server.route(
      'GET',
      '/v1/properties',
      () =>
        new Promise<RouteResult>((resolve) => {
          release = resolve;
        }),
    );
    const slowView = renderWithSafeArea(
      <PropertyListScreen client={clientFor(server)} onCreate={() => undefined} onOpen={() => undefined} />,
    );
    expect(screen.getByText(SCREEN_STATE_COPY.loading)).toBeTruthy();
    await waitFor(() => expect(server.calls('GET', '/v1/properties').length).toBeGreaterThan(0));
    await act(async () => {
      release({ status: 200, body: { items: [CASA] } });
    });
    expect((await screen.findAllByText('Casa')).length).toBeGreaterThan(0);
    slowView.unmount();

    const offline = createContractFakeServer();
    let online = false;
    offline.route('GET', '/v1/properties', () => {
      if (!online) {
        return { status: 200, networkError: true };
      }
      return { status: 200, body: { items: [CASA] } };
    });
    renderWithSafeArea(
      <PropertyListScreen client={clientFor(offline)} onCreate={() => undefined} onOpen={() => undefined} />,
    );
    expect(await screen.findByText(SCREEN_STATE_COPY.error)).toBeTruthy();
    expect(screen.queryByText('Casa')).toBeNull();
    expect(offline.calls('GET', '/v1/properties').length).toBe(2);
    online = true;
    fireEvent.press(screen.getByRole('button', { name: 'Reintentar Agregar propiedad' }));
    expect((await screen.findAllByText('Casa')).length).toBeGreaterThan(0);
  });

  it('shows not-found for a foreign id and hides writes for a viewer', async () => {
    const missing = createContractFakeServer();
    renderWithSafeArea(
      <PropertyDetailScreen
        client={clientFor(missing)}
        propertyId={FOREIGN_ID}
        onAddObligation={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByText(copyText('err.notFound'))).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain(FOREIGN_ID);
    expect(screen.queryByRole('button', { name: COPY['cta.addObligation'] })).toBeNull();

    const server = createContractFakeServer();
    server.route('GET', `/v1/properties/${PROPERTY_ID}`, () => ({ status: 200, body: CASA }));
    server.route('GET', `/v1/properties/${PROPERTY_ID}/obligations`, () => ({
      status: 403,
      body: { statusCode: 403, error: 'forbidden', message: 'Viewer.' },
    }));
    renderWithSafeArea(
      <PropertyDetailScreen
        client={clientFor(server)}
        propertyId={PROPERTY_ID}
        role="viewer"
        onAddObligation={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByText(copyText('err.forbidden'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: COPY['cta.addObligation'] })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular' })).toBeNull();
  });

  it('keeps the property form and resends the same body after idempotency_in_progress', async () => {
    let n = 0;
    const server = createContractFakeServer();
    const keys: string[] = [];
    const bodies: string[] = [];
    server.route('POST', '/v1/properties', (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      bodies.push(request.bodyText ?? '');
      if (keys.length === 1) {
        return { status: 409, body: { statusCode: 409, error: 'idempotency_in_progress', message: 'busy' } };
      }
      return { status: 201, body: CASA };
    });
    const created = jest.fn();
    renderWithSafeArea(
      <PropertyFormScreen
        client={clientFor(server, () => v4(++n))}
        onCreated={created}
        onCancel={() => undefined}
      />,
    );
    fireEvent.changeText(screen.getByLabelText(COPY['property.name.label']), 'Casa');
    fireEvent.press(screen.getByRole('button', { name: COPY['property.add.cta'] }));
    expect(await screen.findByText(COPY['common.connecting.failed'])).toBeTruthy();
    expect(screen.queryByText(COPY['err.generic'])).toBeNull();
    expect(screen.getByLabelText(COPY['property.name.label']).props.value).toBe('Casa');
    expect(server.calls('POST', '/v1/properties')).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: COPY['common.retry'] }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(PROPERTY_ID));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(v4(1));
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[0]).toContain('"name":"Casa"');
    expect(n).toBe(1);
  });

  it('shows the conflict notice without clearing the form, then uses a new key', async () => {
    let n = 0;
    const server = createContractFakeServer();
    const keys: string[] = [];
    server.route('POST', '/v1/properties', (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      if (keys.length === 1) {
        return { status: 409, body: { statusCode: 409, error: 'conflict', message: 'unique' } };
      }
      return { status: 201, body: CASA };
    });
    renderWithSafeArea(
      <PropertyFormScreen
        client={clientFor(server, () => v4(++n))}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.changeText(screen.getByLabelText(COPY['property.name.label']), 'Casa');
    fireEvent.press(screen.getByRole('button', { name: COPY['property.add.cta'] }));
    expect(await screen.findByText(COPY['pay.sync.conflict'])).toBeTruthy();
    expect(screen.queryByText(COPY['err.generic'])).toBeNull();
    expect(screen.getByLabelText(COPY['property.name.label']).props.value).toBe('Casa');
    fireEvent.press(screen.getByRole('button', { name: COPY['property.add.cta'] }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[0]).toBe(v4(1));
    expect(keys[1]).toBe(v4(2));
  });

  it('renders a long accented name and the form at 320x568 with font scale 2', async () => {
    const longName = `Árbol ñandú ¿listo? ${'áéíóúñü'.repeat(600)}`;
    expect(longName.length).toBeGreaterThan(4000);
    const server = createContractFakeServer();
    server.route('GET', '/v1/properties', () => ({
      status: 200,
      body: {
        items: [{ ...CASA, name: longName }],
      },
    }));
    renderWithSafeArea(
      <PropertyListScreen client={clientFor(server)} onCreate={() => undefined} onOpen={() => undefined} />,
    );
    expect(await screen.findByText(longName)).toBeTruthy();

    Dimensions.set({
      window: { width: 320, height: 568, scale: 2, fontScale: 2 },
      screen: { width: 320, height: 568, scale: 2, fontScale: 2 },
    });
    expect(PixelRatio.getFontScale()).toBeCloseTo(2, 1);
    renderWithSafeArea(
      <PropertyFormScreen client={clientFor(createContractFakeServer())} onCreated={() => undefined} onCancel={() => undefined} />,
      { width: 320, height: 568 },
    );
    expect(screen.getByText('Casa')).toBeTruthy();
    expect(screen.getByLabelText(COPY['property.name.label'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['property.add.cta'] })).toBeTruthy();

    const now = new Date('2026-10-30T05:59:00.000Z');
    renderWithSafeArea(
      <ObligationFormScreen
        client={clientFor(createContractFakeServer())}
        propertyId={PROPERTY_ID}
        now={() => now}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
      { width: 320, height: 568 },
    );
    expect(screen.getByText('Predial')).toBeTruthy();
    expect(screen.getByText('Agua')).toBeTruthy();
    expect(screen.getByText('CFE/Electricidad')).toBeTruthy();
    expect(screen.getByText('Irregular/única')).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['obligation.add.cta'] })).toBeTruthy();
  });

  it('uses the property-zone date around midnight in America/Mexico_City', () => {
    const cases: Array<[string, string]> = [
      ['2026-10-30T05:59:00.000Z', '2026-10-29'],
      ['2026-10-30T06:00:00.000Z', '2026-10-30'],
      ['2026-10-30T06:01:00.000Z', '2026-10-30'],
    ];
    for (const [instant, calendar] of cases) {
      expect(suggestedNextDueDate(new Date(instant), 'America/Mexico_City')).toBe(calendar);
      renderWithSafeArea(
        <ObligationFormScreen
          client={clientFor(createContractFakeServer())}
          propertyId={PROPERTY_ID}
          now={() => new Date(instant)}
          onCreated={() => undefined}
          onCancel={() => undefined}
        />,
      );
      const day = calendar.slice(8, 10).replace(/^0/, '');
      const month = calendar.startsWith('2026-10') ? 'octubre' : calendar.slice(5, 7);
      expect(
        screen.getAllByTestId('obligation-next-due').some((node) => String(node.props.children).includes(`${day} de ${month}`)),
      ).toBe(true);
    }
    expect(screen.queryByText(/2026-10-30T06:00/)).toBeNull();
  });

  it('refreshes an expired session once and resends the property list once', async () => {
    const server = createContractFakeServer();
    let gets = 0;
    server.route('GET', '/v1/properties', (request) => {
      gets += 1;
      if (request.headers.authorization === 'Bearer rotated-access') {
        return { status: 200, body: { items: [CASA] } };
      }
      return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
    });
    renderWithSafeArea(
      <PropertyListScreen client={clientFor(server)} onCreate={() => undefined} onOpen={() => undefined} />,
    );
    expect((await screen.findAllByText('Casa')).length).toBeGreaterThan(0);
    expect(gets).toBe(2);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
  });

  it('holds a 503 on property and obligation creates and resends the same body', async () => {
    let n = 0;
    const server = createContractFakeServer();
    const keys: string[] = [];
    const bodies: string[] = [];
    server.route('POST', '/v1/properties', (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      bodies.push(request.bodyText ?? '');
      if (keys.length === 1) {
        return { status: 503, body: { statusCode: 503, error: 'unavailable', message: 'db down at 10.0.0.5' } };
      }
      return { status: 201, body: CASA };
    });
    const propertyView = renderWithSafeArea(
      <PropertyFormScreen
        client={clientFor(server, () => v4(++n))}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.changeText(screen.getByLabelText(COPY['property.name.label']), 'Casa');
    fireEvent.press(screen.getByRole('button', { name: COPY['property.add.cta'] }));
    expect(await screen.findByText(COPY['common.connecting.failed'])).toBeTruthy();
    expect(screen.queryByText(COPY['err.generic'])).toBeNull();
    expect(screen.getByLabelText(COPY['property.name.label']).props.value).toBe('Casa');
    expect(screen.getByRole('button', { name: COPY['common.retry'] })).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain('10.0.0.5');
    fireEvent.changeText(screen.getByLabelText(COPY['property.name.label']), 'Casa norte');
    expect(screen.getByRole('button', { name: COPY['property.add.cta'] })).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(COPY['property.name.label']), 'Casa');
    fireEvent.press(screen.getByRole('button', { name: COPY['common.retry'] }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
    expect(bodies[1]).toBe(bodies[0]);
    propertyView.unmount();

    const obligations = createContractFakeServer();
    const obligationKeys: string[] = [];
    const obligationBodies: string[] = [];
    obligations.route('POST', `/v1/properties/${PROPERTY_ID}/obligations`, (request) => {
      obligationKeys.push(request.headers['idempotency-key'] ?? '');
      obligationBodies.push(request.bodyText ?? '');
      if (obligationKeys.length === 1) {
        return { status: 503, body: { statusCode: 503, error: 'unavailable', message: 'db down' } };
      }
      return { status: 201, body: CFE };
    });
    renderWithSafeArea(
      <ObligationFormScreen
        client={clientFor(obligations, () => v4(9))}
        propertyId={PROPERTY_ID}
        now={() => new Date('2026-10-21T18:00:00.000Z')}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );
    fireEvent.changeText(screen.getByLabelText(COPY['obligation.title.label']), 'CFE');
    fireEvent.changeText(screen.getByLabelText(COPY['obligation.amount.label']), '850');
    fireEvent.press(screen.getByRole('button', { name: COPY['obligation.add.cta'] }));
    expect(await screen.findByText(COPY['common.connecting.failed'])).toBeTruthy();
    expect(screen.queryByText(COPY['err.generic'])).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: COPY['common.retry'] }));
    await waitFor(() => expect(obligationKeys).toHaveLength(2));
    expect(obligationKeys[0]).toBe(obligationKeys[1]);
    expect(obligationBodies[1]).toBe(obligationBodies[0]);
    expect(obligationBodies[0]).toContain('"title":"CFE"');
    expect(obligationBodies[0]).toContain('"expectedAmount":"850.00"');
  });

  it('rejects a name or city past the API single-line cap', () => {
    const draft = {
      name: 'a'.repeat(FIELD_LIMITS.propertyName + 1),
      propertyType: 'house' as const,
      occupancyStatus: 'owned' as const,
      addressLine: '',
      city: '',
      state: '',
    };
    expect(buildPropertyWrite(draft).ok).toBe(false);
    expect(
      buildPropertyWrite({ ...draft, name: 'Casa', city: 'b'.repeat(FIELD_LIMITS.city + 1) }).ok,
    ).toBe(false);
    const now = new Date('2026-10-21T18:00:00.000Z');
    expect(
      buildObligationWrite(
        {
          category: 'electricity',
          title: 'CFE',
          providerName: 'p'.repeat(FIELD_LIMITS.providerName + 1),
          recurrence: 'monthly',
          nextDueDate: '2026-11-02',
          expectedAmount: '850.00',
          notes: '',
        },
        now,
      ).ok,
    ).toBe(false);
  });
});
