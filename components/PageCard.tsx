import type { ReactNode } from 'react';

type Props = {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
};

export function PageCard({ title, description, action, children, className = '', 'aria-label': ariaLabel }: Props) {
  return (
    <section className={`page-card ${className}`.trim()} aria-label={ariaLabel}>
      {(title || description || action) && (
        <div className="section-heading-row">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
