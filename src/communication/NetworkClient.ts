import https from 'https';
import { SecureContextOptions } from 'tls';

import axios, { AxiosInstance, AxiosResponse } from 'axios';

import List from '../data/list/List';
import ApiError from '../errors/ApiError';
import Options from '../Options';
import HelpfulIterator from '../plumbing/HelpfulIterator';
import Maybe from '../types/Maybe';
import Nullable from '../types/Nullable';
import dromedaryCase from './dromedaryCase';
import stringifyQuery from './stringifyQuery';

/**
 * Like `[].map` but with support for non-array inputs, in which case this function behaves as if an array was passed
 * with the input as its sole element.
 */
function map<T, U>(input: Maybe<T | T[]>, callback: (value: T, index: number) => U, context?: any): U[] {
  if (Array.isArray(input)) {
    return input.map(callback, context);
  }
  if (input != undefined) {
    return [callback.call(context, input, 0)];
  }
  return [];
}

/**
 * Composes a `User-Agent` header value which looks something like
 * `'Node/10.0.0 Mollie/3.0.0 RockenbergCommerce/1.16.0'`.
 */
function composeUserAgent(nodeVersion: string, libraryVersion: string, versionStrings: Options['versionStrings']) {
  return [
    `Node/${nodeVersion}`,
    `Mollie/${libraryVersion}`,
    ...map(versionStrings, versionString => {
      //                platform /version
      const matches = /^([^\/]+)\/([^\/\s]+)$/.exec(versionString);
      if (matches == null) {
        if (-1 == versionString.indexOf('/') || versionString.indexOf('/') != versionString.lastIndexOf('/')) {
          throw new Error('Invalid version string. It needs to consist of a name and version separated by a forward slash, e.g. RockenbergCommerce/3.1.12');
        }
        throw new Error('Invalid version string. The version may not contain any whitespace.');
      }
      const platform = dromedaryCase(matches[1]);
      const version = matches[2];
      return `${platform}/${version}`;
    }),
  ].join(' ');
}

/**
 * Throws an API error based on the passed cause.
 */
const throwApiError = (() => {
  /**
   * Returns whether the passed value is an object with a property with the passed name (`true`) or not (`false`).
   */
  function findProperty<K extends string>(value: unknown, name: K): value is Record<K, unknown> {
    return typeof value == 'object' && value != null && name in value;
  }
  return function throwApiError(cause: unknown) {
    if (findProperty(cause, 'response') && cause.response != undefined) {
      throw ApiError.createFromResponse(cause.response as AxiosResponse<any>);
    }
    throw new ApiError(findProperty(cause, 'message') ? String(cause.message) : 'An unknown error has occurred');
  };
})();

/**
 * If there are fewer items in the buffer of the iterator than this mark, a request to the Mollie API for the next page
 * will be made.
 */
const iteratorLowWaterMark = 5.5;

async function* iterate<R>(networkClient: NetworkClient, ...firstPageArguments: Parameters<NetworkClient['list']>) {
  // Make the initial request for the first page.
  let currentPage: R[] & { links: List<R>['links'] } = await networkClient.list<R>(...firstPageArguments);
  let nextPage: Nullable<Promise<R[] & { links: List<R>['links'] }>> = null;
  while (true) {
    // Yield the items in the current page.
    while (true) {
      /* eslint-disable-next-line no-var */
      var item = currentPage.shift();
      if (item == undefined) {
        break;
      }
      yield item;
      // If the low water mark is hit, make a request for the next page. (Note that this code is never reached if the
      // page is empty. This is OK: if the page is empty, there is no next page either.)
      if (nextPage == null && currentPage.links.next != null && currentPage.length < iteratorLowWaterMark) {
        nextPage = networkClient.list<R>(currentPage.links.next.href, firstPageArguments[1]);
      }
    }
    // If a request for the next page has been made, wait for it to complete and switch to that page. (If no such
    // request has been made, there is no next page.)
    if (nextPage == null) {
      return;
    }
    currentPage = await nextPage;
    nextPage = null;
  }
}

