#!/usr/bin/env python3
"""Research Sugi products with Firecrawl + MiniMax-M3 Hermes subagents.

Creates/updates two DB tables:
- product_research_sources: raw source snippets per product
- product_unique_features: customer-facing unique features per product

Default is safe: --dry-run does not write feature rows. Real writes require --write.

Required for real Firecrawl use:
  export FIRECRAWL_API_URL=http://<local-laptop-tailscale-ip>:3002
  # export FIRECRAWL_API_KEY=...   # only if your Firecrawl requires it

MiniMax-M3 summarization uses fresh Hermes oneshot workers:
  hermes -z <prompt> --provider minimax-oauth -m MiniMax-M3
"""
from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import asyncpg

try:
    from firecrawl import FirecrawlApp
except Exception:  # pragma: no cover - validated at runtime
    FirecrawlApp = None  # type: ignore

DSN = os.environ.get("SIGMA_RAG_PG_DSN", "postgresql://sigma_rag@127.0.0.1:5433/sigma_rag")
DEFAULT_HERMES = os.environ.get("HERMES_BIN") or shutil.which("hermes") or "/home/hermes/.local/bin/hermes"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS product_research_sources (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  source_provider TEXT NOT NULL DEFAULT 'firecrawl',
  markdown TEXT,
  sha256 TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, url, sha256)
);
CREATE INDEX IF NOT EXISTS idx_product_research_sources_product ON product_research_sources(product_id);

