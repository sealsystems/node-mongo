# @sealsystems/mongo ![Master](https://github.com/sealsystems/node-mongo/workflows/Master/badge.svg)

@sealsystems/mongo makes it easy to connect to MongoDB reliably.

## Installation

```shell
$ npm install @sealsystems/mongo
```

## Quick start

First you need to add a reference to @sealsystems/mongo to your application:

```javascript
const mongo = require('@sealsystems/mongo');
```

Then you can use its `db` function to connect to a MongoDB server. Provide the connection string as parameter:

```javascript
const db = await mongo.db('mongodb://localhost:27017/mydb', options);
```

If no connection can be established, @sealsystems/mongo retries to connect ten times, with a pause of 1 second between two connection attempts.

If you need to pass options to the MongoDB connection, e.g. for setting write concerns, provide an additional `options` object. For details see the [MongoClient.connect documentation](http://mongodb.github.io/node-mongodb-native/api-generated/mongoclient.html#mongoclient-connect). Additionally the following options can be set:

- `connectionRetries` is the number of retries to connect to MongoDB server, a value of 0 tries to connect only once without retries, default is 10.
- `waitTimeBetweenRetries` is the time in milliseconds waiting between the retries, default is 1000 ms.
- `noCursorTimeout` boolean, a true value is indicating that read stream cursors created by subsequent calls to `createReadStream` are not closed automatically after a timeout.

```javascript
const db = await mongo.db('mongodb://localhost:27017/mydb', {
  connectionRetries: 1
  // ...
});
```

Now you can use the `db` object to access the database. Please note that this is the very same object as the one that the [node-mongodb-native driver](http://mongodb.github.io/node-mongodb-native/) provides.

*Please note that if you call `db` twice with the same connection string, both calls will use the same underlying connection.*

## Transactions
`db` has a method `executeTransaction` to execute a transaction. In the callback method you get the session object associated with the transaction for use in your DB calls.
```javascript
try {
  await db.executeTransaction(async (session) => {
    // do whatever you want within the transaction
    await myCollection1.findOneAndUpdate(
      { // my filter
        $and: [{ _id: 'blabla' }, { status: 'blubb' }]
      },
      { // my set
        $set: { status: 'lalelu' }
      },
      { // my properties
        returnDocument: 'after',
        session // don't forget the session
      }
    );
    await myCollection2.insertOne(
      { // my new doc
        _id: uuid()
      },
      { // my properties
        returnDocument: 'after',
        session // don't forget the session
      }
    );
  });
} catch (err) {
  console.log('Error in transaction - aborting', { err });
  throw err;
}
```

## Accessing GridFS

If you need to access GridFS, simply call the `db` object's `gridfs` function.

```javascript
const gridfs = db.gridfs();
```

### gridfs.createReadStream

createReadStream(fileName, options)

- fileName `String` Name of the file to read

The optional options object overrides the default settings set in `db` and may contain:

- `noCursorTimeout` boolean, true is indicating that the read stream cursor created by `createReadStream` is not closed automatically after a timeout.

Opens the file `fileName` for reading and returns as soon the file is opened. The functions returns the data of the file as a `Readable` stream as well as its metadata:

```javascript
const { stream, metadata } = await gridfs.createReadStream('My file.txt');

const chunk = stream.read();
```

### gridfs.createWriteStream

createWriteStream(fileName, metadata)

- fileName `String` Name of the file to write
- metadata `Object` Optional metadata, can be left out

Opens the file `fileName` for writing and returns as soon as the file is opened. The content of the file can be written with the `Writable` stream that is returned. The stream emits a `close` event when all data is written and the file is closed.

**Please note:** The file content is not fully written when the `finish` event occurs. So, do not rely on it.

```javascript
const stream = await gridfs.createWriteStream('My file.txt', { foo: 'bar' });

stream.on('close', (err) => {
  if (err) {
    // Handle error on file close
  }
});

stream.write('Hello World');
stream.end();
```

### gridfs.exist

exist(fileName)

- fileName `String` Name of the file to check

Checks if file `fileName` does exist. If the function returns false the file does not exist, otherwise it exists.

```javascript
const doesExist = await gridfs.exist('My file.txt');

if (doesExist) {
  // File does exist
} else {
  // File does not exist
}
```

### gridfs.unlink

unlink(fileName)

- fileName `String` Name of the file to delete

Deletes the file `fileName`. The returned value indicates whether the file did exist or not.

```javascript
const fileFound = await gridfs.unlink('My file.txt');

if (fileFound) {
  // File did exist and has been removed
} else {
  // File does not exist
}
```

## TLS

The module uses [@sealsystems/tlscert](https://github.com/sealsystems/tlscert) to obtain certificates for an encrypted connection to the database.
The connection will only be encrypted if `TLS_UNPROTECTED` is set to `none` or `loopback`. Otherwise it is assumed that an unencrypted connection
is save. If `@sealsystems/tlscert` provides a CA certificate, the host's certificate will be transmitted to the database server in order to allow
client verification.

To always enforce TLS encrypted connections to MongoDB, regardless of the value of `TLS_UNPROTECTED`, you can set `MONGODB_FORCE_TLS`to `true`.

The MongoDB client option `tlsAllowInvalidCertificates` will be set according to `NODE_TLS_REJECT_UNAUTHORIZED`, so if invalid TLS certificates
are allowed for NodeJS it's also allowd for MongoDB.

## Running the build

To build this module use [roboter](https://www.npmjs.com/package/roboter).

```shell
$ bot
```

## Test Hint

For testing start own mongo without ssl. Add the `--replSet rs` option if you want a replication set:

```bash
docker run -d --name db -p 27017:27017 mongo:3.6.17 --replSet rs
```

In case of a replication set you need to initialize it:

```bash
docker exec -it db mongo --eval 'rs.initiate()'
```

Run tests

```bash
npm run test
```
