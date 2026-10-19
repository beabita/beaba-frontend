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

const PAIR_SECONDS = 254;

// A transmettre a la personne sur place (SMS, telephone...)
const ONSITE_STEPS = [
  "Approchez l'appareil a moins de 2 metres du boitier Beaba.",
  "Maintenez son bouton enfonce environ 5 secondes, jusqu'a ce que le voyant clignote.",
  "Relachez et attendez une minute sans rien debrancher.",
];

const EVENT_LABEL = {
  device_joined: 'a rejoint le reseau',
  device_announce: "s'est annonce",
  started: 'identification en cours...',
  successful: 'identifie avec succes',
  failed: "echec de l'identification : recommencer l'appui",
};

function formatMS(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function signalLevel(lqi) {
  if (lqi == null) return null;
  if (lqi >= 100) return 'good';
  if (lqi >= 50) return 'fair';
  return 'poor';
}

export default function ZigbeeNetworkModal({ onClose }) {
  const [pairingOpen, setPairingOpen] = useState(false);
  // Pendant l'appairage on suit les evenements de pres
  const { data, error, loading, refresh } = usePolling(
    useCallback(() => api.get('/api/zigbee/overview'), []),
    pairingOpen ? 3000 : 30 * 1000
  );
  const [refreshing, setRefreshing] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const bridge = data?.bridge;
  const pairEnd = bridge?.permit_join && bridge.permit_join_end ? new Date(bridge.permit_join_end).getTime() : null;
  const remaining = pairEnd ? (pairEnd - now) / 1000 : 0;
  const isPairing = remaining > 0;

  useEffect(() => { setPairingOpen(isPairing); }, [isPairing]);

  useEffect(() => {
    if (!pairEnd) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairEnd]);

  // Le backend vide la liste a chaque ouverture de l'appairage
  const pairEvents = bridge?.events || [];

  const setPairing = async (seconds) => {
    setPairBusy(true);
    setPairError(null);
    try {
      await api.post('/api/zigbee/permit-join', { seconds });
      setNow(Date.now());
      refresh();
    } catch (err) {
      setPairError(err.response?.data?.error || "Impossible de joindre le boitier.");
    } finally {
      setPairBusy(false);
    }
  };

  const copySteps = async () => {
    const text = `Pour connecter l'appareil au kit Beaba :\n${ONSITE_STEPS.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papier indisponible */ }
  };

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

        <div className={`zbn-pair ${isPairing ? 'zbn-pair-on' : ''}`}>
          {!isPairing ? (
            <div className="zbn-pair-row">
              <div>
                <div className="zbn-pair-title">Ajouter un appareil a distance</div>
                <div className="zbn-pair-text">
                  Ouvre l'appairage pendant {Math.round(PAIR_SECONDS / 60)} min. Une personne sur place appuie
                  alors sur le bouton de l'appareil, et vous suivez le resultat ici.
                </div>
              </div>
              <button type="button" className="zbn-pair-btn" onClick={() => setPairing(PAIR_SECONDS)} disabled={pairBusy || !data}>
                {pairBusy ? 'Ouverture...' : "Autoriser l'appairage"}
              </button>
            </div>
          ) : (
            <>
              <div className="zbn-pair-row">
                <div>
                  <div className="zbn-pair-title">
                    Appairage ouvert <span className="zbn-pair-timer">{formatMS(remaining)}</span>
                  </div>
                  <div className="zbn-pair-text">A faire par la personne sur place :</div>
                </div>
                <div className="zbn-pair-actions">
                  <button type="button" className="zbn-refresh" onClick={copySteps}>
                    {copied ? 'Copie !' : 'Copier les consignes'}
                  </button>
                  <button type="button" className="zbn-refresh" onClick={() => setPairing(0)} disabled={pairBusy}>
                    Arreter
                  </button>
                </div>
              </div>
              <ol className="zbn-pair-steps">
                {ONSITE_STEPS.map((t) => <li key={t}>{t}</li>)}
              </ol>
            </>
          )}

          {pairEvents.length > 0 && (
            <ul className="zbn-pair-events">
              {pairEvents.map((e) => (
                <li key={`${e.ts}_${e.type}_${e.status}_${e.ieee_address}`} className={`zbn-ev-${e.status || e.type}`}>
                  <span className="zbn-meta">{new Date(e.ts).toLocaleTimeString('fr-BE')}</span>{' '}
                  <strong>{[e.vendor, e.model].filter(Boolean).join(' ') || e.friendly_name || e.ieee_address}</strong>{' '}
                  {EVENT_LABEL[e.status] || EVENT_LABEL[e.type] || e.type}
                </li>
              ))}
            </ul>
          )}
          {pairEvents.some((e) => e.status === 'successful') && (
            <div className="zbn-pair-text zbn-pair-next">
              L'appareil apparait ci-dessous en « Non declare ». Declarez-le ensuite dans la campagne
              (Ajouter des appareils, ou l'assistant de setup) pour que ses mesures soient conservees.
            </div>
          )}
          {pairError && <div className="zbn-pair-text zbn-error">{pairError}</div>}
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
