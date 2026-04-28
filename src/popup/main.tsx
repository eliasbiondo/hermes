import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../components/select.css';
import '../components/checkbox.css';
import './popup.css';

const root = document.getElementById('root');
if (!root) throw new Error('popup root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
