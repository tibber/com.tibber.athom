// eslint-disable-next-line @typescript-eslint/no-var-requires,import/no-unresolved
const Homey = require('homey');
/**
 * New Relic agent configuration.
 *
 * See lib/config/default.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: ['Athom Homey App'],
  /**
   * Your New Relic license key.
   */
  license_key: Homey.env.NEW_RELIC_LICENCE_KEY,

  logging: {
    enabled: false,
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'info',
    filepath: 'stdout',
    diagnostics: false,
  },
  agent_enabled: true,

  /**
   * When true, all request headers except for those listed in attributes.exclude
   * will be captured for all traces, unless otherwise specified in a destination's
   * attributes include/exclude lists.
   */
  allow_all_headers: true,
  distributed_tracing: {
    enabled: true,
  },
  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end.
     *
     * NOTE: If excluding headers, they must be in camelCase form to be filtered.
     *
     * @env NEW_RELIC_ATTRIBUTES_EXCLUDE
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*',
    ],
  },
  // serverless_mode: { enabled: true },
  plugins: {
    /**
     * Controls usage of the native metrics module which samples VM and event
     * loop data.
     */
    native_metrics: { enabled: false },
  },
};
