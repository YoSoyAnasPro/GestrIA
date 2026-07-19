const admin = require('firebase-admin');

let db;

function getDb() {
  if (!db) {
    let config;
    if (process.env.FIREBASE_PROJECT_ID) {
      config = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || '',
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID || '',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`
      };
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        config = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (config.private_key) config.private_key = config.private_key.replace(/\\n/g, '\n');
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT no es JSON válido');
      }
    } else {
      try {
        config = require('./firebase-config.json');
      } catch {
        throw new Error('Configura las variables de entorno de Firebase en Vercel');
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
