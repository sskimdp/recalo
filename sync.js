import { firebaseConfig } from './firebase-config.js';

// Firebase подключается только если заполнен firebase-config.js. Без него приложение
// работает как обычное локальное: ни одного сетевого запроса не уходит.
const SDK = 'https://www.gstatic.com/firebasejs/12.0.0/';
const EMAIL_KEY = 'recalo-sync-email';

export const isConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let sdk = null;
let app = null;
let auth = null;
let db = null;
let unsubscribeDoc = null;
let state = { status: 'off', email: null, error: null };
let listeners = [];

const notify = () => listeners.forEach((listener) => listener({ ...state }));
const setState = (patch) => { state = { ...state, ...patch }; notify(); };

export function onSyncState(listener) {
  listeners.push(listener);
  listener({ ...state });
  return () => { listeners = listeners.filter((item) => item !== listener); };
}

export const syncState = () => ({ ...state });

async function loadSdk() {
  if (sdk) return sdk;
  const [appModule, authModule, storeModule] = await Promise.all([
    import(`${SDK}firebase-app.js`),
    import(`${SDK}firebase-auth.js`),
    import(`${SDK}firebase-firestore.js`),
  ]);
  sdk = { ...appModule, ...authModule, ...storeModule };
  return sdk;
}

// onRemote получает { sets, deleted } из облака, push() отправляет местные данные.
export async function startSync({ onRemote, onMerged }) {
  if (!isConfigured()) return setState({ status: 'off' });
  setState({ status: 'connecting', error: null });
  try {
    const firebase = await loadSdk();
    app = app ?? firebase.initializeApp(firebaseConfig);
    auth = auth ?? firebase.getAuth(app);
    db = db ?? firebase.initializeFirestore(app, { localCache: firebase.persistentLocalCache({}) });

    // Возврат по ссылке из письма: адрес мы сохранили перед отправкой.
    if (firebase.isSignInWithEmailLink(auth, window.location.href)) {
      const email = localStorage.getItem(EMAIL_KEY) || window.prompt('Введите почту, на которую пришла ссылка') || '';
      if (email) {
        await firebase.signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem(EMAIL_KEY);
        history.replaceState(null, '', window.location.pathname);
      }
    }

    firebase.onAuthStateChanged(auth, (user) => {
      unsubscribeDoc?.();
      unsubscribeDoc = null;
      if (!user) return setState({ status: 'signed-out', email: null });
      setState({ status: 'syncing', email: user.email });
      const ref = firebase.doc(db, 'users', user.uid);
      unsubscribeDoc = firebase.onSnapshot(
        ref,
        (snapshot) => {
          const data = snapshot.data() ?? {};
          onRemote({ sets: data.sets ?? [], deleted: data.deleted ?? {} });
          setState({ status: 'ready', email: user.email, error: null });
          onMerged?.();
        },
        (error) => setState({ status: 'error', error: error.message }),
      );
    });
  } catch (error) {
    setState({ status: 'error', error: error.message });
  }
}

let pushTimer;
export function pushSets(sets, deleted) {
  if (state.status !== 'ready' && state.status !== 'syncing') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const firebase = await loadSdk();
      const user = auth?.currentUser;
      if (!user) return;
      await firebase.setDoc(firebase.doc(db, 'users', user.uid), { sets, deleted, updatedAt: Date.now() });
    } catch (error) {
      setState({ status: 'error', error: error.message });
    }
  }, 800);
}

export async function signIn(email) {
  const firebase = await loadSdk();
  localStorage.setItem(EMAIL_KEY, email);
  await firebase.sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true });
}

export async function signOutUser() {
  const firebase = await loadSdk();
  await firebase.signOut(auth);
}
