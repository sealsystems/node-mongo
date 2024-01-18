/* eslint-disable require-atomic-updates */
'use strict';

const { processenv } = require('processenv');
const tls = require('tls');

const tlscert = require('@sealsystems/tlscert');

const setTlsOptions = async function (options) {
  if (!options) {
    throw new Error('Options are missing.');
  }

  const tlsUnprotected = processenv('TLS_UNPROTECTED') || 'loopback';

  if (!processenv('MONGODB_FORCE_TLS') && tlsUnprotected !== 'none' && tlsUnprotected !== 'loopback') {
    return options;
  }

  const keystore = await tlscert.get();

  options.tls = true;

  if (keystore.ca) {
    const secureContext = tls.createSecureContext({
      ca: keystore.ca,
      cert: keystore.cert,
      key: keystore.key
    });
    options.secureContext = secureContext;
  }

  return options;
};

module.exports = setTlsOptions;
