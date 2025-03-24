# Tibber

Integration with Tibber, with Pulse and Watty support.

## Flow cards

### Device: _**Home**_

#### Triggers

- Price changed
- Current price is at today's lowest
- Current price is at today's highest
- Current price is at its lowest among the next [x] hours
- Current price is at its highest among the next [x] hours
- Current price is [x] percent below today's average
- Current price is [x] percent above today's average
- Current price is [x] percent below average of the next [y] hours
- Current price is [x] percent above average of the next [y] hours
- Current price is one of today's lowest [x] prices
- Current price is one of today's highest [x] prices
- Consumption is reported (triggers when new data is available, normally once a week. Every hour if you
  have a Pulse device)
  &nbsp;

#### Conditions

- Current price below/above
- Current price is at today's lowest
- Current price is at today's highest
- Current price is at its lowest among the next [x] hours
- Current price is at its highest among the next [x] hours
- Current price is [x] percent below today's average
- Current price is [x] percent above today's average
- Current price is [x] percent below average of the next [y] hours
- Current price is [x] percent above average of the next [y] hours
- Current price is one of the [x] lowest prices between [y] and [z]
- Current price is one of today's lowest [x] prices
- Current price is one of today's highest [x] prices &nbsp;

#### Actions

- Send push notification (through Tibber app)


### Device: _**Pulse**_ / _**Watty**_

#### Triggers

- Power changed
- Consumption since midnight changed
- Cost since midnight changed
- Daily consumption is reported

---

## Homey app API

The app provides an API that can be used by other Homey apps.

Your app can use the permission `homey:app:com.tibber` to request access to the Tibber app.
The following API endpoints can then be used:

- HTTP `GET /home-devices[?name=<string>]`

  List Home devices, optionally filtered by `name`
- HTTP `GET /pulse-devices[?name=<string>]`

  List Pulse/Watty devices, optionally filtered by `deviceId`
- HTTP `GET /home-device-data[?deviceId=<string>]`

  Read current device data

In addition, the app can publish real-time events for price and Pulse/Watty live measurement updates. Register the event with name `data-update-event` the following way to receive data updates:

```ts
  this.tibberAppApi = this.homey.api.getApiApp('com.tibber');
  this.tibberAppApi.on(
    'data-update-event',
    async (event, data) => {
      // ...
    });
```

---

## Contributing

