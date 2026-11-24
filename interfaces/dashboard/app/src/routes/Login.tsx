import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { resetCsrfToken } from '../api.ts';
import { SeedMark } from '../components/SeedMark.tsx';

const ERRORS: Record<string, { text: string; tone: 'alert' | 'seed' }> = {
  dev_not_member: {
    text: 'Desenvolvedores precisam ser membros do servidor para acessar o painel. Isso faz parte da segurança do projeto: limita o estrago se uma conta for invadida.',
    tone: 'alert',
  },
  not_member: { text: 'Só membros do servidor podem acessar o painel.', tone: 'alert' },
  retry: {
    text: 'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.',
    tone: 'seed',
  },
  failed: { text: 'Não foi possível entrar. Tente de novo.', tone: 'alert' },
};

export function Login() {
  // Any way of arriving here means the session is over: nothing from it may stay in memory.
  const client = useQueryClient();
  useEffect(() => {
    resetCsrfToken();
    client.clear();
  }, [client]);
  const [params] = useSearchParams();
  const code = params.get('error');
  const error = code !== null && Object.hasOwn(ERRORS, code) ? ERRORS[code] : undefined;
  return (
    <main className="login">
      <SeedMark size={96} dots={37} />
      <h1>Sun Flower</h1>
      <p>Painel do servidor. Entre com a sua conta do Discord.</p>
      <a className="button button-primary" href="/auth/login">
        Entrar com Discord
      </a>
      {error === undefined ? null : (
        <p role="alert" className={`login-error login-error-${error.tone}`}>
          {error.text}
        </p>
      )}
    </main>
  );
}