/**
 * This class is essentially a wrapper around axios. It simplifies communication with the Mollie API over the network.
 */
export default class NetworkClient {
  protected readonly axiosInstance: AxiosInstance;
  constructor({
    apiKey,
    accessToken,
    versionStrings,
    apiEndpoint = 'https://api.mollie.com:443/v2/',
    caCertificates,
    libraryVersion,
    nodeVersion,
    ...axiosOptions
  }: Options & { caCertificates?: SecureContextOptions['ca']; libraryVersion: string; nodeVersion: string }) {
    axiosOptions.headers = { ...axiosOptions.headers };
    // Compose the headers set in the sent requests.
    axiosOptions.headers['User-Agent'] = composeUserAgent(nodeVersion, libraryVersion, versionStrings);
    if (apiKey != undefined) {
      axiosOptions.headers['Authorization'] = `Bearer ${apiKey}`;
    } /* if (accessToken != undefined) */ else {
      axiosOptions.headers['Authorization'] = `Bearer ${accessToken}`;
      axiosOptions.headers['User-Agent'] += ' OAuth/2.0';
    }
    axiosOptions.headers['Accept'] = 'application/hal+json';
    axiosOptions.headers['Accept-Encoding'] = 'gzip';
    axiosOptions.headers['Content-Type'] = 'application/json';
    // Create the axios instance.
    this.axiosInstance = axios.create({
      ...axiosOptions,
      baseURL: apiEndpoint,
      httpsAgent: new https.Agent({
        ca: caCertificates,
      }),
    });
  }

  async post<R>(relativePath: string, data: any, query: Record<string, any> = {}): Promise<R | true> {
    const response = await this.axiosInstance.post(`${relativePath}${stringifyQuery(query)}`, data).catch(throwApiError);
    if (response.status == 204) {
      return true;
    }
    return response.data;
  }

  async get<R>(relativePath: string, query: Record<string, any> = {}): Promise<R> {
    const response = await this.axiosInstance.get(`${relativePath}${stringifyQuery(query)}`).catch(throwApiError);
    return response.data;
  }

  async list<R>(relativePath: string, type: string, query: Record<string, any> = {}): Promise<R[] & Pick<List<R>, 'links' | 'count'>> {
    const response = await this.axiosInstance.get(`${relativePath}${stringifyQuery(query)}`).catch(throwApiError);
    try {
      /* eslint-disable-next-line no-var */
      var { _embedded: embedded, _links: links, count } = response.data;
    } catch (error) {
      throw new ApiError('Received unexpected response from the server');
    }
    return Object.assign(embedded[type] as R[], {
      links,
      count,
    });
  }

  async listPlain<R>(relativePath: string, binderName: string, query: Record<string, any> = {}): Promise<R[]> {
    const response = await this.axiosInstance.get(`${relativePath}${stringifyQuery(query)}`).catch(throwApiError);
    try {
      /* eslint-disable-next-line no-var */
      var { _embedded: embedded } = response.data;
    } catch (error) {
      throw new ApiError('Received unexpected response from the server');
    }
    return embedded[binderName] as R[];
  }

  iterate<R>(...firstPageArguments: Parameters<NetworkClient['list']>): HelpfulIterator<R> {
    return new HelpfulIterator<R>(iterate(this, ...firstPageArguments));
  }

  async patch<R>(relativePath: string, data: any): Promise<R> {
    const response = await this.axiosInstance.patch(relativePath, data).catch(throwApiError);
    return response.data;
  }

  async delete<R>(relativePath: string, context?: any): Promise<R | true> {
    const response = await this.axiosInstance.delete(relativePath, { data: context }).catch(throwApiError);
    if (response.status == 204) {
      return true;
    }
    return response.data as R;
  }
}