Contributions are very welcome in the form of a pull request.
We cannot guarantee that all pull requests will be accepted (we have to balance individual users' needs and wants with the user base as a whole),
but we will do our best to review and work with you to get them in a good state and merge them.

Currently, our focus is very divided, and we may not be actively monitoring the repository activity on a daily basis, so please be patient if we don't respond immediately.

### Running the app locally

The app uses OAuth authentication with client ID and client secret. Since these are sensitive data,
it is not possible to run the app locally with the same authentication as the production app.

If you want to contribute, or just run your own fork of the app, you need to use your own personal access token
to be able to run the app on your Homey (either connected to a local computer, or over your LAN) while talking
to the Tibber API.

The process is as follows:

1. Create a personal access token at https://developer.tibber.com/
2. Create an `env.json` file in the root of the app
3. Paste the following:

   ```
     { "ACCESS_TOKEN": "..." }
   ```

   Where `...` is your personal access token.

Now the app uses your personal token for API access.

Note that `env.json` is in `.gitignore` so there should be no risk of mistakenly committing the file to the repository.

### Debugging

You can run the app in debug mode by setting the `DEBUG` environment variable to `tibber:*`.

### Running tests

Run `npm test` to run the test suite.

### ESLint

The project uses both ESLint and Prettier (as an ESLint plugin) for code formatting and linting. If you are making a PR, ensure to run this before requesting a review.

Run `npm run lint` to run ESLint.

## Release Notes

### 1.9.21

- Updated `cross-spawn` dependency
- Internal instrumentation change

### 1.9.20

- Imported/exported power accumulated capabilities
- Updated dependencies

#### 1.9.18

- Reintroduce changes from 1.9.0
- Reduce resource utilization
- Improve trigger reliability

#### 1.9.7

- Rollback nonfunctional changes

#### 1.9.6

- Revert caching

#### 1.9.4

- Performance improvements

#### 1.9.0

- Updated dependencies
- Added caching of yesterday's prices
- Added a new condition card: current price is one of the [x] lowest prices between [y] and [z]
- Added new icons
- Added source link to manifest
- Small API refactoring

#### 1.8.7

- Updated dependencies

#### 1.8.6

- Updated dependencies
- Updated required Homey version

#### 1.8.4

- Added fallback price currency EUR and areas BE, DE-LU, FI and NL
- Prices no longer have internally truncated decimals when updated, but are still shown with two decimals
- Updated dependencies

#### 1.8.3

- Properly clean up websockets on Homey Bridge

#### 1.8.2

- Improved real time device handling during startup and when device is removed from user's account

#### 1.8.1

- Fixed an error during test version package build

#### 1.8.0

- Improved websocket subscription handling
- Retrieve websocket subscription URL dynamically

#### 1.7.2

- Improved error handling

#### 1.7.1

- Added global tokens for lowest and highest price today
- Fixed timezone issue with price on Homey Bridge
- Updated dependencies

#### 1.6.2

- Automatically disable pulse/watty when paired home not present anymore

#### 1.6.1

- Instrumentation cleanup

#### 1.6.0

- Support for web socket sub protocol graphql-transport-ws

#### 1.5.14

- Fixed timezone issue fetching fallback Nord Pool price on Homey Bridge

#### 1.5.13

- Fixed device pairing not always working
- Fixed highest/lowest price cards not always working as intended
- Improved reliability of triggers/updates
- Improved reliability of fetching prices

#### 1.5.10

- Reverted to using 5 price levels
- Fixed price sometimes failing to update
- Show price device indicator with 2 decimals.
- Safer handling of current updates and triggers

#### 1.5.5

- Breaking change: Outdoor temperature capability for Home has been removed. Please use a separate weather app if you need temperature actions for your flows (there are plenty). Any flows that were using this need to be set up anew.
- Support for Homey Bridge
- Add trigger and condition for top/bottom X hours today
- Using updated price information from the Tibber API
- Fix parsing high prices

#### 1.4.13

- Bug fix for price fetch scheduling

#### 1.4.12

- Update readme to include price level trigger

#### 1.4.11

- Add price level capability automatically

#### 1.4.10

- Change price level to an enumeration

#### 1.4.9

- Deactivate device if home can't be found anymore. Add price level indicator. Fix current triggers
  for L2 and L3.

#### 1.4.8

- Fix push notification flow

#### 1.4.7

- Fix crash related to Pulse/Watty trigger registration

#### 1.4.6

- Update readme

#### 1.4.5

- Set description and support URL

#### 1.4.4

- Update readme

#### 1.4.3

- New triggers for currents reported by Pulse and Watty

#### 1.4.2

- Bug fix for keeping track of last logged daily consumption

#### 1.4.1

- Bug fix for calculating amount of hours to be fetched for consumption report

#### 1.4.0

- Rewrite of Tibber API data access to reduce load at hour shift
- Use a cache for day-ahead-prices for today and tomorrow
- Home non-real time consumption report is now enabled with an advanced parameter (default to false)
- Support for displaying real time current per phase for Pulse and Watty

#### 1.3.11

- Increase data fetch timeout. Fix data fetch retry logic.

#### 1.3.10

- New Dark Sky API key

#### 1.3.9

- Improved API request tracing

#### 1.3.8

- Improved query tracing

#### 1.3.7

- Increase GraphQL client timeout

#### 1.3.6

- Set timeout for GraphQl queries

#### 1.3.5

- Fix Tibber icon color dropped by homey cli

#### 1.3.4

- Avoid error in price triggers when last price is not populated

#### 1.3.3

- Logo and brand color

#### 1.3.2

- Tibber logo and brand color

#### 1.3.1

- Tibber logo and brand color

#### 1.3.0

- New Tibber logo

#### 1.2.7

- Allow production power being reported less frequently than power

#### 1.2.6

- Update measure_power even when it's 0 or same as previous

#### 1.2.5

- Support for retrieving production power from Pulse

#### 1.2.4

- Added a note about re-adding a Pulse/Watty device in case fetching data timeouts

#### 1.2.3

- Fixed fetching current temperature for home location

#### 1.2.2

- Bug fix for missing flow card id

#### 1.2.1

- Correct Watty images

#### 1.2.0

- Support for pairing Watty and bug fixes

#### 1.1.0

- Support for Energy API - Pulse and Watty show up as a cumulative devices in the Homey energy
  section

#### 1.0.12

- Fixed app crashing on API timeout (#14)

#### 1.0.10

- Fixed weather forecast (#13)
  &nbsp;

#### 1.0.9

- Fixed #12

#### 1.0.8

- Added 4 new trigger and 4 new condition cards for price at today's lowest/highest and above/below
  a set average
- Added fallback code for re-initiating Pulse subscription if no data for 10 minutes

#### 1.0.6

- Added condition cards for lowest/highest price among the next [x] hours
- Added cost calculation to Pulse for users without a (paying) subscription, based on Nord Pool
  prices. Note: Net spot prices/without any taxes, fees, etc.
- Minor fixes

#### 1.0.4

- Fixed flow triggers broken in 2.0

#### 1.0.3

- Registering capability value before triggering flow action (fixed issue #5)
  &nbsp;

#### 1.0.2

- Added support for Pulse without a (paying) subscription (N.B. cost is not available without
  subscription so accumulated cost will never have any value and cost related triggers will never
  fire)

#### 1.0.1

- Added trigger cards for lowest/highest price among the next [x] hours

#### 1.0.0

- Initial public version

### Known Issues

- Currently, the user's Tibber subscription needs to be confirmed or started to use the Tibber app.
