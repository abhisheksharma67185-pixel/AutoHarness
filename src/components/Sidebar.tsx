'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  Terminal,
  AlertTriangle,
  FlaskConical,
  GraduationCap
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/runs', label: 'Runs View', icon: Layers },
    { href: '/tasks', label: 'Task Explorer', icon: Terminal },
    { href: '/failures', label: 'Failure Modes', icon: AlertTriangle },
    { href: '/evals', label: 'Eval Suites', icon: GraduationCap },
    { href: '/experiments', label: 'Experiments', icon: FlaskConical },
  ];

  return (
    <aside className="w-64 border-r border-black/5 bg-white/70 backdrop-blur-md flex flex-col h-screen sticky top-0 shrink-0">
      {/* Brand Section */}
      <div className="p-6 border-b border-black/5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-purple-500/20">
          Σ
        </div>
        <div>
          <h1 className="font-bold text-sm leading-none tracking-tight text-slate-800">AutoHarness</h1>
          <span className="text-[10px] text-purple-600 font-semibold uppercase tracking-wider">Studio v1.0</span>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-purple-50 border-l-2 border-purple-600 text-purple-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-black/5'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-purple-600' : 'text-slate-400'} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer Section */}
      <div className="p-4 border-t border-black/5 bg-black/[0.02] text-center">
        <span className="text-[11px] text-slate-500 font-medium block">
          NeoSigma Agentic Flywheel
        </span>
      </div>
    </aside>
  );
}
