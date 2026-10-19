import { useCallback } from 'react';
import api from '../api';
import usePolling from '../hooks/usePolling';
import './SensorHealthBanner.css';

/* Alerte capteurs pendant la campagne : capteur CO2 absent, desappaire,
   muet ou sans piece. Sans elle, une campagne peut se terminer sans CO2
   sans que personne ne s'en rende compte. */
export default function SensorHealthBanner({ onRequestConfig, onShowNetwork }) {
  const { data } = usePolling(
    useCallback(() => api.get('/api/sensors/health'), []),
    5 * 60 * 1000
  );

  if (!data?.issues?.length) return null;
  const hasError = data.issues.some((i) => i.level === 'error');

  return (
    <div className={`sensor-health ${hasError ? 'sensor-health-error' : 'sensor-health-warning'}`} role="alert">
      <div className="sensor-health-title">
        {hasError ? 'Mesures manquantes' : 'Capteurs a verifier'}
      </div>
      <ul className="sensor-health-list">
        {data.issues.map((i) => (
          <li key={`${i.code}_${i.sensor || ''}`}>{i.message}</li>
        ))}
      </ul>
      {onShowNetwork && (
        <button type="button" className="sensor-health-btn" onClick={onShowNetwork}>
          Voir le reseau Zigbee
        </button>
      )}
      {onRequestConfig && (
        <button type="button" className="sensor-health-btn" onClick={onRequestConfig}>
          Ouvrir la configuration
        </button>
      )}
    </div>
  );
}
