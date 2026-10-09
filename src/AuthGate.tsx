import { useEffect, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth, allowedUid, demoUiMode, db, waitForPendingWrites } from './firebase';
import App from './App';
import { SyncStatus } from './SyncStatus';

export function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => onAuthStateChanged(auth, value => {
    setUser(value);
    setReady(true);
  }), []);
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
      if (result.user.uid !== allowedUid) {
        await signOut(auth);
        setError('このアカウントには利用権限がありません。共用アカウントでログインしてください。');
      }
    } catch {
      setError('ログインできません。メールアドレス・パスワードとインターネット接続を確認してください。');
    } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([waitForPendingWrites(db), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('pending')), 15000);
      })]);
      await signOut(auth);
    } catch {
      setError('変更の送信を確認できません。接続を確認してからログアウトしてください。');
    } finally { clearTimeout(timer); setBusy(false); }
  }
  if (demoUiMode) return <><App /><SyncStatus /></>;
  if (!ready) return <p className="p-8">ログイン状態を確認中…</p>;
  if (user?.uid === allowedUid) return <>
    <div className="fixed bottom-2 left-2 z-50 flex max-w-[70vw] flex-wrap items-center gap-3 rounded border bg-white px-3 py-2 text-xs shadow print:hidden">
      {error && <span role="alert" className="text-red-700">{error}</span>}
      <span>共用アカウントでログイン中</span>
      <button disabled={busy} onClick={logout} className="rounded border px-3 py-1">{busy ? '送信確認中…' : 'ログアウト'}</button>
    </div>
    <App /><SyncStatus />
  </>;
  return <main className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
    <form onSubmit={login} className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow">
      <h1 className="text-xl font-bold">キリンジ シフト・作業割当 ログイン</h1>
      <p>登録した共用アカウントでログインしてください。</p>
      <label className="block">メールアドレス<input className="mt-1 w-full rounded border p-2" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block">パスワード<input className="mt-1 w-full rounded border p-2" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {(error || user) && <p role="alert" className="text-red-700">{error || 'このアカウントには利用権限がありません。'}</p>}
      <button className="w-full rounded bg-blue-700 p-3 text-white" disabled={busy}>{busy ? 'ログイン中…' : 'ログイン'}</button>
    </form>
  </main>;
}
