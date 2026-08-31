BEGIN;

-- Supabase owns extension functions as supabase_admin, so the migration role
-- cannot revoke the owner's default PUBLIC grants. Keep the runtime role out of
-- the extension schema and expose only this parameterized, visibility-filtered
-- search boundary instead.
CREATE FUNCTION sugi.search_product_candidates(
  search_user_id BIGINT,
  requested_terms TEXT[]
)
RETURNS TABLE (
  product_id BIGINT,
  variant_id BIGINT,
  term TEXT,
  search_score DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $search$
  WITH input_guard AS MATERIALIZED (
    SELECT CASE
      WHEN COALESCE(cardinality(requested_terms), 0) <= 8 THEN COALESCE((
        SELECT MAX(char_length(input_term)) <= 32
           AND SUM(char_length(input_term)) <= 128
        FROM unnest(requested_terms) AS input_term
      ), TRUE)
      ELSE FALSE
    END AS is_valid
  ),
  search_terms AS MATERIALIZED (
    SELECT DISTINCT requested_term AS term,
           CASE WHEN char_length(requested_term) >= 4 THEN 0.34::REAL ELSE 0::REAL END AS fuzzy_ratio
    FROM input_guard
    CROSS JOIN unnest(requested_terms) AS requested_term
    WHERE input_guard.is_valid
      AND requested_term <> ''
  ),
  product_pgroonga_matches AS MATERIALIZED (
    SELECT p.id AS product_id,
           search_terms.term,
           GREATEST(extensions.pgroonga_score(p.tableoid, p.ctid), 1)::DOUBLE PRECISION AS search_score
    FROM search_terms
    JOIN sugi.products AS p ON
      (ARRAY[p.product_name] || COALESCE(p.nicknames, ARRAY[]::TEXT[])) OPERATOR(extensions.&@~)
      extensions.pgroonga_condition(
        extensions.pgroonga_query_escape(search_terms.term),
        fuzzy_max_distance_ratio => search_terms.fuzzy_ratio
      )
    WHERE p.is_active = TRUE
      AND (p.user_id IS NULL OR p.user_id = search_user_id)
  ),
  product_trigram_matches AS MATERIALIZED (
    SELECT p.id AS product_id,
           search_terms.term,
           product_similarity.search_score * 10 AS search_score
    FROM search_terms
    CROSS JOIN sugi.products AS p
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        public.similarity(p.product_name, search_terms.term),
        COALESCE((
          SELECT MAX(public.similarity(nickname, search_terms.term))
          FROM unnest(COALESCE(p.nicknames, ARRAY[]::TEXT[])) AS nickname
        ), 0)
      )::DOUBLE PRECISION AS search_score
    ) AS product_similarity
    WHERE search_terms.fuzzy_ratio > 0
      AND product_similarity.search_score >= 0.4
      AND p.is_active = TRUE
      AND (p.user_id IS NULL OR p.user_id = search_user_id)
  ),
  product_matches AS MATERIALIZED (
    SELECT match_candidates.product_id,
           match_candidates.term,
           MAX(match_candidates.search_score)::DOUBLE PRECISION AS search_score
    FROM (
      SELECT * FROM product_pgroonga_matches
      UNION ALL
      SELECT * FROM product_trigram_matches
    ) AS match_candidates
    GROUP BY match_candidates.product_id, match_candidates.term
  ),
  variant_pgroonga_matches AS MATERIALIZED (
    SELECT pv.id AS variant_id,
           search_terms.term,
           GREATEST(extensions.pgroonga_score(pv.tableoid, pv.ctid), 1)::DOUBLE PRECISION AS search_score
    FROM search_terms
    JOIN sugi.product_variants AS pv ON
      (ARRAY[pv.variant_label, COALESCE(pv.display_shortcut, '')] || COALESCE(pv.nicknames, ARRAY[]::TEXT[])) OPERATOR(extensions.&@~)
      extensions.pgroonga_condition(
        extensions.pgroonga_query_escape(search_terms.term),
        fuzzy_max_distance_ratio => search_terms.fuzzy_ratio
      )
    JOIN sugi.products AS variant_parent ON variant_parent.id = pv.product_id
    WHERE pv.is_active = TRUE
      AND variant_parent.is_active = TRUE
      AND (variant_parent.user_id IS NULL OR variant_parent.user_id = search_user_id)
  ),
  variant_trigram_matches AS MATERIALIZED (
    SELECT pv.id AS variant_id,
           search_terms.term,
           variant_similarity.search_score * 10 AS search_score
    FROM search_terms
    CROSS JOIN sugi.product_variants AS pv
    JOIN sugi.products AS variant_parent ON variant_parent.id = pv.product_id
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        public.similarity(pv.variant_label, search_terms.term),
        public.similarity(COALESCE(pv.display_shortcut, ''), search_terms.term),
        COALESCE((
          SELECT MAX(public.similarity(nickname, search_terms.term))
          FROM unnest(COALESCE(pv.nicknames, ARRAY[]::TEXT[])) AS nickname
        ), 0)
      )::DOUBLE PRECISION AS search_score
    ) AS variant_similarity
    WHERE search_terms.fuzzy_ratio > 0
      AND variant_similarity.search_score >= 0.4
      AND pv.is_active = TRUE
      AND variant_parent.is_active = TRUE
      AND (variant_parent.user_id IS NULL OR variant_parent.user_id = search_user_id)
  ),
  variant_matches AS MATERIALIZED (
    SELECT match_candidates.variant_id,
           match_candidates.term,
           MAX(match_candidates.search_score)::DOUBLE PRECISION AS search_score
    FROM (
      SELECT * FROM variant_pgroonga_matches
      UNION ALL
      SELECT * FROM variant_trigram_matches
    ) AS match_candidates
    GROUP BY match_candidates.variant_id, match_candidates.term
  )
  SELECT product_matches.product_id,
         NULL::BIGINT AS variant_id,
         product_matches.term,
         product_matches.search_score
  FROM product_matches
  UNION ALL
  SELECT NULL::BIGINT AS product_id,
         variant_matches.variant_id,
         variant_matches.term,
         variant_matches.search_score
  FROM variant_matches
$search$;

REVOKE ALL ON FUNCTION sugi.search_product_candidates(BIGINT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sugi.search_product_candidates(BIGINT, TEXT[]) TO sugi_app;
REVOKE USAGE ON SCHEMA extensions FROM sugi_app;

DO $privilege_check$
BEGIN
  IF has_schema_privilege('sugi_app', 'extensions', 'USAGE') THEN
    RAISE EXCEPTION 'sugi_app must not have effective USAGE on extensions schema';
  END IF;
END
$privilege_check$;

COMMIT;
