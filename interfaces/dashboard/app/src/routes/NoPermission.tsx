import { Card, CardHeader } from '../components/ui/card.tsx';

export function NoPermission() {
  return (
    <section className="flex justify-center py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <h1 className="m-0 text-xl font-semibold">Sem permissão.</h1>
        </CardHeader>
      </Card>
    </section>
  );
}
