import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { resetCsrfToken } from '../api.ts';
import { SeedMark } from '../components/SeedMark.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { cn } from '../lib/utils.ts';

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
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl items-center px-6 text-center">
        <SeedMark size={96} dots={37} />
        <h1 className="m-0 text-2xl font-bold">Sun Flower</h1>
        <p className="m-0">Painel do servidor. Entre com a sua conta do Discord.</p>
        <Button asChild size="lg">
          <a href="/auth/login">Entrar com Discord</a>
        </Button>
        {error === undefined ? null : (
          <p
            role="alert"
            className={cn(
              'm-0 max-w-[52ch] text-sm',
              error.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {error.text}
          </p>
        )}
      </Card>
    </main>
  );
}
