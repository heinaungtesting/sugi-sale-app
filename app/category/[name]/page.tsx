import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { ProductTapList } from '@/components/ProductTapList';
import { currentUser } from '@/lib/auth';
import { listProductsByCategory, todaySummary } from '@/lib/sugi-db';

export const dynamic = 'force-dynamic';

export default async function CategoryPage({ params }: { params: Promise<{ name: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { name } = await params;
  const category = decodeURIComponent(name);
  const [products, today] = await Promise.all([listProductsByCategory(user.id, category), todaySummary(user.id)]);

  return (
    <main className="shell">
      <AppHeader user={user} totalPoints={today.total_points} totalItems={today.total_items} backHref="/" />
      <h2 className="section-title">{category}</h2>
      {products.length === 0 ? <p className="muted">No products in this category.</p> : <ProductTapList products={products} />}
    </main>
  );
}
