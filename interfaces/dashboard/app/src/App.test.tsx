import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App.tsx';

it('renders without crashing', () => {
  const { container } = render(<App />);
  expect(container).toBeInTheDocument();
});
