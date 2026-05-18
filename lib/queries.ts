import gql from 'graphql-tag';

export const queries = {
  getHomesQuery: () => `{
      viewer {
        homes {
          id
          timeZone
          address {
            address1
            postalCode
            city
          }
          features {
            realTimeConsumptionEnabled
          }
          currentSubscription {
            status
          }
        }
        websocketSubscriptionUrl
      }
    }`,

  getHomeFeaturesByIdQuery: (homeId: string) => `{
      viewer {
        home(id:"${homeId}") {
          features {
            realTimeConsumptionEnabled
          }
        }
        websocketSubscriptionUrl
      }
    }`,

  getPriceQuery: (homeId: string) => `{
      viewer {
        home(id:"${homeId}") {
          currentSubscription {
            priceInfo(resolution: QUARTER_HOURLY) {
              today {
                total
                energy
                tax
                startsAt
                level
              }
              tomorrow {
                total
                energy
                tax
                startsAt
                level
              }
            }
          }
        }
      }
    }`,

  getConsumptionQuery: (
    homeId: string,
    daysToFetch: number,
    hoursToFetch: number,
  ) => `{
      viewer {
        home(id:"${homeId}") {
          daily: consumption(resolution: DAILY, last: ${daysToFetch}) {
            nodes {
              from
              to
              totalCost
              unitCost
              unitPrice
              unitPriceVAT
              consumption
              consumptionUnit
            }
          },
          hourly: consumption(resolution: HOURLY, last: ${hoursToFetch}) {
            nodes {
              from
              to
              totalCost
              consumption
            }
          }
        }
      }
    }`,

  getPushMessage: (title: string, message: string) => `mutation{
      sendPushNotification(input: {
        title: "${title}",
          message: "${message}",
          screenToOpen: CONSUMPTION
      }){
        successful
        pushedToNumberOfDevices
      }
    }`,

  getSubscriptionQuery: (homeId: string) => gql`subscription{
      liveMeasurement(homeId:"${homeId}"){
        timestamp
        power
        accumulatedConsumption
        accumulatedCost
        accumulatedProduction
        accumulatedReward
        lastMeterConsumption
        lastMeterProduction
        currency
        minPower
        averagePower
        maxPower
        powerProduction
        currentL1
        currentL2
        currentL3
      }
    }`,
};
