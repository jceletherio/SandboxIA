'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ListTodo,
  Terminal,
  MessageSquare,
  Clock,
  GitBranch,
  ScrollText,
  Settings,
  ChevronDown,
  Bot,
  Wrench,
  Network,
  ChevronRight,
  FileText,
  Menu,
  X,
  Layers,
  Check,
  Plus,
  Cpu,
  FolderGit2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useProject } from '@/lib/project-context'
import { useNavCounts } from '@/lib/nav-counts'
import { MobileNav } from '@/components/mobile-nav'

const navItems = [
  { href: '/pipelines', label: 'Pipelines', icon: Layers, countKey: 'pipelines' },
  { href: '/macro-tasks', label: 'Macro Tasks', icon: ListTodo, countKey: 'macroTasks' },
  // `alertKey`: contagem âmbar ao lado da normal. Travamento precisa aparecer
  // sem abrir /sessions — o toast de `session:stalled` cobre o instante em que
  // acontece, mas some, e quem chegou depois não via nada.
  { href: '/sessions', label: 'Sessions', icon: Terminal, countKey: 'sessions', alertKey: 'stalledSessions' },
  { href: '/terminal', label: 'Terminal', icon: Terminal, countKey: 'sessions' },
  { href: '/questions', label: 'Questions', icon: MessageSquare, countKey: 'questions', urgent: true },
  { href: '/scheduler', label: 'Scheduler', icon: Clock, countKey: 'scheduler', global: true },
  { href: '/git', label: 'Git', icon: GitBranch },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const toolItems = [
  { label: 'Agents', icon: Bot, href: '/agents', countKey: 'agents' },
  { label: 'Skills', icon: Wrench, href: '/skills', countKey: 'skills' },
  { label: 'MCPs', icon: Network, href: '/mcps', countKey: 'mcps', global: true },
  { label: 'Models', icon: Cpu, href: '/models', countKey: 'models', global: true },
]

function SidebarContent({ counts, onNavigate }: { counts: Record<string, number>; onNavigate?: () => void }) {
  const pathname = usePathname()
  const [toolsOpen, setToolsOpen] = useState(true)
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const { currentProject, projects, setCurrentProject, loading } = useProject()

  const isMasterAgent = pathname === '/master-agent'
  const isContext = pathname === '/context'
  const isDashboard = pathname === '/'

  return (
    <div className="flex flex-col h-full">
      {/* Logo / Project Header */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-sidebar-border shrink-0">
        <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground text-[10px] font-bold font-mono">OX</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-sidebar-accent-foreground leading-none truncate">
            orchestr
          </span>
          <span className="text-[10px] text-muted-foreground leading-none mt-0.5 font-mono">v0.9.4-beta</span>
        </div>
      </div>

      {/* Project selector */}
      <div className="px-3 py-2 border-b border-sidebar-border shrink-0 relative">
        <button 
          onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
          className="w-full flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md hover:bg-sidebar-accent transition-colors group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-1.5 h-1.5 rounded-full bg-status-running shrink-0" />
            <span className="text-xs font-medium text-sidebar-accent-foreground truncate">
              {loading ? 'Loading...' : currentProject?.name || 'No project'}
            </span>
          </div>
          <ChevronDown className={cn('w-3 h-3 text-muted-foreground shrink-0 transition-transform', projectDropdownOpen && 'rotate-180')} />
        </button>

        {/* Project dropdown */}
        {projectDropdownOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setProjectDropdownOpen(false)} 
            />
            <div className="absolute top-full left-3 right-3 mt-1 bg-card border border-border rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No projects available</div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      setCurrentProject(project)
                      setProjectDropdownOpen(false)
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-3 lg:py-2 text-sm lg:text-xs hover:bg-accent transition-colors text-left',
                      currentProject?.id === project.id && 'bg-accent/50'
                    )}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-status-running shrink-0" />
                    <span className="flex-1 truncate">{project.name}</span>
                    {currentProject?.id === project.id && (
                      <Check className="w-3 h-3 text-primary shrink-0" />
                    )}
                  </button>
                ))
              )}
              <div className="border-t border-border">
                <Link
                  href="/projects/new"
                  onClick={() => setProjectDropdownOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-3 lg:py-2 text-sm lg:text-xs hover:bg-accent transition-colors text-left text-primary"
                >
                  <Plus className="w-3 h-3" />
                  New Project
                </Link>
                <Link
                  href="/projects"
                  onClick={() => setProjectDropdownOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-3 lg:py-2 text-sm lg:text-xs hover:bg-accent transition-colors text-left text-muted-foreground"
                >
                  <FolderGit2 className="w-3 h-3" />
                  Manage projects
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* Dashboard */}
        <div className="space-y-0.5 mb-1">
          <Link
            href="/"
            onClick={onNavigate}
            className={cn(
              // py-2.5 no mobile: no drawer estes itens são alvo de toque, e
              // 1.5 dava ~26px de altura — metade do mínimo confortável.
              'flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md text-sm lg:text-xs transition-colors group',
              isDashboard
                ? 'bg-accent text-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <span className="flex items-center gap-2">
              <LayoutDashboard className={cn('w-3.5 h-3.5 shrink-0', isDashboard ? 'text-primary' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground')} />
              Dashboard
            </span>
          </Link>
        </div>

        {/* Master Agent — highlighted */}
        <div className="mb-1">
          <Link
            href="/master-agent"
            onClick={onNavigate}
            className={cn(
              // py-2.5 no mobile: no drawer estes itens são alvo de toque, e
              // 1.5 dava ~26px de altura — metade do mínimo confortável.
              'flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md text-sm lg:text-xs transition-colors group',
              isMasterAgent
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'text-primary/80 bg-primary/5 border border-primary/10 hover:bg-primary/15 hover:text-primary'
            )}
          >
            <span className="flex items-center gap-2">
              <Bot className="w-3.5 h-3.5 shrink-0 text-primary" />
              Master Agent
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          </Link>
        </div>

        {/* Context */}
        <div className="mb-3">
          <Link
            href="/context"
            onClick={onNavigate}
            className={cn(
              // py-2.5 no mobile: no drawer estes itens são alvo de toque, e
              // 1.5 dava ~26px de altura — metade do mínimo confortável.
              'flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md text-sm lg:text-xs transition-colors group',
              isContext
                ? 'bg-accent text-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <span className="flex items-center gap-2">
              <FileText className={cn('w-3.5 h-3.5 shrink-0', isContext ? 'text-primary' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground')} />
              Context
            </span>
          </Link>
        </div>

        {/* Divider */}
        <div className="border-t border-sidebar-border mb-2" />

        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href
            const count = item.countKey ? counts[item.countKey] : undefined
            const alert = (item as any).alertKey ? counts[(item as any).alertKey] : undefined
            const isGlobal = (item as any).global
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  // py-2.5 no mobile: no drawer estes itens são alvo de toque, e
              // 1.5 dava ~26px de altura — metade do mínimo confortável.
              'flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md text-sm lg:text-xs transition-colors group',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground')} />
                  {item.label}
                </span>
                <span className="flex items-center gap-1">
                  {alert !== undefined && alert > 0 && (
                    <span
                      title={`${alert} sessão(ões) travada(s) — sem output há mais que o limite do watchdog`}
                      className="text-[10px] font-mono px-1 py-0 rounded leading-4 bg-status-waiting/20 text-status-waiting"
                    >
                      ⚠ {alert}
                    </span>
                  )}
                  {count !== undefined && count > 0 && (
                    <span
                      className={cn(
                        'text-[10px] font-mono px-1 py-0 rounded leading-4',
                        item.urgent
                          ? 'bg-destructive/20 text-destructive'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {count}
                    </span>
                  )}
                  {isGlobal && (
                    <span className="text-[8px] font-mono text-muted-foreground/60 leading-3">G</span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Tools section */}
        <div className="mt-4">
          <button
            onClick={() => setToolsOpen(!toolsOpen)}
            className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-sidebar-foreground transition-colors"
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform', toolsOpen && 'rotate-90')} />
            Configuration
          </button>
          {toolsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {toolItems.map((item) => {
                const Icon = item.icon
                const active = pathname === item.href
                const count = item.countKey ? counts[item.countKey] : undefined
                const isGlobal = (item as any).global
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      // py-2.5 no mobile: no drawer estes itens são alvo de toque, e
              // 1.5 dava ~26px de altura — metade do mínimo confortável.
              'flex items-center justify-between px-2 py-2.5 lg:py-1.5 rounded-md text-sm lg:text-xs transition-colors group',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover:text-sidebar-accent-foreground" />
                      {item.label}
                    </span>
                    <span className="flex items-center gap-1">
                      {count !== undefined && count > 0 && (
                        <span className="text-[10px] font-mono px-1 py-0 rounded leading-4 bg-muted text-muted-foreground">
                          {count}
                        </span>
                      )}
                      {isGlobal && (
                        <span className="text-[8px] font-mono text-muted-foreground/60 leading-3">G</span>
                      )}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom status bar */}
      <div className="px-3 py-2 border-t border-sidebar-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse shrink-0" />
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            {currentProject ? currentProject.name : 'No project'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const counts = useNavCounts()
  const { currentProject } = useProject()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 h-dvh bg-sidebar border-r border-sidebar-border">
        <SidebarContent counts={counts} />
      </aside>

      {/* Mobile top bar — só identidade e estado. A navegação mora na barra
          inferior (`MobileNav`), na faixa que o dedo alcança; duplicar o botão
          de menu aqui em cima só gastaria o espaço que o nome do projeto usa. */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between gap-3 h-12 px-4 bg-sidebar border-b border-sidebar-border pt-[env(safe-area-inset-top)] box-content">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground text-[10px] font-bold font-mono">OX</span>
          </div>
          <span className="text-xs font-medium text-sidebar-accent-foreground truncate">
            {currentProject?.name || 'orchestr'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse" />
          <span className="text-[10px] font-mono text-muted-foreground">{counts.sessions || 0} active</span>
        </div>
      </div>

      <MobileNav onOpenMenu={() => setMobileOpen(true)} />

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative w-[min(17rem,85vw)] h-full bg-sidebar border-r border-sidebar-border flex flex-col z-10 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            {/* Close button */}
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-[calc(env(safe-area-inset-top)+0.5rem)] right-2 p-2 rounded-md hover:bg-sidebar-accent transition-colors z-10"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4 text-sidebar-foreground" />
            </button>
            <SidebarContent counts={counts} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
