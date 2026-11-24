import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element.');

const client = new QueryClient();

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
