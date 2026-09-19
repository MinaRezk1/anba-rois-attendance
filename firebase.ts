import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import firebaseConfig from "./firebase-applet-config.json";

// The config will have firestoreDatabaseId which needs to be removed from config if we are connecting usually, 
// wait, firestore uses databaseid as the second param for getFirestore ? No, in firebase web SDK v9+ it's not automatically used if provided in initializeApp. Wait, maybe we need to pass databaseId to initializeFirestore or something.
// Actually firebaseConfig from json:
// projectId, appId, apiKey, authDomain, firestoreDatabaseId...
// getFirestore(app) uses (default) database unless specified. 
// Let's use getFirestore(app, firebaseConfig.firestoreDatabaseId) maybe?
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
