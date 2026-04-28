import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './edit.css';

const root = document.getElementById('root');
if (!root) throw new Error('edit root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
