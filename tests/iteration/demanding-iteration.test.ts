import { Interceptor } from 'nock';
import { MollieClient, Payment } from '../..';
import NetworkMocker, { getApiKeyClientProvider } from '../NetworkMocker';

declare global {
  namespace jest {
    interface Matchers<R, T> {
      toDemand(expected: number): Promise<CustomMatcherResult>;
    }
  }
}

describe('demanding-iteration', () => {
  const networkMocker = new NetworkMocker(getApiKeyClientProvider());
  let mollieClient: MollieClient;

  beforeAll(async () => {
    mollieClient = await networkMocker.prepare();
    expect.extend({
      async toDemand(received: AsyncIterable<Payment>, expected: number) {
        // Setup the interceptor.
        const interceptor = networkMocker.intercept('GET', `/payments?limit=${expected}`, 200, { _embedded: { payments: [] }, count: 0, _links: {} }) as Interceptor & { counter: number };
        // Trigger he iterable to make a request.
        try {
          for await (let _ of received) {
            break;
          }
        } catch (error) {}
        const { isNot } = this;
        const pass = interceptor.counter == 0;
        return {
          pass,
          message: () =>
            'expect(iterable).toDemand(expected)' + //
            '\n\n' +
            `Expected an iterable which ${isNot ? 'does not make' : 'makes'} a request to https://api.mollie.com:443/v2/payments?limit=${expected}`,
        };
      },
    });
  });

  test('naked', () => {
    // No guess can be made, 128 values are requested.
    return expect(mollieClient.payments.iterate()).toDemand(128);
  });

  test('take', () => {
    // 80 values are required.
    return expect(mollieClient.payments.iterate().take(80)).toDemand(80);
  });

  test('drop', () => {
    // No guess can be made, 128 values are requested.
    return expect(mollieClient.payments.iterate().drop(10)).toDemand(128);
  });

  test('drop-take', () => {
    // 90 values are required: the first 10 are dropped and the 80 after that are consumed.
    return expect(mollieClient.payments.iterate().drop(10).take(80)).toDemand(90);
  });

  test('take-drop', () => {
    // 80 values are required: the first 10 are dropped and the 70 after that are consumed.
    return expect(mollieClient.payments.iterate().take(80).drop(10)).toDemand(80);
  });

  test('drop-take-drop', () => {
    // 90 values are required: the first 20 are dropped and the 70 after that are consumed.
    return expect(mollieClient.payments.iterate().drop(10).take(80).drop(10)).toDemand(90);
  });

  test('take-take', async () => {
    // 80 values are required in both scenarios.
    await expect(mollieClient.payments.iterate().take(100).take(80)).toDemand(80);
    await expect(mollieClient.payments.iterate().take(80).take(100)).toDemand(80);
  });

  test('take-filter', () => {
    // 80 values are required.
    return expect(
      mollieClient.payments
        .iterate()
        .take(80)
        .filter(_ => true),
    ).toDemand(80);
  });

  test('filter-take', () => {
    // No guess can be made (as there is no way to know how many values will pass the filter), 128 values are
    // requested.
    return expect(
      mollieClient.payments
        .iterate()
        .filter(_ => true)
        .take(80),
    ).toDemand(128);
  });

  test('take-map', () => {
    // 80 values are required. The map does not affect demand.
    return expect(
      mollieClient.payments
        .iterate()
        .take(80)
        .map(payment => payment),
    ).toDemand(80);
  });

  test('map-take', () => {
    // 80 values are required. The map does not affect demand.
    return expect(
      mollieClient.payments
        .iterate()
        .map(payment => payment)
        .take(80),
    ).toDemand(80);
  });

  test('take-300', () => {
    // 250 values are requested in the initial page. (50 values are requested in the second page, but this is not
    // tested.)
    return expect(mollieClient.payments.iterate().take(300)).toDemand(250);
  });

  test('take-3218', () => {
    // 250 values are requested in the initial page. (More precisely, 250 values are requested for 12 pages, then 218
    // values are requested for the last page. But this is not tested)
    return expect(mollieClient.payments.iterate().take(3218)).toDemand(250);
  });

  afterAll(() => networkMocker.cleanup());
});
