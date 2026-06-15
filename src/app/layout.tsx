import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'AutoHarness Studio – Visual Experiment IDE',
  description: 'Visual analysis and experiment command center for NeoSigma self-improving agents.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex antialiased">
        {/* Decorative Background Glows */}
        <div className="radial-glow top-0 left-1/4" />
        <div className="radial-glow bottom-0 right-10" />

        {/* Sidebar */}
        <Sidebar />

        {/* Main Workspace Scroll Area */}
        <main className="flex-1 flex flex-col h-screen overflow-y-auto">
          <div className="flex-1 p-8 max-w-7xl w-full mx-auto pb-16">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
