'use client';
import { usePushNotifications } from '@/lib/usePushNotifications';

export default function PushNotificationSettings({ userId, customerId }) {
  const {
    supported,
    permission,
    loading,
    error,
    subscribe,
    unsubscribe,
    isSubscribed
  } = usePushNotifications(userId, customerId);

  if (!supported) {
    return (
      <div className="p-4 bg-gray-800 rounded-lg">
        <p className="text-gray-400 text-sm">
          Push-notiser stöds inte i denna webbläsare.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <h3 className="text-white font-medium mb-3">🔔 Push-notiser</h3>
      
      {error && (
        <p className="text-red-400 text-sm mb-3">{error}</p>
      )}

      {permission === 'denied' ? (
        <p className="text-yellow-400 text-sm">
          Du har blockerat notiser. Ändra i webbläsarens inställningar.
        </p>
      ) : isSubscribed ? (
        <div>
          <p className="text-green-400 text-sm mb-3">
            ✓ Notiser aktiverade
          </p>
          <button
            onClick={unsubscribe}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition disabled:opacity-50"
          >
            {loading ? 'Vänta...' : 'Stäng av notiser'}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-gray-400 text-sm mb-3">
            Få notis när kunder skriver eller bokar.
          </p>
          <button
            onClick={subscribe}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition disabled:opacity-50"
          >
            {loading ? 'Aktiverar...' : 'Aktivera notiser'}
          </button>
        </div>
      )}
    </div>
  );
}
