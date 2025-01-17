import { PaginationParameters, ThrottlingParameters } from '../../../types/parameters';

interface ContextParameters {
  testmode?: boolean;
  customerId: string;
  subscriptionId: string;
}

export type ListParameters = ContextParameters & PaginationParameters;

export type IterateParameters = Omit<ListParameters, 'limit'> & ThrottlingParameters;
