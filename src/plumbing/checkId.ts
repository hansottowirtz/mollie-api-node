import Maybe from '../types/Maybe';

type ResourceKind = 'capture' | 'chargeback' | 'customer' | 'mandate' | 'order' | 'orderline' | 'organization' | 'payment' | 'payment-link' | 'profile' | 'refund' | 'shipment' | 'subscription';

const prefixes = new Map<ResourceKind, string>([
  ['capture', 'cpt_'],
  ['chargeback', 'chb_'],
  ['customer', 'cst_'],
  ['mandate', 'mdt_'],
  ['order', 'ord_'],
  ['orderline', 'odl_'],
  ['organization', 'org_'],
  ['payment', 'tr_'],
  ['payment-link', 'pl_'],
  ['profile', 'pfl_'],
  ['refund', 're_'],
  ['shipment', 'shp_'],
  ['subscription', 'sub_'],
]);
/**
 * Returns whether the passed identifier seems plausible (`true`); or is definitely invalid (`false`).
 */
export default function checkId(value: Maybe<string>, resource: ResourceKind): value is string {
  if (typeof value != 'string') {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return value.startsWith(prefixes.get(resource)!);
}
