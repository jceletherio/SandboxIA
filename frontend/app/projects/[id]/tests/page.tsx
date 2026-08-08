'use client';

import { useParams } from 'next/navigation';

export default function TestPlansPage() {
  const params = useParams();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Testes</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Planos de teste por stack e nivel. Gerado por <code className="text-xs bg-muted px-1 rounded">/tests-release</code> ao final do desenvolvimento.
      </p>
      <div className="rounded-lg bg-muted/30 border border-border p-8 text-center text-sm text-muted-foreground">
        Em breve: tabela de cenarios por nivel (unit/functional/integration/e2e) e artefatos de trace (playwright trace.zip).
      </div>
    </div>
  );
}
