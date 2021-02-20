# Tibber

Integration with Tibber, with Pulse support!

&nbsp;
## Flow cards

### Device: *__Home__*
#### Triggers
- Price changed
- Temperature changed
- Current price is at today's lowest
- Current price is at today's highest
- Current price is at the lowest among the next [x] hours
- Current price is at the highest among the next [x] hours
- Current price is [x] percent below today's average
- Current price is [x] percent above today's average
- Current price is [x] percent below average of the next [y] hours
- Current price is [x] percent above average of the next [y] hours
- Current price is one of todays lowest [x] prices
- Current price is one of todays highest [x] prices
- Consumption report (triggers when new data is available, normally once a week. Every hour if you have a Pulse device)
&nbsp;
#### Conditions
- Current price below/above
- Outdoor temperature below/above
- Current price is at today's lowest
- Current price is at today's highest
- Current price is at the lowest among the next [x] hours
- Current price is at the highest among the next [x] hours
- Current price is [x] percent below today's average
- Current price is [x] percent above today's average
- Current price is [x] percent below average of the next [y] hours
- Current price is [x] percent above average of the next [y] hours
- Current price is one of todays lowest [x] prices
- Current price is one of todays highest [x] prices
&nbsp;
#### Actions
- Send push notification (through Tibber app)

&nbsp;
### Device: *__Pulse__*
#### Triggers
- Power changed
- Consumption since midnight changed
- Cost since midnight changed
- Daily consumption report

&nbsp;
### Release Notes

#### 1.2.5
- Support for retrieving production power from Pulse
#### 1.2.4
- Added a note about re-adding a Pulse/Watty device in case fetching data timeouts
#### 1.2.3
- Fixed fetching current temperature for home location
#### 1.2.2
- Bug fix for missing flowcard id
#### 1.2.1
- Correct Watty images
#### 1.2.0
- Support for pairing Watty and bug fixes
#### 1.1.0
- Support for Energy API - Pulse and Watty show up as a cumulative devices in the Homey energy section
#### 1.0.12
- Fixed app crashing on api timeout #14
&nbsp;
#### 1.0.10
- Fixed weather forecast (#13)
&nbsp;
#### 1.0.9
- Fixed #12
&nbsp;
#### 1.0.8
- Added 4 new trigger and 4 new condition cards for price at today's lowest/highest and above/below a set average
- Added fallback code for re-initiating Pulse subscription if no data for 10 minutes
&nbsp;
#### 1.0.6
- Added condition cards for lowest/highest price among the next [x] hours
- Added cost calculation to Pulse for users without a (paying) subscription, based on nordpool prices. Note: Net spot prices/without any taxes, fees, etc.
- Minor fixes
&nbsp;
#### 1.0.4
- Fixed flow triggers broken in 2.0
&nbsp;
#### 1.0.3
- Registering capability value before triggering flow action (fixed issue #5)
&nbsp;
#### 1.0.2
- Added support for Pulse without a (paying) subscription (N.B. cost is not available without subscription so accumulated cost will never have any value and cost related triggers will never fire)
&nbsp;
#### 1.0.1
- Added trigger cards for lowest/highest price among the next [x] hours
&nbsp;
#### 1.0.0
- Initial public version
&nbsp;
#### 1.2.0
- Bug fixes. Added Watty as a energy device.
