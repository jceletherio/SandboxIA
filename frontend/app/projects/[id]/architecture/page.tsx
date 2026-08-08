'use client';

import { useParams } from 'next/navigation';

export default function ArchitectureViewer() {
  const params = useParams();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Arquitetura</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Documentacao de arquitetura com diagramas Mermaid renderizados. Gerado por <code className="text-xs bg-muted px-1 rounded">/generate-architecture</code>.
      </p>
      <div className="rounded-lg bg-muted/30 border border-border p-8 text-center text-sm text-muted-foreground">
        Em breve: visualizador de overview.md e docs por stack com Mermaid renderizado.
      </div>
    </div>
  );
}