CREATE TABLE IF NOT EXISTS product_unique_features (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  features_ja JSONB NOT NULL DEFAULT '[]'::jsonb,
  features_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  features_zh JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_pitch_ja TEXT,
  customer_pitch_en TEXT,
  customer_pitch_zh TEXT,
  dosage_note_ja TEXT,
  caution_note_ja TEXT,
  source_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_unique_features_status ON product_unique_features(status, updated_at);
"""

@dataclass
class Product:
    id: int
    name: str
    category: str | None
    nicknames: list[str]


def clean_text(s: str, limit: int = 5000) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return s[:limit]


def as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    if hasattr(obj, "__dict__"):
        return dict(obj.__dict__)
    return {}


def normalize_search_results(raw: Any) -> list[dict[str, Any]]:
    data = as_dict(raw)
    candidates = data.get("data") or data.get("results") or data.get("web") or raw
    if isinstance(candidates, dict):
        candidates = candidates.get("data") or candidates.get("results") or candidates.get("web") or []
    out: list[dict[str, Any]] = []
    for item in candidates or []:
        d = as_dict(item)
        url = d.get("url") or d.get("link")
        if not url:
            continue
        out.append({
            "url": str(url),
            "title": d.get("title") or d.get("metadata", {}).get("title") or "",
            "markdown": d.get("markdown") or d.get("content") or d.get("description") or "",
        })
    return out


def get_firecrawl() -> Any:
    if FirecrawlApp is None:
        raise RuntimeError("firecrawl package is not importable")
    api_url = os.environ.get("FIRECRAWL_API_URL")
    if not api_url:
        raise RuntimeError("FIRECRAWL_API_URL is not set. Point it to your local laptop Firecrawl API, e.g. http://100.x.y.z:3002")
    return FirecrawlApp(api_key=os.environ.get("FIRECRAWL_API_KEY") or "", api_url=api_url, timeout=90)


def firecrawl_research_product(product: Product, *, limit: int = 4, scrape: bool = True) -> list[dict[str, Any]]:
    app = get_firecrawl()
    query = f"{product.name} 公式 効能 特徴 成分 用法"
    raw = app.search(query, limit=limit)
    results = normalize_search_results(raw)
    enriched: list[dict[str, Any]] = []
    for r in results[:limit]:
        md = r.get("markdown") or ""
        if scrape and (not md or len(md) < 500):
            try:
                scraped = app.scrape(r["url"], formats=["markdown"])  # firecrawl v2 client
                sd = as_dict(scraped)
                md = sd.get("markdown") or sd.get("data", {}).get("markdown") or md
                r["title"] = r.get("title") or sd.get("metadata", {}).get("title") or ""
            except Exception as e:
                md = md or f"[scrape_failed: {type(e).__name__}: {e}]"
        enriched.append({**r, "query": query, "markdown": clean_text(md, 7000)})
        time.sleep(0.25)
    return enriched


def build_prompt(product: Product, sources: list[dict[str, Any]]) -> str:
    source_text = "\n\n".join(
        f"SOURCE {i+1}\nTITLE: {s.get('title','')}\nURL: {s.get('url','')}\nTEXT: {clean_text(s.get('markdown',''), 3500)}"
        for i, s in enumerate(sources)
    )
    return textwrap.dedent(f"""
    You are researching a Japanese pharmacy product for Sugi Pharmacy counter sales.

    Product: {product.name}
    Category: {product.category or ''}
    Known nicknames/search aliases: {', '.join(product.nicknames[:12])}

    Evidence from Firecrawl:
    {source_text}

    Task:
    Extract ONLY source-supported, customer-facing unique features. Do not invent.
    Focus on what helps a staff member explain why this product is special vs similar products.
    Keep Japanese practical and natural for a pharmacy counter.
    Avoid unsafe medical claims. Include cautions only when clearly supported by sources.

    Return strict JSON only, no markdown fences:
    {{
      "features_ja": ["3-6 short bullet strings"],
      "features_en": ["same meaning in English"],
      "features_zh": ["same meaning in simplified Chinese"],
      "customer_pitch_ja": "one concise 1-2 sentence pitch",
      "customer_pitch_en": "English pitch",
      "customer_pitch_zh": "Chinese pitch",
      "dosage_note_ja": "source-supported dosage/use note or empty string",
      "caution_note_ja": "source-supported caution or empty string",
      "confidence": 0.0
    }}
    confidence: 0.85+ if official/manufacturer sources are clear; 0.6 if mostly retailer pages; <0.4 if weak/noisy.
    """).strip()


def parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise ValueError(f"No JSON object in model output: {text[:300]}")
    return json.loads(m.group(0))


def minimax_summarize(product: Product, sources: list[dict[str, Any]], *, timeout: int = 240) -> dict[str, Any]:
    prompt = build_prompt(product, sources)
    cmd = [DEFAULT_HERMES, "-z", prompt, "--provider", "minimax-oauth", "-m", "MiniMax-M3"]
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"Hermes MiniMax worker failed rc={proc.returncode}: {proc.stderr[-1000:]}")
    data = parse_json_object(proc.stdout)
    data["model"] = "MiniMax-M3 via Hermes oneshot"
    return data


async def migrate(conn: asyncpg.Connection) -> None:
    await conn.execute(SCHEMA_SQL)


async def load_products(conn: asyncpg.Connection, *, limit: int | None, product_ids: list[int], only_missing: bool) -> list[Product]:
    where = ["p.is_active = TRUE"]
    args: list[Any] = []
    if product_ids:
        args.append(product_ids)
        where.append(f"p.id = ANY(${len(args)}::bigint[])")
    if only_missing:
        where.append("NOT EXISTS (SELECT 1 FROM product_unique_features f WHERE f.product_id = p.id AND f.status = 'ready')")
    sql = f"""
      SELECT p.id, p.product_name, p.category, p.nicknames
      FROM products p
      WHERE {' AND '.join(where)}
      ORDER BY p.updated_at DESC, p.id
    """
    if limit:
        args.append(limit)
        sql += f" LIMIT ${len(args)}"
    rows = await conn.fetch(sql, *args)
    return [Product(int(r["id"]), r["product_name"], r["category"], list(r["nicknames"] or [])) for r in rows]


async def store_sources(conn: asyncpg.Connection, product: Product, sources: list[dict[str, Any]]) -> list[str]:
    urls: list[str] = []
    for s in sources:
        url = s.get("url") or ""
        if not url:
            continue
        md = s.get("markdown") or ""
        sha = hashlib.sha256((url + "\n" + md).encode()).hexdigest()
        urls.append(url)
        await conn.execute(
            """
            INSERT INTO product_research_sources(product_id, query, url, title, markdown, sha256)
            VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT (product_id, url, sha256) DO NOTHING
            """,
            product.id, s.get("query") or "", url, s.get("title") or "", md, sha,
        )
    return sorted(set(urls))


async def store_features(conn: asyncpg.Connection, product: Product, data: dict[str, Any], urls: list[str]) -> None:
    def arr(key: str) -> str:
        v = data.get(key) or []
        if not isinstance(v, list):
            v = []
        return json.dumps([str(x).strip() for x in v if str(x).strip()][:8], ensure_ascii=False)
    confidence = float(data.get("confidence") or 0)
    confidence = max(0.0, min(1.0, confidence))
    status = "ready" if confidence >= 0.45 and data.get("features_ja") else "needs_review"
    await conn.execute(
        """
        INSERT INTO product_unique_features(
          product_id, product_name, features_ja, features_en, features_zh,
          customer_pitch_ja, customer_pitch_en, customer_pitch_zh,
          dosage_note_ja, caution_note_ja, source_urls, confidence, model, status, updated_at
        ) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
        ON CONFLICT(product_id) DO UPDATE SET
          product_name=EXCLUDED.product_name,
          features_ja=EXCLUDED.features_ja,
          features_en=EXCLUDED.features_en,
          features_zh=EXCLUDED.features_zh,
          customer_pitch_ja=EXCLUDED.customer_pitch_ja,
          customer_pitch_en=EXCLUDED.customer_pitch_en,
          customer_pitch_zh=EXCLUDED.customer_pitch_zh,
          dosage_note_ja=EXCLUDED.dosage_note_ja,
          caution_note_ja=EXCLUDED.caution_note_ja,
          source_urls=EXCLUDED.source_urls,
          confidence=EXCLUDED.confidence,
          model=EXCLUDED.model,
          status=EXCLUDED.status,
          updated_at=now()
        """,
        product.id, product.name, arr("features_ja"), arr("features_en"), arr("features_zh"),
        str(data.get("customer_pitch_ja") or "")[:1200],
        str(data.get("customer_pitch_en") or "")[:1200],
        str(data.get("customer_pitch_zh") or "")[:1200],
        str(data.get("dosage_note_ja") or "")[:1000],
        str(data.get("caution_note_ja") or "")[:1000],
        urls,
        confidence,
        data.get("model") or "MiniMax-M3",
        status,
    )


async def process_product(conn: asyncpg.Connection, product: Product, *, args: argparse.Namespace, executor: concurrent.futures.Executor) -> tuple[int, str, str]:
    loop = asyncio.get_running_loop()
    try:
        if args.no_firecrawl:
            sources = []
        else:
            sources = await loop.run_in_executor(executor, lambda: firecrawl_research_product(product, limit=args.sources, scrape=not args.no_scrape))
        urls = await store_sources(conn, product, sources) if args.write else [s.get("url", "") for s in sources if s.get("url")]
        if not sources:
            return product.id, product.name, "no_sources"
        if args.no_ai:
            return product.id, product.name, f"sources={len(sources)}"
        data = await loop.run_in_executor(executor, lambda: minimax_summarize(product, sources, timeout=args.ai_timeout))
        if args.write:
            await store_features(conn, product, data, urls)
            return product.id, product.name, f"stored confidence={float(data.get('confidence') or 0):.2f} sources={len(urls)}"
        print(json.dumps({"product_id": product.id, "product_name": product.name, "preview": data, "sources": urls}, ensure_ascii=False, indent=2))
        return product.id, product.name, "dry_run_preview"
    except Exception as e:
        return product.id, product.name, f"ERROR {type(e).__name__}: {e}"


async def main_async(args: argparse.Namespace) -> int:
    if args.write and args.dry_run:
        raise SystemExit("Use either --write or --dry-run, not both")
    conn = await asyncpg.connect(DSN)
    try:
        await migrate(conn)
        products = await load_products(conn, limit=args.limit, product_ids=args.product_id, only_missing=args.only_missing)
        print(f"Loaded {len(products)} active products")
        if not products:
            return 0
        if not args.write:
            print("DRY RUN: feature rows will not be written. Use --write to upsert product_unique_features.")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            sem = asyncio.Semaphore(args.concurrency)
            async def one(p: Product):
                async with sem:
                    result = await process_product(conn, p, args=args, executor=ex)
                    print(f"[{result[0]}] {result[1]} -> {result[2]}", flush=True)
                    return result
            results = await asyncio.gather(*(one(p) for p in products))
        errors = [r for r in results if r[2].startswith("ERROR")]
        print(f"Done. products={len(results)} errors={len(errors)}")
        return 1 if errors else 0
    finally:
        await conn.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--write", action="store_true", help="Actually upsert researched feature rows")
    p.add_argument("--dry-run", action="store_true", default=True, help="Preview only (default)")
    p.add_argument("--limit", type=int, default=3, help="Max products to process; use 0 for all")
    p.add_argument("--product-id", type=int, action="append", default=[], help="Specific product id(s) to process")
    p.add_argument("--only-missing", action="store_true", default=True, help="Skip products already status=ready")
    p.add_argument("--include-existing", dest="only_missing", action="store_false", help="Reprocess existing ready rows too")
    p.add_argument("--sources", type=int, default=4, help="Firecrawl search result count per product")
    p.add_argument("--concurrency", type=int, default=3, help="Parallel product workers / Hermes oneshot subagents")
    p.add_argument("--ai-timeout", type=int, default=240, help="Seconds per MiniMax-M3 Hermes worker")
    p.add_argument("--no-ai", action="store_true", help="Only collect/store Firecrawl sources")
    p.add_argument("--no-firecrawl", action="store_true", help="Skip Firecrawl; useful for migration/schema smoke tests")
    p.add_argument("--no-scrape", action="store_true", help="Use search snippets only; don't scrape result URLs")
    ns = p.parse_args(argv)
    if ns.limit == 0:
        ns.limit = None
    if ns.write:
        ns.dry_run = False
    ns.concurrency = max(1, min(8, ns.concurrency))
    return ns


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
