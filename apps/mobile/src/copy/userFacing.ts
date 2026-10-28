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

export const COPY = {
  'ocr.edit.invalid': 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.',
  'ocr.field.saved': 'Este campo ya estaba guardado. Usa Reemplazar si quieres cambiarlo.',
  'ocr.conflict': 'Este dato cambió. Revisa la sugerencia otra vez.',
  'ocr.target.locked': 'Esta sugerencia ya está ligada a otro registro. Revísala otra vez.',
  'ocr.target.required': 'Elige a qué pago aplica esta sugerencia.',
  'ocr.target.voided': 'Este registro ya no se puede usar. Elige otro o descarta la sugerencia.',
  'ocr.target.unchecked': 'No pudimos comprobar el registro de destino. Elige otro o descarta la sugerencia.',
  'ocr.bulk.refused': 'Hay que decidir cada sugerencia por separado.',
  'ocr.job.notSuggested': 'Esta revisión ya estaba registrada. Actualiza la pantalla.',
  'ocr.job.expired': 'Esta revisión ya no está disponible. Vuelve a intentarlo.',
  'form.text.invalidChars': 'Este texto tiene caracteres no permitidos. Bórralos e inténtalo de nuevo.',
  'form.text.required': 'Este campo no puede quedar vacío.',
  'form.title.tooLong': 'El título admite hasta 300 caracteres.',
  'form.body.tooLong': 'El texto admite hasta 32 KB.',
  'obligation.nextDueDate.invalid':
    'La próxima fecha no es válida. Revisa el valor e inténtalo de nuevo.',
  'invite.unavailable':
    'Esta invitación no está disponible. Pide a quien te invitó que te envíe una nueva.',
  'invite.expired': 'Esta invitación ya no se puede usar. Pide una nueva.',
  'notif.notFound.title': 'Esta notificación ya no está disponible',
  'notif.notFound.body': 'Puede que se haya eliminado o que no tengas acceso.',
  'notif.notFound.cta': 'Ir a Inicio',
} as const;

export type CopyKey = keyof typeof COPY;

export function copyText(key: CopyKey): string {
  return COPY[key];
}

export const OCR_REPLACE_KEEP_LABEL = 'Mantener lo que escribí';
export const OCR_REPLACE_BUTTON_LABEL = 'Reemplazar';
export const OCR_REPLACE_TOAST = 'Valor reemplazado. Puedes editarlo antes de registrar.';
export const OCR_UNREVIEWED_DISCARD_COPY = 'Las sugerencias sin revisar se descartarán al registrar.';

/** Shown when the field already has a typed value. Placeholders are the current and suggested text. */
export function ocrReplacePrompt(actual: string, suggested: string): string {
  return `Reemplazar «${actual}» por «${suggested}»`;
}
