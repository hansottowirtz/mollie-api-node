import { randomBytes } from 'crypto';

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * The name of the property in the request configuration which indicates which attempt this is. `0` for the initial
 * attempt, `1` for the first retry (second attempt), et cetera.
 *
 * This must not overlap with any of the other properties, and for technical reasons, cannot be a symbol.
 */
const attemptIndex = '_attemptIndex';

/**
 * The delay, in milliseconds, between attempts. Note that if Axios' timeout is smaller than this value, no second
 * attempt will ever be made.
 */
const retryDelay = 2e3;
/**
 * The maximum number of attempts per request. `3` means: one initial attempt + up to two retries.
 */
const attemptLimit = 3;

type AttemptState = { [attemptIndex]: number };

/**
 * Returns whether the passed error is as expected: an Axios error whose config has an attemptIndex property.
 */
function checkError(error: any): error is AxiosError & { config: AxiosRequestConfig & AttemptState } {
  return (
    axios.isAxiosError(error) && // Note that Axios errors always have a config property.
    (error.config as AxiosRequestConfig & Partial<AttemptState>)[attemptIndex] != undefined
  );
}

/**
 * Returns an object with a single `'Idempotency-Key'` property, whose value is a random 24-character string which can
 * be used as an idempotency key.
 *
 * As the data encoded in said string is 144 bits long, the odds of two generated keys colliding is ±2% after
 * generating a sextillion (1000 billion billion, or 10^21) keys.
 */
function generateIdempotencyHeader() {
  return { 'Idempotency-Key': randomBytes(18).toString('base64') };
}

/**
 * Parses the 'Retry-After' header, if any, and returns the time in milliseconds. Returns `undefined` if the header is
 * not present or not parseable into a numeric value.
 *
 * If the header contains an HTTP date rather than a delay, it will be ignored.
 * @see https://httpwg.org/specs/rfc9110.html#field.retry-after
 */
function parseRetryAfterHeader(response: AxiosResponse): number | undefined {
  const retryAfter = parseInt(response.headers['retry-after'], 10);
  if (isNaN(retryAfter)) {
    return undefined;
  }
  // Convert the header value from seconds to milliseconds.
  return retryAfter * 1e3;
}

/**
 * Enhances the passed Axios instance, making it attempt requests multiple times in some scenarios.
 *
 * The idea is that if the Mollie API has a brief hiccup, the extra attempts may cause the request to succeed anyway.
 *
 * If the Mollie API responds with a 5×× status code, the request will be re-attempted until:
 *  * the Mollie API responds with a different status code, or
 *  * the attempt limit has been reached (it gives up after the third attempt), or
 *  * the request has timed out (as per the timeout set in the Axios instance).
 *
 * For `POST` and `DELETE` requests, an idempotency key is added. This ensures the Mollie API can distinguish a single
 * request being re-attempted from two separate similarly-looking requests. In effect, this allows this client to
 * safely re-attempt requests.
 */
export default function makeRetrying(axiosInstance: AxiosInstance) {
  // Set the attempt (in the request configuration) of any request.
  axiosInstance.interceptors.request.use((config: AxiosRequestConfig & Partial<AttemptState>) => {
    config[attemptIndex] = (config[attemptIndex] ?? -1) + 1;
    return config;
  });
  // Intercept any erroneous responses, and consider doing another attempt.
  axiosInstance.interceptors.response.use(undefined, error => {
    // If the request configuration is unexpected ‒ in other words, it seems the request did not go through the
    // interceptor above ‒ do not make another attempt.
    if (!checkError(error)) {
      return Promise.reject(error);
    }
    const { config } = error;
    // If the attempt limit has been reached, do not make another attempt.
    if (config[attemptIndex] == attemptLimit - 1) {
      return Promise.reject(error);
    }
    // If there is no response or the HTTP status code of the response is not 5××, do not make another attempt.
    if (error.response == undefined || Math.floor(error.response.status / 100) != 5) {
      return Promise.reject(error);
    }
    // Determine the delay after which the next attempt is made, preferring a Retry-After header defined in the
    // response over the default value.
    const delay = parseRetryAfterHeader(error.response) ?? retryDelay;
    // Schedule the attempt.
    return new Promise(resolve => setTimeout(() => resolve(axiosInstance.request(config)), delay));
  });
  // Overwrite the post and delete functions in the Axios instance, making them add the header. Note that the Axios
  // instance still has its original request function, which is not overwritten. Additionally, the Axios instance
  // itself can be called as a function, which is equivalent to calling the request function. In this client, neither
  // is used, so this is not an issue.
  const { post: originalPost, delete: originalDelete } = axiosInstance;
  axiosInstance.post = function (url, data, config) {
    return originalPost(url, data, { ...config, headers: { ...config?.headers, ...generateIdempotencyHeader() } });
  };
  axiosInstance.delete = function (url, config) {
    return originalDelete(url, { ...config, headers: { ...config?.headers, ...generateIdempotencyHeader() } });
  };
}
