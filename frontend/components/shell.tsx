import { Sidebar } from './sidebar'

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    // h-dvh, não h-screen: no celular `100vh` inclui a barra de endereço que o
    // navegador esconde ao rolar, e o rodapé da página ficava fora da tela.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar />
      {/* Mobile: espaço para a barra fixa de cima e para a MobileNav de baixo,
          somando os insets do notch/gesture bar. */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col pt-[calc(3rem+env(safe-area-inset-top))] lg:pt-0 pb-[calc(3.25rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
    </div>
  )
}
