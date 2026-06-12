import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  return <main className="shell app-shell">{children}</main>;
}
