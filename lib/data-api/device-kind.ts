export interface DiscoveredDevice {
  id: string;
  info?: { name?: string; brand?: string; model?: string };
}

// The discovery response has no device type yet, and a Pulse CT came back without `info` at all. Its
// id is base64 of "<kind>:<uuid>", e.g. "tibber pulse ct:…". The API calls ids opaque, so this is a
// stopgap until discovery says what a device is.
const decodedKind = (device: DiscoveredDevice): string | undefined => {
  const decoded = Buffer.from(
    device.id.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
  return /^([a-z][a-z0-9 ]{1,40}):/i.exec(decoded)?.[1]?.toLowerCase();
};

export const isPulseCt = (device: DiscoveredDevice): boolean =>
  decodedKind(device) === 'tibber pulse ct';

// Short words are abbreviations: "tibber pulse ct" -> "Tibber Pulse CT"
const titleCase = (text: string) =>
  text
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length <= 2
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(' ');

/** Name for a discovered device, with the home name added when the account has several homes. */
export const deviceName = (
  device: DiscoveredDevice,
  homeName?: string,
): string => {
  const kind = decodedKind(device);
  const name =
    device.info?.name ||
    (kind ? titleCase(kind) : `Tibber meter ${device.id.slice(-6)}`);
  return homeName ? `${name} (${homeName})` : name;
};
