'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CARD_COPY,
  CARD_SECTION_ORDER,
  CUSTOMER_LANGUAGES,
  badgeText,
  type CustomerInfoCard as Card,
  type CustomerLanguage,
} from '@/domain/customer-info/customer-info';
import { getCachedCards, readCardLanguage, saveCardLanguage } from '@/lib/customer-info-cache';

type Cards = Partial<Record<CustomerLanguage, Card>>;

async function fetchCards(productId: number): Promise<Cards> {
  const cards: Cards = {};
  await Promise.all(CUSTOMER_LANGUAGES.map(async (language) => {
    const response = await fetch(`/api/products/${productId}/customer-info?lang=${language}`, { cache: 'no-store' }).catch(() => null);
    if (response?.status === 200) cards[language] = await response.json() as Card;
  }));
  return cards;
}

/**
 * Full-screen card staff turn toward the customer. Reads the device cache
 * first so it opens with no signal; it never touches the sale queue.
 */
export function CustomerInfoCard({ productId, productName, onClose }: { productId: number; productName: string; onClose: () => void }) {
  const [cards, setCards] = useState<Cards | null>(null);
  const [language, setLanguage] = useState<CustomerLanguage>('en');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLanguage(readCardLanguage());
    void (async () => {
      const cached = await getCachedCards(productId);
      if (cancelled) return;
      if (cached && Object.keys(cached.cards).length > 0) {
        setCards(cached.cards);
        return;
      }
      const fetched = await fetchCards(productId);
      if (!cancelled) setCards(fetched);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const languages = CUSTOMER_LANGUAGES.filter((code) => cards?.[code]);
  const activeLanguage = cards?.[language] ? language : languages[0];
  const card = activeLanguage ? cards?.[activeLanguage] : undefined;
  const copy = CARD_COPY[activeLanguage ?? 'en'];

  function choose(next: CustomerLanguage) {
    setLanguage(next);
    saveCardLanguage(next);
  }

  return (
    <div className="customer-info-overlay" role="dialog" aria-modal="true" aria-labelledby="customer-info-title" lang={activeLanguage ?? 'en'}>
      <div className="customer-info-sheet">
        <div className="customer-info-toolbar">
          {languages.length > 0 && (
            <div className="customer-info-toggle" role="group" aria-label="Language">
              {languages.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={code === activeLanguage ? 'active' : ''}
                  aria-pressed={code === activeLanguage}
                  onClick={() => choose(code)}
                  lang={code}
                >
                  {CARD_COPY[code].toggle}
                </button>
              ))}
            </div>
          )}
          <button ref={closeRef} type="button" className="customer-info-close" onClick={onClose} aria-label={copy.close}>×</button>
        </div>

        {cards === null ? (
          <p className="customer-info-status" aria-live="polite">…</p>
        ) : !card ? (
          <div className="customer-info-status">
            <h2 id="customer-info-title" lang="ja">{productName}</h2>
            <p lang="ja">準備中 — この商品のお客様向け情報はまだありません。</p>
            <p>Customer information for this product is not available yet.</p>
          </div>
        ) : (
          <article className="customer-info-body">
            <header>
              <h2 id="customer-info-title">{card.fields.display_name}</h2>
              <p className="customer-info-ja-name" lang="ja">{card.product_name}</p>
              <p className="customer-info-badge">{badgeText(card)}</p>
            </header>
            {CARD_SECTION_ORDER.map((key) => card.fields[key] ? (
              <section key={key} className={`customer-info-section customer-info-${key}`}>
                <h3>{copy.sections[key]}</h3>
                <p>{card.fields[key]}</p>
              </section>
            ) : null)}
            {card.product_type === 'supplement' && <p className="customer-info-note">{copy.supplementNote}</p>}
            <footer className="customer-info-disclaimer">{copy.disclaimer}</footer>
          </article>
        )}
      </div>
    </div>
  );
}

/** ⓘ entry point on a family card. Hidden for private products (FR-2). */
export function CustomerInfoButton({ available, productName, onOpen }: { available: boolean; productName: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="customer-info-button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      disabled={!available}
      aria-label={available ? `Customer info: ${productName}` : `Customer info not ready: ${productName}`}
      title={available ? 'お客様向け情報' : '準備中'}
    >
      <span aria-hidden="true">ⓘ</span>
      {!available && <small>準備中</small>}
    </button>
  );
}
