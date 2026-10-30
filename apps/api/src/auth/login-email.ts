/**
 * UX screen inventory v1.6. Wording is the approved login email.
 * The code is only in the body. The subject and headers never carry it.
 */
export const AUTH_CODE_EMAIL_SUBJECT_KEY = 'auth.codeEmail.subject';
export const AUTH_CODE_EMAIL_BODY_KEY = 'auth.codeEmail.body';

export const AUTH_CODE_EMAIL_SUBJECT = 'Tu código para entrar a DueRecord';

export function authCodeEmailBody(code: string): string {
  return `Tu código es: ${code}. Vence en 10 minutos. Si no lo pediste, ignora este correo; nadie puede entrar sin el código. DueRecord nunca te pedirá este código por teléfono ni por mensaje.`;
}
