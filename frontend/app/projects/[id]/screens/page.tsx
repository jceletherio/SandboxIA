'use client';

import { useParams } from 'next/navigation';

export default function ScreensGallery() {
  const params = useParams();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Telas</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Upload de prototipos visuais (.png/.jpg/.fig). Cada tela e descrita pelo LLM vision e referenciada nas specs Angular.
      </p>
      <div className="rounded-lg bg-muted/30 border border-border p-8 text-center text-sm text-muted-foreground">
        Em breve: galeria de telas com thumbnails e descricoes estruturadas.
        <br />Use <code className="text-xs bg-muted px-1 rounded">/req-add meuarquivo.png</code> no chat para adicionar telas.
      </div>
    </div>
  );
}
