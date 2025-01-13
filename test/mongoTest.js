/* eslint-disable no-constant-condition */
/* eslint-disable no-async-promise-executor */
'use strict';

const crypto = require('crypto');
const fsProm = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');
const streamProm = require('node:stream/promises');

const assert = require('assertthat');
const { nodeenv } = require('nodeenv');
const proxyquire = require('proxyquire');
const { v4: uuidv4 } = require('uuid');

const mongo = require('../lib/mongo');

const MockMongoClient = function (urlString, options) {
  this.options = options;
  this.connect = async () => {
    // empty
  };
  this.db = async () => {
    return this.options;
  };
};

const mongoMock = proxyquire('../lib/mongo', {
  async './setTlsOptions'(options) {
    options.sslCA = ['ca'];
    options.sslCert = 'cert';
    options.sslKey = 'key';
    options.sslValidate = true;

    return options;
  },
  mongodb: {
    MongoClient: MockMongoClient
  }
});

const sleep = function (ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const connectionStringFoo = `mongodb://localhost:27017/foo`;
const connectionStringBar = `mongodb://localhost:27017/bar`;
const connectionStringBaz = `mongodb://localhost:27017/baz`;
const connectionStringGridfs = `mongodb://localhost:27017/grid`;
const connectionStringCursor = `mongodb://localhost:27017/cursor`;
let restore;

suite('mongo', () => {
  setup(async () => {
    restore = nodeenv({
      TLS_UNPROTECTED: 'world',
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    });
  });

  teardown(async () => {
    restore();
  });

  test('is an object.', async () => {
    assert.that(mongo).is.ofType('object');
  });

  suite('db', () => {
    test('is a function.', async () => {
      assert.that(mongo.db).is.ofType('function');
    });

    test('throws an exception if connection string is missing.', async () => {
      await assert
        .that(async () => {
          await mongo.db();
        })
        .is.throwingAsync('Connection string is missing.');
    });

    test('throws an error if the given MongoDB is not reachable.', async function () {
      this.timeout(10 * 1000);

      try {
        await mongo.db('mongodb://localhost:12345/foo', {
          connectionRetries: 1,
          waitTimeBetweenRetries: 1000,
          serverSelectionTimeoutMS: 500
        });
        throw new Error('X');
      } catch (err) {
        assert.that(err.name).is.startingWith('MongoServerSelectionError');
        // only for linux:
        // assert.that(err.message).is.containing('ECONNREFUSED');
      }
    });

    test('connectionRetries equals to 0 does try to connect only once.', async function () {
      this.timeout(10 * 1000);

      try {
        await mongo.db('mongodb://localhost:12345/foo', {
          connectionRetries: 0,
          waitTimeBetweenRetries: 1000,
          serverSelectionTimeoutMS: 500
        });
        throw new Error('X');
      } catch (err) {
        assert.that(err.name).is.startingWith('MongoServerSelectionError');
        // only for linux:
        // assert.that(err.message).is.containing('ECONNREFUSED');
      }
    });

    test('returns a reference to the database.', async function () {
      this.timeout(10 * 1000);
      const db = await mongo.db(connectionStringFoo);

      assert.that(db).is.ofType('object');
      assert.that(db.collection).is.ofType('function');
    });

    test('db returns MongoClient', async function () {
      this.timeout(10 * 1000);
      const db = await mongo.db(connectionStringFoo);

      assert.that(db).is.ofType('object');
      assert.that(db.getMongoClient).is.ofType('function');
      assert.that(db.getMongoClient()).is.ofType('object');
    });

    test('db returns mongodb module', async function () {
      this.timeout(10 * 1000);
      const db = await mongo.db(connectionStringFoo);

      assert.that(db).is.ofType('object');
      assert.that(db.getMongoModule().Long).is.ofType('function');
    });

    test('validates with given CA certificate.', async () => {
      const connectOptions = await mongoMock.db(connectionStringFoo);

      assert.that(connectOptions).is.ofType('object');
      assert.that(connectOptions.sslCA).is.equalTo(['ca']);
      assert.that(connectOptions.sslValidate).is.true();
      assert.that(connectOptions.tlsAllowInvalidCertificates).is.true();
    });

    test('does validate if not own self sign certificates.', async () => {
      restore = nodeenv('NODE_TLS_REJECT_UNAUTHORIZED', '2');
      const connectOptions = await mongoMock.db(connectionStringBaz);

      assert.that(connectOptions.tlsAllowInvalidCertificates).is.false();
      restore();
    });

    test('does validate cert is the default.', async () => {
      // eslint-disable-next-line no-process-env
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      const connectOptions = await mongoMock.db(connectionStringBaz);

      assert.that(connectOptions.tlsAllowInvalidCertificates).is.false();
    });

    test('returns the same reference if called twice with the same connection string.', async () => {
      const dbFirst = await mongo.db(connectionStringFoo);
      const dbSecond = await mongo.db(connectionStringFoo);

      assert.that(dbFirst).is.sameAs(dbSecond);
    });

    test('returns different references if called twice with different connection strings.', async () => {
      const dbFirst = await mongo.db(connectionStringFoo);
      const dbSecond = await mongo.db(connectionStringBar);

      assert.that(dbFirst).is.not.sameAs(dbSecond);
    });

    test('connects to database', async () => {
      const db = await mongo.db(connectionStringFoo);
      const coll = db.collection(uuidv4());

      await assert
        .that(async () => {
          await coll.insertOne({ foo: 'bar' });
        })
        .is.not.throwingAsync();
    });

    suite('gridfs', () => {
      test('is a function.', async () => {
        const db = await mongo.db(connectionStringFoo);

        assert.that(db.gridfs).is.ofType('function');
      });

      test('returns a reference to GridFS.', async () => {
        const db = await mongo.db(connectionStringFoo);

        const gridfs = db.gridfs();

        assert.that(gridfs).is.ofType('object');
        assert.that(gridfs.createReadStream).is.ofType('function');
      });

      test('returns a reference to files collection.', async () => {
        const db = await mongo.db(connectionStringFoo);

        const gridfs = db.gridfs();

        assert.that(gridfs).is.ofType('object');
        assert.that(gridfs.getFilesCollection).is.ofType('function');
        assert.that(gridfs.getFilesCollection()).is.ofType('object');
        assert.that(gridfs.getFilesCollection().aggregate).is.ofType('function');
        assert.that(gridfs.getFilesCollection().find).is.ofType('function');
        assert.that(gridfs.getFilesCollection().namespace).is.endingWith('fs.files');
      });

      test('returns a reference to chunks collection.', async () => {
        const db = await mongo.db(connectionStringFoo);

        const gridfs = db.gridfs();

        assert.that(gridfs).is.ofType('object');
        assert.that(gridfs.getFilesCollection).is.ofType('function');
        assert.that(gridfs.getChunksCollection()).is.ofType('object');
        assert.that(gridfs.getChunksCollection().aggregate).is.ofType('function');
        assert.that(gridfs.getChunksCollection().find).is.ofType('function');
        assert.that(gridfs.getChunksCollection().namespace).is.endingWith('fs.chunks');
      });

      test('Uses prefix for gridfs', async () => {
        const db = await mongo.db(connectionStringGridfs, { bucketName: 'foobar' });

        const gridfs = db.gridfs();

        assert.that(gridfs).is.ofType('object');
        assert.that(gridfs.getFilesCollection).is.ofType('function');
        assert.that(gridfs.getFilesCollection().namespace).is.endingWith('foobar.files');

        // write file and test if it is in the right collection
        const out = await gridfs.createWriteStream('hopperla');
        const prom = new Promise((resolve) => {
          out.once('close', resolve);
        });
        out.end('Hello, world!');
        await prom;
        assert.that(await gridfs.getFilesCollection().count()).is.greaterThan(0);
      });

      suite('createReadStream', () => {
        test('throws an error if filename is missing', async () => {
          const db = await mongo.db(connectionStringFoo);

          await assert
            .that(async () => {
              await db.gridfs().createReadStream();
            })
            .is.throwingAsync('Filename is missing.');
        });

        test('returns an error if file could not be opened', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();

          await assert
            .that(async () => {
              await gridfs.createReadStream(fileName);
            })
            .is.throwingAsync();
        });

        const writeBigFile = async function (fileName, sizeInMb) {
          const fileHandle = await fsProm.open(fileName, 'w', 0o666);
          for (let i = 0; i < sizeInMb; i++) {
            await fileHandle.write(crypto.randomBytes(1024 * 1024));
          }
          await fileHandle.close();
        };

        const compareFiles = async function (fname1, fname2) {
          const kReadSize = 1024 * 8;
          let h1, h2;
          try {
            h1 = await fsProm.open(fname1);
            h2 = await fsProm.open(fname2);
            const [stat1, stat2] = await Promise.all([h1.stat(), h2.stat()]);
            if (stat1.size !== stat2.size) {
              return false;
            }
            const buf1 = Buffer.alloc(kReadSize);
            const buf2 = Buffer.alloc(kReadSize);
            let pos = 0;
            let remainingSize = stat1.size;
            while (remainingSize > 0) {
              const readSize = Math.min(kReadSize, remainingSize);
              const [r1, r2] = await Promise.all([h1.read(buf1, 0, readSize, pos), h2.read(buf2, 0, readSize, pos)]);
              if (r1.bytesRead !== readSize || r2.bytesRead !== readSize) {
                throw new Error('Failed to read desired number of bytes');
              }
              if (buf1.compare(buf2, 0, readSize, 0, readSize) !== 0) {
                return false;
              }
              remainingSize -= readSize;
              pos += readSize;
            }
            return true;
          } finally {
            if (h1) {
              await h1.close();
            }
            if (h2) {
              await h2.close();
            }
          }
        };

        test('read/write big file data', async function () {
          this.timeout(20 * 1000);

          const dbFileName = uuidv4();
          const fileName = path.join(os.tmpdir(), dbFileName);
          const fileNameIn = `${fileName}.in`;
          const fileNameOut = `${fileName}.out`;
          try {
            const db = await mongo.db(connectionStringFoo);
            const gridfs = db.gridfs();

            await writeBigFile(fileNameIn, 200);

            const dbWriteStream = await gridfs.createWriteStream(dbFileName);
            const fsReadStream = await fs.createReadStream(fileNameIn);

            await streamProm.pipeline(fsReadStream, dbWriteStream);
            // Wait for a short amount of time to give MongoDB enough time to
            // actually save the file to GridFS.
            while (true) {
              await sleep(100);
              if (await gridfs.exist(dbFileName)) {
                break;
              }
              console.log('Waiting for file to be written...');
            }

            const { stream: dbReadStream } = await gridfs.createReadStream(dbFileName);
            const fsWriteStream = await fs.createWriteStream(fileNameOut);

            await streamProm.pipeline(dbReadStream, fsWriteStream);

            assert.that(await compareFiles(fileNameIn, fileNameOut)).is.true();
          } finally {
            try {
              await fsProm.unlink(fileNameIn);
            } catch {
              // ignore this
            }
            await fsProm.unlink(fileNameOut);
          }
        });

        test('reads file', async function () {
          this.timeout(10 * 1000);

          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';

          const writeStream = await gridfs.createWriteStream(fileName);

          writeStream.write(content);
          writeStream.end();

          await new Promise(async (resolve, reject) => {
            try {
              let result;

              for (let i = 0; i < 10; i++) {
                // Wait for a short amount of time to give MongoDB enough time to
                // actually save the file to GridFS.
                await sleep(0.1 * 1000);

                result = await gridfs.exist(fileName);
                if (result) {
                  // Write is complete. No need to re-check.
                  break;
                }
              }

              assert.that(result).is.true();

              const { stream } = await gridfs.createReadStream(fileName, { noCursorTimeout: true });

              stream.on('data', (chunk) => {
                try {
                  assert.that(chunk.toString()).is.equalTo(content);
                  // tests in data event, because cursor is created at first read
                  assert.that(stream.s.cursor.cursorOptions.noCursorTimeout).is.true();
                } catch (ex) {
                  reject(ex);
                }
              });
              stream.once('end', resolve);
            } catch (ex) {
              reject(ex);
            }
          });
        });

        test('sets cursor timeout', async function () {
          this.timeout(10 * 1000);

          const db = await mongo.db(connectionStringCursor, { noCursorTimeout: true });
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'jojojo';

          const writeStream = await gridfs.createWriteStream(fileName);

          writeStream.write(content);
          writeStream.end();

          await new Promise(async (resolve, reject) => {
            try {
              let result;

              for (let i = 0; i < 10; i++) {
                // Wait for a short amount of time to give MongoDB enough time to
                // actually save the file to GridFS.
                await sleep(0.1 * 1000);

                result = await gridfs.exist(fileName);
                if (result) {
                  // Write is complete. No need to re-check.
                  break;
                }
              }

              assert.that(result).is.true();

              const { stream } = await gridfs.createReadStream(fileName);

              // test for mongo client version
              assert.that(stream.s).is.ofType('object');

              stream.on('data', (chunk) => {
                try {
                  assert.that(stream.s.cursor).is.not.undefined();
                  assert.that(chunk.toString()).is.equalTo(content);
                  // tests in data event, because cursor is created at first read
                  assert.that(stream.s.cursor.cursorOptions.noCursorTimeout).is.true();
                } catch (ex) {
                  reject(ex);
                }
              });
              stream.once('end', resolve);
            } catch (ex) {
              reject(ex);
            }
          });
        });

        test('reads file with metadata', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';
          const writeMetadata = { foo: 'bar' };

          const writeStream = await gridfs.createWriteStream(fileName, writeMetadata);

          writeStream.write(content);
          writeStream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const result = await gridfs.exist(fileName);

          assert.that(result).is.true();

          await new Promise(async (resolve, reject) => {
            try {
              const { stream, metadata } = await gridfs.createReadStream(fileName);

              assert.that(metadata).is.equalTo({ foo: 'bar' });

              stream.on('data', (chunk) => {
                try {
                  assert.that(chunk.toString()).is.equalTo(content);
                } catch (ex) {
                  reject(ex);
                }
              });
              stream.once('end', resolve);
            } catch (ex) {
              reject(ex);
            }
          });
        });
      });

      suite('createWriteStream', () => {
        test('throws an error if filename is missing', async () => {
          const db = await mongo.db(connectionStringFoo);

          await assert
            .that(async () => {
              await db.gridfs().createWriteStream();
            })
            .is.throwingAsync('Filename is missing.');
        });

        test('writes file', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';

          const writeStream = await gridfs.createWriteStream(fileName);

          writeStream.write(content);
          writeStream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const result = await gridfs.exist(fileName);

          assert.that(result).is.true();

          await new Promise(async (resolve, reject) => {
            try {
              const { stream } = await gridfs.createReadStream(fileName);

              stream.on('data', (chunk) => {
                try {
                  assert.that(chunk.toString()).is.equalTo(content);
                } catch (ex) {
                  reject(ex);
                }
              });

              stream.once('end', resolve);
            } catch (ex) {
              reject(ex);
            }
          });
        });

        test('writes file with metadata', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';
          const writeMetadata = { foo: 'bar' };

          const writeStream = await gridfs.createWriteStream(fileName, writeMetadata);

          writeStream.write(content);
          writeStream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const result = await gridfs.exist(fileName);

          assert.that(result).is.true();

          await new Promise(async (resolve, reject) => {
            try {
              const { stream, metadata } = await gridfs.createReadStream(fileName);

              assert.that(metadata).is.equalTo({ foo: 'bar' });

              stream.on('data', (chunk) => {
                try {
                  assert.that(chunk.toString()).is.equalTo(content);
                } catch (ex) {
                  reject(ex);
                }
              });
              stream.once('end', resolve);
            } catch (ex) {
              reject(ex);
            }
          });
        });

        test('updates metadata', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';
          const writeStream = await gridfs.createWriteStream(fileName);

          writeStream.write(content);
          writeStream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const metadata = ['1', '2', '3'];
          const result = await gridfs.setMetadata(fileName, metadata);

          assert.that(result.acknowledged).is.true();
          assert.that(result.matchedCount).is.equalTo(1);

          const fileData = await gridfs.findFile(fileName);

          assert.that(fileData.metadata).is.equalTo(metadata);
        });
      });

      suite('exist', () => {
        test('throws an error if filename is missing', async () => {
          const db = await mongo.db(connectionStringFoo);

          await assert
            .that(async () => {
              await db.gridfs().exist();
            })
            .is.throwingAsync('Filename is missing.');
        });

        test('returns false if file does not exist', async () => {
          const db = await mongo.db(connectionStringFoo);
          const fileName = uuidv4();

          const result = await db.gridfs().exist(fileName);

          assert.that(result).is.false();
        });

        test('returns true if file exists', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';

          const stream = await gridfs.createWriteStream(fileName);

          stream.write(content);
          stream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const result = await gridfs.exist(fileName);

          assert.that(result).is.true();
        });
      });

      suite('unlink', () => {
        test('throws an error if filename is missing', async () => {
          const db = await mongo.db(connectionStringFoo);

          await assert
            .that(async () => {
              await db.gridfs().unlink();
            })
            .is.throwingAsync('Filename is missing.');
        });

        test('unlinks file', async () => {
          const db = await mongo.db(connectionStringFoo);
          const gridfs = db.gridfs();

          const fileName = uuidv4();
          const content = 'hohoho';

          const stream = await gridfs.createWriteStream(fileName);

          stream.write(content);
          stream.end();

          // Wait for a short amount of time to give MongoDB enough time to
          // actually save the file to GridFS.
          await sleep(0.1 * 1000);

          const result = await gridfs.exist(fileName);

          assert.that(result).is.true();

          await gridfs.unlink(fileName);

          const result2 = await gridfs.exist(fileName);

          assert.that(result2).is.false();
        });
      });
    });

    suite('executeTransaction', () => {
      test('is a function.', async () => {
        const db = await mongo.db(connectionStringFoo);

        assert.that(db.executeTransaction).is.ofType('function');
      });

      test('calls callback function.', async () => {
        const db = await mongo.db(connectionStringFoo);

        let session;
        db.executeTransaction((_session) => {
          session = _session;
        });

        assert.that(session).is.ofType('object');
      });
    });
  });
});
