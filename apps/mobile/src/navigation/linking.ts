import type { LinkingOptions } from '@react-navigation/native';
import { APP_SCHEME } from './deepLink';

/**
 * Tab links for NavigationContainer. Only the duerecord scheme is registered.
 * Notification detail is resolved by parseDeepLink, which also drops query secrets.
 */
export const linking: LinkingOptions<Record<string, object | undefined>> = {
  prefixes: [`${APP_SCHEME}://`],
  config: {
    screens: {
      Inicio: '',
      Propiedades: 'propiedades',
      Pagos: 'pagos',
      Mantenimiento: 'mantenimiento',
      Documentos: 'documentos',
    },
  },
};
