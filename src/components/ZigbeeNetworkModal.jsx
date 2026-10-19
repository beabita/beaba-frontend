import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import usePolling from '../hooks/usePolling';
import './ZigbeeNetworkModal.css';

/* Apercu du reseau Zigbee : chaque appareil appaire dans zigbee2mqtt,
   croise avec ce qui est declare dans la campagne. Un capteur appaire
   mais non declare voit ses mesures ignorees : c'est ce que cet ecran
   doit rendre visible. */

const KIND_LABEL = { co2: 'CO2', temp: 'Temperature', plug: 'Prise', other: 'Autre' };

const STATUS = {
  missing:    { label: 'Absent du reseau', hint: 'Declare dans Beaba mais plus appaire : aucune mesure possible.' },
  undeclared: { label: 'Non declare',      hint: 'Appaire mais pas declare dans la campagne : ses mesures sont ignorees.' },
  silent:     { label: 'Muet',             hint: "Appaire mais n'envoie plus rien." },
  waiting:    { label: 'En attente',       hint: 'Aucun message depuis le redemarrage du boitier.' },
  ok:         { label: 'OK',               hint: 'Appaire, declare et actif.' },
};

function timeAgo(iso) {
  if (!iso) return 'jamais';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "a l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

function signalLevel(lqi) {
  if (lqi == null) return null;
  if (lqi >= 100) return 'good';
  if (lqi >= 50) return 'fair';
  return 'poor';
}

export default function ZigbeeNetworkModal({ onClose }) {
  const { data, error, loading, refresh } = usePolling(
    useCallback(() => api.get('/api/zigbee/overview'), []),
    30 * 1000
  );
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Redemande la liste a zigbee2mqtt puis recharge l'apercu
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/api/zigbee/devices/refresh');
      await new Promise((r) => setTimeout(r, 1500));
    } catch { /* on recharge quand meme */ }
    refresh();
    setRefreshing(false);
  };

  const devices = data?.devices || [];
  const counts = data?.counts || {};
  const problems = (counts.missing || 0) + (counts.undeclared || 0) + (counts.silent || 0);

  return (
    <div className="zbn-overlay" onClick={onClose}>
      <div className="zbn-modal" role="dialog" aria-label="Reseau Zigbee" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="zbn-close" onClick={onClose} aria-label="Fermer">×</button>

        <div className="zbn-head">
          <div>
            <h3>Reseau Zigbee</h3>
            <p className="zbn-sub">
              {data?.campaign
                ? <>Compare a la campagne <strong>{data.campaign.household}</strong>{data.campaign.status === 'completed' ? ' (terminee)' : ''}</>
                : 'Aucune campagne : tous les appareils apparaissent non declares.'}
            </p>
          </div>
          <button type="button" className="zbn-refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Actualisation...' : 'Rafraichir'}
          </button>
        </div>

        {data && (
          <div className="zbn-counts">
            {['missing', 'undeclared', 'silent', 'waiting', 'ok'].filter((s) => counts[s]).map((s) => (
              <span key={s} className={`zbn-pill zbn-st-${s}`} title={STATUS[s].hint}>
                {counts[s]} {STATUS[s].label.toLowerCase()}
              </span>
            ))}
          </div>
        )}

        {data && problems > 0 && (
          <p className="zbn-advice">
            {counts.undeclared > 0 && 'Un appareil non declare doit etre ajoute a la campagne (Ajouter des appareils) pour que ses mesures soient conservees. '}
            {counts.missing > 0 && "Un appareil absent doit etre reappaire dans zigbee2mqtt (bouton maintenu 5 s pendant l'appairage). "}
            {counts.silent > 0 && "Un appareil muet a peut-etre la pile vide ou est hors de portee."}
          </p>
        )}

        {loading && !data && <p className="zbn-empty">Chargement...</p>}
        {error && !data && <p className="zbn-empty zbn-error">Impossible de charger l'etat du reseau.</p>}
        {data && !data.list_known && (
          <p className="zbn-empty zbn-error">
            Le boitier n'a pas encore recu la liste des appareils de zigbee2mqtt. Cliquez sur Rafraichir ;
            si rien n'apparait, zigbee2mqtt est peut-etre arrete.
          </p>
        )}

        {devices.length > 0 && (
          <div className="zbn-table-wrap">
            <table className="zbn-table">
              <thead>
                <tr>
                  <th>Statut</th>
                  <th>Appareil</th>
                  <th>Type</th>
                  <th>Declare comme</th>
                  <th>Dernier message</th>
                  <th>Signal</th>
                  <th>Batterie</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const sig = signalLevel(d.linkquality);
                  return (
                    <tr key={d.ieee_address || d.friendly_name}>
                      <td>
                        <span className={`zbn-pill zbn-st-${d.status}`} title={STATUS[d.status]?.hint}>
                          {STATUS[d.status]?.label || d.status}
                        </span>
                      </td>
                      <td>
                        <div className="zbn-name">{d.friendly_name}</div>
                        {(d.vendor || d.model) && (
                          <div className="zbn-meta">{[d.vendor, d.model].filter(Boolean).join(' ')}</div>
                        )}
                      </td>
                      <td>{KIND_LABEL[d.kind] || d.kind}</td>
                      <td>
                        {d.declared
                          ? <>{d.declared.name}<div className="zbn-meta">{d.declared.room || 'sans piece'}</div></>
                          : <span className="zbn-muted">—</span>}
                      </td>
                      <td title={d.last_seen ? new Date(d.last_seen).toLocaleString('fr-BE') : undefined}>
                        {timeAgo(d.last_seen)}
                      </td>
                      <td>
                        {sig ? <span className={`zbn-sig zbn-sig-${sig}`}>{d.linkquality}</span> : <span className="zbn-muted">—</span>}
                      </td>
                      <td>{d.battery != null ? `${d.battery} %` : <span className="zbn-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <p className="zbn-foot">
            Muet = aucun message depuis {data.silent_after_min} min. Le signal (LQI) va de 0 a 255 ;
            sous 50, la liaison est fragile. Mise a jour automatique toutes les 30 s.
          </p>
        )}
      </div>
    </div>
  );
}
