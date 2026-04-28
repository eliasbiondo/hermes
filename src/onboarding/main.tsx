import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './onboarding.css';

const root = document.getElementById('root');
if (!root) throw new Error('onboarding root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
