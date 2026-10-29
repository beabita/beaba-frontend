import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import './LoginPage.css';

// Cible du magic link. Le token n'est consomme qu'au clic : les antivirus de
// messagerie qui ouvrent le lien avant le conseiller ne le grillent plus.
export default function VerifyLoginPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  if (!token) return <Navigate to="/login?error=expired" replace />;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await api.post('/api/auth/verify', { token });
      await refreshAuth();
      navigate('/app', { replace: true });
    } catch {
      navigate('/login?error=expired', { replace: true });
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/beaba_banner.png" alt="Beaba" className="login-logo" />
        <h1 className="login-title">Connexion conseiller</h1>
        <div className="login-form">
          <button
            type="button"
            className="login-button"
            onClick={handleConfirm}
            disabled={submitting}
            autoFocus
          >
            {submitting ? 'Connexion...' : 'Se connecter à Beaba'}
          </button>
        </div>
        <Link to="/" className="login-back">Retour à l'accueil</Link>
      </div>
    </div>
  );
}
