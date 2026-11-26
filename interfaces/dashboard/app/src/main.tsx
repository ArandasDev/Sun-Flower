import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { makeQueryClient } from './query-client.ts';
import { installStyleNonce } from './style-nonce.ts';
import { applyTheme, readThemeChoice } from './theme.ts';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element.');

installStyleNonce();
applyTheme(readThemeChoice());

const client = makeQueryClient();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
