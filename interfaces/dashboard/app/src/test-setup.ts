import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { stubWebSocket } from './fake-websocket.ts';

// No test may open a real connection.
beforeEach(() => stubWebSocket());
afterEach(() => cleanup());
