import { tabDeepLink, type TabScreen } from './deepLink';

export type Place =
  | { name: 'inicio'; tabUrl: string | null }
  | { name: 'sign-in' }
  | { name: 'notification' };

/** The nid stays here and is never passed into the rendered tree. */
export type Held =
  | { kind: 'notification'; nid: string }
  | { kind: 'tab'; screen: TabScreen }
  | { kind: 'inicio' };

/**
 * Applies a held link once.
 * Sign-in keeps the nid until a session exists. Opening the notification, a tab, or Inicio clears it.
 */
export function settleHeld(held: Held, hasSession: boolean): { place: Place; held: Held | null } {
  if (held.kind === 'notification') {
    if (!hasSession) {
      return { place: { name: 'sign-in' }, held };
    }
    return { place: { name: 'notification' }, held: null };
  }
  if (held.kind === 'tab') {
    return { place: { name: 'inicio', tabUrl: tabDeepLink(held.screen) }, held: null };
  }
  return { place: { name: 'inicio', tabUrl: null }, held: null };
}

/** Ahora no, Cancelar, and the not-found action drop the nid and open Inicio. */
export function dropHeld(): { place: Place; held: null } {
  return { place: { name: 'inicio', tabUrl: null }, held: null };
}
