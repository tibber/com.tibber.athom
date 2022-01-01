import newrelic from 'newrelic';

export interface TransactionAttributes {
  readonly firmwareVersion?: string;
  readonly appVersion?: string;
}

export const attributes: TransactionAttributes = {
  firmwareVersion: undefined,
  appVersion: undefined,
};

const addAttributesToTransaction = (): void => {
  const { firmwareVersion, appVersion } = attributes;

  if (firmwareVersion !== undefined)
    newrelic.addCustomAttribute('firmwareVersion', firmwareVersion);

  if (appVersion !== undefined)
    newrelic.addCustomAttribute('appVersion', appVersion);
};

export const startTransaction = <T>(
  name: string,
  group: string,
  handle: (...args: unknown[]) => T,
): T => {
  addAttributesToTransaction();
  return newrelic.startBackgroundTransaction(name, group, handle);
};

export const startSegment = <T, C extends (...args: unknown[]) => unknown>(
  name: string,
  record: boolean,
  handler: (cb?: C) => T,
  callback?: C,
): T => newrelic.startSegment(name, record, handler, callback);

export const noticeError = (
  error: Error,
  customAttributes?: { [key: string]: string | number | boolean },
): void => newrelic.noticeError(error, customAttributes);
