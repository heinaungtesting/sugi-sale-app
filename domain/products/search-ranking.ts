// Product search is a domain concern. The implementation remains backward-compatible
// through lib/sugi-domain while callers migrate to this stable boundary.
export {
  groupProductsIntoFamilies,
  rankProductsForSearch,
  type ProductFamily,
  type ProductVariant,
  type SearchableProduct,
} from '@/lib/sugi-domain';
