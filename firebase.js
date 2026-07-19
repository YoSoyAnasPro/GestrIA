const admin = require('firebase-admin');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    const serviceAccount = require(path.join(__dirname, 'firebase-config.json'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

function getAdmin() {
  getDb();
  return admin;
}

module.exports = { getDb, getAdmin };
