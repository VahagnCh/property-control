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
  'ocr.target.unknown': 'No pudimos revisar ese pago. Inténtalo de nuevo.',
  'ocr.confirm.failed': 'No pudimos guardar las sugerencias. Inténtalo de nuevo.',
  'ocr.job.notSuggested': 'Esta revisión ya estaba registrada. Actualiza la pantalla.',
  'ocr.job.expired': 'Esta revisión ya no está disponible. Vuelve a intentarlo.',
  'form.text.invalidChars': 'Este texto tiene caracteres no permitidos. Bórralos e inténtalo de nuevo.',
  'form.text.required': 'Este campo no puede quedar vacío.',
  'form.title.tooLong': 'El título admite hasta 300 caracteres.',
  'form.body.tooLong': 'El texto admite hasta 32 KB.',
  'obligation.nextDueDate.outOfRange': 'Elige una fecha entre {min} y {max}.',
  'invite.unavailable':
    'Esta invitación no está disponible. Pide a quien te invitó que te envíe una nueva.',
  'invite.expired': 'Esta invitación ya no se puede usar. Pide una nueva.',
  'notif.signIn.body': 'Inicia sesión para abrir esta notificación.',
  'notif.signIn.notNow': 'Ahora no',
  'notif.signIn.cancel': 'Cancelar',
  'notif.notFound.title': 'Esta notificación ya no está disponible',
  'notif.notFound.body': 'Puede que se haya eliminado o que no tengas acceso.',
  'notif.notFound.cta': 'Ir a Inicio',
  'err.generic': 'Revisa los datos e intenta de nuevo.',
  'property.forbidden': 'No tienes acceso a esta propiedad.',
  'err.forbidden': 'No tienes permiso para registrar pagos en esta propiedad.',
  'err.notFound': 'No encontramos esta obligación.',
  'err.notFound.cta': 'Ir a Inicio',
  'common.unavailable': 'Esto ya no está disponible.',
  'common.connecting': 'Conectando…',
  'common.connecting.slow': 'La primera conexión del día puede tardar hasta un minuto.',
  'common.connecting.failed': 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
  'common.retry': 'Reintentar',
  'pay.sync.conflict': 'Este registro cambió mientras estabas sin conexión.',
  'pay.void.noEdit': 'Este pago fue anulado y ya no se puede editar.',
  'pay.void.noEdit.cta': 'Ver pago',
  'pay.void.alreadyVoided': 'Este pago ya estaba anulado.',
  'pay.void.badge': 'Anulado',
  'pay.void.cta': 'Anular pago',
  'pay.void.forbidden': 'No tienes permiso para anular este pago',
  'pay.edit': 'Editar',
  'property.add.title': 'Nueva propiedad',
  'property.add.cta': 'Guardar propiedad',
  'property.name.label': 'Nombre',
  'property.type.label': 'Tipo',
  'property.address.label': 'Dirección',
  'property.city.label': 'Ciudad',
  'property.state.label': 'Estado',
  'property.occupancy.label': 'Estatus',
  'property.empty.title': 'Agrega tu primera propiedad.',
  'cta.addProperty': 'Agregar propiedad',
  'property.back': 'Volver',
  'property.obligations': 'Obligaciones',
  'property.loadingContext': 'Propiedad',
  'obligation.add.title': 'Nueva obligación',
  'obligation.add.cta': 'Guardar obligación',
  'obligation.empty': 'Esta propiedad no tiene obligaciones.',
  'cta.addObligation': 'Agregar obligación',
  'obligation.category.label': 'Categoría',
  'obligation.title.label': 'Nombre',
  'obligation.provider.label': 'Proveedor',
  'obligation.recurrence.label': 'Frecuencia',
  'obligation.nextDueDate.label': 'Próxima fecha',
  'obligation.amount.label': 'Monto esperado',
  'obligation.notes.label': 'Notas',
  'obligation.reminders': 'Recordatorios: 7 días antes y 1 día antes.',
  'form.amount.invalid': 'Escribe el monto en pesos, por ejemplo 850.00.',
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
  'property.type.house': 'Casa',
  'property.type.apartment': 'Depto',
  'property.type.land': 'Terreno',
  'property.type.commercial': 'Local',
  'property.type.other': 'Otro',
  'property.occupancy.owned': 'Propia',
  'property.occupancy.rented': 'Rentada',
  'property.occupancy.family': 'Familiar',
  'property.occupancy.investment': 'Inversión',
  'obligation.category.predial': 'Predial',
  'obligation.category.water': 'Agua',
  'obligation.category.electricity': 'CFE/Electricidad',
  'obligation.category.gas': 'Gas',
  'obligation.category.internet': 'Internet',
  'obligation.category.mantenimiento': 'Mantenimiento/HOA',
  'obligation.category.mortgage': 'Hipoteca',
  'obligation.category.insurance': 'Seguro',
  'obligation.category.security': 'Seguridad',
  'obligation.category.other': 'Otro',
  'obligation.recurrence.monthly': 'Mensual',
  'obligation.recurrence.bimonthly': 'Bimestral',
  'obligation.recurrence.quarterly': 'Trimestral',
  'obligation.recurrence.semiannual': 'Semestral',
  'obligation.recurrence.annual': 'Anual',
  'obligation.recurrence.custom': 'Personalizada',
  'obligation.recurrence.irregular': 'Irregular/única',
} as const;

