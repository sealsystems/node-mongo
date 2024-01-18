'use strict';

const assert = require('assertthat');
const { nodeenv } = require('nodeenv');
const proxyquire = require('proxyquire');

const tlsCert = require('@sealsystems/tlscert');

let keystore;

const setTlsOptions = proxyquire('../lib/setTlsOptions', {
  '@sealsystems/tlscert': {
    async get() {
      return keystore;
    }
  }
});

suite('setTlsOptions', () => {
  setup(async () => {
    keystore = await tlsCert.get();
    keystore.ca = keystore.cert;
  });

  test('is a function', async () => {
    assert.that(setTlsOptions).is.ofType('function');
  });

  test('throws an error if options are missing.', async () => {
    await assert
      .that(async () => {
        await setTlsOptions();
      })
      .is.throwingAsync('Options are missing.');
  });

  test("does not set TLS options if TLS_UNPROTECTED is set to 'world'.", async () => {
    const options = { foo: 'bar' };
    const restore = nodeenv('TLS_UNPROTECTED', 'world');

    await setTlsOptions(options);
    assert.that(options).is.equalTo({ foo: 'bar' });

    restore();
  });

  test("does not set TLS options if TLS_UNPROTECTED is set to 'dc'.", async () => {
    const options = { foo: 'bar' };
    const restore = nodeenv('TLS_UNPROTECTED', 'dc');

    await setTlsOptions(options);
    assert.that(options).is.equalTo({ foo: 'bar' });

    restore();
  });

  test('sets TLS option if MONGODB_FORCE_TLS is given regardless of TLS_UNPROTECTED option.', async () => {
    const options = { foo: 'bar' };
    const restore = nodeenv({ TLS_UNPROTECTED: 'world', MONGODB_FORCE_TLS: 'true' });

    await setTlsOptions(options);

    assert.that(options.tls).is.true();

    restore();
  });

  test('enforces TLS encryption by default.', async () => {
    const options = { foo: 'bar' };
    const restore = nodeenv('TLS_UNPROTECTED', null);

    await setTlsOptions(options);

    assert.that(options.tls).is.true();

    restore();
  });

  test('returns CA certificate, client certificate and key.', async () => {
    const options = {};
    const restore = nodeenv('TLS_UNPROTECTED', null);

    await setTlsOptions(options);

    assert.that(options.secureContext).is.ofType('object');

    restore();
  });

  test('does not provide certificates for client authentication if CA certificate is missing.', async () => {
    const options = {};
    const restore = nodeenv('TLS_UNPROTECTED', null);

    keystore = { cert: 'cert', key: 'key' };

    await setTlsOptions(options);

    assert.that(options).is.equalTo({ tls: true });

    restore();
  });
});
