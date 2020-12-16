const   gql                     = require('graphql-tag');

module.exports = {
    getHomesQuery: getHomesQuery,
    getPriceQuery: getPriceQuery,
    getConsumptionQuery: getConsumptionQuery,
    getPushMessage: getPushMessage,
    getSubscriptionQuery: getSubscriptionQuery
};

function getHomesQuery() {
    return `{
      viewer {
        homes {
          id
          timeZone
          address {
            address1
            postalCode
            city
            latitude
            longitude
          }
          features {
            realTimeConsumptionEnabled
          }
          currentSubscription {
            status
          }
        }
      }
    }`;
}

function getPriceQuery(homeId) {
  return `{
        viewer {
          home(id:"${homeId}") {
            currentSubscription {
              status
              priceInfo {
                current {
                  total
                  energy
                  tax
                  startsAt
                  level
                }
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
  }`;
}

function getConsumptionQuery(homeId, daysToFetch, hoursToFetch) {
    return `{
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
    }`;
}

function getPushMessage(title, message) {
    return `mutation{
        sendPushNotification(input: {
            title: "${title}",
                message: "${message}",
                screenToOpen: CONSUMPTION
        }){
            successful
            pushedToNumberOfDevices
        }
    }`;
}

function getSubscriptionQuery(homeId) {
    return gql`
        subscription{
              liveMeasurement(homeId:"${homeId}"){
                timestamp
                power
                accumulatedConsumption
                accumulatedCost
                currency
                minPower
                averagePower
                maxPower
                powerProduction
                currentL1
                currentL2
                currentL3
              }
            }`;
}
