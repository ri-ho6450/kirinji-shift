import { useSyncExternalStore } from 'react';
import { subscribeSyncStatus, getSyncStatus } from './firebase';

export function SyncStatus() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const labels = {
    connecting: 'Firebase 接続待ち・キャッシュ表示',
    synced: 'Firebase 同期済み',
    pending: '変更を送信中',
    error: 'Firebase 接続エラー：環境の通信許可・アクセス権を確認してください',
  };
  return <div role="status" className="print:hidden fixed bottom-2 right-3 z-[100] rounded-lg border border-slate-200 bg-white/95 px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm">{labels[status]}</div>;
}
