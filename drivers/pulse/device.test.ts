jest.mock('../../lib/newrelic-transaction', () => ({
  startTransaction: (_n: string, _g: string, fn: () => unknown) => fn(),
  startSegment: (_n: string, _r: boolean, fn: () => unknown) => fn(),
  noticeError: jest.fn(),
  getUserAgent: () => 'test-agent',
}));

const mockGetHomeFeatures = jest.fn();
const mockSubscribeToLive = jest.fn();

jest.mock('../../lib/tibber-api', () => ({
  TibberApi: jest.fn().mockImplementation(() => ({
    getHomeFeatures: mockGetHomeFeatures,
    subscribeToLive: mockSubscribeToLive,
    getDefaultToken: () => 'token-1',
  })),
}));

// Minimal Homey Device stand-in — only the surface PulseDevice touches
class FakeDevice {
  homey = {
    settings: {},
    flow: {
      getDeviceTriggerCard: () => ({
        trigger: jest.fn().mockResolvedValue(undefined),
      }),
    },
    platform: 'local',
    api: { realtime: jest.fn().mockResolvedValue(undefined) },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  log = jest.fn();
  getData = () => ({ id: 'home-1', t: 'token-1' });
  getName = () => 'Test Pulse';
  getSetting = (_key: string) => null;
  setUnavailable = jest.fn().mockResolvedValue(undefined);
  setAvailable = jest.fn().mockResolvedValue(undefined);
  setCapabilityValue = jest.fn().mockResolvedValue(undefined);
  hasCapability = () => false;
  addCapability = jest.fn().mockResolvedValue(undefined);
}

// Patch Device before requiring the module
jest.mock('homey', () => ({ Device: FakeDevice, env: {} }), { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PulseDeviceModule = require('./device');
const PulseDevice: new () => FakeDevice & { onInit(): Promise<void> } =
  PulseDeviceModule;

const fakeSubscription = () => ({
  subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
});

function homeResponse(realTimeConsumptionEnabled: boolean | null) {
  return {
    viewer: {
      websocketSubscriptionUrl: 'wss://fake',
      home: { features: { realTimeConsumptionEnabled } },
    },
  };
}

describe('PulseDevice realTimeConsumptionEnabled=false handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSubscribeToLive.mockReturnValue(fakeSubscription());
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('marks device unavailable but retries after 1 hour when flag is false', async () => {
    mockGetHomeFeatures.mockResolvedValue(homeResponse(false));

    const device = new PulseDevice();
    await device.onInit();

    expect(device.setUnavailable).toHaveBeenCalledWith(
      'Real time consumption is not enabled for this home.',
    );
    expect(mockSubscribeToLive).not.toHaveBeenCalled();
    const callsAfterInit = mockGetHomeFeatures.mock.calls.length;

    // 1-hour debounce fires → another getHomeFeatures call
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);

    expect(mockGetHomeFeatures.mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  test('stops retrying after 24 hours of persistent false', async () => {
    mockGetHomeFeatures.mockResolvedValue(homeResponse(false));

    const device = new PulseDevice();
    await device.onInit();

    // Advance past 24h so the diff check triggers the cancel
    jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);

    const callsAt24h = mockGetHomeFeatures.mock.calls.length;

    // No further retries
    await jest.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    expect(mockGetHomeFeatures.mock.calls.length).toBe(callsAt24h);
  });

  test('reconnects and restores normal debounce interval when flag recovers', async () => {
    // First check: false. All subsequent: true.
    mockGetHomeFeatures
      .mockResolvedValueOnce(homeResponse(false))
      .mockResolvedValue(homeResponse(true));

    const device = new PulseDevice();
    await device.onInit();

    expect(mockSubscribeToLive).not.toHaveBeenCalled();

    // 1-hour retry fires, flag is now true → should subscribe
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(mockSubscribeToLive).toHaveBeenCalledTimes(1);

    const callsAfterRecovery = mockGetHomeFeatures.mock.calls.length;

    // Normal watchdog is ~10 min; advancing 15 min should fire it
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(mockGetHomeFeatures.mock.calls.length).toBeGreaterThan(
      callsAfterRecovery,
    );
  });
});
