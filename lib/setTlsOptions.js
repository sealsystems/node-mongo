/* eslint-disable require-atomic-updates */
'use strict';

const { processenv } = require('processenv');

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

  options.ssl = true;

  if (keystore.ca) {
    options.sslCA = [keystore.ca];
    options.sslCert = keystore.cert;
    options.sslKey = keystore.key;
    options.sslValidate = true;
  }

  return options;
};

module.exports = setTlsOptions;