export type CopyKey = keyof typeof COPY;

/** English fallback. Spanish in `COPY` is the source. */
export const COPY_EN: Partial<Record<CopyKey, string>> = {
  'auth.email.webUnavailable': 'For now, you can only sign in from the app on your phone.',
  'auth.code.expiresAt': 'The code expires at {time}.',
  'err.generic': 'Check the details and try again.',
  'property.forbidden': 'You do not have access to this property.',
  'err.forbidden': 'You do not have permission to record payments on this property.',
  'err.notFound': 'We could not find this obligation.',
  'err.notFound.cta': 'Go to Home',
  'common.unavailable': 'This is no longer available.',
  'common.connecting': 'Connecting…',
  'common.connecting.slow': 'The first connection of the day can take up to a minute.',
  'common.connecting.failed': 'We could not connect. Check your connection and try again.',
  'common.retry': 'Try again',
  'pay.sync.conflict': 'This record changed while you were offline.',
  'pay.void.noEdit': 'This payment was voided and can no longer be edited.',
  'pay.void.noEdit.cta': 'View payment',
  'pay.void.alreadyVoided': 'This payment was already voided.',
  'pay.void.badge': 'Voided',
  'pay.void.cta': 'Void payment',
  'pay.void.forbidden': 'You do not have permission to void this payment.',
  'pay.edit': 'Edit',
  'obligation.nextDueDate.outOfRange': 'Choose a date between {min} and {max}.',
  'ocr.target.unknown': 'We could not review that payment. Try again.',
  'ocr.confirm.failed': 'We could not save the suggestions. Try again.',
  'property.add.title': 'New property',
  'property.add.cta': 'Save property',
  'property.name.label': 'Name',
  'property.type.label': 'Type',
  'property.address.label': 'Address',
  'property.city.label': 'City',
  'property.state.label': 'State',
  'property.occupancy.label': 'Status',
  'property.empty.title': 'Add your first property.',
  'cta.addProperty': 'Add property',
  'property.back': 'Back',
  'property.obligations': 'Obligations',
  'property.loadingContext': 'Property',
  'obligation.add.title': 'New obligation',
  'obligation.add.cta': 'Save obligation',
  'obligation.empty': 'This property has no obligations.',
  'cta.addObligation': 'Add obligation',
  'obligation.category.label': 'Category',
  'obligation.title.label': 'Name',
  'obligation.provider.label': 'Provider',
  'obligation.recurrence.label': 'Frequency',
  'obligation.nextDueDate.label': 'Next date',
  'obligation.amount.label': 'Expected amount',
  'obligation.notes.label': 'Notes',
  'obligation.reminders': 'Reminders: 7 days before and 1 day before.',
  'form.amount.invalid': 'Enter the amount in pesos, for example 850.00.',
  'property.type.house': 'House',
  'property.type.apartment': 'Apartment',
  'property.type.land': 'Land',
  'property.type.commercial': 'Shop',
  'property.type.other': 'Other',
  'property.occupancy.owned': 'Owned',
  'property.occupancy.rented': 'Rented',
  'property.occupancy.family': 'Family',
  'property.occupancy.investment': 'Investment',
  'obligation.category.predial': 'Predial',
  'obligation.category.water': 'Water',
  'obligation.category.electricity': 'Electricity',
  'obligation.category.gas': 'Gas',
  'obligation.category.internet': 'Internet',
  'obligation.category.mantenimiento': 'Maintenance',
  'obligation.category.mortgage': 'Mortgage',
  'obligation.category.insurance': 'Insurance',
  'obligation.category.security': 'Security',
  'obligation.category.other': 'Other',
  'obligation.recurrence.monthly': 'Monthly',
  'obligation.recurrence.bimonthly': 'Every two months',
  'obligation.recurrence.quarterly': 'Quarterly',
  'obligation.recurrence.semiannual': 'Twice a year',
  'obligation.recurrence.annual': 'Yearly',
  'obligation.recurrence.custom': 'Custom',
  'obligation.recurrence.irregular': 'One time',
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
