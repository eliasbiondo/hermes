import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../components/select.css';
import './options.css';

const root = document.getElementById('root');
if (!root) throw new Error('options root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
