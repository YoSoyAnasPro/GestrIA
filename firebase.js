const admin = require('firebase-admin');

let db;

function getDb() {
  if (!db) {
    let config;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      config = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      try {
        config = require('./firebase-config.json');
      } catch {
        throw new Error('No se encontró firebase-config.json ni la variable FIREBASE_SERVICE_ACCOUNT');
      }
    }
    admin.initializeApp({ credential: admin.credential.cert(config) });
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
