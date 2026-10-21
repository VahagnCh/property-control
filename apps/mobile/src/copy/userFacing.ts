export const PRODUCT_NAME = 'DueRecord';

export const TAB_LABELS = [
  'Inicio',
  'Propiedades',
  'Pagos',
  'Mantenimiento',
  'Documentos',
] as const;

export type TabLabel = (typeof TAB_LABELS)[number];

export const TAB_BODIES: Record<TabLabel, string> = {
  Inicio:
    'Aquí verás lo atrasado y lo que vence pronto en todas tus propiedades.',
  Propiedades:
    'El portafolio y, dentro de cada propiedad, sus obligaciones.',
  Pagos:
    'Registrar un pago anota lo que ya pagaste. El comprobante es opcional. DueRecord no mueve dinero.',
  Mantenimiento:
    'Tareas ligeras de la propiedad. El flujo completo llega después.',
  Documentos:
    'Los archivos de cada propiedad viven aquí. La pantalla para revisar sugerencias de OCR y confirmarlas llega después. Nada se guarda en obligaciones o pagos hasta que la persona confirma.',
};

export const SCREEN_STATE_COPY = {
  loading: 'Cargando…',
  empty: 'Nada por mostrar todavía.',
  error: 'No se pudo cargar esta pantalla.',
  retry: 'Reintentar',
} as const;

export function loadingAccessibilityLabel(context: string): string {
  return `${context}: ${SCREEN_STATE_COPY.loading}`;
}

export function emptyAccessibilityLabel(context: string): string {
  return `${context}: ${SCREEN_STATE_COPY.empty}`;
}

export function errorAccessibilityLabel(context: string): string {
  return `${context}: ${SCREEN_STATE_COPY.error}`;
}

export function retryAccessibilityLabel(context: string): string {
  return `${SCREEN_STATE_COPY.retry} ${context}`;
}
