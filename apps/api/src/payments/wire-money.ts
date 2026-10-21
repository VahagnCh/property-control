/**
 * API wire money. `amount` is a decimal string such as "1234.50", never a
 * JSON number or a float. `currency` is MXN only. The database stores the
 * same value as integer centavos.
 */
export interface WireMoney {
  amount: string;
  currency: 'MXN';
}

export const WIRE_MONEY_EXAMPLE: WireMoney = {
  amount: '1234.50',
  currency: 'MXN',
};
