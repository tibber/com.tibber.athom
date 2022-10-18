import newrelic from 'newrelic';

export interface TransactionAttributes {
  firmwareVersion?: string;
  appVersion?: string;
}

const attributes: TransactionAttributes = {
  firmwareVersion: undefined,
  appVersion: undefined,
};

export const setGlobalAttributes = ({
  firmwareVersion,
  appVersion,
}: TransactionAttributes): void => {
  if (firmwareVersion !== undefined)
    attributes.firmwareVersion = firmwareVersion;

  if (appVersion !== undefined) attributes.appVersion = appVersion;
};

export const getGlobalAttributes = (): TransactionAttributes => attributes;

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
  handle: (...args: unknown[]) => Promise<T>,
): Promise<T> =>
  newrelic.startBackgroundTransaction(name, group, async () => {
    addAttributesToTransaction();
    return handle();
  });

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

export const getUserAgent = () => {
  const { firmwareVersion, appVersion } = getGlobalAttributes();
  return `Homey/${firmwareVersion} com.tibber/${appVersion}`;
};
