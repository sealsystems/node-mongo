'use strict';

const { GridFSBucket, MongoClient } = require('mongodb');
const { parse } = require('mongodb-uri');
const retry = require('async-retry');

const log = require('@sealsystems/log').getLogger();

const setTlsOptions = require('./setTlsOptions');
const { processenv } = require('processenv');

const cachedConnections = {};
const mongo = {};

const faultTolerantConnect = async function (connectionString, options) {
  await setTlsOptions(options);
  const dbObjects = await retry(
    async () => {
      const mongoOptions = Object.assign(
        {},
        {
          useUnifiedTopology: true,
          useNewUrlParser: true,
          tlsAllowInvalidCertificates: processenv('NODE_TLS_REJECT_UNAUTHORIZED', '1') === 0
        },
        options
      );
      delete mongoOptions.connectionRetries;
      delete mongoOptions.waitTimeBetweenRetries;
      delete mongoOptions.noCursorTimeout;
      delete mongoOptions.collectionSize;
      delete mongoOptions.cacheTtl;

      const client = new MongoClient(connectionString, mongoOptions);
      await client.connect();
      const db = await client.db(parse(connectionString).database);
      return { db, client };
    },
    {
      // eslint-disable-next-line require-atomic-updates
      retries: (options.connectionRetries = options.connectionRetries >= 0 ? options.connectionRetries : 10),
      minTimeout: options.waitTimeBetweenRetries || 1 * 1000,
      maxTimeout: options.waitTimeBetweenRetries || 1 * 1000,
      factor: 1
    }
  );

  return dbObjects;
};

mongo.db = async function (connectionString, options = {}) {
  if (!connectionString) {
    throw new Error('Connection string is missing.');
  }

  if (cachedConnections[connectionString]) {
    return cachedConnections[connectionString];
  }

  const { db, client } = await faultTolerantConnect(connectionString, options);

  db.executeTransaction = async function (cb, transactionOptions) {
    transactionOptions = transactionOptions || {
      readPreference: 'primary',
      readConcern: { level: 'local' },
      writeConcern: { w: 'majority' }
    };

    const session = client.startSession();

    try {
      session.startTransaction(transactionOptions);

      await cb(session);

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  };

  if (db.gridfs) {
    throw new Error('Property gridfs already exists.');
  }

  db.sealOptions = {
    noCursorTimeout: options.noCursorTimeout
  };

  db.gridfs = function () {
    if (!db.gridfs.cachedfs) {
      db.gridfs.cachedfs = {
        bucket: new GridFSBucket(db),

        async findFile(fileName) {
          const cursor = db.gridfs.cachedfs.bucket.find({ filename: fileName });

          let file;

          try {
            file = await cursor.next();
          } finally {
            cursor.close();
          }

          return file;
        },

        async createReadStream(fileName, readOptions = {}) {
          if (!fileName) {
            throw new Error('Filename is missing.');
          }

          const mergedOptions = Object.assign({}, db.sealOptions, readOptions);
          let file;

          try {
            file = await db.gridfs.cachedfs.findFile(fileName);
          } catch (ex) {
            throw new Error('File not found');
          }

          if (!file) {
            throw new Error('File not found');
          }

          const stream = db.gridfs.cachedfs.bucket.openDownloadStreamByName(fileName);

          if (mergedOptions.noCursorTimeout) {
            stream.once('file', () => {
              if (stream.s && stream.s.cursor) {
                stream.s.cursor.addCursorFlag('noCursorTimeout', true);
              } else {
                log.error('Error setting "noCursorTimeout" flag.');
              }
            });
          }

          return { stream, metadata: file.metadata };
        },

        async createWriteStream(fileName, metadata) {
          if (!fileName) {
            throw new Error('Filename is missing.');
          }

          const stream = db.gridfs.cachedfs.bucket.openUploadStream(fileName, {
            metadata
          });

          stream.once('finish', () => {
            stream.emit('close');
          });

          return stream;
        },

        async setMetadata(fileName, metadata) {
          let file;

          try {
            file = await db.gridfs.cachedfs.findFile(fileName);
          } catch (ex) {
            throw new Error('File not found.');
          }

          if (!file) {
            throw new Error('File not found.');
          }

          const result = await db
            .collection('fs.files')
            .updateOne({ _id: file._id }, { $set: { metadata } }, { upsert: true });

          return result;
        },

        async exist(fileName) {
          if (!fileName) {
            throw new Error('Filename is missing.');
          }

          const cursor = db.gridfs.cachedfs.bucket.find({ filename: fileName });

          let resultHasNext;

          try {
            resultHasNext = await cursor.hasNext();
          } finally {
            cursor.close();
          }

          return resultHasNext;
        },

        async unlink(fileName) {
          if (!fileName) {
            throw new Error('Filename is missing.');
          }

          let file;

          try {
            file = await db.gridfs.cachedfs.findFile(fileName);
          } catch (ex) {
            throw new Error('File not found');
          }

          if (!file) {
            throw new Error('File not found');
          }

          await db.gridfs.cachedfs.bucket.delete(file._id);
        }
      };
    }

    return db.gridfs.cachedfs;
  };

  // eslint-disable-next-line require-atomic-updates
  cachedConnections[connectionString] = db;

  return db;
};

module.exports = mongo;
