import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'Agentic Connector Demo',
  description:
    'Demo of an async, AI-mediated care review transaction standard across Patient, Reviewing Org, Laboratory, and Payer.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <Link href="/" className="brand">Agentic Connector</Link>
          <Link href="/patient">Patient</Link>
          <Link href="/org">Reviewing Org</Link>
          <Link href="/lab">Laboratory</Link>
          <Link href="/payer">Payer</Link>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
