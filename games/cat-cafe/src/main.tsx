/**
 * Entry point. Mounts the app into #root and nothing else.
 *
 * The stylesheet import order here is the whole of the app's cascade contract:
 * tokens first (custom properties must exist before anything reads them),
 * then the base/reset layer. Component stylesheets are imported by the
 * components themselves, which puts them after both by construction.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/tokens.css';
import '@/styles/base.css';
import { App } from '@/app';

const root = document.getElementById('root');
// A missing #root means index.html and this file have drifted. Failing loudly
// beats a null-dereference stack trace from deep inside React.
if (!root) {
  throw new Error('index.html is missing its <div id="root">, so the app cannot mount.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
