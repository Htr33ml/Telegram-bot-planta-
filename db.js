// db.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');  // Coloque esse arquivo na raiz

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = db;
