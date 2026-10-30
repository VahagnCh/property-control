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

/** Shown while a write waits on GET /v1/health. Not a place for secrets or response text. */
export const CONNECTING_LABEL = 'Conectando…';

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
  'notif.signIn.body': 'Inicia sesión para abrir esta notificación.',
  'notif.signIn.notNow': 'Ahora no',
  'notif.signIn.cancel': 'Cancelar',
  'notif.notFound.title': 'Esta notificación ya no está disponible',
  'notif.notFound.body': 'Puede que se haya eliminado o que no tengas acceso.',
  'notif.notFound.cta': 'Ir a Inicio',
  'common.notFound': 'No encontramos esto, o no tienes acceso.',
  'common.error': 'No se pudo completar la acción. Inténtalo de nuevo.',
  'common.connecting': 'Conectando…',
  'common.connecting.slow': 'La primera conexión del día puede tardar hasta un minuto.',
  'common.connecting.failed': 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
  'common.retry': 'Reintentar',
  'auth.email.title': 'Entra a DueRecord',
  'auth.email.body': 'Te enviaremos un código de 6 dígitos a tu correo.',
  'auth.email.label': 'Correo electrónico',
  'auth.email.cta': 'Enviar código',
  'auth.email.invalid': 'Escribe un correo válido.',
  'auth.email.webUnavailable': 'Por ahora, solo puedes entrar desde la app en tu teléfono.',
  'auth.code.title': 'Revisa tu correo',
  'auth.code.body': 'Si {email} puede entrar a DueRecord, te enviamos un código de 6 dígitos. Vence en 10 minutos.',
  'auth.code.latest': 'Si pediste más de un código, usa el del correo más reciente.',
  'auth.code.spamHint': '¿No llegó? Revisa tu carpeta de spam o correo no deseado.',
  'auth.code.cta': 'Entrar',
  'auth.code.wrong': 'El código no es correcto o ya no sirve. Revísalo o pide uno nuevo.',
  'auth.code.resend': 'Enviar otro código',
  'auth.code.resendWait': 'Puedes pedir otro código en {s} s.',
  'auth.code.wait': 'Demasiados intentos. Espera unos minutos y pide un código nuevo.',
  'auth.code.changeEmail': 'Usar otro correo',
  'auth.code.expiresAt': 'El código vence a las {time}.',
  'auth.network': 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.',
  'auth.session.expired': 'Tu sesión terminó. Entra de nuevo.',
  'idempotency.keyReused': 'Esa solicitud ya se usó con otros datos. Revísala e inténtalo de nuevo.',
} as const;

export type CopyKey = keyof typeof COPY;

/** English fallback. Spanish in `COPY` is the source. */
export const COPY_EN: Partial<Record<CopyKey, string>> = {
  'auth.email.webUnavailable': 'For now, you can only sign in from the app on your phone.',
  'auth.code.expiresAt': 'The code expires at {time}.',
};

/**
 * Spanish is the source. English is used when the caller asks for it, or
 * when the Spanish string is empty.
 */
export function pickCopy(spanish: string, english: string | undefined, language: 'es' | 'en' = 'es'): string {
  if (language === 'en') {
    return english || spanish;
  }
  return spanish || english || '';
}

export function copyText(key: CopyKey, language: 'es' | 'en' = 'es'): string {
  return pickCopy(COPY[key], COPY_EN[key], language);
}

/** Fills `{name}` placeholders. The replacement is inserted as text, not a pattern. */
export function fillCopy(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : value;
  });
}

export const OCR_REPLACE_KEEP_LABEL = 'Mantener lo que escribí';
export const OCR_REPLACE_BUTTON_LABEL = 'Reemplazar';
export const OCR_REPLACE_TOAST = 'Valor reemplazado. Puedes editarlo antes de registrar.';
export const OCR_UNREVIEWED_DISCARD_COPY = 'Las sugerencias sin revisar se descartarán al registrar.';

/** Shown when the field already has a typed value. Placeholders are the current and suggested text. */
export function ocrReplacePrompt(actual: string, suggested: string): string {
  return `Reemplazar «${actual}» por «${suggested}»`;
}
