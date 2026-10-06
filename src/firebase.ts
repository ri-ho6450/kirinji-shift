import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, onSnapshot as firestoreOnSnapshot,
} from 'firebase/firestore';
import bundledConfig from '../firebase-applet-config.json';

// Firebase web configuration is public project metadata, not a server credential.
// VITE_FIREBASE_CONFIG overrides the entire configuration for a separate project.
const config = import.meta.env.VITE_FIREBASE_CONFIG
  ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG)
  : bundledConfig;
const app = initializeApp(config);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, config.firestoreDatabaseId || '(default)');

// Test instances use a demo project and never connect to the production database.
if (import.meta.env.VITE_FIRESTORE_EMULATOR_HOST) {
  if (!config.projectId.startsWith('demo-')) throw new Error('エミュレーターではdemo-プロジェクトを使用してください。');
  const [host, port] = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}
export {
  collection, query, where, doc, setDoc, deleteDoc, updateDoc,
  getDoc, getDocs, getDocsFromServer, waitForPendingWrites, writeBatch, orderBy, limit,
} from 'firebase/firestore';
export type { User } from 'firebase/auth';

type SyncState = 'connecting' | 'synced' | 'pending' | 'error';
const observations = new Map<symbol, SyncState>();
const statusListeners = new Set<() => void>();
export const getSyncStatus = (): SyncState => {
  const states = [...observations.values()];
  if (states.includes('error')) return 'error';
  if (states.includes('pending')) return 'pending';
  if (!states.length || states.includes('connecting')) return 'connecting';
  return 'synced';
};
export const subscribeSyncStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
};
const notifyStatus = () => statusListeners.forEach(listener => listener());
export function onSnapshot(ref: any, callback: (snapshot: any) => void) {
  const id = Symbol();
  observations.set(id, 'connecting');
  notifyStatus();
  const unsubscribe = firestoreOnSnapshot(ref, { includeMetadataChanges: true }, (snapshot: any) => {
    observations.set(id, snapshot.metadata.hasPendingWrites ? 'pending' : snapshot.metadata.fromCache ? 'connecting' : 'synced');
    notifyStatus();
    callback(snapshot);
  }, (error) => {
    observations.set(id, 'error');
    notifyStatus();
    console.error('Firestore subscription failed:', error.code);
  });
  return () => {
    unsubscribe();
    observations.delete(id);
    notifyStatus();
  };
}
